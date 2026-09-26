// Big-screen view: everyone's rocket on one Earth→Moon route, a live feed and a landing leaderboard.
// Always English (judges and audience); a player's own item word is kept as they wrote it.
// No photos here, by design: the big screen shows names and gear only.
import type { Content, Outbound, RunState } from '../engine/types.ts';
import type { RunRecord, Store } from '../store/store.ts';

export interface FeedItem {
  at: number;
  icon: string;
  text: string;
}

const FEED_CAP = 40;
const ACTIVE_MS = 45 * 60_000;
/** Finished runs leave the route after a while so a busy room stays readable (the leaderboard keeps them). */
const ENDED_MS = 5 * 60_000;

function modName(en: Content, id: string): string {
  return en.mods.find((m) => m.id === id)?.name ?? id;
}

/** Notable moments in this batch of outbound messages, phrased for the room. */
export function feedFor(en: Content, nickname: string, s: RunState, out: Outbound[], started: boolean): FeedItem[] {
  const at = Date.now();
  const items: FeedItem[] = [];
  if (started) items.push({ at, icon: '🚨', text: `${nickname} is racing to the launch pad` });
  for (const o of out) {
    if (o.t === 'gear_card' && o.card.kind === 'item' && s.item) {
      const m = en.mods.find((x) => x.id === s.item!.modId);
      items.push({ at, icon: m?.icon ?? '📦', text: `${nickname} boarded with ${s.item.label} → ${modName(en, s.item.modId)}` });
    } else if (o.t === 'fx' && o.fx === 'combo') {
      const k = en.combos.find((x) => x.id === s.combos[s.combos.length - 1]);
      items.push({ at, icon: '⚡', text: `${nickname} built a combo: ${k?.icon ?? ''} ${k?.name ?? o.text}` });
    } else if (o.t === 'fx' && o.fx === 'legendary') {
      const u = en.upgrades.find((x) => x.id === s.upgrades[s.upgrades.length - 1]);
      items.push({ at, icon: '✨', text: `${nickname} found a legendary ${u?.name ?? 'upgrade'}` });
    } else if (o.t === 'fx' && o.fx === 'shield') {
      items.push({ at, icon: '🛡️', text: `${nickname} cheated death` });
    } else if (o.t === 'report') {
      const r = o.report;
      const kept = r.item?.status === 'kept' ? `, ${s.item?.label} still aboard` : '';
      if (r.kind === 'success') items.push({ at, icon: '🌕', text: `${nickname} landed on the Moon! ${r.score} pts${kept}` });
      else if (r.kind === 'rescue') items.push({ at, icon: '🛰️', text: `${nickname} is adrift, waiting for rescue` });
      else items.push({ at, icon: '💥', text: `${nickname} was lost on the way` });
    }
  }
  return items;
}

export class ScreenFeed {
  private items: FeedItem[] = [];

  clear(): void {
    this.items = [];
  }

  push(list: FeedItem[]): void {
    this.items.push(...list);
    if (this.items.length > FEED_CAP) this.items.splice(0, this.items.length - FEED_CAP);
  }

  recent(): FeedItem[] {
    return [...this.items].reverse();
  }
}

export interface ScreenPlayer {
  id: string;
  nickname: string;
  stage: number;
  phase: RunState['phase'];
  ending: RunState['ending'];
  icon: string;
  combos: number;
  joinedAt: number;
}

export interface ScreenFilter {
  /** Only runs touched after this time (the host's "clear big screen"). */
  since: number;
  /** Web-simulator runs are test runs; hidden unless asked for. */
  includeSim: boolean;
}

/** Current runs updated recently, one per player, plus the best landing per player. */
export function screenState(store: Store, en: Content, nick: (r: RunRecord) => string, filter: ScreenFilter) {
  const now = Date.now();
  const players: ScreenPlayer[] = [];
  const best = new Map<string, { nickname: string; score: number; icon: string; kept: boolean; at: number }>();
  for (const r of store.allRuns()) {
    const s = r.state;
    if (s.updatedAt < filter.since || (r.channel === 'sim' && !filter.includeSim)) continue;
    const icon = s.item ? (en.mods.find((m) => m.id === s.item!.modId)?.icon ?? '📦') : '🧑‍🚀';
    if (s.ending?.kind === 'success') {
      const prev = best.get(r.address);
      if (!prev || s.ending.score > prev.score) best.set(r.address, { nickname: nick(r), score: s.ending.score, icon, kept: s.item?.status === 'kept', at: s.updatedAt });
    }
    const current = store.getPlayer(r.address)?.currentRunId === s.runId;
    if (!current || s.phase === 'new' || now - s.updatedAt > (s.phase === 'ended' ? ENDED_MS : ACTIVE_MS)) continue;
    players.push({ id: r.address.slice(-8) + s.runId.slice(0, 4), nickname: nick(r), stage: s.stage, phase: s.phase, ending: s.ending, icon, combos: s.combos.length, joinedAt: s.createdAt });
  }
  players.sort((a, b) => a.joinedAt - b.joinedAt);
  const leaderboard = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  const counts = {
    flying: players.filter((p) => p.phase !== 'ended').length,
    landed: players.filter((p) => p.ending?.kind === 'success').length,
    lost: players.filter((p) => p.ending && p.ending.kind !== 'success').length,
  };
  return { players, leaderboard, counts };
}
