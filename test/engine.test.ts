import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AI, validateItem } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import { classifyByKeyword, interpretAction, interpretConfirm, interpretPick } from '../src/engine/interpret.ts';
import type { Content, EngineInput, Outbound, RunState } from '../src/engine/types.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { Store } from '../src/store/store.ts';
import { playRun } from '../scripts/simulate.ts';

const contents = loadAllContent(join(import.meta.dirname, '..', 'content'));
const content = contents.en;
const zh = contents.zh;
const env = { numbered: false, now: 0 };

function feed(s: RunState, input: EngineInput, c: Content = content) {
  return step(s, input, c, env);
}

/** A run that is sitting at the given stage's event, carrying `modId`. */
function runAt(stage: number, eventId: string, modId: string, c: Content = content, label = 'scarf'): RunState {
  let s = newRun('t', 1, c, 0);
  s = feed(s, { type: 'start' }, c).state;
  s = feed(s, { type: 'item_scanned', item: { modId, label, blurb: 'x' } }, c).state;
  s = feed(s, { type: 'confirm', yes: true }, c).state;
  return { ...s, stage, eventId, phase: 'action', clarifyCount: 0, numberedShown: false };
}

function textOf(o: Outbound): string[] {
  switch (o.t) {
    case 'text': return [o.text];
    case 'scene': return [o.title];
    case 'fx': return [o.text, o.label];
    case 'gear_card': return [o.card.name, o.card.subtitle, o.card.effectText, o.card.blurb ?? ''];
    case 'report': return [o.report.title, o.report.item?.label ?? '', o.report.item?.name ?? '', ...o.report.upgrades.map((u) => u.name), ...o.report.combos.map((k) => k.name)];
  }
}

/** Play many runs in one language, poking every awkward path, and collect every string shown to the player. */
function collectAllOutput(c: Content, itemLabel: string): string[] {
  const seen: string[] = [];
  const go = (s: RunState, input: EngineInput, numbered = false) => {
    const r = step(s, input, c, { numbered, now: 0 });
    r.out.forEach((o) => seen.push(...textOf(o)));
    return r.state;
  };
  for (const mod of c.mods) {
    for (let seed = 0; seed < 60; seed++) {
      let s = newRun('x', seed * 97 + 5, c, 0);
      let pick = seed;
      s = go(s, { type: 'start' });
      s = go(s, { type: 'nudge' });
      if (seed % 5 === 0) {
        // failed scan → retry → failed again → standard supplies
        s = go(s, { type: 'scan_failed' });
        s = go(s, { type: 'nudge' });
        s = go(s, { type: 'scan_choice', retry: true });
        s = go(s, { type: 'scan_failed' });
      } else {
        const blurb = mod.blurb.replace('{label}', itemLabel);
        s = go(s, { type: 'item_scanned', item: { modId: mod.id, label: itemLabel, blurb } });
        s = go(s, { type: 'nudge' });
        if (seed % 7 === 0) s = go(s, { type: 'confirm', yes: false });
        if (s.phase === 'await_item') s = go(s, { type: 'item_scanned', item: { modId: mod.id, label: itemLabel, blurb } });
        if (s.phase === 'confirm_item') s = go(s, { type: 'confirm', yes: true });
        if (s.phase === 'scan_failed') s = go(s, { type: 'scan_choice', retry: false });
      }
      for (let guard = 0; guard < 60 && s.phase !== 'ended'; guard++) {
        if (s.phase === 'pick') {
          if (guard % 3 === 0) s = go(s, { type: 'nudge' });
          s = go(s, { type: 'pick', index: pick++ % (s.offer?.length ?? 1) });
        } else {
          if (guard % 4 === 0) {
            s = go(s, { type: 'photo_not_now' });
            s = go(s, { type: 'unclear', candidates: [], multi: true });
            s = go(s, { type: 'unclear', candidates: ['swerve', 'punch'] });
            s = go(s, { type: 'unclear', candidates: [] });
            s = go(s, { type: 'unclear', candidates: [] });
          }
          const pool = c.stages.find((x) => x.n === s.stage)!.pool.find((e) => e.id === s.eventId)!.actions;
          const a = pool[(seed + guard) % pool.length];
          s = go(s, { type: 'choose', actionId: a.id }, seed % 3 === 0);
          if (s.phase === 'action' && s.history.at(-1)?.actionId !== a.id) s = go(s, { type: 'choose', actionId: pool[0].id });
        }
      }
      s = go(s, { type: 'nudge' });
    }
  }
  return seen;
}

