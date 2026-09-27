import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import type { Outbound } from '../src/engine/types.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { Store } from '../src/store/store.ts';

const contents = loadAllContent(join(import.meta.dirname, '..', 'content'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('automatic rounds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rounds-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const sent = new Map<string, string[]>();
  const channel: Channel = {
    name: 'imessage',
    send: async (address: string, msgs: Outbound[]) => {
      sent.set(address, [...(sent.get(address) ?? []), ...msgs.map((m) => (m.t === 'text' ? m.text : `[${m.t}]`))]);
    },
  };
  const game = new GameService({
    contents, store: new Store(dir), hub: new Hub(), channels: [channel],
    ai: new AI(new Gemini('')), eventMode: true, publicUrl: '',
    rounds: { boardingMs: 150, flightMs: 400, ceremonyMs: 150 },
  });
  const say = (address: string, id: string, text: string) => game.handleInbound({ channel: 'imessage', address, msgId: id, text });

  it('holds new players on the launch list, then launches everyone together', async () => {
    game.rounds.setEnabled(true);
    assert.equal(game.rounds.phase, 'waiting');
    await say('+1001', 'a1', 'join');
    assert.equal(game.rounds.phase, 'boarding', 'first boarder starts the countdown');
    await say('+1002', 'b1', '加入');
    for (const a of ['+1001', '+1002']) {
      assert.equal(game.currentRun(a)!.state.phase, 'new', `${a} waits`);
      assert.ok(sent.get(a)![0].startsWith('🎫'), 'told they are on the list');
    }
    assert.equal(game.screenState().counts.boarding, 2);
    await sleep(260);
    assert.equal(game.rounds.phase, 'flying');
    for (const a of ['+1001', '+1002']) {
      assert.equal(game.currentRun(a)!.state.phase, 'await_item', `${a} launched`);
      assert.ok(sent.get(a)!.some((t) => t.startsWith('🚀')), 'launch message');
    }
    assert.ok(sent.get('+1002')!.some((t) => t.includes('发射')), 'launch message in the player\'s language');
  });

  it('late arrivals start straight away and are told the time left', async () => {
    await say('+1003', 'c1', 'join');
    assert.equal(game.currentRun('+1003')!.state.phase, 'await_item');
    assert.ok(sent.get('+1003')!.some((t) => t.startsWith('⏱️')));
  });

  it('the bell ranks the best landings; the next round starts clean', async () => {
    // Fast-forward two players to a landing inside the round window.
    for (const [a, score] of [['+1001', 420], ['+1003', 390]] as const) {
      const rec = game.currentRun(a)!;
      rec.state = { ...rec.state, phase: 'ended', stage: 5, ending: { kind: 'success', score }, updatedAt: Date.now() };
      game.store.saveRun(rec);
    }
    await sleep(320);
    assert.equal(game.rounds.phase, 'ceremony');
    assert.deepEqual(game.rounds.podium.map((p) => p.score), [420, 390]);
    assert.equal(game.rounds.participants, 3);
    await sleep(220);
    assert.equal(game.rounds.phase, 'waiting', 'ceremony over, next round open');
    const s = game.screenState();
    assert.equal(s.players.length, 0, 'old round is off the screen');
    assert.equal(s.leaderboard.length, 0);
  });

  it('players who arrive during the ceremony make the next launch', async () => {
    await say('+1004', 'd1', 'join');
    assert.equal(game.rounds.phase, 'boarding');
    game.rounds.endNow(); // nothing to end while boarding
    game.rounds.launchNow();
    await sleep(30);
    assert.equal(game.rounds.phase, 'flying');
    assert.equal(game.currentRun('+1004')!.state.phase, 'await_item');
    game.rounds.endNow();
    assert.equal(game.rounds.phase, 'ceremony');
    await say('+1005', 'e1', 'join');
    assert.equal(game.currentRun('+1005')!.state.phase, 'new', 'held during the ceremony');
    await sleep(200);
    assert.equal(game.rounds.phase, 'boarding', 'goes straight to boarding for them');
    assert.equal(game.screenState().counts.boarding, 1, 'on the big screen\'s launch list during the countdown');
    await sleep(200);
    assert.equal(game.currentRun('+1005')!.state.phase, 'await_item');
    // Boarded during the last ceremony, lands in this round: it must count for this round's board.
    const rec = game.currentRun('+1005')!;
    rec.state = { ...rec.state, phase: 'ended', stage: 5, ending: { kind: 'success', score: 333 }, updatedAt: Date.now() };
    game.store.saveRun(rec);
    assert.deepEqual(game.screenState().leaderboard.map((b) => b.score), [333]);
    game.rounds.setEnabled(false);
  });
});
