// Difficulty sweep: average success rate over all items for several costScale / life-support settings.
//   node scripts/tune.ts [runsPerItem]
import { join } from 'node:path';
import { loadContent } from '../src/engine/content.ts';
import { playRun, type Policy } from './simulate.ts';

const base = loadContent(join(import.meta.dirname, '..', 'content'));
const runs = Number(process.argv[2] ?? 150);

function rate(costScale: number, lifeSupport: number, policy: Policy): number {
  const c = { ...base, costScale, lifeSupportPerStage: lifeSupport };
  let ok = 0;
  let n = 0;
  for (const mod of c.mods) {
    for (let i = 0; i < runs; i++) {
      if (playRun(c, i * 7919 + 13, mod.id, policy).ending!.kind === 'success') ok++;
      n++;
    }
  }
  return ok / n;
}

console.log(`current: costScale=${base.costScale} lifeSupport=${base.lifeSupportPerStage}`);
console.log('costScale  lifeSupport  random  smart  thoughtful');
for (const cs of [1.8, 1.9, 2.0, 2.1]) {
  for (const ls of [10]) {
    const r = rate(cs, ls, 'random');
    const s = rate(cs, ls, 'smart');
    const t = rate(cs, ls, 'thoughtful');
    console.log(`${cs.toFixed(2).padStart(9)}  ${String(ls).padStart(11)}  ${(r * 100).toFixed(0).padStart(5)}%  ${(s * 100).toFixed(0).padStart(4)}%  ${(t * 100).toFixed(0).padStart(9)}%`);
  }
}
