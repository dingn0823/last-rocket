// Record the Devpost demo video by playing the real game in headless Edge, like a careful player would.
// :3400 is one player's story (phone simulator + laptop join page and bridge); :3401 is the big screen with
// bot players and automatic rounds. scripts/demo-video.html lays them out with captions and an original
// soundtrack and records its own tab (VP9/Opus WebM, 1920x1080), pausing through the boring waits.
// Temp saves only. Registration is a stub with a fictional 555 number, so nothing reaches Photon.
// Gemini (if .env has a key) writes the captain's log and speaks the narration (Gemini TTS, VOICE=Puck by default;
// NARRATION=0 for music only).
// PHOTO=<photo.jpg> sends a real photo: the bridge's hologram scans it while Gemini recognizes it (the shot the video is built
// around); without it the item is typed.
//   PHOTO=<photo.jpg> node scripts/demo-video.ts <out.webm>   (PLAN_ONLY=1 prints the planned run; FIX_ONLY=<old.webm> only repairs a file)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { PhotonUsers } from '../src/channel/photon-users.ts';
import { SimChannel } from '../src/channel/sim.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import { classifyByKeyword, interpretAction } from '../src/engine/interpret.ts';
import { modById, upgradeById, visibleActions } from '../src/engine/rules.ts';
import { fmt, withArticle } from '../src/engine/text.ts';
import type { Action, EngineInput, ItemInfo, Outbound, RunState } from '../src/engine/types.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { createHttpServer } from '../src/server/http.ts';
import { Store } from '../src/store/store.ts';
import { bestAction, bestPick } from './simulate.ts';

const root = join(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const outFile = process.argv[2];
if (!outFile) throw new Error('usage: node scripts/demo-video.ts <out.webm>');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const contents = loadAllContent(join(root, 'content'));
const en = contents.en;

// ---------- 1. Pick dice (a seed) under which a careful run shows everything ----------
// The seed only decides events and luck; every move is the careful player's own choice.
const PHOTO = process.env.PHOTO;
const ITEM = "my grandma's knitted scarf";
let item: ItemInfo;
if (PHOTO) {
  // What Gemini will most likely say during the shoot (the narration is written from it; the run is re-planned if it differs).
  const probe = await new AI(new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL)).classifyPhoto(en, { base64: readFileSync(PHOTO).toString('base64'), mime: 'image/jpeg' });
  if (!probe.ok) throw new Error(`Gemini could not read ${PHOTO}`);
  item = probe.item;
  console.log(`photo: Gemini sees "${item.label}" → ${modById(en, item.modId).name}`);
} else {
  const hit = classifyByKeyword(en, ITEM);
  if (!hit) throw new Error('item not recognized by keywords');
  item = { modId: hit.mod.id, label: hit.keyword, blurb: fmt(hit.mod.blurb, { label: hit.keyword }) };
}

interface Move { text: string; phase: 'action' | 'pick'; stage: number; eventId: string | null; hidden: boolean; fx: string[]; newCombos: string[] }
interface Plan { seed: number; rng: number; moves: Move[]; end: RunState }

/** "Strap your {mod} to the nose as a bumper (risky)" → "strap my scarf to the nose as a bumper" */
function sayIt(a: Action, label: string): string {
  const text = a.label.replace(/\s*\([^)]*\)/g, '').replace(/\byour \{(mod|item)\}/gi, `my ${label}`)
    .replace(/\{(mod|item)\}/g, label).replace(/\s+—.*$/, '');
  return text.charAt(0).toLowerCase() + text.slice(1);
}
const fxOf = (out: Outbound[]) => out.flatMap((o) => (o.t === 'fx' ? [o.fx] : []));

function plan(seed: number, it: ItemInfo): Plan | null {
  const env = { numbered: false, now: 0 };
  let s = newRun('plan', seed, en, 0);
  const feed = (input: EngineInput) => {
    const r = step(s, input, en, env);
    s = r.state;
    return r.out;
  };
  // feed() reassigns s, which TypeScript can't see through the closure: read the phase fresh.
  const phase = (): string => s.phase;
  feed({ type: 'start' });
  feed({ type: 'item_scanned', item: it });
  feed({ type: 'confirm', yes: true });
  if (phase() !== 'action') return null;
  const rng = s.rng;
  const moves: Move[] = [];
  for (let guard = 0; guard < 40 && phase() !== 'ended'; guard++) {
    const before = s;
    if (phase() === 'pick') {
      const i = bestPick(s, en);
      const fx = fxOf(feed({ type: 'pick', index: i }));
      moves.push({ text: String(i + 1), phase: 'pick', stage: before.stage, eventId: null, hidden: false, fx, newCombos: s.combos.filter((k) => !before.combos.includes(k)) });
      continue;
    }
    if (phase() !== 'action') return null;
    const a = bestAction(s, en);
    const idx = visibleActions(s, en).findIndex((v) => v.id === a.id);
    // Stage 1 is numbered; after that the player types. The words must reach the move by keywords alone.
    const candidates = s.stage === 1 && idx >= 0 ? [String(idx + 1)] : [sayIt(a, it.label), ...a.keywords.slice(0, 2)];
    const text = candidates.find((t) => {
      const r = interpretAction(s, en, t);
      return r.kind === 'action' && r.id === a.id;
    });
    if (!text) return null;
    const fx = fxOf(feed({ type: 'choose', actionId: a.id }));
    moves.push({ text, phase: 'action', stage: before.stage, eventId: before.eventId, hidden: !!a.hidden, fx, newCombos: s.combos.filter((k) => !before.combos.includes(k)) });
  }
  return phase() === 'ended' ? { seed, rng, moves, end: s } : null;
}

