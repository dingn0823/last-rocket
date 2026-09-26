// Numbers live here. AI never touches any of this.
import type { Action, Content, Deltas, Effect, GameEvent, Mod, Resource, RunState, Upgrade } from './types.ts';
import { RESOURCES } from './types.ts';

export interface Gear {
  /** "item" | "upgrade:<id>" | "combo:<id>" */
  key: string;
  name: string;
  icon: string;
  tags: string[];
  effects: Effect[];
}

export const MAX_REDUCTION = 60;

export function modById(c: Content, id: string): Mod {
  const m = c.mods.find((x) => x.id === id);
  if (!m) throw new Error(`unknown mod ${id}`);
  return m;
}

export function upgradeById(c: Content, id: string): Upgrade {
  const u = c.upgrades.find((x) => x.id === id);
  if (!u) throw new Error(`unknown upgrade ${id}`);
  return u;
}

/** Gear that is currently active. A consumed item no longer counts. */
export function activeGear(s: RunState, c: Content): Gear[] {
  const gear: Gear[] = [];
  if (s.item && s.item.status === 'kept') {
    const m = modById(c, s.item.modId);
    gear.push({ key: 'item', name: m.name, icon: m.icon, tags: m.tags, effects: m.effects });
  }
  for (const id of s.upgrades) {
    const u = upgradeById(c, id);
    gear.push({ key: `upgrade:${id}`, name: u.name, icon: u.icon, tags: u.tags, effects: u.effects });
  }
  for (const id of s.combos) {
    const k = c.combos.find((x) => x.id === id)!;
    gear.push({ key: `combo:${id}`, name: k.name, icon: k.icon, tags: [], effects: k.effects });
  }
  return gear;
}

export function tagSet(s: RunState, c: Content, extraUpgrade?: string): Set<string> {
  const tags = new Set(activeGear(s, c).flatMap((g) => g.tags));
  if (extraUpgrade) upgradeById(c, extraUpgrade).tags.forEach((t) => tags.add(t));
  return tags;
}

/** Requirement entries: "tag:x", "upgrade:x", "a|b" (either). All entries must hold. */
export function meets(requires: string[] | undefined, s: RunState, c: Content, extraUpgrade?: string): boolean {
  if (!requires || requires.length === 0) return true;
  const tags = tagSet(s, c, extraUpgrade);
  const owned = new Set(extraUpgrade ? [...s.upgrades, extraUpgrade] : s.upgrades);
  return requires.every((entry) =>
    entry.split('|').some((term) => {
      const [kind, id] = term.split(':');
      return kind === 'tag' ? tags.has(id) : kind === 'upgrade' ? owned.has(id) : false;
    }),
  );
}

export function reductionPct(s: RunState, c: Content, r: Resource): number {
  let pct = 0;
  for (const g of activeGear(s, c)) for (const e of g.effects) if (e.type === 'reduce' && e.resource === r) pct += e.pct;
  return Math.min(pct, MAX_REDUCTION);
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max, v));
}

/** Apply deltas. Costs (negative) are softened by reduce effects; gains are not. Returns what actually changed. */
export function applyDeltas(s: RunState, c: Content, d: Deltas | undefined): Deltas {
  const applied: Deltas = {};
  if (!d) return applied;
  for (const r of RESOURCES) {
    const raw = d[r];
    if (!raw) continue;
    const amount = raw < 0 ? Math.round(raw * (1 - reductionPct(s, c, r) / 100)) : raw;
    const before = s.res[r];
    s.res[r] = clamp(before + amount, c.max);
    applied[r] = s.res[r] - before;
  }
  return applied;
}

/** One-shot effects fire when gear is gained. Passive ones (reduce, shield) are read on demand. */
export function applyInstantEffects(s: RunState, c: Content, effects: Effect[]): void {
  for (const e of effects) {
    if (e.type === 'refill') applyDeltas(s, c, { [e.resource]: e.amount });
    if (e.type === 'swap') {
      const paid = Math.min(e.cost, s.res[e.from]);
      s.res[e.from] -= paid;
      s.res[e.to] = clamp(s.res[e.to] + Math.round((e.gain * paid) / e.cost), c.max);
    }
  }
}

/** If hull or oxygen hit 0, burn the first unused shield. Returns the saves made. */
export function useShields(s: RunState, c: Content): { gear: Gear; resource: Resource; amount: number }[] {
  const saves: { gear: Gear; resource: Resource; amount: number }[] = [];
  for (const r of ['hull', 'oxygen'] as Resource[]) {
    if (s.res[r] > 0) continue;
    for (const g of activeGear(s, c)) {
      if (s.shieldsUsed.includes(g.key)) continue;
      const shield = g.effects.find((e) => e.type === 'shield');
      if (!shield || shield.type !== 'shield') continue;
      s.shieldsUsed.push(g.key);
      s.res[r] = clamp(shield.restore, c.max);
      saves.push({ gear: g, resource: r, amount: s.res[r] });
      break;
    }
  }
  return saves;
}

export function deadCause(s: RunState): Resource | null {
  if (s.res.hull <= 0) return 'hull';
  if (s.res.oxygen <= 0) return 'oxygen';
  if (s.res.fuel <= 0) return 'fuel';
  return null;
}

export function currentEvent(s: RunState, c: Content): GameEvent | null {
  if (!s.eventId) return null;
  const stage = c.stages.find((x) => x.n === s.stage);
  return stage?.pool.find((e) => e.id === s.eventId) ?? null;
}

export function eligibleActions(s: RunState, c: Content): Action[] {
  const e = currentEvent(s, c);
  return e ? e.actions.filter((a) => meets(a.requires, s, c)) : [];
}

export function visibleActions(s: RunState, c: Content): Action[] {
  return eligibleActions(s, c).filter((a) => !a.hidden);
}

/** Combos that would newly activate if `extraUpgrade` were owned. */
export function combosCompletedBy(s: RunState, c: Content, extraUpgrade?: string): string[] {
  return c.combos
    .filter((k) => !s.combos.includes(k.id))
    .filter((k) => meets(k.requires, s, c, extraUpgrade))
    .map((k) => k.id);
}

export function computeScore(s: RunState, c: Content, kind: 'success' | 'rescue' | 'failure'): number {
  const sc = c.endings.score;
  const resources = kind === 'failure' ? 0 : s.res.fuel + s.res.oxygen + s.res.hull;
  return sc[kind] + resources + sc.perCombo * s.combos.length + (s.item?.status === 'kept' ? sc.itemKept : 0);
}
