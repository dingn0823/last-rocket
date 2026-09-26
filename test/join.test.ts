import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import { normalizePhone } from '../src/channel/photon-users.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import type { Outbound } from '../src/engine/types.ts';
import { JoinRegistry, joinText } from '../src/game/join.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { Store } from '../src/store/store.ts';

const root = join(import.meta.dirname, '..');
const contents = loadAllContent(join(root, 'content'));

class Capture implements Channel {
  readonly name = 'imessage';
  sent: Outbound[][] = [];
  async send(_a: string, msgs: Outbound[]) { this.sent.push(msgs); }
}

/** Fake ServerResponse that records the long-poll answer. */
function fakeRes() {
  const r: any = { writableEnded: false, body: null as any, handlers: {} as Record<string, () => void> };
  r.writeHead = () => r;
  r.end = (s: string) => { r.writableEnded = true; r.body = JSON.parse(s); };
  r.on = (ev: string, fn: () => void) => { r.handlers[ev] = fn; return r; };
  return r as ServerResponse & { body: any };
}

describe('join & live updates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'join-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const make = (publicUrl = '') => {
    const hub = new Hub();
    const cap = new Capture();
    const game = new GameService({ contents, store: new Store(join(dir, String(Math.random()))), ai: new AI(new Gemini('')), hub, channels: [cap], eventMode: false, publicUrl });
    return { hub, cap, game };
  };

  it('phone numbers need a country code', () => {
    assert.equal(normalizePhone('+1 (314) 555-0123'), '+13145550123');
    assert.equal(normalizePhone('0086 138 0000 0000'), '+8613800000000');
    assert.equal(normalizePhone('314 555 0123'), null);
    assert.equal(normalizePhone('+12'), null);
  });

  it('codes are unique, claimable once, language-specific', () => {
    const reg = new JoinRegistry();
    const a = reg.create({ nickname: 'A', lang: 'en', assignedNumber: '+1' });
    const b = reg.create({ nickname: 'B', lang: 'zh', assignedNumber: '+1' });
    assert.notEqual(a.code, b.code);
    assert.equal(joinText('zh', b.code), `加入 ${b.code}`);
    assert.equal(reg.claim('hello'), undefined);
    assert.equal(reg.claim(`JOIN ${a.code}`)?.token, a.token);
    assert.equal(reg.claim(`join ${a.code}`), undefined, 'second claim fails');
    assert.equal(reg.claim(`加入${b.code}`)?.nickname, 'B');
  });

  it('"加入 1234" pairs the join page, uses the nickname, plays in Chinese', async () => {
    const { hub, game } = make();
    const j = game.joins.create({ nickname: 'Luna', lang: 'zh', assignedNumber: '+16280000000' });
    const res = fakeRes();
    hub.poll(`join:${j.token}`, hub.cursor, res);
    await game.handleInbound({ channel: 'imessage', address: '+8613800000000', msgId: 'm1', text: `加入 ${j.code}` });
    assert.equal(res.body.events[0].event, 'paired');
    const rec = game.currentRun('+8613800000000')!;
    assert.equal(res.body.events[0].data.path, game.bridgePath(rec.bridgeToken));
    assert.equal(rec.state.lang, 'zh');
    assert.equal(rec.state.phase, 'await_item');
    assert.equal(game.snapshotFor(rec).nickname, 'Luna');
  });

  it('the bridge follows the player to a new run', async () => {
    const { hub, game } = make();
    const say = (id: string, text: string) => game.handleInbound({ channel: 'imessage', address: 'p', msgId: id, text });
    await say('1', 'join');
    const first = game.currentRun('p')!;
    const res = fakeRes();
    hub.poll(`bridge:${first.bridgeToken}`, hub.cursor, res);
    // A computer pairs again mid-run: new run, old bridge is told where to go.
    const j = game.joins.create({ nickname: 'P', lang: 'en', assignedNumber: '+1' });
    await say('2', `join ${j.code}`);
    const second = game.currentRun('p')!;
    assert.notEqual(second.state.runId, first.state.runId);
    assert.deepEqual(res.body.events.find((e: any) => e.event === 'next')?.data, { path: game.bridgePath(second.bridgeToken) });
  });

  it('phone-only players get the bridge link when there is a public URL', async () => {
    const { game, cap } = make('https://demo.trycloudflare.com');
    await game.handleInbound({ channel: 'imessage', address: 'solo', msgId: '1', text: 'join' });
    const texts = cap.sent.flat().map((m) => (m.t === 'text' ? m.text : ''));
    assert.ok(texts.some((t) => t.startsWith('🖥') && t.includes('https://demo.trycloudflare.com/bridge/')), texts.join('\n'));
  });

  it('long poll: immediate when events are waiting, empty after timeout', async () => {
    const hub = new Hub();
    hub.publish('t', 'a', 1);
    const r1 = fakeRes();
    hub.poll('t', 0, r1);
    assert.equal(r1.body.events.length, 1);
    const r2 = fakeRes();
    hub.poll('t', hub.cursor, r2);
    assert.equal(r2.body, null, 'waits');
    hub.publish('t', 'b', 2);
    assert.equal(r2.body!.events[0].event, 'b');
  });

  it('ui.json has the same keys in both languages', () => {
    const ui = JSON.parse(readFileSync(join(root, 'content', 'ui.json'), 'utf8'));
    assert.deepEqual(Object.keys(ui.zh).sort(), Object.keys(ui.en).sort());
  });
});
