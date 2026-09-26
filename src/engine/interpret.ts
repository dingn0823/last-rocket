// Steps 1–2 of input understanding: number → keyword. Pure; no AI here. Handles English and Chinese.
import type { Action, Content, Mod, RunState } from './types.ts';
import { eligibleActions, upgradeById, visibleActions } from './rules.ts';
import { findPhrase, hasCJK, normalize } from './text.ts';

export type ActionReading =
  | { kind: 'action'; id: string }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'multi' }
  | { kind: 'none' };

const NEGATIONS_EN = [' not ', " don't ", ' dont ', ' do not ', ' never ', ' no ', ' without ', " won't ", ' stop '];
const NEGATIONS_ZH = ['不要', '不用', '千万别', '别', '不', '没', '勿', '甭'];
const MULTI_EN = [' then ', ' after that ', ' afterwards ', ' if ', ' unless ', ' and also ', ' otherwise '];
const MULTI_ZH = ['然后', '之后', '接着', '如果', '要是', '假如', '否则', '再然后'];

const ZH_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };

export function parseNumber(text: string): number | null {
  const raw = normalize(text).trim();
  const m = raw.match(/^#?\s*(\d{1,2})$/);
  if (m) return Number(m[1]);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, first: 1, second: 2, third: 3 };
  if (raw in words) return words[raw];
  // 选2 / 第二个 / 2号 / 选择三
  const z = raw.replace(/\s+/g, '').match(/^(?:我)?(?:选择?|要)?第?([1-9]|[一二两三四五])(?:个|号|项|条)?(?:吧|啊)?$/);
  if (z) return /\d/.test(z[1]) ? Number(z[1]) : ZH_DIGITS[z[1]];
  return null;
}

/** True if the keyword at `idx` is directly negated ("don't swerve", "别绕开", "不拆"). */
function negated(norm: string, idx: number, keyword: string): boolean {
  const before = norm.slice(0, idx);
  if (hasCJK(keyword)) {
    const tail = before.replace(/\s+$/, '');
    return NEGATIONS_ZH.some((n) => tail.endsWith(n));
  }
  const words = before.trim().split(' ');
  const last = ` ${words[words.length - 1] ?? ''} `;
  const lastTwo = ` ${words.slice(-2).join(' ')} `;
  return NEGATIONS_EN.some((n) => n === last || n === lastTwo);
}

/** Length of the longest non-negated keyword found (0 = none). */
function matches(norm: string, keywords: string[]): number {
  let best = 0;
  for (const k of keywords) {
    const idx = findPhrase(norm, k);
    if (idx >= 0 && !negated(norm, idx, k)) best = Math.max(best, k.length);
  }
  return best;
}

function isMultiStep(norm: string): boolean {
  return MULTI_EN.some((m) => norm.includes(m)) || MULTI_ZH.some((m) => norm.includes(m));
}

export function interpretAction(s: RunState, c: Content, text: string): ActionReading {
  const n = parseNumber(text);
  const visible = visibleActions(s, c);
  if (n !== null) return n >= 1 && n <= visible.length ? { kind: 'action', id: visible[n - 1].id } : { kind: 'none' };

  const norm = normalize(text);
  const hits: { a: Action; score: number }[] = [];
  for (const a of eligibleActions(s, c)) {
    const score = matches(norm, a.keywords);
    if (score > 0) hits.push({ a, score });
  }
  if (hits.length === 1) {
    if (isMultiStep(norm)) return { kind: 'multi' };
    return { kind: 'action', id: hits[0].a.id };
  }
  if (hits.length > 1) {
    // A hidden action the player explicitly reached for beats the generic ones it overlaps.
    const hidden = hits.filter((h) => h.a.hidden);
    if (hidden.length === 1 && !isMultiStep(norm)) return { kind: 'action', id: hidden[0].a.id };
    hits.sort((x, y) => y.score - x.score);
    return { kind: 'ambiguous', ids: hits.slice(0, 2).map((h) => h.a.id) };
  }
  if (isMultiStep(norm)) return { kind: 'multi' };
  return { kind: 'none' };
}

