import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Content } from './types.ts';

function readJson(dir: string, file: string): any {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

export function loadContent(dir: string): Content {
  const mods = readJson(dir, 'mods.json');
  const upgrades = readJson(dir, 'upgrades.json');
  const combos = readJson(dir, 'combos.json');
  const stages = readJson(dir, 'stages.json');
  const endings = readJson(dir, 'endings.json');
  const copy = readJson(dir, 'copy.json');
  const content: Content = {
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
  for (const s of c.stages) {
    if (s.pool.length === 0) errors.push(`stage ${s.n}: empty pool`);
    for (const e of s.pool) {
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
