// Print one scripted run as plain text, for proofreading copy.
//   node scripts/sample-run.ts [en|zh] [seed]
import { join } from 'node:path';
import { loadAllContent } from '../src/engine/content.ts';
import { newRun, step } from '../src/engine/engine.ts';
import type { EngineInput } from '../src/engine/types.ts';
import type { Lang } from '../src/engine/text.ts';

const lang = (process.argv[2] ?? 'zh') as Lang;
const c = loadAllContent(join(import.meta.dirname, '..', 'content'))[lang];
let s = newRun('sample', Number(process.argv[3] ?? 12345), c, 0);
const lines: string[] = [];
const go = (input: EngineInput) => {
  const r = step(s, input, c, { numbered: false, now: 0 });
  s = r.state;
  for (const o of r.out) {
    if (o.t === 'text') lines.push(o.text);
    else if (o.t === 'scene') lines.push(`[scene] ${o.title}`);
    else if (o.t === 'fx') lines.push(`[fx ${o.fx}] ${o.text}`);
    else if (o.t === 'gear_card') lines.push(`[card] ${o.card.name} · ${o.card.subtitle} · ${o.card.effectText} · ${o.card.blurb ?? ''}`);
    else lines.push(`[report] ${o.report.title} ${o.report.score} · ${o.report.item?.label}/${o.report.item?.name} ${o.report.item?.status}`);
  }
};
const label = lang === 'zh' ? '围巾' : 'scarf';
go({ type: 'start' });
go({ type: 'item_scanned', item: { modId: 'impact_pad', label, blurb: c.mods.find((m) => m.id === 'impact_pad')!.blurb.replace('{label}', label) } });
go({ type: 'confirm', yes: true });
go({ type: 'choose', actionId: 'brace' });
go({ type: 'pick', index: 0 });
go({ type: 'unclear', candidates: [] });
go({ type: 'choose', actionId: s.eventId === 'debris_field' ? 'pad_hull' : 'bypass' });
if (s.phase === 'pick') go({ type: 'pick', index: 1 });
if (s.phase === 'action') go({ type: 'choose', actionId: s.eventId === 'strange_signal' ? 'follow' : 'cover' });
if (s.phase === 'pick') go({ type: 'pick', index: 2 });
if (s.phase === 'action') go({ type: 'choose', actionId: 'plug' });
if (s.phase === 'action') go({ type: 'choose', actionId: s.eventId === 'boulder_field' ? 'hover' : 'feather' });
console.log(lines.join('\n'));