export type ConfirmReading = 'yes' | 'no' | 'other';

const YES = ['yes', 'y', 'yeah', 'yep', 'yup', 'lock', 'lock it in', 'confirm', 'ok', 'okay', 'sure', 'correct', 'right', 'go', 'do it', 'perfect', 'good',
  '是', '是的', '对', '对的', '没错', '好', '好的', '行', '可以', '确认', '锁定', '嗯', '就它', '就是它'];
const NO = ['no', 'nope', 'nah', 'retake', 'redo', 'again', 'wrong', 'try again', 'another',
  '不是', '不对', '错了', '不要', '重拍', '重来', '换一个', '再拍', '再来'];

/** Rough size of what's left after removing matched keywords: Latin words + Chinese characters. */
function leftover(norm: string, keywords: string[]): { words: number; cjk: number } {
  let rest = norm;
  for (const k of [...keywords].sort((a, b) => b.length - a.length)) {
    const p = normalize(k).trim();
    if (p && findPhrase(rest, k) >= 0) rest = rest.split(p).join(' ');
  }
  const cjk = (rest.match(/[㐀-鿿]/g) ?? []).length;
  const words = rest.replace(/[㐀-鿿]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return { words, cjk };
}

export function interpretConfirm(text: string): ConfirmReading {
  const n = parseNumber(text);
  if (n === 1) return 'yes';
  if (n === 2) return 'no';
  const norm = normalize(text);
  const y = matches(norm, YES) > 0;
  const x = matches(norm, NO) > 0;
  if (y && !x) return 'yes';
  if (x && !y) {
    // "no it's actually a water bottle" / "不是，是水瓶" is a correction, not a plain retake.
    const rest = leftover(norm, NO);
    return rest.words <= 3 && rest.cjk <= 2 ? 'no' : 'other';
  }
  return 'other';
}

export function interpretScanChoice(text: string): 'retry' | 'standard' | 'other' {
  const n = parseNumber(text);
  if (n === 1) return 'retry';
  if (n === 2) return 'standard';
  const norm = normalize(text);
  if (matches(norm, ['standard', 'supplies', 'skip', '标准', '物资', '跳过']) > 0) return 'standard';
  if (matches(norm, ['retry', 'try again', 'again', 'retake', '重试', '再试', '重拍', '再拍']) > 0) return 'retry';
  return 'other';
}

/** Returns 0-based index into s.offer, or null. */
export function interpretPick(s: RunState, c: Content, text: string): number | null {
  const offer = s.offer ?? [];
  const n = parseNumber(text);
  if (n !== null) return n >= 1 && n <= offer.length ? n - 1 : null;
  const norm = normalize(text);
  const hits = offer
    .map((id, i) => ({ i, score: matches(norm, [...upgradeById(c, id).keywords, upgradeById(c, id).name]) }))
    .filter((h) => h.score > 0);
  return hits.length === 1 ? hits[0].i : null;
}

export function isAgain(text: string): boolean {
  const norm = normalize(text);
  return matches(norm, ['again', 'restart', 'new game', 'play again', 'new run', 'retry', 'one more', '再来一局', '再来', '重新开始', '再玩', '重玩']) > 0;
}

/** Keyword classification of a typed item description ("my grandma's scarf", "一罐可乐"). */
export function classifyByKeyword(c: Content, text: string): { mod: Mod; keyword: string } | null {
  const norm = normalize(text);
  let best: { mod: Mod; keyword: string } | null = null;
  for (const mod of c.mods) {
    for (const k of mod.keywords) {
      if (findPhrase(norm, k) >= 0 && (!best || k.length > best.keyword.length)) best = { mod, keyword: k };
    }
  }
  return best;
}