const mainEvent = (stage: number, m: Move) => m.phase === 'action' && m.stage === stage && en.stages[stage - 1].pool.some((e) => e.id === m.eventId);
function keyMoves(p: Plan) {
  const hidden = p.moves.findIndex((m) => mainEvent(2, m));
  const combo = p.moves.findIndex((m) => m.newCombos.length > 0);
  const stage4 = p.moves.findIndex((m) => mainEvent(4, m));
  const legendary = p.moves.findIndex((m) => m.fx.includes('legendary'));
  return { hidden, combo, stage4, legendary, last: p.moves.length - 1 };
}
function score(p: Plan | null): number {
  if (!p || p.end.ending?.kind !== 'success' || p.end.item?.status !== 'kept') return -1;
  const k = keyMoves(p);
  if (k.hidden < 0 || !p.moves[k.hidden].hidden || k.combo <= k.hidden || k.stage4 <= k.combo || p.moves[k.combo].phase !== 'pick') return -1;
  let sc = 100 - p.moves.length * 3;
  if (k.legendary > k.hidden && k.legendary < k.stage4) sc += 12;
  if (/^\d$/.test(p.moves[k.stage4].text)) sc -= 20;
  return sc;
}
function findPlan(it: ItemInfo): Plan {
  let found: Plan | null = null;
  let bestScore = -1;
  for (let seed = 1; seed <= 40_000 && bestScore < 80; seed++) {
    const p = plan(seed, it);
    const sc = score(p);
    if (sc > bestScore) { found = p; bestScore = sc; }
  }
  if (!found) throw new Error(`no seed shows the whole story for ${it.label}`);
  console.log(`dice: seed ${found.seed} (score ${bestScore}), ${found.moves.length} moves:`);
  found.moves.forEach((m, i) => console.log(`  ${i}. [${m.phase} s${m.stage} ${m.eventId ?? ''}] "${m.text}"${m.hidden ? ' HIDDEN' : ''}${m.fx.length ? ` fx=${m.fx}` : ''}${m.newCombos.length ? ` combo=${m.newCombos}` : ''}`));
  return found;
}
let best = findPlan(item);
let K = keyMoves(best);

if (process.env.PLAN_ONLY) process.exit(0);
// FIX_ONLY=<recording.webm>: just make an earlier recording seekable (writes <out.webm>).
if (process.env.FIX_ONLY) {
  writeFileSync(outFile, seekable(readFileSync(process.env.FIX_ONLY)));
  console.log(`seekable copy written to ${outFile}`);
  process.exit(0);
}

