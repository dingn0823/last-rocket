// Steps 1–2 of input understanding: number → keyword. Pure; no AI here.
import type { Action, Content, Mod, RunState } from './types.ts';
import { eligibleActions, upgradeById, visibleActions } from './rules.ts';
import { findPhrase, normalize } from './text.ts';

export type ActionReading =
  | { kind: 'action'; id: string }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'multi' }
  | { kind: 'none' };

const NEGATIONS = [' not ', " don't ", ' dont ', ' do not ', ' never ', ' no ', ' without ', " won't ", ' stop '];
const MULTI_STEP = [' then ', ' after that ', ' afterwards ', ' if ', ' unless ', ' and also ', ' otherwise '];

function parseNumber(text: string): number | null {
  const m = text.trim().match(/^#?\s*(\d{1,2})\s*[.)!]?$/);
  if (m) return Number(m[1]);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, first: 1, second: 2, third: 3 };
  const w = normalize(text).trim();
  return w in words ? words[w] : null;
}

/** True if the word right before the phrase at `idx` is a negation ("don't swerve", "do not swerve"). */
function negated(norm: string, idx: number): boolean {
  const words = norm.slice(0, idx).trim().split(' ');
  const last = ` ${words[words.length - 1] ?? ''} `;
  const lastTwo = ` ${words.slice(-2).join(' ')} `;
  return NEGATIONS.some((n) => n === last || n === lastTwo);
}

function matches(norm: string, keywords: string[]): number {
  let best = 0;
  for (const k of keywords) {
    const idx = findPhrase(norm, k);
    if (idx >= 0 && !negated(norm, idx)) best = Math.max(best, k.length);
  }
  return best;
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
    if (MULTI_STEP.some((m) => norm.includes(m))) return { kind: 'multi' };
    return { kind: 'action', id: hits[0].a.id };
  }
  if (hits.length > 1) {
    // A hidden action the player explicitly reached for beats the generic ones it overlaps.
    const hidden = hits.filter((h) => h.a.hidden);
    if (hidden.length === 1 && !MULTI_STEP.some((m) => norm.includes(m))) return { kind: 'action', id: hidden[0].a.id };
    hits.sort((x, y) => y.score - x.score);
    return { kind: 'ambiguous', ids: hits.slice(0, 2).map((h) => h.a.id) };
  }
  if (MULTI_STEP.some((m) => norm.includes(m))) return { kind: 'multi' };
  return { kind: 'none' };
}

export type ConfirmReading = 'yes' | 'no' | 'other';

export function interpretConfirm(text: string): ConfirmReading {
  const n = parseNumber(text);
  if (n === 1) return 'yes';
  if (n === 2) return 'no';
  const norm = normalize(text);
  const yes = ['yes', 'y', 'yeah', 'yep', 'yup', 'lock', 'lock it in', 'confirm', 'ok', 'okay', 'sure', 'correct', 'right', 'go', 'do it', 'perfect', 'good'];
  const no = ['no', 'nope', 'nah', 'retake', 'redo', 'again', 'wrong', 'try again', 'another'];
  const y = yes.some((k) => findPhrase(norm, k) >= 0);
  const x = no.some((k) => findPhrase(norm, k) >= 0);
  if (y && !x) return 'yes';
  if (x && !y && norm.trim().split(' ').length <= 4) return 'no';
  return 'other';
}

export function interpretScanChoice(text: string): 'retry' | 'standard' | 'other' {
  const n = parseNumber(text);
  if (n === 1) return 'retry';
  if (n === 2) return 'standard';
  const norm = normalize(text);
  if (['standard', 'supplies', 'skip'].some((k) => findPhrase(norm, k) >= 0)) return 'standard';
  if (['retry', 'try again', 'again', 'retake'].some((k) => findPhrase(norm, k) >= 0)) return 'retry';
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
  return ['again', 'restart', 'new game', 'play again', 'new run', 'retry', 'one more'].some((k) => findPhrase(norm, k) >= 0);
}

/** Keyword classification of a typed item description ("my grandma's scarf"). */
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