describe('languages', () => {
  it('a full Chinese run shows no English', () => {
    const bad = [...new Set(collectAllOutput(zh, '围巾').filter((t) => /[A-Za-z]/.test(t)))];
    assert.deepEqual(bad, [], `English found in Chinese output:\n${bad.join('\n')}`);
  });

  it('a full English run shows no Chinese', () => {
    const bad = [...new Set(collectAllOutput(content, 'scarf').filter((t) => /[㐀-鿿]/.test(t)))];
    assert.deepEqual(bad, []);
  });

  it('Chinese has the same ids and numbers as English', () => {
    assert.deepEqual(zh.stages.map((s) => s.pool.map((e) => e.actions.map((a) => [a.id, a.outcome?.delta, a.chance?.p]))),
      content.stages.map((s) => s.pool.map((e) => e.actions.map((a) => [a.id, a.outcome?.delta, a.chance?.p]))));
    assert.deepEqual(zh.upgrades.map((u) => u.effects), content.upgrades.map((u) => u.effects));
  });

  it('English grammar: plurals and list commas', () => {
    let s = feed(newRun('t', 1, content, 0), { type: 'start' }).state;
    const guess = feed(s, { type: 'item_scanned', item: { modId: 'hatch_wrench', label: 'keys', blurb: 'your keys, ground down' } });
    assert.match((guess.out[0] as { text: string }).text, /^I think these are keys\. I can rig them into a Hatch Repair Wrench/);
    const thermos = feed(s, { type: 'item_scanned', item: { modId: 'emergency_air_tank', label: 'thermos', blurb: 'your thermos, sealed' } });
    assert.match((thermos.out[0] as { text: string }).text, /^I think this is a thermos\. I can rig it into/);
    s = feed(s, { type: 'scan_failed' }).state;
    s = feed(s, { type: 'scan_choice', retry: false }).state;
    assert.equal(s.item?.label, 'standard supplies');
    const end = { ...s, stage: 5, eventId: 'boulder_field', phase: 'action' as const, res: { fuel: 50, oxygen: 50, hull: 50 } };
    const out = feed(end, { type: 'choose', actionId: 'hover' }).out.flatMap(textOf).join('\n');
    assert.match(out, /Your standard supplies are the first thing/);

    const o2 = { ...runAt(4, 'o2_failure', 'impact_pad'), upgrades: ['co2_scrubber'] };
    const prompt = feed(o2, { type: 'nudge' }).out.flatMap(textOf).join('');
    assert.match(prompt, /for parts, keep it and ration the air, reroute through the life-support upgrade, or try something with your scarf\./);
  });
});