// ---------- Narration: one line per shot, spoken by Gemini TTS (cached, so re-shoots cost no quota) ----------
const VOICE = process.env.VOICE ?? 'Puck';
const NARRATE = !!process.env.GEMINI_API_KEY && process.env.NARRATION !== '0';
const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const ITEM_NAME = ITEM.replace(/^my /, '');
const MOD_NAME = modById(en, item.modId).name;
const LINES: Record<string, string> = {
  title: 'Earth has hours left. You can bring one thing with you. What would it be?',
  join: 'Join from any laptop. Just a nickname and your iPhone number. No app to install.',
  pair: "Scan the code, tap send, and your laptop turns into your ship's bridge.",
  ...(PHOTO
    ? {
        scan: 'Snap a photo of anything near you. Gemini scans it and picks one of twelve fixed mods.',
        rigged: `A ${item.label.split(' ').pop()}? Now it's ${withArticle(MOD_NAME)}.`,
        rigged_any: "Now it's gear for the trip.",
      }
    : { item: `Text the ship a photo of anything near you, or just name it. Gemini rigs it into one of twelve fixed mods. ${ITEM_NAME.charAt(0).toUpperCase() + ITEM_NAME.slice(1)}? That's ${withArticle(MOD_NAME)}.` }),
  stage1: 'Every move costs fuel, oxygen or hull. Along the way, you choose upgrades.',
  freetext: "From stage two, there are no menus. Just say what you'd do. What you brought unlocks moves nobody else gets.",
  combo: "Upgrades stack into combos. And if you're lucky, you find legendary gear.",
  dilemma: 'In lunar orbit, the ship breaks. Tear apart the thing you brought, or keep it and take the risk?',
  landing: "Touchdown. The ending remembers what you brought, and Gemini writes a captain's log from what really happened.",
  boarding: 'At events, everyone scans the big screen and launches together.',
  flight: 'A live mission feed and leaderboard light up every combo, find and landing.',
  podium: 'Every round ends on a podium, and the next launch opens on its own.',
  tech: 'It all runs over iMessage with Photon Spectrum. Gemini only recognizes your item and understands your words. The rules decide every number, so every run is fair.',
  end: 'Last Rocket to the Moon. What would you bring?',
};
const voiceDir = join(tmpdir(), 'demo-video-voice');
const voiceFile = (text: string) => join(voiceDir, `${createHash('sha1').update(`${VOICE}|${text}`).digest('hex').slice(0, 16)}.wav`);
/** Gemini TTS answers with a WAV, or raw 16-bit PCM ("audio/L16;rate=24000") that needs a header. */
function asWav(data: Buffer, mime: string): Buffer {
  if (data.toString('latin1', 0, 4) === 'RIFF') return data;
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
async function speak(text: string): Promise<Buffer> {
  let last = '';
  for (const model of TTS_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } }),
      });
      const j = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] };
      const audio = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (r.ok && audio) return asWav(Buffer.from(audio.data, 'base64'), audio.mimeType);
      last = `${model}: HTTP ${r.status}`;
      if (r.status !== 429) break;
      await sleep(20_000); // per-minute limit: wait it out, then try again
    }
  }
  throw new Error(`narration failed (${last})`);
}
if (NARRATE) {
  mkdirSync(voiceDir, { recursive: true });
  for (const [name, text] of Object.entries(LINES)) {
    if (existsSync(voiceFile(text))) continue;
    writeFileSync(voiceFile(text), await speak(text));
    console.log(`voice: ${name}`);
    await sleep(800);
  }
}
if (process.env.VOICE_ONLY) {
  for (const [name, text] of Object.entries(LINES)) {
    const w = readFileSync(voiceFile(text));
    const secs = w.readUInt32LE(40) / (w.readUInt32LE(24) * w.readUInt16LE(22) * (w.readUInt16LE(34) / 8));
    console.log(`${name.padEnd(9)} ${secs.toFixed(1).padStart(5)} s  ${voiceFile(text)}`);
  }
  process.exit(0);
}

// ---------- 2. Servers ----------
const stubUsers = { register: async () => ({ assignedNumber: '+15555550123' }), status: async () => ({ ok: true, users: 0, limit: 100 }) } as unknown as PhotonUsers;
const soloHub = new Hub();
const solo = new GameService({
  contents, store: new Store(mkdtempSync(join(tmpdir(), 'video-solo-'))), hub: soloHub, channels: [new SimChannel(soloHub)],
  ai: new AI(new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL)), eventMode: false, publicUrl: '',
});
solo.shortUrl = 'https://dingn0823.github.io/moon';
const soloHttp = createHttpServer({ game: solo, hub: soloHub, webDir: join(root, 'web'), photonUsers: stubUsers });
const directorHtml = readFileSync(join(import.meta.dirname, 'demo-video.html'), 'utf8');
const chunks = new Map<number, Buffer>();
const front = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/director') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(directorHtml);
  }
  if (url.pathname === '/director/photo.jpg' && PHOTO) {
    res.setHeader('content-type', 'image/jpeg');
    return res.end(readFileSync(PHOTO));
  }
  const line = /^\/director\/voice\/(\w+)\.wav$/.exec(url.pathname);
  if (line && LINES[line[1]]) {
    res.setHeader('content-type', 'audio/wav');
    return res.end(readFileSync(voiceFile(LINES[line[1]])));
  }
  if (url.pathname === '/director/chunk' && req.method === 'POST') {
    const b: Buffer[] = [];
    req.on('data', (d) => b.push(d)).on('end', () => {
      chunks.set(Number(url.searchParams.get('i')), Buffer.concat(b));
      res.end('ok');
    });
    return;
  }
  soloHttp.emit('request', req, res);
});
await new Promise<void>((r) => front.listen(3400, () => r()));

const fleetHub = new Hub();
const botChannel: Channel = { name: 'bot', send: async () => {} };
const fleet = new GameService({
  contents, store: new Store(mkdtempSync(join(tmpdir(), 'video-fleet-'))), hub: fleetHub, channels: [botChannel],
  ai: new AI(new Gemini('')), eventMode: true, publicUrl: '',
  rounds: { boardingMs: 20_000, flightMs: 100_000, ceremonyMs: 25_000 },
});
fleet.shortUrl = 'https://dingn0823.github.io/moon';
fleet.rounds.setEnabled(true);
const fleetHttp = createHttpServer({ game: fleet, hub: fleetHub, webDir: join(root, 'web'), photonUsers: null });
await new Promise<void>((r) => fleetHttp.listen(3401, () => r()));

