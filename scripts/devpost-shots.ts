// Capture Devpost screenshots with headless Edge/Chrome (Chrome DevTools Protocol, no extra packages).
// Starts a throwaway game server on :3400 (simulator channel, real Gemini if .env has a key, temp data),
// plays one scripted English run (the item is typed, so no real photo is needed), and screenshots the phone chat,
// bridge and join page. If the big-screen rehearsal is running on :3100 it also captures a round in flight and the podium.
// Registration is a stub with a fictional 555 number: nothing is sent to Photon.
//   node scripts/devpost-shots.ts <outDir> ["my grandma's knitted scarf"]      (ONLY=phone,join,screen to pick parts)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import { SimChannel } from '../src/channel/sim.ts';
import { loadAllContent } from '../src/engine/content.ts';
import type { PhotonUsers } from '../src/channel/photon-users.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { createHttpServer } from '../src/server/http.ts';
import { modById, visibleActions } from '../src/engine/rules.ts';
import type { Action } from '../src/engine/types.ts';
import { Store } from '../src/store/store.ts';
import { bestAction, bestPick } from './simulate.ts';

const root = join(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const [outDir, item = "my grandma's knitted scarf"] = process.argv.slice(2);
if (!outDir) throw new Error('usage: node scripts/devpost-shots.ts <outDir> [item]');
mkdirSync(outDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const want = (part: string) => !process.env.ONLY || process.env.ONLY.split(',').includes(part);

// ---------- throwaway game server ----------
const PORT = 3400;
const BASE = `http://localhost:${PORT}`;
const hub = new Hub();
const game = new GameService({
  contents: loadAllContent(join(root, 'content')), store: new Store(mkdtempSync(join(tmpdir(), 'shots-'))), hub,
  channels: [new SimChannel(hub)], ai: new AI(new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL)),
  eventMode: false, publicUrl: '',
});
game.shortUrl = 'https://dingn0823.github.io/moon';
const stubUsers = { register: async () => ({ assignedNumber: '+15555550123' }), status: async () => ({ ok: true, users: 0, limit: 100 }) } as unknown as PhotonUsers;
await new Promise<void>((r) => createHttpServer({ game, hub, webDir: join(root, 'web'), photonUsers: stubUsers }).listen(PORT, () => r()));

const post = (path: string, body: unknown) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
let address = '';
let n = 0;
const phase = () => game.currentRun(address)?.state.phase;
const eventId = () => game.currentRun(address)?.state.eventId;
const say = (text: string) => post('/api/sim/message', { address, msgId: `m${n++}`, text });
async function waitFor(pred: () => boolean, ms = 15000) {
  const t = Date.now();
  while (!pred() && Date.now() - t < ms) await sleep(250);
}

// ---------- headless browser via CDP ----------
const browserBin = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => existsSync(p));
if (!browserBin) throw new Error('no Edge/Chrome found');
const debugPort = 9333;
const browser = spawn(browserBin, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shots-browser-'))}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--lang=en-US', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let targets: any[] = [];
for (let i = 0; i < 40 && !targets.some((t) => t.type === 'page'); i++) {
  await sleep(250);
  targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => []);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map<number, (m: any) => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
};
const cdp = (method: string, params: object = {}) => new Promise<any>((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await cdp('Page.enable');
const evaluate = (expression: string) => cdp('Runtime.evaluate', { expression, awaitPromise: true });

async function shot(url: string, file: string, o: { width?: number; height?: number; scale?: number; mobile?: boolean; wait?: number; setup?: string } = {}) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: o.width ?? 1920, height: o.height ?? 1080, deviceScaleFactor: o.scale ?? 1, mobile: o.mobile ?? false });
  if (o.setup) {
    await cdp('Page.navigate', { url: new URL(url).origin + '/api/health' });
    await sleep(500);
    await evaluate(o.setup);
  }
  await cdp('Page.navigate', { url });
  await sleep(o.wait ?? 3000);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, file), Buffer.from(data, 'base64'));
  console.log(`saved ${file}`);
}
const phoneShot = (file: string) => shot(`${BASE}/phone`, file, { width: 430, height: 932, scale: 2, mobile: true, wait: 2500, setup: `localStorage.setItem('lr_address', ${JSON.stringify(address)}); localStorage.setItem('lr_join_lang', 'en')` });

