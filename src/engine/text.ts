export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

export function withArticle(label: string): string {
  const l = label.trim();
  if (/^(a|an|the|my|your|some)\s/i.test(l)) return l;
  return (/^[aeiou]/i.test(l) ? 'an ' : 'a ') + l;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "a, b or c" */
export function joinOr(items: string[], or = 'or'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${or} ${items[items.length - 1]}`;
}

export function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'₂\s-]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** Whole-word / whole-phrase match. `norm` must come from normalize(). Returns match index or -1. */
export function findPhrase(norm: string, phrase: string): number {
  const p = normalize(phrase);
  if (p.trim() === '') return -1;
  return norm.indexOf(p);
}