const NAMES = ['Nova', 'Leo', 'Maya', 'Kai', 'Zoe', 'Omar', 'Iris', 'Theo', 'Nina', 'Sam', 'Ava', 'Ravi', 'Mei', 'Jon', 'Lia', 'Ezra'];
const ITEMS = ['my hoodie', 'a water bottle', 'my headphones', 'house keys', 'a laptop', 'an umbrella', 'a coke', 'a pencil', 'a compass', 'my blanket', 'a teddy bear', 'a thermos'];
async function bot(i: number): Promise<void> {
  const address = `bot-${i}`;
  fleet.ensurePlayer('bot', address, NAMES[i % NAMES.length]);
  let n = 0;
  const say = (text: string) => fleet.handleInbound({ channel: 'bot', address, msgId: `${address}-${n++}`, text });
  const phase = () => fleet.currentRun(address)?.state.phase;
  await sleep(i * 1200 + Math.random() * 1500);
  let first = true;
  for (;;) {
    await say(first ? 'join' : 'again');
    first = false;
    while (phase() === 'new') await sleep(500);
    await sleep(1500 + Math.random() * 3000);
    await say(ITEMS[(i + n) % ITEMS.length]);
    await say('yes');
    while (phase() !== 'ended') {
      await sleep(4000 + Math.random() * 5000);
      await say(String(1 + Math.floor(Math.random() * 3)));
    }
    while (fleet.rounds.phase === 'flying') await sleep(1000);
    await sleep(2000 + Math.random() * 6000);
  }
}
for (let i = 0; i < 14; i++) void bot(i);

// ---------- 3. Headless Edge, recording its own tab ----------
const bin = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
if (!bin) throw new Error('no Edge/Chrome found');
const browser = spawn(bin, ['--headless=new', '--remote-debugging-port=9350', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'video-browser-'))}`,
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--lang=en-US', '--hide-scrollbars', '--force-device-scale-factor=1',
  // The "sharing this tab" bar takes 48px while recording, so the window is taller than 1080.
  '--window-size=1952,1223', '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
for (let i = 0; i < 40 && !targets.some((t) => t.type === 'page'); i++) {
  await sleep(250);
  targets = await fetch('http://127.0.0.1:9350/json/list').then((r) => r.json()).catch(() => []);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map<number, (m: any) => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
};
const cdp = (method: string, params: object = {}) => new Promise<any>((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
async function ev<T = unknown>(expression: string, gesture = false): Promise<T> {
  const hang = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`no answer from the page: ${expression.slice(0, 70)}`)), 60_000));
  const m = await Promise.race([hang, cdp('Runtime.evaluate', { expression, awaitPromise: true, userGesture: gesture, returnByValue: true })]);
  const r = m.result;
  if (m.error || r?.exceptionDetails) throw new Error(`${expression.slice(0, 70)}: ${m.error?.message ?? r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value as T;
}
function quit(code: number): never {
  try { ws.close(); } catch { /* already closed */ }
  browser.kill();
  process.exit(code);
}

// ---------- 4. Helpers ----------
let address = '';
const run = () => solo.currentRun(address);
const st = () => run()?.state;
async function until(pred: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
  const t = Date.now();
  while (!(await pred())) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(120);
  }
}
/** Wait until the phone has shown every bubble and nothing changed for a moment. */
async function phoneIdle(stableMs = 600, ms = 25_000): Promise<void> {
  let last = '';
  let since = Date.now();
  const t0 = Date.now();
  for (;;) {
    const s = await ev<string>('D.phoneState()');
    if (s !== last) { last = s; since = Date.now(); }
    if (!JSON.parse(s).typing && Date.now() - since >= stableMs) return;
    if (Date.now() - t0 > ms) throw new Error('phone never went quiet');
    await sleep(100);
  }
}
async function send(text: string, typed: boolean, cps = 15): Promise<void> {
  const v = st()?.version ?? -1;
  await ev(typed ? `D.typePhone(${JSON.stringify(text)}, ${cps})` : `D.sendFast(${JSON.stringify(text)})`);
  await until(() => (st()?.version ?? -1) !== v, 20_000, `the ship to answer "${text}"`);
}
const q = (s: string) => JSON.stringify(s);
const rows = async () => (JSON.parse(await ev<string>('D.phoneState()')) as { rows: number }).rows;
/** Cut as soon as the bubbles that matter are on screen; the rest can arrive while paused. */
async function waitRows(from: number, n: number): Promise<void> {
  await until(async () => (await rows()) >= from + n, 15_000, `${n} new bubbles`);
}
const cap = (k: string, t: string, s: string, mode = 'stage') => ev(`D.cap(${q(k)}, ${q(t)}, ${q(s)}, ${q(mode)})`);
const resume = () => ev('D.rec.resume()');
/** Start this shot's line (seconds from now, on the recording's clock). */
const say = (name: string, inSec = 0) => (NARRATE ? ev(`M.say(${q(name)}, ${inSec})`) : Promise.resolve(0));
const said = () => (NARRATE ? ev('M.said()') : Promise.resolve(true));
/** Never cut in the middle of a sentence. */
const pause = async () => { await said(); await sleep(250); await ev('D.rec.pause()'); };
const pauseNow = () => ev('D.rec.pause()');
/** Fade to black (after the line is said), then pause; the next shot starts black and fades in. */
const toBlack = async () => { await said(); await ev('D.dip(true); true'); await sleep(420); await pauseNow(); };
const fromBlack = async () => { await resume(); await sleep(250); await ev('D.dip(false); true'); };
const timeline: { shot: string; at: number }[] = [];
const mark = async (shot: string) => timeline.push({ shot, at: await ev<number>('D.rec.elapsed()') });

