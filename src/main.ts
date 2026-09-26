// Single long-running backend: channels + engine + web + SSE.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { AI } from './ai/ai.ts';
import { Gemini } from './ai/gemini.ts';
import { PhotonChannel } from './channel/photon.ts';
import { SimChannel } from './channel/sim.ts';
import type { Channel, Inbound } from './channel/types.ts';
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
// iMessage via Photon when credentials are present; the web phone simulator is always on for debugging.
const channels: Channel[] = [new SimChannel(hub)];
let deliver: (msg: Inbound) => unknown = () => {};
const photon = process.env.PROJECT_ID && process.env.PROJECT_SECRET && process.env.PHOTON !== '0'
  ? new PhotonChannel({
    projectId: process.env.PROJECT_ID,
    projectSecret: process.env.PROJECT_SECRET,
    mediaDir: store.mediaDir,
    onInbound: (msg) => deliver(msg),
  })
  : null;
if (photon) channels.push(photon);

const game = new GameService({
  contents,
  store,
  ai,
  hub,
  channels,
  eventMode: process.env.EVENT_MODE === '1',
  publicUrl,
});

createHttpServer(game, hub, join(root, 'web')).listen(port, () => {
  console.log(`🚀 Last Rocket to the Moon — http://localhost:${port}`);
  console.log(`   phone simulator: http://localhost:${port}/phone`);
  console.log(`   AI: ${ai.gemini.enabled ? `Gemini (${ai.gemini.model})` : 'off — keyword matching + numbered options'}`);
});

deliver = (msg) => game.handleInbound(msg);
if (photon) {
  photon.start().catch((err) => console.error('[photon] could not connect; iMessage is off, the web simulator still works:', err?.message ?? err));
} else {
  console.log('   iMessage: off (no PROJECT_ID / PROJECT_SECRET in .env)');
}

async function shutdown() {
  await photon?.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