describe('engine', () => {
  it('every item can finish hundreds of runs without getting stuck', () => {
    for (const mod of content.mods) for (let i = 0; i < 150; i++) {
      const s = playRun(content, i * 31 + 7, mod.id, i % 2 ? 'smart' : 'random');
      assert.ok(s.ending, 'run ended');
      for (const v of Object.values(s.res)) assert.ok(v >= 0 && v <= content.max);
      assert.equal(new Set(s.upgrades).size, s.upgrades.length, 'no duplicate upgrades');
      assert.equal(new Set(s.combos).size, s.combos.length, 'no duplicate combos');
    }
  });

  it('is deterministic for a given seed', () => {
    const a = playRun(content, 42, 'impact_pad', 'random');
    const b = playRun(content, 42, 'impact_pad', 'random');
    assert.deepEqual(a.res, b.res);
    assert.deepEqual(a.history, b.history);
  });

  it('does not mutate the input state', () => {
    const s = runAt(2, 'debris_field', 'impact_pad');
    const before = JSON.stringify(s);
    feed(s, { type: 'choose', actionId: 'swerve' });
    assert.equal(JSON.stringify(s), before);
  });

  it('one retake, then standard supplies', () => {
    let s = feed(newRun('t', 1, content, 0), { type: 'start' }).state;
    s = feed(s, { type: 'scan_failed' }).state;
    assert.equal(s.phase, 'scan_failed');
    s = feed(s, { type: 'scan_choice', retry: true }).state;
    assert.equal(s.phase, 'await_item');
    s = feed(s, { type: 'scan_failed' }).state;
    assert.equal(s.item?.modId, 'standard_supplies');
    assert.equal(s.phase, 'action');
  });

  it('stage 4 strip consumes the item', () => {
    let s = runAt(4, 'o2_failure', 'impact_pad');
    s = feed(s, { type: 'choose', actionId: 'strip' }).state;
    assert.equal(s.item?.status, 'consumed');
  });

  it('pick 2 guarantees a combo partner when one exists', () => {
    for (let seed = 0; seed < 100; seed++) {
      let s = runAt(2, 'debris_field', 'impact_pad');
      s = { ...s, rng: seed };
      s = feed(s, { type: 'choose', actionId: 'swerve' }).state;
      if (s.phase !== 'pick') continue;
      assert.ok(s.offer!.includes('reinforced_plating'), `seed ${seed}: offer ${s.offer}`);
    }
  });

  it('combo activates exactly once', () => {
    let s = runAt(2, 'debris_field', 'impact_pad');
    s = { ...s, phase: 'pick', offer: ['reinforced_plating', 'fuel_cell', 'patch_kit'], pickIndex: 1 };
    const r = feed(s, { type: 'pick', index: 0 });
    assert.deepEqual(r.state.combos, ['crash_couch']);
    assert.equal(r.out.filter((o) => o.t === 'fx' && o.fx === 'combo').length, 1);
  });

  it('unclear → clarify once → numbered list → short reminder', () => {
    const s = runAt(2, 'debris_field', 'impact_pad');
    const texts: string[] = [];
    let cur = s;
    for (let i = 0; i < 3; i++) {
      const r = feed(cur, { type: 'unclear', candidates: [] });
      texts.push((r.out[0] as { text: string }).text);
      cur = r.state;
    }
    assert.match(texts[0], /^Say again\?/);
    assert.match(texts[1], /reply with a number/i);
    assert.match(texts[2], /^I still need a number/);
    assert.notEqual(texts[1], texts[2]);
  });
});