let cursor = 0;
function expect(m: Move): void {
  const s = st()!;
  const ok = s.phase === m.phase && (m.phase === 'pick' || s.eventId === m.eventId);
  if (!ok) throw new Error(`run drifted from the plan at move ${cursor}: live ${s.phase}/${s.eventId}, planned ${m.phase}/${m.eventId}`);
}
/** Paused: play the moves that aren't worth showing. */
async function fastForwardTo(k: number): Promise<void> {
  while (cursor < k) {
    const m = best!.moves[cursor];
    expect(m);
    await send(m.text, false);
    await phoneIdle(250);
    cursor++;
  }
  await phoneIdle(700);
}
async function play(k: number, cps: number): Promise<void> {
  const m = best!.moves[k];
  expect(m);
  await send(m.text, true, cps);
  cursor = k + 1;
}
const stageName = (n: number) => en.stages[n - 1].name;
function comboLine(id: string): string {
  const k = en.combos.find((x) => x.id === id)!;
  const parts = k.requires.map((r) => (r.startsWith('upgrade:') ? upgradeById(en, r.slice('upgrade:'.length)).name : `your ${item.label}`));
  return `${parts.join(' + ')} = ⚡ ${k.name}.`;
}

const TITLE = `<div class="title-card"><span class="rocket">🚀</span>
  <div class="k">HackWashU 2026 · Fly Me to the Moon</div>
  <h1>Last Rocket<br>to the Moon</h1>
  <p>Earth has hours left. You can bring <b>one thing</b> with you.</p>
  <div class="q">What would it be?</div></div>`;
const TECH = `<div class="tech"><div class="k">How it works</div>
  <h2>The AI never touches the numbers.</h2>
  <div class="tiles">
    <div class="tile"><div class="ic">💬</div><h3>iMessage</h3><p>A Photon Spectrum agent: photos in; typing, screen effects and pushes out.</p></div>
    <div class="tile"><div class="ic">👁️</div><h3>Gemini</h3><p>Recognizes your item and understands your words, choosing only from fixed lists.</p></div>
    <div class="tile"><div class="ic">⚙️</div><h3>Rules engine</h3><p>A pure state machine decides every number, so every run is fair.</p></div>
  </div>
  <div class="foot">One laptop · free tiers · <span>$0</span> · English + 中文 · played by friends on real iPhones</div></div>`;
const END = `<div class="end"><h1>🚀 Last Rocket to the Moon</h1>
  <div class="big">What would you bring?</div>
  <div class="links"><span>dingn0823.github.io/moon</span><span>github.com/dingn0823/last-rocket</span></div>
  <div class="k">HackWashU 2026 · Photon Bonus Track</div></div>`;

/**
 * MediaRecorder WebM has no Duration and no Cues, so players show no length and can't seek.
 * Add both: Duration in Info, and one cue per cluster that starts on a video keyframe, placed
 * before the first Cluster (fixed-width entries, so the index size is known before the offsets).
 */
