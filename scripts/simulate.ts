// Balance check: play many runs with scripted policies straight against the engine.
//   node scripts/simulate.ts [runs]
import { join } from 'node:path';
import { loadContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import { nextRandom } from '../src/engine/rng.ts';
import { combosCompletedBy, eligibleActions, reductionPct, upgradeById, visibleActions } from '../src/engine/rules.ts';
import type { Action, Content, Deltas, EngineInput, Resource, RunState } from '../src/engine/types.ts';

const content = loadContent(join(import.meta.dirname, '..', 'content'));

export type Policy = 'random' | 'smart' | 'thoughtful';

const RES: Resource[] = ['fuel', 'oxygen', 'hull'];

/** How much a player who watches the gauges would dislike this change: scarce resources weigh more. */
function pain(s: RunState, c: Content, d: Deltas | undefined): number {
  let p = 0;
  for (const r of RES) {
    const v = d?.[r] ?? 0;
    const eff = v < 0 ? v * c.costScale * (1 - reductionPct(s, c, r) / 100) : v;
    p -= eff * (60 / (s.res[r] + 15));
  }
  return p;
}

function expectedPain(s: RunState, c: Content, a: Action): number {
  if (a.outcome) return pain(s, c, a.outcome.delta) + (a.outcome.item === 'consumed' ? 12 : 0);
  const ch = a.chance!;
  // Risk-averse: a bad roll hurts a bit more than its probability says.
  return ch.p * pain(s, c, ch.success.delta) + (1 - ch.p) * pain(s, c, ch.fail.delta) * 1.15;
}

/** The upgrade a careful player takes (index into the offer). */
export function bestPick(s: RunState, c: Content): number {
  const offer = s.offer ?? [];
  let best = 0;
  let bestScore = -Infinity;
  offer.forEach((id, i) => {
    const u = upgradeById(c, id);
    let score = combosCompletedBy(s, c, id).length * 30;
    for (const e of u.effects) {
      if (e.type === 'refill') score += e.amount * (60 / (s.res[e.resource] + 15));
      if (e.type === 'reduce') score += e.pct * 0.8;
      if (e.type === 'shield') score += 25;
      if (e.type === 'swap') score += e.gain * (60 / (s.res[e.to] + 15)) - e.cost * (60 / (s.res[e.from] + 15));
    }
    if (u.tags.length) score += 8;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** The move a careful player makes: least expected damage, hidden gear moves included. */
export function bestAction(s: RunState, c: Content): Action {
  return eligibleActions(s, c).reduce((a, b) => (expectedPain(s, c, b) < expectedPain(s, c, a) ? b : a));
}

export function playRun(c: Content, seed: number, modId: string, policy: Policy): RunState {
  let s = newRun(`sim-${seed}`, seed, c, 0);
  let r = seed ^ 0x5bd1e995;
  const roll = () => {
    const [v, n] = nextRandom(r);
    r = n;
    return v;
  };
  const env = { numbered: false, now: 0 };
  const feed = (input: EngineInput) => (s = step(s, input, c, env).state);
  feed({ type: 'start' });
  feed({ type: 'item_scanned', item: { modId, label: 'thing', blurb: 'your thing, modified' } });
  if (s.phase === 'scan_failed') feed({ type: 'scan_choice', retry: false });
  else feed({ type: 'confirm', yes: true });
  for (let guard = 0; guard < 50 && s.phase !== 'ended'; guard++) {
    if (s.phase === 'pick') feed({ type: 'pick', index: policy === 'thoughtful' ? bestPick(s, c) : Math.floor(roll() * (s.offer?.length ?? 1)) });
    else if (s.phase === 'action') {
      if (policy === 'thoughtful') {
        feed({ type: 'choose', actionId: bestAction(s, c).id });
        continue;
      }
      const pool = policy === 'smart' ? eligibleActions(s, c) : visibleActions(s, c);
      // "smart": prefer gear-gated / hidden actions, since those are what the player's item unlocks.
      const gated = pool.filter((a) => a.requires);
      const choices = policy === 'smart' && gated.length ? gated : pool;
      feed({ type: 'choose', actionId: choices[Math.floor(roll() * choices.length)].id });
    } else throw new Error(`stuck in phase ${s.phase}`);
  }
  if (s.phase !== 'ended') throw new Error('run did not end');
  return s;
}

if (import.meta.main ?? process.argv[1]?.endsWith('simulate.ts')) {
  const runs = Number(process.argv[2] ?? 500);
  for (const policy of ['random', 'smart', 'thoughtful'] as Policy[]) {
    console.log(`\n== policy: ${policy} (${runs} runs per item) ==`);
    console.log('item'.padEnd(22), 'success  rescue  failure  combos  avgScore');
    for (const mod of content.mods) {
      const tally = { success: 0, rescue: 0, failure: 0 };
      let combos = 0;
      let score = 0;
      for (let i = 0; i < runs; i++) {
        const s = playRun(content, i * 7919 + 13, mod.id, policy);
        tally[s.ending!.kind]++;
        combos += s.combos.length;
        score += s.ending!.score;
      }
      const pct = (n: number) => `${((100 * n) / runs).toFixed(0)}%`.padStart(7);
      console.log(mod.id.padEnd(22), pct(tally.success), pct(tally.rescue), pct(tally.failure), (combos / runs).toFixed(2).padStart(7), (score / runs).toFixed(0).padStart(9));
    }
  }
}