describe('interpret', () => {
  it('numbers map to visible options', () => {
    const s = runAt(2, 'debris_field', 'impact_pad');
    assert.deepEqual(interpretAction(s, content, '1'), { kind: 'action', id: 'swerve' });
    assert.deepEqual(interpretAction(s, content, '9'), { kind: 'none' });
  });

  it('keywords, negation, ambiguity, multi-step', () => {
    const s = runAt(2, 'debris_field', 'impact_pad');
    assert.deepEqual(interpretAction(s, content, 'Swerve!'), { kind: 'action', id: 'swerve' });
    assert.deepEqual(interpretAction(s, content, "don't swerve, punch it"), { kind: 'action', id: 'punch' });
    assert.equal(interpretAction(s, content, 'dodge it or push straight').kind, 'ambiguous');
    assert.equal(interpretAction(s, content, 'swerve then punch through').kind, 'ambiguous');
    assert.equal(interpretAction(s, content, 'swerve and then wait').kind, 'multi');
    assert.equal(interpretAction(s, content, 'sing a song').kind, 'none');
  });

  it('Chinese: numbers, keywords, negation, multi-step', () => {
    const s = runAt(2, 'debris_field', 'impact_pad', zh, '围巾');
    assert.deepEqual(interpretAction(s, zh, '选2'), { kind: 'action', id: 'punch' });
    assert.deepEqual(interpretAction(s, zh, '第一个'), { kind: 'action', id: 'swerve' });
    assert.deepEqual(interpretAction(s, zh, '２'), { kind: 'action', id: 'punch' });
    assert.deepEqual(interpretAction(s, zh, '绕开！'), { kind: 'action', id: 'swerve' });
    assert.deepEqual(interpretAction(s, zh, '别绕开，硬闯过去'), { kind: 'action', id: 'punch' });
    assert.deepEqual(interpretAction(s, zh, 'swerve'), { kind: 'action', id: 'swerve' }, 'English words still work in a Chinese run');
    assert.equal(interpretAction(s, zh, '先躲开然后硬闯').kind, 'ambiguous');
    assert.equal(interpretAction(s, zh, '躲开，然后等一下').kind, 'multi');
    assert.equal(interpretAction(s, zh, '唱首歌吧').kind, 'none');
    assert.deepEqual(interpretAction({ ...s, upgrades: ['deflector_shield'] }, zh, '开启护盾'), { kind: 'action', id: 'shields' });

    const o2 = runAt(4, 'o2_failure', 'impact_pad', zh, '围巾');
    assert.deepEqual(interpretAction(o2, zh, '用围巾堵住漏洞'), { kind: 'action', id: 'plug' });
    assert.deepEqual(interpretAction(o2, zh, '不拆，保留它'), { kind: 'action', id: 'keep' });
    assert.deepEqual(interpretAction(o2, zh, '拆掉吧'), { kind: 'action', id: 'strip' });

    const land = runAt(5, 'boulder_field', 'impact_pad', zh, '围巾');
    assert.deepEqual(interpretAction(land, zh, '手动驾驶'), { kind: 'action', id: 'manual' });
    assert.deepEqual(interpretAction(land, zh, '自动驾驶'), { kind: 'action', id: 'autopilot' });
    assert.deepEqual(interpretAction(land, zh, '悬停'), { kind: 'action', id: 'hover' });

    const dust = runAt(5, 'dust_storm', 'impact_pad', zh, '围巾');
    assert.deepEqual(interpretAction(dust, zh, '慢慢'), { kind: 'action', id: 'feather' });
    assert.deepEqual(interpretAction(dust, zh, '拆成零件'), { kind: 'none' });

    const sig = runAt(3, 'strange_signal', 'impact_pad', zh, '围巾');
    assert.deepEqual(interpretAction(sig, zh, '跟着信号'), { kind: 'action', id: 'follow' });
    assert.deepEqual(interpretAction(sig, zh, '保持航线'), { kind: 'action', id: 'ignore' });
  });

  it('gated actions only match when the gear is there', () => {
    const s = runAt(2, 'debris_field', 'impact_pad');
    assert.equal(interpretAction(s, content, 'raise shields').kind, 'none');
    const shielded = { ...s, upgrades: ['deflector_shield'] };
    assert.deepEqual(interpretAction(shielded, content, 'raise shields'), { kind: 'action', id: 'shields' });
  });

  it('hidden option: plug the leak with a soft item', () => {
    const s = runAt(4, 'o2_failure', 'impact_pad');
    assert.deepEqual(interpretAction(s, content, 'use my scarf to plug the leak'), { kind: 'action', id: 'plug' });
    const tool = runAt(4, 'o2_failure', 'hatch_wrench');
    assert.deepEqual(interpretAction(tool, content, 'fix it with the wrench'), { kind: 'action', id: 'fix' });
    assert.equal(interpretAction(tool, content, 'plug the leak').kind, 'none');
  });

  it('confirm replies', () => {
    assert.equal(interpretConfirm('1'), 'yes');
    assert.equal(interpretConfirm('yes lock it in'), 'yes');
    assert.equal(interpretConfirm('2'), 'no');
    assert.equal(interpretConfirm('nope'), 'no');
    assert.equal(interpretConfirm("no it's actually a water bottle"), 'other');
    assert.equal(interpretConfirm('是的'), 'yes');
    assert.equal(interpretConfirm('好'), 'yes');
    assert.equal(interpretConfirm('不对'), 'no');
    assert.equal(interpretConfirm('重拍'), 'no');
    assert.equal(interpretConfirm('不是，这是水瓶'), 'other');
  });

  it('pick by name in both languages', () => {
    const s = { ...runAt(2, 'debris_field', 'impact_pad'), phase: 'pick' as const, offer: ['fuel_cell', 'deflector_shield', 'solar_sail'] };
    assert.equal(interpretPick(s, content, 'the shield'), 1);
    assert.equal(interpretPick(s, zh, '太阳帆'), 2);
    assert.equal(interpretPick(s, zh, '我选3'), 2);
  });

  it('AI blurbs that name the wrong gear fall back to the template', () => {
    const wrong = validateItem(zh, { modId: 'impact_pad', label: '办公椅', blurb: '你的办公椅，被改装成了舒适的舰桥指挥座。' });
    assert.equal(wrong?.blurb, '你的办公椅，被缝成了缓冲护垫');
    const right = validateItem(content, { modId: 'impact_pad', label: 'office chair', blurb: 'your office chair, stripped into an impact pad' });
    assert.equal(right?.blurb, 'your office chair, stripped into an impact pad');
  });

  it("a captain's log never claims a landing the run didn't have", async () => {
    const saying = (text: string) => new AI({ available: true, json: async () => ({ text }) } as unknown as Gemini);
    const home = 'Pour yourself a drink from that thermos, Captain, because you finally made it home.';
    assert.equal(await saying(home).narrateEnding(content, 'Ending: drifting', false), null);
    assert.equal(await saying('你终于登上了月球。').narrateEnding(zh, 'Ending: drifting', false), null);
    assert.equal(await saying(home).narrateEnding(content, 'Ending: landed on the Moon', true), home);
    const adrift = 'You and your thermos, drifting under a thousand stars. Rescue is on its way.';
    assert.equal(await saying(adrift).narrateEnding(content, 'Ending: drifting', false), adrift);
  });

  it('everyday objects in both languages', () => {
    const cases: [string, string][] = [
      ['a coke', 'fuel_side_pod'], ['my Pepsi can', 'fuel_side_pod'], ['一罐可乐', 'fuel_side_pod'],
      ['water bottle', 'emergency_air_tank'], ['我的保温杯', 'emergency_air_tank'], ['背包', 'emergency_air_tank'],
      ['a potted plant', 'water_recycler'], ['一盆多肉', 'water_recycler'],
      ['my hoodie', 'impact_pad'], ['teddy bear', 'impact_pad'], ['毛绒玩具', 'impact_pad'], ['围巾', 'impact_pad'],
      ['down jacket', 'thermal_blanket'], ['羽绒服', 'thermal_blanket'],
      ['umbrella', 'landing_airbag'], ['雨伞', 'landing_airbag'],
      ['house keys', 'hatch_wrench'], ['筷子', 'hatch_wrench'],
      ['a pencil', 'weld_pen'], ['圆珠笔', 'weld_pen'],
      ['compass', 'nav_antenna'], ['指南针', 'nav_antenna'],
      ['my airpods', 'signal_booster'], ['蓝牙耳机', 'signal_booster'], ['keyboard', 'signal_booster'],
      ['laptop', 'backup_battery'], ['充电宝', 'backup_battery'], ['笔记本电脑', 'backup_battery'],
    ];
    for (const [text, mod] of cases) assert.equal(classifyByKeyword(zh, text)?.mod.id, mod, text);
    assert.equal(classifyByKeyword(content, 'a coke')?.mod.id, 'fuel_side_pod');
    assert.equal(classifyByKeyword(content, 'keyboard')?.mod.id, 'signal_booster', 'key must not match keyboard');
  });
});