function seekable(b: Buffer): Buffer {
  const vint = (pos: number, keep: boolean) => {
    const f = b[pos];
    let len = 1;
    let m = 0x80;
    while (len <= 8 && !(f & m)) { len++; m >>= 1; }
    let v = keep ? f : f & (m - 1);
    for (let i = 1; i < len; i++) v = v * 256 + b[pos + i];
    return { v, len, unknown: !keep && v === 2 ** (7 * len) - 1 };
  };
  const el = (pos: number) => {
    const id = vint(pos, true);
    const sz = vint(pos + id.len, false);
    return { pos, id: id.v, idLen: id.len, size: sz.v, unknown: sz.unknown, data: pos + id.len + sz.len };
  };
  const head = el(0);
  const seg = el(head.data + head.size);
  if (head.id !== 0x1a45dfa3 || seg.id !== 0x18538067) throw new Error('not a WebM file');
  let info: ReturnType<typeof el> | null = null;
  let videoTrack = 0;
  let scale = 1e6;
  let firstCluster = -1;
  let last = 0;
  const clusters: { pos: number; time: number; key: boolean | null }[] = [];
  for (let p = seg.data; p < b.length;) {
    const e = el(p);
    const cur = clusters[clusters.length - 1];
    if (e.id === 0x1549a966) {
      info = e;
      for (let q = e.data; q < e.data + e.size;) { const c = el(q); if (c.id === 0x2ad7b1) scale = b.readUIntBE(c.data, c.size); q = c.data + c.size; }
    } else if (e.id === 0x1654ae6b) {
      for (let q = e.data; q < e.data + e.size;) {
        const t = el(q);
        let num = 0;
        let type = 0;
        for (let r = t.data; t.id === 0xae && r < t.data + t.size;) { const c = el(r); if (c.id === 0xd7) num = b.readUIntBE(c.data, c.size); if (c.id === 0x83) type = b.readUIntBE(c.data, c.size); r = c.data + c.size; }
        if (type === 1) videoTrack = num;
        q = t.data + t.size;
      }
    } else if (e.id === 0x1f43b675) {
      if (firstCluster < 0) firstCluster = p;
      clusters.push({ pos: p, time: 0, key: null });
      p = e.data; // unknown size: the cluster's children follow
      continue;
    } else if (e.id === 0xe7 && cur) {
      cur.time = b.readUIntBE(e.data, e.size);
    } else if (e.id === 0xa3 && cur) {
      const t = vint(e.data, false);
      last = Math.max(last, cur.time + b.readInt16BE(e.data + t.len));
      if (t.v === videoTrack && cur.key === null) cur.key = !!(b[e.data + t.len + 2] & 0x80);
    } else if (e.unknown) throw new Error(`unknown-size element ${e.id.toString(16)}`);
    p = e.data + e.size;
  }
  if (!info || !videoTrack || firstCluster < 0 || info.size + 11 > 126) throw new Error('unexpected WebM layout');
  const u64 = (v: number) => { const x = Buffer.alloc(8); x.writeBigUInt64BE(BigInt(Math.round(v))); return x; };
  const dur = Buffer.concat([Buffer.from([0x44, 0x89, 0x88]), Buffer.alloc(8)]);
  dur.writeDoubleBE(last + 33e6 / scale, 3);
  const newInfo = Buffer.concat([b.subarray(info.pos, info.pos + info.idLen), Buffer.from([0x80 | (info.size + dur.length)]), b.subarray(info.data, info.data + info.size), dur]);
  const keys = clusters.filter((c) => c.key);
  const shift = dur.length + 4 + 8 + keys.length * 27;
  const cues = Buffer.concat([
    Buffer.from([0x1c, 0x53, 0xbb, 0x6b, 0x01]), u64(keys.length * 27).subarray(1),
    ...keys.map((c) => Buffer.concat([
      Buffer.from([0xbb, 0x99, 0xb3, 0x88]), u64(c.time),
      Buffer.from([0xb7, 0x8d, 0xf7, 0x81, videoTrack, 0xf1, 0x88]), u64(c.pos + shift - seg.data),
    ])),
  ]);
  return Buffer.concat([b.subarray(0, info.pos), newInfo, b.subarray(info.data + info.size, firstCluster), cues, b.subarray(firstCluster)]);
}

