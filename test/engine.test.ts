import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import { interpretAction, interpretConfirm } from '../src/engine/interpret.ts';
import type { Content, EngineInput, Outbound, RunState } from '../src/engine/types.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/sse.ts';
import { Store } from '../src/store/store.ts';
import { playRun } from '../scripts/simulate.ts';

const content = loadContent(join(import.meta.dirname, '..', 'content'));
const env = { numbered: false, now: 0 };

function feed(s: RunState, input: EngineInput, c: Content = content) {
  return step(s, input, c, env);
}

/** A run that is sitting at the given stage's event, carrying `modId`. */
function runAt(stage: number, eventId: string, modId: string): RunState {
  let s = newRun('t', 1, content, 0);
  s = feed(s, { type: 'start' }).state;
  s = feed(s, { type: 'item_scanned', item: { modId, label: 'scarf', blurb: 'your scarf, padded' } }).state;
  s = feed(s, { type: 'confirm', yes: true }).state;
  return { ...s, stage, eventId, phase: 'action', clarifyCount: 0, numberedShown: false };
}

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

  it('stage 4 strip consumes the item and removes its tags', () => {
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
  });

  it('unclear → clarify once → numbered fallback', () => {
    let s = runAt(2, 'debris_field', 'impact_pad');
    let r = feed(s, { type: 'unclear', candidates: [] });
    assert.match((r.out[0] as { text: string }).text, /^Say again\?/);
    r = feed(r.state, { type: 'unclear', candidates: [] });
    assert.match((r.out[0] as { text: string }).text, /reply with a number/i);
    assert.equal(r.state.numberedShown, true);
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
      content, store, hub: new Hub(), channels: [channel], eventMode: false, publicUrl: '',
      ai: new AI(new Gemini('', 'none'), content),
    });
    return { game, store, channel };
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
    const afterFail = game.currentRun(address)!.state;
    assert.equal(afterFail.history.length, 1, 'state saved even though send failed');
    await send('m4', '1'); // retry of same message id: no re-settlement
    assert.equal(game.currentRun(address)!.state.history.length, 1);

    let n = 5;
    while (game.currentRun(address)!.state.phase !== 'ended' && n < 60) await send(`m${n++}`, '1');
    assert.equal(game.currentRun(address)!.state.phase, 'ended');

    const oldRun = game.currentRun(address)!.state.runId;
    await send(`m${n++}`, 'again');
    assert.notEqual(game.currentRun(address)!.state.runId, oldRun, 'again starts a new run');
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
