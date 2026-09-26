import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Content } from './types.ts';
import type { Lang } from './text.ts';

function readJson(dir: string, file: string): any {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

/** English content: the primary version. All numbers live here. */
export function loadBaseContent(dir: string): Content {
  const mods = readJson(dir, 'mods.json');
  const upgrades = readJson(dir, 'upgrades.json');
  const combos = readJson(dir, 'combos.json');
  const stages = readJson(dir, 'stages.json');
  const endings = readJson(dir, 'endings.json');
  const copy = readJson(dir, 'copy.json');
  const content: Content = {
    lang: 'en',
    categories: mods.categories,
    mods: mods.mods,
    upgrades: upgrades.upgrades,
    picks: upgrades.picks,
    combos: combos.combos,
    start: stages.start,
    max: stages.max,
    lifeSupportPerStage: stages.lifeSupportPerStage,
    interludeChance: stages.interludeChance,
    stages: stages.stages,
    interludes: stages.interludes,
    endings,
    copy,
  };
  validateContent(content);
  return content;
}

export function loadContent(dir: string, lang: Lang = 'en'): Content {
  const base = loadBaseContent(dir);
  if (lang === 'en') return base;
  const file = `${lang}.json`;
  if (!existsSync(join(dir, file))) throw new Error(`missing content/${file}`);
  return applyOverlay(base, readJson(dir, file), lang);
}

export function loadAllContent(dir: string): Record<Lang, Content> {
  return { en: loadContent(dir, 'en'), zh: loadContent(dir, 'zh') };
}

/**
 * Build a translated Content: same ids and numbers as the base, text from the overlay.
 * Keywords are merged (translated + English) so players can mix languages.
 * Throws if any translatable string is missing, so gaps show up at boot, not mid-game.
 */
export function applyOverlay(base: Content, o: any, lang: Lang): Content {
  const c: Content = structuredClone(base);
  c.lang = lang;
  const missing: string[] = [];
  const need = (v: unknown, where: string): any => {
    if (v === undefined || v === null) missing.push(where);
    return v;
  };
  const kw = (extra: unknown, own: string[]) => [...(Array.isArray(extra) ? extra : []), ...own];

  for (const key of Object.keys(base.categories)) c.categories[key] = need(o.categories?.[key], `categories.${key}`);
  for (const key of Object.keys(base.copy)) (c.copy as any)[key] = need(o.copy?.[key], `copy.${key}`);
  for (const key of Object.keys(o.copy ?? {})) if (!(key in base.copy)) missing.push(`copy.${key} (not in English copy.json)`);

  for (const m of c.mods) {
    const t = o.mods?.[m.id] ?? {};
    m.name = need(t.name, `mods.${m.id}.name`);
    m.effectText = need(t.effectText, `mods.${m.id}.effectText`);
    m.blurb = need(t.blurb, `mods.${m.id}.blurb`);
    m.keywords = kw(t.keywords, m.keywords);
  }
  for (const u of c.upgrades) {
    const t = o.upgrades?.[u.id] ?? {};
    u.name = need(t.name, `upgrades.${u.id}.name`);
    u.effectText = need(t.effectText, `upgrades.${u.id}.effectText`);
    u.keywords = kw(t.keywords, u.keywords);
  }
  c.picks.forEach((p, i) => (p.intro = need(o.picks?.[i]?.intro, `picks.${i}.intro`)));
  for (const k of c.combos) {
    const t = o.combos?.[k.id] ?? {};
    k.name = need(t.name, `combos.${k.id}.name`);
    k.text = need(t.text, `combos.${k.id}.text`);
  }
  for (const s of c.stages) {
    const t = o.stages?.[String(s.n)] ?? {};
    s.name = need(t.name, `stages.${s.n}.name`);
    if (s.opening !== undefined) s.opening = need(t.opening, `stages.${s.n}.opening`);
    for (const e of s.pool) {
      const te = o.events?.[e.id] ?? {};
      e.title = need(te.title, `events.${e.id}.title`);
      e.intro = need(te.intro, `events.${e.id}.intro`);
      for (const a of e.actions) {
        const ta = te.actions?.[a.id] ?? {};
        const w = `events.${e.id}.actions.${a.id}`;
        a.label = need(ta.label, `${w}.label`);
        a.hint = need(ta.hint, `${w}.hint`);
        a.keywords = kw(ta.keywords, a.keywords);
        if (a.outcome) a.outcome.text = need(ta.text, `${w}.text`);
        if (a.chance) {
          a.chance.success.text = need(ta.success, `${w}.success`);
          a.chance.fail.text = need(ta.fail, `${w}.fail`);
        }
      }
    }
  }
  for (const i of c.interludes) {
    const t = o.interludes?.[i.id] ?? {};
    i.text = need(t.text, `interludes.${i.id}.text`);
    if (i.guard) i.guard.text = need(t.guardText, `interludes.${i.id}.guardText`);
  }
  for (const kind of ['success', 'rescue', 'failure'] as const) {
    const t = o.endings?.[kind] ?? {};
    const e = c.endings[kind];
    e.title = need(t.title, `endings.${kind}.title`);
    e.lines = need(t.lines, `endings.${kind}.lines`);
    e.kept = need(t.kept, `endings.${kind}.kept`);
    e.consumed = need(t.consumed, `endings.${kind}.consumed`);
  }
  for (const r of ['fuel', 'oxygen', 'hull'] as const) c.endings.causes[r] = need(o.endings?.causes?.[r], `endings.causes.${r}`);

  if (missing.length) throw new Error(`content/${lang}.json is missing translations:\n  ${missing.join('\n  ')}`);
  return c;
}

/** Fail fast at boot if content references something that doesn't exist. */
export function validateContent(c: Content): void {
  const errors: string[] = [];
  const upgradeIds = new Set(c.upgrades.map((u) => u.id));
  const tags = new Set<string>([...c.mods.flatMap((m) => m.tags), ...c.upgrades.flatMap((u) => u.tags)]);
  const checkReq = (req: string, where: string) => {
    for (const term of req.split('|')) {
      const [kind, id] = term.split(':');
      if (kind === 'upgrade' && !upgradeIds.has(id)) errors.push(`${where}: unknown upgrade ${id}`);
      else if (kind === 'tag' && !tags.has(id)) errors.push(`${where}: no gear has tag ${id}`);
      else if (kind !== 'upgrade' && kind !== 'tag') errors.push(`${where}: bad requirement ${term}`);
    }
  };
  if (!c.mods.some((m) => m.id === 'standard_supplies')) errors.push('mods: standard_supplies is required');
  for (const m of c.mods) if (!(m.category in c.categories)) errors.push(`mod ${m.id}: unknown category`);
  for (const combo of c.combos) combo.requires.forEach((r) => checkReq(r, `combo ${combo.id}`));
  if (c.picks.length !== 3) errors.push('upgrades.picks must have 3 entries');
  const stageNs = c.stages.map((s) => s.n).join(',');
  if (stageNs !== '1,2,3,4,5') errors.push(`stages must be 1..5, got ${stageNs}`);
  const eventIds = new Set<string>();
  for (const s of c.stages) {
    if (s.pool.length === 0) errors.push(`stage ${s.n}: empty pool`);
    for (const e of s.pool) {
      if (eventIds.has(e.id)) errors.push(`duplicate event id ${e.id}`);
      eventIds.add(e.id);
      const ids = new Set<string>();
      if (e.actions.filter((a) => !a.hidden && !a.requires).length < 2) errors.push(`event ${e.id}: needs 2+ always-available actions`);
      for (const a of e.actions) {
        if (ids.has(a.id)) errors.push(`event ${e.id}: duplicate action ${a.id}`);
        ids.add(a.id);
        if (!a.outcome === !a.chance) errors.push(`action ${e.id}.${a.id}: needs exactly one of outcome/chance`);
        a.requires?.forEach((r) => checkReq(r, `action ${e.id}.${a.id}`));
      }
    }
  }
  for (const i of c.interludes) i.guard?.requires.forEach((r) => checkReq(r, `interlude ${i.id}`));
  if (errors.length) throw new Error(`Invalid content:\n  ${errors.join('\n  ')}`);
}