// ---------- 5. The shoot ----------
try {
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: 'http://localhost:3400/director' });
  await sleep(1500);
  address = (await fetch('http://localhost:3400/api/sim/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'Luna' }) }).then((r) => r.json())).address;
  await ev(`localStorage.setItem('lr_address', ${q(address)}); localStorage.setItem('lr_join_lang', 'en'); true`);
  await ev(`D.load('lap', '/join')`);
  await ev(`D.load('ph', '/phone')`);
  await sleep(1800);
  await ev('D.speedPhone(0.55); D.clearStart(); true');
  await ev(`D.card(''); D.show('card'); true`);
  if (PHOTO) console.log('photo for the phone:', await ev<string>(`D.shrinkPhoto('/director/photo.jpg')`));
  if (NARRATE) for (const name of Object.keys(LINES)) await ev(`M.loadLine(${q(name)}, '/director/voice/${name}.wav')`);

  console.log('capture:', await ev<string>('D.rec.start()', true));
  await ev('M.start()');
  await mark('title');
  await ev(`D.card(${q(TITLE)}); true`);
  await say('title', 0.9);
  await sleep(5300);
  await said();
  await sleep(200);
  await toBlack();
  await ev(`D.show('stage'); true`);
  await sleep(1500); // drawn while paused, under the black
  await fromBlack();

  // Join from the laptop.
  await mark('join');
  await say('join', 0.3);
  await cap('Join · about 20 seconds', 'Join from any laptop', 'A nickname and your iPhone number. No app to install.');
  await sleep(1000);
  await ev(`D.type(D.lap(), '#nick', 'Luna', 8)`);
  await sleep(250);
  await ev(`D.type(D.lap(), '#num', '(555) 555-0100', 13)`);
  await sleep(500);
  await ev(`D.lap().getElementById('go').click(); true`);
  await until(async () => !!(await ev('D.joinCode()')), 10_000, 'the boarding pass');
  await sleep(2400);
  await pause();

  // One text pairs the phone; the laptop turns into the bridge.
  const code = await ev<string>('D.joinCode()');
  await resume();
  await mark('pair');
  await say('pair', 0.2);
  await cap('Scan · tap send', 'One text and you’re aboard', 'Messages opens with your join code already typed.');
  await sleep(700);
  await send(code, true, 11);
  await until(async () => (await ev<string>('D.lapPath()')).startsWith('/bridge'), 10_000, 'the laptop to become the bridge');
  await cap('Pair', 'Your laptop becomes your ship’s bridge', 'Live, in sync with every text.');
  await phoneIdle(700);
  await sleep(1000);
  await pause();

  // Bring one thing. (The photo is attached while paused: decoding it on camera stalls a frame.)
  if (PHOTO) {
    await ev('D.attachPhoto(D.photoUrl)');
    await ev('D.zoomNow()');
    await sleep(1400); // the close-up is drawn before it's seen
  }
  await resume();
  await ev('M.level(1)');
  if (PHOTO) {
    // The AI scan: the photo goes out, the bridge's hologram scans it, Gemini names it.
    await mark('scan');
    await say('scan', 0.2);
    await cap('AI scan · Gemini', 'Snap one real thing', 'Gemini looks at the photo and picks one of 12 fixed mods.');
    // Open on the empty scanner, so the whole scan is seen: photo in, scan lines, Gemini's answer.
    await sleep(1800);
    await ev('D.sendAttached()');
    await until(async () => !!(await ev('D.holoScanning()')), 10_000, 'the hologram scan');
    await until(() => st()?.phase === 'confirm_item', 20_000, "Gemini's answer");
    const seen = st()!.pendingItem!;
    console.log(`live scan: Gemini sees "${seen.label}" → ${modById(en, seen.modId).name}`);
    await sleep(700);
    await cap('AI scan · Gemini', `${seen.label.charAt(0).toUpperCase() + seen.label.slice(1)} → ${modById(en, seen.modId).name}`, 'Recognized from the photo, then rigged into gear by the rules.');
    await said();
    await say(seen.modId === item.modId ? 'rigged' : 'rigged_any', 0.1);
    await sleep(1400);
    await said();
    await sleep(300);
    await pauseNow();
    await ev('D.zoomReset()');
    await sleep(1200);
    await resume();
    await sleep(300);
  } else {
    await mark('item');
    await say('item', 0.2);
    await cap('Bring one real thing', 'Snap it, or just name it…', '…and the AI rigs it into gear: one of 12 fixed mods.');
    await sleep(900);
    await send(ITEM, true, 16);
    await until(() => st()?.phase === 'confirm_item', 8000, 'the item guess');
  }
  await phoneIdle(500);
  await sleep(900);
  let r0 = await rows();
  await send('1', true, 5);
  await until(() => st()?.phase === 'action' && st()?.stage === 1, 8000, 'stage 1');
  const locked = st()!.item!;
  if (locked.modId !== item.modId || locked.label !== item.label) {
    item = { modId: locked.modId, label: locked.label, blurb: locked.blurb, plural: locked.plural };
    best = findPlan(item);
    K = keyMoves(best);
  }
  // Load the chosen dice: from here on, events and luck follow the plan.
  const rec = run()!;
  rec.state.rng = best.rng;
  solo.store.saveRun(rec);
  await waitRows(r0, 3); // own "1", the gear card, "Locked in"
  await sleep(1500);
  await pause();
  await phoneIdle(700);

  // Stage 1 and the first upgrade.
  await resume();
  await mark('stage1');
  await say('stage1', 0.2);
  await cap(`Stage 1 of 5 · ${stageName(1)}`, 'Every move costs fuel, oxygen or hull', `Your ${item.label} unlocks its own moves. Then choose 1 of 3 upgrades.`);
  await sleep(1300);
  r0 = await rows();
  await play(0, 5);
  await waitRows(r0, 3); // own move, the outcome, the upgrade offer
  await sleep(1100);
  if (best.moves[1].phase === 'pick') {
    r0 = await rows();
    await play(1, 5);
    await waitRows(r0, 3); // own pick, the gear card, "Installed"
  }
  await sleep(1200);
  await pause();

  // Free text: the hidden move the item unlocks.
  await fastForwardTo(K.hidden);
  await resume();
  await mark('freetext');
  await say('freetext', 0.2);
  await cap(`Stage 2 · ${stageName(2)}`, 'From here on, no menus', `Just say what you’d do. Your ${item.label} unlocks a move nobody else gets.`);
  await sleep(1400);
  r0 = await rows();
  await play(K.hidden, 17);
  await waitRows(r0, 2);
  await sleep(1600);
  await pause();

  // Upgrades stack into combos (and maybe a legendary).
  await fastForwardTo(K.combo);
  await resume();
  await mark('combo');
  await say('combo', 0.2);
  await cap('Upgrades stack', 'Combos and legendary gear', comboLine(best.moves[K.combo].newCombos[0]));
  await sleep(1400);
  r0 = await rows();
  await play(K.combo, 5);
  await waitRows(r0, 3);
  await sleep(1700);
  await (K.legendary > K.combo && K.legendary < K.stage4 ? pauseNow() : pause());
  if (K.legendary > K.combo && K.legendary < K.stage4) {
    await fastForwardTo(K.legendary);
    await resume();
    await mark('legendary');
    await sleep(500);
    r0 = await rows();
    await play(K.legendary, 5);
    await waitRows(r0, 3);
    await sleep(1500);
    await pause();
  }

  // The dilemma: the thing you brought, or your life?
  await fastForwardTo(K.stage4);
  await resume();
  await mark('dilemma');
  await say('dilemma', 0.2);
  await cap(`Stage 4 · ${stageName(4)}`, 'Tear it apart to survive… or keep it?', 'Random crises and ±25% luck: no two flights are the same.');
  await sleep(2000);
  r0 = await rows();
  await play(K.stage4, 17);
  await waitRows(r0, 2);
  await sleep(1600);
  await pause();

  // Touchdown.
  await fastForwardTo(K.last);
  await resume();
  await mark('landing');
  await say('landing', 0.2);
  await cap(`Stage 5 · ${stageName(5)}`, 'Touchdown', `The ending remembers what you brought: your ${item.label} made it to the Moon.`);
  await sleep(1300);
  await play(K.last, 17);
  await until(() => st()?.phase === 'ended', 10_000, 'the ending');
  await ev('M.chime(0.6)');
  await phoneIdle(600);
  await sleep(1300);
  await pause();
  const logged = () => !!run()?.transcript.some((e) => e.dir === 'out' && JSON.stringify(e.msg).includes("Captain's log"));
  await until(logged, 15_000, "the captain's log").catch(() => console.log("no captain's log (Gemini unavailable?)"));
  if (logged()) {
    await phoneIdle(500);
    await resume();
    await mark('log');
    await cap('Captain’s log', 'Gemini writes the last line', 'Grounded in what actually happened on your run.');
    await sleep(3400);
    await pause();
  }
  console.log(`solo run: ${st()?.ending?.kind}, score ${st()?.ending?.score}`);

  // The big screen: everyone launches together. (The phone and laptop are done: unload them, less to draw.)
  await toBlack();
  await ev(`D.capOff(); D.unload('lap'); D.unload('ph'); D.bigOn(); D.show('full'); true`);
  await ev(`D.load('big', 'http://localhost:3401/screen')`);
  await sleep(8000); // let it settle before anything is recorded
  const round = () => fleet.rounds.snapshot();
  await until(() => { const r = round(); const left = r.boardingEndsAt - r.now; return r.phase === 'boarding' && left < 6600 && left > 5200 && fleet.screenState().counts.boarding >= 6; }, 300_000, 'a boarding call on the big screen');
  await fromBlack();
  await mark('boarding');
  await say('boarding', 0.3);
  await ev('M.level(2)');
  const toLift = (round().boardingEndsAt - round().now) / 1000;
  await ev(`M.riser(${Math.max(0, toLift - 3.2)}, 3.2); M.boom(${toLift}); true`);
  await cap('At events', 'Everyone launches together', 'Scan the code on the big screen: a boarding call, then 3·2·1.', 'full');
  await until(() => { const r = round(); return r.phase === 'flying' && r.now - (r.endsAt - r.flightMs) > 2600; }, 15_000, 'liftoff');
  await toBlack();
  await until(() => { const r = round(); return r.phase === 'flying' && r.now - (r.endsAt - r.flightMs) > 40_000; }, 60_000, 'mid-flight');
  await fromBlack();
  await mark('flight');
  await say('flight', 0.2);
  await cap('Live on the big screen', 'Mission feed and best landings', 'Combos, legendary finds and landings light up as they happen.', 'full');
  await sleep(5800);
  await toBlack();
  await until(() => { const r = round(); return r.phase === 'ceremony' && r.now - (r.ceremonyEndsAt - 25_000) > 900; }, 120_000, 'the podium');
  await fromBlack();
  await mark('podium');
  await say('podium', 0.3);
  await ev('M.chime(0.2)');
  await cap('Every round', 'A podium, then the next launch', 'Rounds run on their own. The host just switches them on.', 'full');
  await sleep(5800);
  await toBlack();

  // How it works, and where to play.
  await ev(`D.capOff(); D.card(''); D.show('card'); D.unload('big'); true`);
  await sleep(800);
  await fromBlack();
  await ev('M.level(1)');
  await mark('tech');
  await sleep(300);
  await ev(`D.card(${q(TECH)}); true`);
  await say('tech', 0.4);
  await sleep(7000);
  await said();
  await sleep(400);
  await ev(`D.show('none'); true`);
  await sleep(650);
  await mark('end');
  await ev(`D.card(${q(END)}); D.show('card'); M.level(0); true`);
  await say('end', 0.5);
  await sleep(4400);
  await said();
  await ev('M.fadeOut(2.4); true');
  await sleep(2600);
  const total = await ev<number>('D.rec.elapsed()');
  await ev('D.rec.stop()');
  await sleep(1500);

  const n = Math.max(...chunks.keys()) + 1;
  const parts: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const c = chunks.get(i);
    if (!c) throw new Error(`missing video chunk ${i}`);
    parts.push(c);
  }
  const video = seekable(Buffer.concat(parts));
  writeFileSync(outFile, video);
  const timelineFile = join(tmpdir(), 'demo-video.timeline.json');
  writeFileSync(timelineFile, JSON.stringify({ total, timeline, seed: best.seed }, null, 2));
  console.log(`saved ${outFile}: ${(video.length / 1e6).toFixed(1)} MB, ${total.toFixed(1)} s (shot times in ${timelineFile})`);
  for (const t of timeline) console.log(`  ${t.at.toFixed(1).padStart(6)}s  ${t.shot}`);
  quit(0);
} catch (err) {
  console.error('shoot failed:', err);
  quit(1);
}
