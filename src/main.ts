// Single long-running backend: channels + engine + web + SSE.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { AI } from './ai/ai.ts';
import { Gemini } from './ai/gemini.ts';
import { SimChannel } from './channel/sim.ts';
import { loadAllContent } from './engine/content.ts';
import { GameService } from './game/service.ts';
import { createHttpServer } from './server/http.ts';
import { Hub } from './server/sse.ts';
import { Store } from './store/store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3000);
const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');

const contents = loadAllContent(join(root, 'content'));
const store = new Store(join(root, 'data'));
const hub = new Hub();
const ai = new AI(new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL || 'gemini-2.5-flash'));
const game = new GameService({
  contents,
  store,
  ai,
  hub,
  channels: [new SimChannel(hub)],
  eventMode: process.env.EVENT_MODE === '1',
  publicUrl,
});

createHttpServer(game, hub, join(root, 'web')).listen(port, () => {
  console.log(`🚀 Last Rocket to the Moon — http://localhost:${port}`);
  console.log(`   phone simulator: http://localhost:${port}/phone`);
  console.log(`   AI: ${ai.gemini.enabled ? `Gemini (${ai.gemini.model})` : 'off — keyword matching + numbered options'}`);
});
