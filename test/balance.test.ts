import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadAllContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import type { EngineInput, RunState } from '../src/engine/types.ts';
import { playRun } from '../scripts/simulate.ts';

const { en: c } = loadAllContent(join(import.meta.dirname, '..', 'content'));
const env = { numbered: false, now: 0 };

function withItem(modId: string, seed = 1): RunState {
  let s = newRun('b', seed, c, 0);
  const go = (i: EngineInput) => (s = step(s, i, c, env).state);
  go({ type: 'start' });
  go({ type: 'item_scanned', item: { modId, label: 'thermos', blurb: 'x' } });
  go({ type: 'confirm', yes: true });
  return s;
}

describe('balance & variety', () => {
  it('everyone starts at 100', () => {
    assert.deepEqual(newRun('x', 1, c, 0).res, { fuel: 100, oxygen: 100, hull: 100 });
  });

  it('item reserves fire once, when the resource drops below the line', () => {
    let s = { ...withItem('emergency_air_tank'), stage: 3, eventId: 'strange_signal', phase: 'action' as const, res: { fuel: 90, oxygen: 36, hull: 90 } };
    const r1 = step(s, { type: 'choose', actionId: 'ignore' }, c, env);
    assert.ok(r1.out.some((o) => o.t === 'text' && o.text.includes('Emergency reserve')), 'reserve message');
    assert.ok(r1.state.res.oxygen > 36, `oxygen topped up: ${r1.state.res.oxygen}`);
    s = { ...r1.state, stage: 3, eventId: 'strange_signal', phase: 'action', res: { ...r1.state.res, oxygen: 36 } };
    const r2 = step(s, { type: 'choose', actionId: 'ignore' }, c, env);
    assert.ok(!r2.out.some((o) => o.t === 'text' && o.text.includes('Emergency reserve')), 'second time: nothing');
  });

  it('a sacrificed item no longer provides its reserve', () => {
    const s = withItem('emergency_air_tank');
    const gone = { ...s, item: { ...s.item!, status: 'consumed' as const }, stage: 3, eventId: 'strange_signal', phase: 'action' as const, res: { fuel: 90, oxygen: 36, hull: 90 } };
    const r = step(gone, { type: 'choose', actionId: 'ignore' }, c, env);
    assert.ok(!r.out.some((o) => o.t === 'text' && o.text.includes('Emergency reserve')));
  });

  it('every stage-4 crisis keeps the sacrifice-or-keep choice', () => {
    const stage4 = c.stages.find((x) => x.n === 4)!;
    assert.ok(stage4.pool.length >= 3);
    for (const e of stage4.pool) {
      assert.equal(e.actions.find((a) => a.id === 'strip')?.outcome?.item, 'consumed', `${e.id}: strip consumes the item`);
      assert.ok(e.actions.some((a) => a.id === 'keep'), `${e.id}: has keep`);
    }
  });

  it('the same choice plays out differently across runs, identically for the same seed', () => {
    const results = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const s = { ...withItem('standard_supplies', seed), stage: 2, eventId: 'debris_field', phase: 'action' as const };
      results.add(step(s, { type: 'choose', actionId: 'swerve' }, c, env).state.res.fuel);
    }
    assert.ok(results.size > 3, `varied outcomes: ${[...results]}`);
    const a = playRun(c, 99, 'impact_pad', 'random');
    const b = playRun(c, 99, 'impact_pad', 'random');
    assert.deepEqual(a.history, b.history);
  });

  it('option hints never contain list separators (they are joined into one sentence)', () => {
    const all = loadAllContent(join(import.meta.dirname, '..', 'content'));
    for (const lang of ['en', 'zh'] as const) {
      const cc = all[lang];
      for (const st of cc.stages) for (const e of st.pool) for (const a of e.actions) {
        assert.ok(!a.hint.includes(cc.copy.listSep.trim()) && !a.hint.includes('，'), `${lang} ${e.id}.${a.id}: "${a.hint}"`);
      }
    }
  });

  it('random play fails a meaningful share of runs; careful play mostly lands', () => {
    let rnd = 0;
    let good = 0;
    const n = 60;
    for (const mod of c.mods) for (let i = 0; i < n; i++) {
      if (playRun(c, i * 131 + 7, mod.id, 'random').ending!.kind === 'success') rnd++;
      if (playRun(c, i * 131 + 7, mod.id, 'thoughtful').ending!.kind === 'success') good++;
    }
    const total = c.mods.length * n;
    assert.ok(rnd / total < 0.6, `random success ${(100 * rnd / total).toFixed(0)}% should be < 60%`);
    assert.ok(good / total > 0.7, `careful success ${(100 * good / total).toFixed(0)}% should be > 70%`);
  });
});
