export type Lang = 'en' | 'zh';
export const LANGS: Lang[] = ['en', 'zh'];

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

const CJK = /[㐀-鿿]/;

export function hasCJK(s: string): boolean {
  return CJK.test(s);
}

/** Language of a player's message: any Chinese character means Chinese. */
export function detectLang(text: string | undefined): Lang {
  return text && hasCJK(text) ? 'zh' : 'en';
}

/** English-only: plural-looking labels ("keys", "standard supplies"). */
export function isPluralLabel(label: string): boolean {
  const last = label.trim().toLowerCase().split(/\s+/).pop() ?? '';
  return /s$/.test(last) && !/(ss|us|is|ous)$/.test(last);
}

export function withArticle(label: string, lang: Lang = 'en'): string {
  const l = label.trim();
  if (lang === 'zh' || /^(a|an|the|my|your|some)\s/i.test(l) || isPluralLabel(l)) return l;
  return (/^[aeiou]/i.test(l) ? 'an ' : 'a ') + l;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface ListWords {
  listSep: string;
  or2: string;
  orLast: string;
}

/** "a or b" / "a, b, or c" (EN) · "甲或者乙" / "甲、乙，或者丙" (ZH) */
export function joinOr(items: string[], w: ListWords): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]}${w.or2}${items[1]}`;
  return `${items.slice(0, -1).join(w.listSep)}${w.orLast}${items[items.length - 1]}`;
}

export function normalize(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'₂\s㐀-鿿-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${s} `;
}

const WORDCHAR = /[a-z0-9']/;

/**
 * Find a keyword in normalized text. Latin keywords must sit on word boundaries
 * ("key" does not match "keyboard"); Chinese keywords match as substrings.
 * Returns the index of the match or -1.
 */
export function findPhrase(norm: string, phrase: string): number {
  const p = normalize(phrase).trim();
  if (!p) return -1;
  if (hasCJK(p)) return norm.indexOf(p);
  let from = 0;
  while (true) {
    const i = norm.indexOf(p, from);
    if (i < 0) return -1;
    const before = norm[i - 1] ?? ' ';
    const after = norm[i + p.length] ?? ' ';
    if (!WORDCHAR.test(before) && !WORDCHAR.test(after)) return i;
    from = i + 1;
  }
}