// ---------- scripted run ----------
// A careful player (the "thoughtful" balance policy) who types the moves in their own words.
// Retries with a fresh run until one uses a hidden gear move on stage 2 and lands, so the shots tell the whole story.
const run = () => game.currentRun(address)!;
const c = () => game.contentFor(run().state);
/** "Strap your {mod} to the nose as a bumper (risky)" → "strap my scarf to the nose as a bumper" */
function say_it(a: Action): string {
  const label = run().state.item?.label ?? 'thing';
  const text = a.label.replace(/\s*\([^)]*\)/g, '').replace(/\byour \{(mod|item)\}/gi, `my ${label}`)
    .replace(/\{(mod|item)\}/g, label).replace(/\s+—.*$/, '');
  return text.charAt(0).toLowerCase() + text.slice(1);
}
/** One careful move. false = the ship never moved on (stuck), so the attempt is abandoned. */
async function move(): Promise<boolean> {
  const s = run().state;
  const moved = () => run().state.version !== s.version;
  if (s.phase === 'pick') {
    await say(String(bestPick(s, c()) + 1));
    await waitFor(moved);
    return moved();
  }
  const a = bestAction(s, c());
  const numbered = s.stage === 1 || s.numberedShown;
  const idx = visibleActions(s, c()).findIndex((v) => v.id === a.id);
  await say(numbered && idx >= 0 ? String(idx + 1) : say_it(a));
  await waitFor(moved, 12000);
  if (!moved() && idx >= 0) {
    await say(String(idx + 1)); // the ship asked to clarify
    await waitFor(moved);
  }
  return moved();
}
let landed = !want('phone');
for (let attempt = 1; attempt <= 12 && !landed; attempt++) {
  address = (await post('/api/sim/new', { nickname: 'Luna' })).address;
  await say('join');
  await waitFor(() => phase() === 'await_item');
  await say(item);
  await waitFor(() => phase() === 'confirm_item');
  await phoneShot('1-phone-item-to-gear.png');
  await say('yes');
  await waitFor(() => phase() === 'action');
  let hiddenOnStage2 = false;
  let shotStage2 = false;
  let shotBridge = false;
  while (phase() !== 'ended') {
    const s = run().state;
    if (s.phase === 'action' && c().stages[1].pool.some((e) => e.id === s.eventId) && !shotStage2) {
      hiddenOnStage2 = !!bestAction(s, c()).hidden;
      if (!hiddenOnStage2) break;
    }
    if (!(await move())) break;
    if (s.stage === 2 && run().state.phase === 'pick' && !shotStage2) {
      shotStage2 = true;
      await sleep(1200);
      await phoneShot('2-phone-free-text.png');
    }
    if (run().state.stage === 4 && run().state.phase === 'action' && !shotBridge) {
      shotBridge = true;
      await sleep(1500);
      await shot(`${BASE}${game.bridgePath(run().bridgeToken)}`, '3-bridge.png', { wait: 4000 });
    }
  }
  landed = run().state.ending?.kind === 'success';
  console.log(`attempt ${attempt}: item → ${modById(c(), run().state.item?.modId ?? 'standard_supplies').name}, stage-2 hidden move: ${hiddenOnStage2}, ending: ${run().state.ending?.kind ?? 'abandoned'}`);
  if (landed) {
    await waitFor(() => run().transcript.some((e) => e.dir === 'out' && JSON.stringify(e.msg).includes("Captain's log")), 9000);
    await sleep(1000);
    await phoneShot('6-phone-ending.png');
  }
}
if (!landed) console.log('no landing in 12 attempts; phone/bridge shots may be from a failed run');
if (want('join')) {
  await shot(`${BASE}/join`, '7-join-page.png', { width: 1440, height: 900, wait: 2500, setup: "localStorage.setItem('lr_join_lang', 'en')" });
  // The boarding pass: fill the form like a player would (fictional number) and capture the QR step.
  await evaluate(`document.getElementById('nick').value = 'Luna'; document.getElementById('num').value = '(555) 555-0100';
    document.getElementById('num').dispatchEvent(new Event('input')); document.getElementById('go').click();`);
  await sleep(2500);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, '8-join-boarding-pass.png'), Buffer.from(data, 'base64'));
  console.log('saved 8-join-boarding-pass.png');
}

// ---------- big screen rehearsal (optional) ----------
const rehearsal = 'http://localhost:3100';
const state = () => fetch(`${rehearsal}/api/screen/state`).then((r) => r.json()).catch(() => null);
let s = want('screen') ? await state() : null;
if (s) {
  console.log('rehearsal found: waiting for a round in flight…');
  for (let i = 0; i < 600; i++) {
    s = await state();
    const elapsed = s ? s.round.flightMs - (s.round.endsAt - s.round.now) : 0;
    if (s?.round.phase === 'flying' && elapsed > 62_000 && elapsed < 75_000) break; // some landed, most still flying
    await sleep(1000);
  }
  await shot(`${rehearsal}/screen`, '4-big-screen.png', { wait: 5000 });
  console.log('waiting for the podium…');
  for (let i = 0; i < 400 && (await state())?.round.phase !== 'ceremony'; i++) await sleep(1000);
  await shot(`${rehearsal}/screen`, '5-podium.png', { wait: 6500 });
} else console.log('no rehearsal on :3100, skipping big-screen shots');

ws.close();
browser.kill();
process.exit(0);
