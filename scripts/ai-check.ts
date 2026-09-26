// Live Gemini check: photo recognition, free-text parsing, timeout fallback, calls per run.
//   node scripts/ai-check.ts [path/to/photo.heic|jpg]
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import type { Channel } from '../src/channel/types.ts';
import { loadAllContent } from '../src/engine/content.ts';
import { actionCandidates, newRun, step } from '../src/engine/engine.ts';
import type { Content, Outbound, RunState } from '../src/engine/types.ts';
import { GameService } from '../src/game/service.ts';
import { Hub } from '../src/server/hub.ts';
import { Store } from '../src/store/store.ts';

const root = join(import.meta.dirname, '..');
process.loadEnvFile(join(root, '.env'));
const contents = loadAllContent(join(root, 'content'));
const gemini = new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL);
if (!gemini.enabled) throw new Error('GEMINI_API_KEY is empty');
const ai = new AI(gemini);
const MIME: Record<string, string> = { '.heic': 'image/heic', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const photoPath = process.argv[2] ?? (() => {
  const dir = join(root, 'data', 'media');
  const f = readdirSync(dir).filter((x) => x.endsWith('.heic')).pop() ?? readdirSync(dir).pop();
  return f ? join(dir, f) : '';
})();

const timed = async <T>(label: string, fn: () => Promise<T>) => {
  const t = Date.now();
  const r = await fn();
  console.log(`  ${label.padEnd(44)} ${String(Date.now() - t).padStart(5)}ms  ${JSON.stringify(r)}`);
  return r;
};

function at(c: Content, stage: number, eventId: string, modId = 'impact_pad', label = 'scarf'): RunState {
  let s = newRun('check', 1, c, 0);
  s = step(s, { type: 'start' }, c, { numbered: false, now: 0 }).state;
  s = step(s, { type: 'item_scanned', item: { modId, label, blurb: 'x' } }, c, { numbered: false, now: 0 }).state;
  s = step(s, { type: 'confirm', yes: true }, c, { numbered: false, now: 0 }).state;
  return { ...s, stage, eventId, phase: 'action' };
}

console.log(`models: ${gemini.models.join(' → ')}`);

console.log('\n1) photo recognition');
if (photoPath) {
  const image = { base64: readFileSync(photoPath).toString('base64'), mime: MIME[extname(photoPath).toLowerCase()] ?? 'image/jpeg' };
  await timed(`EN photo (${image.mime})`, () => ai.classifyPhoto(contents.en, image));
  await timed(`ZH photo (${image.mime})`, () => ai.classifyPhoto(contents.zh, image));
} else console.log('  (no photo found in data/media; skipped)');
await timed('EN text, no keyword: "grandpa\'s old harmonica"', () => ai.classifyText(contents.en, "my grandpa's old harmonica"));
await timed('ZH text, no keyword: "爷爷的旧口琴"', () => ai.classifyText(contents.zh, '爷爷的旧口琴'));

console.log('\n2) free-text parsing (phrases the keyword lists do NOT cover)');
const dbEn = at(contents.en, 2, 'debris_field');
const dbZh = at(contents.zh, 2, 'debris_field', 'impact_pad', '围巾');
const o2Zh = at(contents.zh, 4, 'o2_failure', 'impact_pad', '围巾');
await timed('EN "take evasive maneuvers to the left"', () => ai.parseAction('take evasive maneuvers to the left', 'Debris field', actionCandidates(dbEn, contents.en)));
await timed('EN "floor it, we go straight at them"', () => ai.parseAction('floor it, we go straight at them', 'Debris field', actionCandidates(dbEn, contents.en)));
await timed('EN "swerve, then if that fails punch it"', () => ai.parseAction('swerve, then if that fails punch it', 'Debris field', actionCandidates(dbEn, contents.en)));
await timed('ZH "从旁边溜过去"', () => ai.parseAction('从旁边溜过去', '碎片区', actionCandidates(dbZh, contents.zh)));
await timed('ZH "拿围巾把那个口子捂上"', () => ai.parseAction('拿围巾把那个口子捂上', '氧气故障', actionCandidates(o2Zh, contents.zh)));
await timed('EN "tell me a joke" (should clarify)', () => ai.parseAction('tell me a joke', 'Debris field', actionCandidates(dbEn, contents.en)));

console.log('\n3) timeout fallback');
await timed('raw call with a 50ms budget → null', () => gemini.json([{ text: 'Reply {"ok":true}' }], 50));

class Capture implements Channel {
  readonly name = 'check';
  sent: Outbound[][] = [];
  async send(_a: string, msgs: Outbound[]) { this.sent.push(msgs); }
}
const dir = mkdtempSync(join(tmpdir(), 'ai-check-'));
try {
  // Service with an AI that always times out: free text must fall straight back to numbered options.
  const slow = new Gemini(gemini.key, gemini.models.join(','));
  const origJson = slow.json.bind(slow);
  slow.json = (parts, _ms) => origJson(parts, 1);
  const capSlow = new Capture();
  const gSlow = new GameService({ contents, store: new Store(join(dir, 'slow')), ai: new AI(slow), hub: new Hub(), channels: [capSlow], eventMode: false, publicUrl: '' });
  const say = (g: GameService, addr: string, id: string, text: string) => g.handleInbound({ channel: 'check', address: addr, msgId: id, text });
  await say(gSlow, 't', '1', 'join');
  await say(gSlow, 't', '2', 'my scarf');
  await say(gSlow, 't', '3', 'yes');
  await say(gSlow, 't', '4', '1');
  await say(gSlow, 't', '5', '1');
  capSlow.sent = [];
  const t0 = Date.now();
  await say(gSlow, 't', '6', 'hmm do the clever thing');
  const reply = capSlow.sent.flat().map((m) => (m.t === 'text' ? m.text : '')).join(' | ');
  console.log(`  AI timeout during stage 2 (${Date.now() - t0}ms) → ${reply.slice(0, 120)}`);
  console.log(`  numbered fallback shown: ${/Reply with a number/.test(reply)}`);

  // 4) A full run with the real AI, counting Gemini calls.
  console.log('\n4) full runs with real Gemini (free text everywhere possible)');
  for (const [lang, lines] of [
    ['en', ['join', "my grandpa's old harmonica", 'yes', '1', '1', 'take evasive maneuvers', '2', 'go check out where it comes from', '3', 'keep it and just breathe less', 'bring us down nice and gentle']],
    ['zh', ['加入', '爷爷的旧口琴', '是', '1', '1', '从旁边溜过去', '2', '去看看信号从哪来', '3', '留着它，大家少喘两口气', '轻轻地降下去']],
  ] as const) {
    const cap = new Capture();
    const g = new GameService({ contents, store: new Store(join(dir, lang)), ai, hub: new Hub(), channels: [cap], eventMode: false, publicUrl: '' });
    let n = 0;
    for (const line of lines) {
      if (g.currentRun(lang)?.state.phase === 'ended') break;
      await say(g, lang, String(n++), line);
      const s = g.currentRun(lang)!.state;
      // Picks and unclear replies: keep going with "1" so the run finishes.
      while (s.phase === 'pick' && n < 40) { await say(g, lang, String(n++), '1'); break; }
    }
    while (g.currentRun(lang)!.state.phase !== 'ended' && n < 60) await say(g, lang, String(n++), '1');
    const rec = g.currentRun(lang)!;
    const log = cap.sent.flat().filter((m) => m.t === 'text').map((m) => (m as { text: string }).text);
    console.log(`  [${lang}] ending=${rec.state.ending?.kind} Gemini calls this run=${rec.aiCalls} (moves: ${rec.state.history.map((h) => h.actionId).join(', ')})`);
    console.log(`  [${lang}] item: ${rec.state.item?.label} → ${rec.state.item?.modId}`);
    console.log(`  [${lang}] last: ${log.at(-1)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
