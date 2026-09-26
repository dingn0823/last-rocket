// Single long-running backend: channels + engine + web + live updates + tunnel.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { AI } from './ai/ai.ts';
import { Gemini } from './ai/gemini.ts';
import { PhotonChannel } from './channel/photon.ts';
import { PhotonUsers } from './channel/photon-users.ts';
import { SimChannel } from './channel/sim.ts';
import type { Channel, Inbound } from './channel/types.ts';
import { loadAllContent } from './engine/content.ts';
import { GameService } from './game/service.ts';
import { createHttpServer } from './server/http.ts';
import { Hub } from './server/hub.ts';
import { updateShortlink } from './server/shortlink.ts';
import { findCloudflared, startTunnel } from './server/tunnel.ts';
import { Store } from './store/store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3000);
const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');

const contents = loadAllContent(join(root, 'content'));
const store = new Store(join(root, 'data'));
const hub = new Hub();
const ai = new AI(new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL));
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
game.shortUrl = (process.env.SHORTLINK_URL ?? '').replace(/\/$/, '');

// Join page registers players with Photon using this laptop's CLI login.
const photonUsers = photon ? new PhotonUsers(process.env.PROJECT_ID!, Number(process.env.PHOTON_USER_LIMIT ?? 100)) : null;

createHttpServer({ game, hub, webDir: join(root, 'web'), photonUsers }).listen(port, () => {
  console.log(`🚀 Last Rocket to the Moon — http://localhost:${port}`);
  console.log(`   host console:    http://localhost:${port}/host`);
  console.log(`   phone simulator: http://localhost:${port}/phone`);
  console.log(`   AI: ${ai.gemini.enabled ? `Gemini (${ai.gemini.models.join(' → ')})` : 'off — keyword matching + numbered options'}`);
});

deliver = (msg) => game.handleInbound(msg);
if (photon) {
  photon.start().catch((err) => console.error('[photon] could not connect; iMessage is off, the web simulator still works:', err?.message ?? err));
} else {
  console.log('   iMessage: off (no PROJECT_ID / PROJECT_SECRET in .env)');
}

// Public https URL: PUBLIC_URL if set, otherwise a Cloudflare quick tunnel (TUNNEL=0 to turn off).
let tunnel: { stop(): void } | null = null;
if (!publicUrl && process.env.TUNNEL !== '0') {
  const bin = findCloudflared(root);
  if (bin) {
    tunnel = startTunnel(bin, port, (url) => {
      game.publicUrl = url;
      console.log(`🌍 public URL: ${url}   (join page: ${url}/join)`);
      // Fixed short link (GitHub Pages) follows the tunnel, so posters and slides never go stale.
      if (process.env.SHORTLINK_REPO) {
        void updateShortlink(process.env.SHORTLINK_REPO, url).then((ok) => {
          if (ok) console.log(`🔗 short link now points here: ${game.shortUrl || process.env.SHORTLINK_REPO} (live within ~1 min)`);
        });
      }
    });
  } else {
    console.log('   public URL: off (put cloudflared.exe in tools/ or set PUBLIC_URL)');
  }
}
if (photonUsers) {
  void photonUsers.status().then((s) => console.log(s.ok ? `   Photon users: ${s.users}/${s.limit} registered` : `   Photon auto-registration unavailable: ${s.error} (run: npx @photon-ai/cli login)`));
}

async function shutdown() {
  tunnel?.stop();
  await photon?.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