describe('service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'last-rocket-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  class FakeChannel implements Channel {
    readonly name = 'fake';
    sent: Outbound[][] = [];
    failNext = false;
    async send(_address: string, msgs: Outbound[]) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('network down');
      }
      this.sent.push(msgs);
    }
  }

  function makeService() {
    const store = new Store(dir);
    const channel = new FakeChannel();
    const game = new GameService({
      contents, store, hub: new Hub(), channels: [channel], eventMode: false, publicUrl: '',
      ai: new AI(new Gemini('', 'none')),
    });
    return { game, store, channel };
  }

  async function playToEnd(game: GameService, address: string, first: string, item: string, yes: string) {
    let n = 0;
    const send = (text: string) => game.handleInbound({ channel: 'fake', address, msgId: `${address}-${n++}`, text });
    await send(first);
    await send(item);
    await send(yes);
    while (game.currentRun(address)!.state.phase !== 'ended' && n < 60) await send('1');
    await send('???');
    return send;
  }

  it('plays a full run over text, ignores duplicates, survives send failures', async () => {
    const { game, channel } = makeService();
    const address = 'p1';
    const send = (msgId: string, text: string) => game.handleInbound({ channel: 'fake', address, msgId, text });
    await send('m1', 'join');
    await send('m2', 'I am bringing my grandma\'s scarf');
    assert.equal(game.currentRun(address)!.state.phase, 'confirm_item');
    await send('m3', 'yes');
    const v = game.currentRun(address)!.state.version;
    await send('m3', 'yes'); // duplicate delivery
    assert.equal(game.currentRun(address)!.state.version, v, 'duplicate did not advance state');

    channel.failNext = true;
    await send('m4', '1'); // stage 1, send fails
    assert.equal(game.currentRun(address)!.state.history.length, 1, 'state saved even though send failed');
    await send('m4', '1'); // retry of same message id: no re-settlement
    assert.equal(game.currentRun(address)!.state.history.length, 1);

    let n = 5;
    while (game.currentRun(address)!.state.phase !== 'ended' && n < 60) await send(`m${n++}`, '1');
    assert.equal(game.currentRun(address)!.state.phase, 'ended');

    const oldRun = game.currentRun(address)!.state.runId;
    await send(`m${n++}`, 'again');
    assert.notEqual(game.currentRun(address)!.state.runId, oldRun, 'again starts a new run');
  });

  it('"加入" plays in Chinese, "join" in English, and "再来一局" switches', async () => {
    const { game, channel } = makeService();
    channel.sent = [];
    const sendZh = await playToEnd(game, 'zh1', '加入', '我奶奶的围巾', '是的');
    assert.equal(game.currentRun('zh1')!.state.lang, 'zh');
    const zhText = channel.sent.flat().flatMap(textOf);
    assert.deepEqual(zhText.filter((t) => /[A-Za-z]/.test(t)), []);

    channel.sent = [];
    await playToEnd(game, 'en1', 'join', 'a coke', 'yes');
    assert.equal(game.currentRun('en1')!.state.lang, 'en');
    assert.deepEqual(channel.sent.flat().flatMap(textOf).filter((t) => /[㐀-鿿]/.test(t)), []);

    await sendZh('再来一局');
    assert.equal(game.currentRun('zh1')!.state.lang, 'zh');
    assert.equal(game.currentRun('zh1')!.state.phase, 'await_item');
  });

  it('chatter while choosing the item gets a friendly hint, not a burned retake', async () => {
    const { game, channel } = makeService();
    const send = (id: string, text: string) => game.handleInbound({ channel: 'fake', address: 'c1', msgId: id, text });
    await send('1', 'join');
    await send('2', 'my scarf');
    channel.sent = [];
    await send('3', 'huh?');
    const s = game.currentRun('c1')!.state;
    assert.equal(s.phase, 'confirm_item');
    assert.equal(s.retakesUsed, 0);
    assert.match((channel.sent[0][0] as { text: string }).text, /^Sorry, I didn't catch that/);
  });

  it('two unrecognizable item descriptions offer the way out', async () => {
    const { game } = makeService();
    const send = (id: string, text: string) => game.handleInbound({ channel: 'fake', address: 'u1', msgId: id, text });
    await send('1', 'join');
    await send('2', 'blorp');
    assert.equal(game.currentRun('u1')!.state.phase, 'await_item');
    await send('3', 'zzzz');
    assert.equal(game.currentRun('u1')!.state.phase, 'scan_failed');
    await send('4', '2');
    assert.equal(game.currentRun('u1')!.state.item?.modId, 'standard_supplies');
  });

  it('two players never share state', async () => {
    const { game } = makeService();
    await Promise.all([
      game.handleInbound({ channel: 'fake', address: 'a', msgId: '1', text: 'hi' }),
      game.handleInbound({ channel: 'fake', address: 'b', msgId: '1', text: 'hi' }),
    ]);
    await game.handleInbound({ channel: 'fake', address: 'a', msgId: '2', text: 'my laptop' });
    assert.equal(game.currentRun('a')!.state.pendingItem?.modId, 'backup_battery');
    assert.equal(game.currentRun('b')!.state.pendingItem, null);
  });
});

