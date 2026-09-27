// Rehearse the big screen: a separate server on :3100 with a throwaway data dir and bot players,
// running automatic rounds with short timings. No Photon, no tunnel, no Gemini; real saves untouched.
//   node scripts/screen-demo.ts [bots=14] [flightMinutes=3]   → open http://localhost:3100/screen
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
const count = Number(process.argv[2] ?? 14);
const flightMin = Number(process.argv[3] ?? 3);
const store = new Store(mkdtempSync(join(tmpdir(), 'screen-demo-')));
const hub = new Hub();
const bots: Channel = { name: 'bot', send: async () => {} };
const game = new GameService({
  contents: loadAllContent(join(root, 'content')), store, hub, channels: [bots],
  ai: new AI(new Gemini('')), eventMode: true, publicUrl: '',
  rounds: { boardingMs: 20_000, flightMs: flightMin * 60_000, ceremonyMs: 25_000 },
});
game.shortUrl = 'https://dingn0823.github.io/moon';
game.rounds.setEnabled(true);
const server = createHttpServer({ game, hub, webDir: join(root, 'web'), photonUsers: null });
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error('\n  The rehearsal is already running in another window: open http://localhost:3100/screen\n');
  process.exit(1);
});
server.listen(3100, () => {
  console.log(`big-screen rehearsal: http://localhost:3100/screen  (${count} bots, ${flightMin}-minute rounds)`);
});

const NAMES = ['Luna', 'Leo', 'Maya', 'Kai', 'Zoe', 'Omar', 'Iris', 'Theo', 'Nina', 'Sam', 'Ava', 'Ravi', 'Mei', 'Jon', 'Lia', 'Ezra', 'Noor', 'Finn'];
const ITEMS = ['my scarf', 'a water bottle', 'my headphones', 'house keys', 'a laptop', 'my hoodie', 'an umbrella', 'a coke', 'a pencil', 'a compass', 'my blanket', 'a teddy bear'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bot(i: number): Promise<void> {
  const address = `bot-${i}`;
  game.ensurePlayer('bot', address, NAMES[i % NAMES.length]);
  let n = 0;
  const say = (text: string) => game.handleInbound({ channel: 'bot', address, msgId: `${address}-${n++}`, text });
  const phase = () => game.currentRun(address)?.state.phase;
  await sleep(i * 1800 + Math.random() * 1500);
  let first = true;
  for (;;) {
    await say(first ? 'join' : 'again');
    first = false;
    while (phase() === 'new') await sleep(500); // on the launch list until liftoff
    await sleep(1500 + Math.random() * 3000);
    await say(ITEMS[(i + n) % ITEMS.length]);
    await say('yes');
    while (phase() !== 'ended') {
      await sleep(4000 + Math.random() * 6000);
      await say(String(1 + Math.floor(Math.random() * 3)));
    }
    // Wait for this round's ceremony to pass, then sign up for the next launch.
    while (game.rounds.phase === 'flying') await sleep(1000);
    await sleep(3000 + Math.random() * 8000);
  }
}

for (let i = 0; i < count; i++) void bot(i);
