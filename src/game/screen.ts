// Big-screen view: everyone's rocket on one Earth→Moon route, a live feed and a landing leaderboard.
// Always English (judges and audience); a player's own item word is kept as they wrote it.
// No photos here, by design: the big screen shows names and gear only.
import type { Content, Outbound, RunState } from '../engine/types.ts';
import type { RunRecord, Store } from '../store/store.ts';

export type FeedKind = 'board' | 'item' | 'combo' | 'legendary' | 'shield' | 'landed' | 'rescue' | 'lost';

export interface FeedItem {
  at: number;
  icon: string;
  text: string;
  kind: FeedKind;
  /** Which rocket on the screen this is about (for the burst effect). */
  pid: string;
}

const FEED_CAP = 40;
const ACTIVE_MS = 45 * 60_000;
/** Finished runs leave the route after a while so a busy room stays readable (the leaderboard keeps them). */
const ENDED_MS = 5 * 60_000;

/** Stable id for a run on the big screen; never contains the phone number. */
export function screenId(r: RunRecord): string {
  return r.state.runId.slice(0, 12);
}

function modName(en: Content, id: string): string {
  return en.mods.find((m) => m.id === id)?.name ?? id;
}

/** Notable moments in this batch of outbound messages, phrased for the room. */
export function feedFor(en: Content, nickname: string, rec: RunRecord, out: Outbound[], started: boolean): FeedItem[] {
  const s = rec.state;
  const pid = screenId(rec);
  const at = Date.now();
  const items: FeedItem[] = [];
  const add = (kind: FeedKind, icon: string, text: string) => items.push({ at, icon, text, kind, pid });
  if (started) add('board', '🚨', `${nickname} is racing to the launch pad`);
  for (const o of out) {
    if (o.t === 'gear_card' && o.card.kind === 'item' && s.item) {
      const m = en.mods.find((x) => x.id === s.item!.modId);
      add('item', m?.icon ?? '📦', `${nickname} boarded with ${s.item.label} → ${modName(en, s.item.modId)}`);
    } else if (o.t === 'fx' && o.fx === 'combo') {
      const k = en.combos.find((x) => x.id === s.combos[s.combos.length - 1]);
      add('combo', '⚡', `${nickname} built a combo: ${k?.icon ?? ''} ${k?.name ?? o.text}`);
    } else if (o.t === 'fx' && o.fx === 'legendary') {
      const u = en.upgrades.find((x) => x.id === s.upgrades[s.upgrades.length - 1]);
      add('legendary', '✨', `${nickname} found a legendary ${u?.name ?? 'upgrade'}`);
    } else if (o.t === 'fx' && o.fx === 'shield') {
      add('shield', '🛡️', `${nickname} cheated death`);
    } else if (o.t === 'report') {
      const r = o.report;
      const kept = r.item?.status === 'kept' ? `, ${s.item?.label} still aboard` : '';
      if (r.kind === 'success') add('landed', '🌕', `${nickname} landed on the Moon! ${r.score} pts${kept}`);
      else if (r.kind === 'rescue') add('rescue', '🛰️', `${nickname} is adrift, waiting for rescue`);
      else add('lost', '💥', `${nickname} was lost on the way`);
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

  recent(since = 0): FeedItem[] {
    return this.items.filter((f) => f.at >= since).reverse();
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
  /** On the launch list, waiting for liftoff. */
  boarding: boolean;
}

export interface ScreenFilter {
  /** Only runs touched after this time (the current round, or the host's "clear big screen"). */
  since: number;
  /** Landings after this moment don't count for the board (the round's final bell). */
  until?: number;
  /** Web-simulator runs are test runs; hidden unless asked for. */
  includeSim: boolean;
  /** Current round number: runs that boarded this round count even if created during the last ceremony. */
  round?: number;
}

export interface BoardEntry {
  nickname: string;
  score: number;
  icon: string;
  item: string;
  kept: boolean;
  at: number;
}

/** Current runs updated recently, one per player, plus the best landing per player. */
export function screenState(store: Store, en: Content, nick: (r: RunRecord) => string, filter: ScreenFilter) {
  const now = Date.now();
  const players: ScreenPlayer[] = [];
  const best = new Map<string, BoardEntry>();
  for (const r of store.allRuns()) {
    const s = r.state;
    // Boarded during the last ceremony: last touched before this round opened, but on its launch list.
    const heldHere = filter.round !== undefined && r.heldRound === filter.round;
    if ((s.updatedAt < filter.since && !heldHere) || (r.channel === 'sim' && !filter.includeSim)) continue;
    const icon = s.item ? (en.mods.find((m) => m.id === s.item!.modId)?.icon ?? '📦') : '🧑‍🚀';
    const member = s.createdAt >= filter.since || heldHere;
    const counts = member && (!filter.until || s.updatedAt <= filter.until + 3000);
    if (s.ending?.kind === 'success' && counts) {
      const prev = best.get(r.address);
      if (!prev || s.ending.score > prev.score) {
        best.set(r.address, { nickname: nick(r), score: s.ending.score, icon, item: s.item?.label ?? '', kept: s.item?.status === 'kept', at: s.updatedAt });
      }
    }
    const current = store.getPlayer(r.address)?.currentRunId === s.runId;
    const held = s.phase === 'new' && r.heldRound !== undefined;
    if (!current || (s.phase === 'new' && !held) || now - s.updatedAt > (s.phase === 'ended' ? ENDED_MS : ACTIVE_MS)) continue;
    players.push({ id: screenId(r), nickname: nick(r), stage: s.stage, phase: s.phase, ending: s.ending, icon, combos: s.combos.length, joinedAt: s.createdAt, boarding: held });
  }
  players.sort((a, b) => a.joinedAt - b.joinedAt);
  const leaderboard = [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 8);
  const counts = {
    boarding: players.filter((p) => p.boarding).length,
    flying: players.filter((p) => !p.boarding && p.phase !== 'ended').length,
    landed: players.filter((p) => p.ending?.kind === 'success').length,
    lost: players.filter((p) => p.ending && p.ending.kind !== 'success').length,
  };
  return { players, leaderboard, counts };
}
