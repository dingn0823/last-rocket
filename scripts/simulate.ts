// Balance check: play many runs with scripted policies straight against the engine.
//   node scripts/simulate.ts [runs]
import { join } from 'node:path';
import { loadContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import { nextRandom } from '../src/engine/rng.ts';
import { visibleActions, eligibleActions } from '../src/engine/rules.ts';
import type { Content, EngineInput, RunState } from '../src/engine/types.ts';

const content = loadContent(join(import.meta.dirname, '..', 'content'));

export type Policy = 'random' | 'smart';

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
    if (s.phase === 'pick') feed({ type: 'pick', index: Math.floor(roll() * (s.offer?.length ?? 1)) });
    else if (s.phase === 'action') {
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
  for (const policy of ['random', 'smart'] as Policy[]) {
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
