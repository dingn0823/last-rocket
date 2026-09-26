// Rehearse the big screen: a separate server on :3100 with a throwaway data dir and bot players.
// No Photon, no tunnel, no Gemini; your real saves are untouched.
//   node scripts/screen-demo.ts [bots=14]   → open http://localhost:3100/screen
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { createHttpServer } from '../src/server/http.ts';
import { Store } from '../src/store/store.ts';

const root = join(import.meta.dirname, '..');
const store = new Store(mkdtempSync(join(tmpdir(), 'screen-demo-')));
const hub = new Hub();
const bots: Channel = { name: 'bot', send: async () => {} };
const game = new GameService({
  contents: loadAllContent(join(root, 'content')), store, hub, channels: [bots],
  ai: new AI(new Gemini('')), eventMode: true, publicUrl: '',
});
game.shortUrl = 'https://dingn0823.github.io/moon';
createHttpServer({ game, hub, webDir: join(root, 'web'), photonUsers: null }).listen(3100, () => {
  console.log('big-screen rehearsal: http://localhost:3100/screen  (bots are joining…)');
});

const NAMES = ['Luna', 'Leo', 'Maya', 'Kai', 'Zoe', 'Omar', 'Iris', 'Theo', 'Nina', 'Sam', 'Ava', 'Ravi', 'Mei', 'Jon', 'Lia', 'Ezra', 'Noor', 'Finn'];
const ITEMS = ['my scarf', 'a water bottle', 'my headphones', 'house keys', 'a laptop', 'my hoodie', 'an umbrella', 'a coke', 'a pencil', 'a compass', 'my blanket', 'a teddy bear'];
const count = Number(process.argv[2] ?? 14);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bot(i: number): Promise<void> {
  const address = `bot-${i}`;
  game.ensurePlayer('bot', address, NAMES[i % NAMES.length]);
  let n = 0;
  const say = (text: string) => game.handleInbound({ channel: 'bot', address, msgId: `${address}-${n++}`, text });
  await sleep(i * 2500 + Math.random() * 2000);
  for (;;) {
    await say('join');
    await sleep(1500);
    await say(ITEMS[(i + n) % ITEMS.length]);
    await say('yes');
    while (game.currentRun(address)?.state.phase !== 'ended') {
      await sleep(3000 + Math.random() * 5000);
      await say(String(1 + Math.floor(Math.random() * 3)));
    }
    await sleep(20_000 + Math.random() * 20_000);
    await say('again');
  }
}

for (let i = 0; i < count; i++) void bot(i);
