import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { Store } from '../src/store/store.ts';

const contents = loadAllContent(join(import.meta.dirname, '..', 'content'));

describe('big screen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'screen-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const make = () => {
    const quiet: Channel = { name: 'imessage', send: async () => {} };
    const sim: Channel = { name: 'sim', send: async () => {} };
    return new GameService({
      contents, store: new Store(join(dir, String(Math.random()))), hub: new Hub(), channels: [quiet, sim],
      ai: new AI(new Gemini('')), eventMode: true, publicUrl: '',
    });
  };

  async function play(game: GameService, channel: string, address: string, nickname: string, lang: 'join' | '加入') {
    game.ensurePlayer(channel, address, nickname);
    let n = 0;
    const say = (text: string) => game.handleInbound({ channel, address, msgId: `${address}-${n++}`, text });
    await say(lang);
    await say(lang === 'join' ? 'my scarf' : '我的围巾');
    await say(lang === 'join' ? 'yes' : '是');
    while (game.currentRun(address)!.state.phase !== 'ended' && n < 60) await say('1');
  }

  it('feed is English for everyone, even Chinese players', async () => {
    const game = make();
    await play(game, 'imessage', '+10000000001', 'Luna', '加入');
    const feed = game.screenState().feed.map((f) => f.text);
    assert.ok(feed.some((t) => t.startsWith('Luna boarded with 围巾 → Impact Pad')), feed.join('\n'));
    assert.ok(feed.some((t) => /^Luna (landed on the Moon|is adrift|was lost)/.test(t)), feed.join('\n'));
    assert.deepEqual(feed.filter((t) => /[㐀-鿿]/.test(t.replace('围巾', ''))), [], 'only the player\'s own word may be Chinese');
  });

  it('simulator test runs stay off the big screen unless asked for', async () => {
    const game = make();
    await play(game, 'sim', 'sim-abc', 'Tester', 'join');
    assert.equal(game.screenState().players.length, 0);
    assert.equal(game.screenState().feed.length, 0);
    assert.equal(game.screenState(true).players.length, 1);
  });

  it('clearing the screen hides earlier runs and empties the feed', async () => {
    const game = make();
    await play(game, 'imessage', '+10000000002', 'Old', 'join');
    const before = game.screenState();
    assert.ok(before.players.length === 1 && before.feed.length > 0);
    game.clearScreen();
    const afterClear = game.screenState();
    assert.equal(afterClear.players.length, 0);
    assert.equal(afterClear.leaderboard.length, 0);
    assert.equal(afterClear.feed.length, 0);
  });
});
