// The game state machine. step() is pure: (state, input) -> (new state, outbound messages).
import type {
  Action, Content, EndingKind, EngineInput, GearCard, ItemInfo, Outbound, Rarity, Resource, RunState, StepEnv, StepResult,
} from './types.ts';
import { nextRandom } from './rng.ts';
import {
  applyDeltas, applyInstantEffects, combosCompletedBy, computeScore, currentEvent, deadCause, eligibleActions,
  meets, modById, reductionPct, upgradeById, useShields, visibleActions,
} from './rules.ts';
import { capitalize, fmt, isPluralLabel, joinOr, withArticle } from './text.ts';

interface Ctx {
  s: RunState;
  c: Content;
  out: Outbound[];
  env: StepEnv;
}

export function newRun(runId: string, seed: number, c: Content, now: number): RunState {
  return {
    runId, lang: c.lang, version: 0, rng: seed, phase: 'new', stage: 0, res: { ...c.start },
    item: null, pendingItem: null, retakesUsed: 0, upgrades: [], combos: [], shieldsUsed: [],
    offer: null, pickIndex: 0, eventId: null, clarifyCount: 0, numberedShown: false,
    history: [], ending: null, processed: [], createdAt: now, updatedAt: now,
  };
}

export function step(state: RunState, input: EngineInput, c: Content, env: StepEnv): StepResult {
  const ctx: Ctx = { s: structuredClone(state), c, out: [], env };
  const { s } = ctx;
  switch (input.type) {
    case 'start':
      if (s.phase === 'new') {
        s.phase = 'await_item';
        c.copy.intro.forEach((line) => say(ctx, line));
      } else nudge(ctx);
      break;
    case 'item_scanned':
      onItemScanned(ctx, input.item);
      break;
    case 'scan_failed':
      if (['await_item', 'confirm_item', 'scan_failed'].includes(s.phase)) onScanFailed(ctx);
      else nudge(ctx);
      break;
    case 'confirm':
      if (s.phase !== 'confirm_item' || !s.pendingItem) nudge(ctx);
      else if (input.yes) lockItem(ctx, s.pendingItem);
      else retake(ctx);
      break;
    case 'scan_choice':
      if (s.phase !== 'scan_failed') nudge(ctx);
      else if (input.retry) retake(ctx);
      else lockStandard(ctx);
      break;
    case 'choose': {
      const action = s.phase === 'action' ? eligibleActions(s, c).find((a) => a.id === input.actionId) : undefined;
      if (action) resolveAction(ctx, action);
      else nudge(ctx);
      break;
    }
    case 'unclear':
      if (s.phase === 'action') onUnclear(ctx, input.candidates, !!input.multi);
      else nudge(ctx);
      break;
    case 'pick':
      if (s.phase === 'pick' && s.offer && input.index >= 0 && input.index < s.offer.length) onPick(ctx, s.offer[input.index]);
      else nudge(ctx);
      break;
    case 'photo_not_now':
      say(ctx, c.copy.photoNotNow);
      nudge(ctx);
      break;
    case 'nudge':
      nudge(ctx);
      break;
  }
  s.version += 1;
  s.updatedAt = env.now;
  return { state: s, out: ctx.out };
}

// ---------- helpers ----------

function rand(ctx: Ctx): number {
  const [v, next] = nextRandom(ctx.s.rng);
  ctx.s.rng = next;
  return v;
}

function say(ctx: Ctx, text: string): void {
  ctx.out.push({ t: 'text', text });
}

function vars(ctx: Ctx): Record<string, string> {
  const { c } = ctx;
  const item = ctx.s.item ?? ctx.s.pendingItem;
  const plural = c.lang === 'en' && !!item && (item.plural ?? isPluralLabel(item.label));
  return {
    item: item?.label ?? c.copy.defaultItem,
    mod: item ? modById(c, item.modId).name : c.copy.defaultMod,
    // English agreement helpers; Chinese templates simply don't use them.
    is: plural ? 'are' : 'is',
    it: plural ? 'they' : 'it',
    obj: plural ? 'them' : 'it',
    thisIs: plural ? 'these are' : 'this is',
  };
}

function t(ctx: Ctx, template: string, extra: Record<string, string | number> = {}): string {
  return fmt(template, { ...vars(ctx), ...extra });
}

function statusLine(ctx: Ctx): string {
  return fmt(ctx.c.copy.status, ctx.s.res);
}

function stageDef(ctx: Ctx) {
  return ctx.c.stages.find((x) => x.n === ctx.s.stage)!;
}

// ---------- item intake ----------

function onItemScanned(ctx: Ctx, item: ItemInfo): void {
  const { s } = ctx;
  if (!['await_item', 'confirm_item', 'scan_failed'].includes(s.phase)) return nudge(ctx);
  if (item.modId === 'standard_supplies') return onScanFailed(ctx);
  // A new item while a guess is on the table counts as a retake.
  if (s.phase !== 'await_item') {
    if (s.retakesUsed >= 1) return lockStandard(ctx, ctx.c.copy.itemRetakeUsed);
    s.retakesUsed += 1;
  }
  s.pendingItem = { ...item, plural: item.plural ?? (ctx.c.lang === 'en' && isPluralLabel(item.label)) };
  s.phase = 'confirm_item';
  const mod = modById(ctx.c, item.modId);
  say(ctx, t(ctx, ctx.c.copy.itemGuess, { label: withArticle(item.label, ctx.c.lang), modA: withArticle(mod.name, ctx.c.lang), effect: mod.effectText }));
  say(ctx, ctx.c.copy.itemConfirmAsk);
}

function onScanFailed(ctx: Ctx): void {
  if (ctx.s.retakesUsed >= 1) return lockStandard(ctx, ctx.c.copy.itemRetakeUsed);
  ctx.s.phase = 'scan_failed';
  say(ctx, `${ctx.c.copy.scanFailed} ${ctx.c.copy.scanFailedAsk}`);
}

function retake(ctx: Ctx): void {
  if (ctx.s.retakesUsed >= 1) return lockStandard(ctx, ctx.c.copy.itemRetakeUsed);
  ctx.s.retakesUsed += 1;
  ctx.s.pendingItem = null;
  ctx.s.phase = 'await_item';
  say(ctx, ctx.c.copy.itemRetake);
}

function lockStandard(ctx: Ctx, message?: string): void {
  if (message) say(ctx, message);
  const mod = modById(ctx.c, 'standard_supplies');
  lockItem(ctx, { modId: mod.id, label: ctx.c.copy.standardLabel, blurb: mod.blurb, plural: ctx.c.lang === 'en' });
}

function lockItem(ctx: Ctx, item: ItemInfo): void {
  const { s, c } = ctx;
  const mod = modById(c, item.modId);
  s.item = { ...item, status: 'kept' };
  s.pendingItem = null;
  applyInstantEffects(s, c, mod.effects);
  const card: GearCard = {
    kind: 'item', id: mod.id, name: mod.name, icon: mod.icon, subtitle: c.categories[mod.category] ?? mod.category,
    effectText: mod.effectText, blurb: item.blurb, photoUrl: item.photoUrl,
  };
  ctx.out.push({ t: 'gear_card', card });
  say(ctx, `${fmt(c.copy.itemLocked, { blurb: capitalize(item.blurb) })}\n${statusLine(ctx)}`);
  enterStage(ctx, 1);
}

// ---------- stages ----------

function enterStage(ctx: Ctx, n: number): void {
  const { s, c } = ctx;
  s.stage = n;
  s.phase = 'action';
  s.clarifyCount = 0;
  s.numberedShown = false;
  const stage = stageDef(ctx);
  const event = stage.pool[Math.floor(rand(ctx) * stage.pool.length)];
  s.eventId = event.id;
  if (stage.opening) say(ctx, stage.opening);
  ctx.out.push({ t: 'scene', stage: n, title: fmt(c.copy.stageHeader, { n, name: stage.name }), icon: event.scene });
  say(ctx, t(ctx, event.intro.join(c.copy.sentenceSep)));
  prompt(ctx);
}

function numberedList(ctx: Ctx, actions: Action[]): string {
  return actions.map((a, i) => `${i + 1}. ${t(ctx, a.label)}`).join('\n');
}

/** Natural-language hints for the visible actions, plus a nudge when a hidden gear option exists. */
function hintList(ctx: Ctx): string {
  const hints = visibleActions(ctx.s, ctx.c).map((a) => t(ctx, a.hint));
  if (eligibleActions(ctx.s, ctx.c).some((a) => a.hidden)) hints.push(t(ctx, ctx.c.copy.gearHint));
  return joinOr(hints, ctx.c.copy);
}

function prompt(ctx: Ctx): void {
  const visible = visibleActions(ctx.s, ctx.c);
  if (stageDef(ctx).mode === 'numbered' || ctx.env.numbered || ctx.s.numberedShown) {
    say(ctx, `${ctx.c.copy.numberedAsk}\n${numberedList(ctx, visible)}`);
  } else {
    say(ctx, t(ctx, ctx.c.copy.freePrompt, { hints: hintList(ctx) }));
  }
}

function onUnclear(ctx: Ctx, candidates: string[], multi: boolean): void {
  const { s, c } = ctx;
  const visible = visibleActions(s, c);
  if (s.numberedShown || ctx.env.numbered || stageDef(ctx).mode === 'numbered') {
    // Already showed the list: a short friendly reminder, not the same wall of text again.
    if (s.numberedShown || s.clarifyCount > 0) say(ctx, fmt(c.copy.nudgeNumbered, { max: visible.length }));
    else say(ctx, `${c.copy.numberedAsk}\n${numberedList(ctx, visible)}`);
    s.clarifyCount += 1;
    return;
  }
  if (s.clarifyCount === 0) {
    s.clarifyCount = 1;
    const cands = candidates.map((id) => eligibleActions(s, c).find((a) => a.id === id)).filter((a): a is Action => !!a);
    if (multi) say(ctx, c.copy.clarifyMulti);
    else if (cands.length >= 2) say(ctx, fmt(c.copy.clarifyPair, { a: capitalize(t(ctx, cands[0].hint)), b: t(ctx, cands[1].hint) }));
    else say(ctx, t(ctx, c.copy.clarifyNone, { hints: hintList(ctx) }));
    return;
  }
  s.numberedShown = true;
  say(ctx, `${c.copy.numberedFallback}\n${numberedList(ctx, visible)}`);
}

function resolveAction(ctx: Ctx, action: Action): void {
  const { s, c } = ctx;
  const stage = stageDef(ctx);
  let outcome = action.outcome;
  let success: boolean | undefined;
  if (action.chance) {
    success = rand(ctx) < action.chance.p;
    outcome = success ? action.chance.success : action.chance.fail;
  }
  if (!outcome) return nudge(ctx);
  const text = t(ctx, outcome.text);
  applyDeltas(s, c, outcome.delta);
  applyDeltas(s, c, { oxygen: -c.lifeSupportPerStage });
  if (outcome.item === 'consumed' && s.item) s.item.status = 'consumed';
  s.history.push({ stage: s.stage, eventId: s.eventId!, actionId: action.id, success });
  if (stage.fx) ctx.out.push({ t: 'fx', fx: stage.fx, text: stage.name });
  say(ctx, `${text}\n${statusLine(ctx)}`);
  if (checkVitals(ctx)) return;
  if (stage.pickAfter !== undefined) return offerPick(ctx, stage.pickAfter);
  if (s.stage >= 5) return finish(ctx, 'success');
  enterStage(ctx, s.stage + 1);
}

/** Shields first; then end the run if anything is at zero. Returns true if the run ended. */
function checkVitals(ctx: Ctx): boolean {
  const { s, c } = ctx;
  for (const save of useShields(s, c)) {
    ctx.out.push({ t: 'fx', fx: 'shield', text: save.gear.name });
    const resource = c.copy[`resource_${save.resource}`];
    say(ctx, fmt(c.copy.shieldSaved, { name: save.gear.name, resource, amount: save.amount }));
  }
  const cause = deadCause(s);
  if (!cause) return false;
  finish(ctx, cause === 'fuel' ? 'rescue' : 'failure', cause);
  return true;
}

// ---------- upgrades ----------

function rollRarity(ctx: Ctx, weights: Record<Rarity, number>): Rarity {
  const total = weights.common + weights.rare + weights.legendary;
  let r = rand(ctx) * total;
  for (const k of ['common', 'rare', 'legendary'] as Rarity[]) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return 'common';
}

function generateOffer(ctx: Ctx, pickIdx: number): string[] {
  const { s, c } = ctx;
  const cfg = c.picks[pickIdx];
  const candidates = c.upgrades.filter((u) => !s.upgrades.includes(u.id));
  const offer: string[] = [];
  for (let slot = 0; slot < 3 && offer.length < candidates.length; slot++) {
    const rarity = rollRarity(ctx, cfg.weights);
    let pool = candidates.filter((u) => u.rarity === rarity && !offer.includes(u.id));
    if (pool.length === 0) pool = candidates.filter((u) => !offer.includes(u.id));
    offer.push(pool[Math.floor(rand(ctx) * pool.length)].id);
  }
  if (cfg.guaranteeCombo && !offer.some((id) => combosCompletedBy(s, c, id).length > 0)) {
    const partners = candidates.filter((u) => !offer.includes(u.id) && combosCompletedBy(s, c, u.id).length > 0);
    if (partners.length > 0) offer[offer.length - 1] = partners[Math.floor(rand(ctx) * partners.length)].id;
  }
  return offer;
}

function offerText(ctx: Ctx): string {
  const { s, c } = ctx;
  const lines = (s.offer ?? []).map((id, i) => {
    const u = upgradeById(c, id);
    const combo = combosCompletedBy(s, c, id).length > 0 ? c.copy.comboTag : '';
    return fmt(c.copy.pickLine, { n: i + 1, icon: u.icon, name: u.name, rarity: c.copy[`rarity_${u.rarity}`], combo, effect: u.effectText });
  });
  return `${c.picks[s.pickIndex].intro}\n${lines.join('\n')}\n${c.copy.pickAsk}`;
}

function offerPick(ctx: Ctx, pickIdx: number): void {
  ctx.s.phase = 'pick';
  ctx.s.pickIndex = pickIdx;
  ctx.s.offer = generateOffer(ctx, pickIdx);
  say(ctx, offerText(ctx));
}

function onPick(ctx: Ctx, id: string): void {
  const { s, c } = ctx;
  const u = upgradeById(c, id);
  s.upgrades.push(id);
  s.offer = null;
  applyInstantEffects(s, c, u.effects);
  if (u.rarity === 'legendary') ctx.out.push({ t: 'fx', fx: 'legendary', text: u.name });
  ctx.out.push({
    t: 'gear_card',
    card: { kind: 'upgrade', id: u.id, name: u.name, icon: u.icon, subtitle: capitalize(c.copy[`rarity_${u.rarity}`]), effectText: u.effectText, rarity: u.rarity },
  });
  for (const comboId of combosCompletedBy(s, c)) {
    const k = c.combos.find((x) => x.id === comboId)!;
    s.combos.push(k.id);
    applyInstantEffects(s, c, k.effects);
    ctx.out.push({ t: 'fx', fx: 'combo', text: k.name });
    say(ctx, t(ctx, c.copy.combo, { name: `${k.icon} ${k.name}`, text: t(ctx, k.text) }));
  }
  say(ctx, `${fmt(c.copy.pickGot, { name: u.name })}\n${statusLine(ctx)}`);
  if (stageDef(ctx).interludeAfter && rand(ctx) < c.interludeChance) {
    if (runInterlude(ctx)) return;
  }
  enterStage(ctx, s.stage + 1);
}

/** Random mid-flight event pushed by the game. Returns true if the run ended. */
function runInterlude(ctx: Ctx): boolean {
  const { s, c } = ctx;
  const inter = c.interludes[Math.floor(rand(ctx) * c.interludes.length)];
  const guarded = inter.guard && meets(inter.guard.requires, s, c);
  const text = guarded ? inter.guard!.text : inter.text;
  applyDeltas(s, c, guarded ? inter.guard!.delta : inter.delta);
  say(ctx, `${t(ctx, text)}\n${statusLine(ctx)}`);
  return checkVitals(ctx);
}

// ---------- endings ----------

function finish(ctx: Ctx, kind: EndingKind, cause?: Resource): void {
  const { s, c } = ctx;
  const e = c.endings[kind];
  const score = computeScore(s, c, kind);
  s.phase = 'ended';
  s.eventId = null;
  s.ending = { kind, cause, score };
  ctx.out.push({ t: 'fx', fx: e.fx, text: e.title });
  const causeText = cause ? c.endings.causes[cause] : '';
  say(ctx, t(ctx, e.lines.join(c.copy.sentenceSep), { cause: causeText }).trim());
  if (s.item) say(ctx, t(ctx, s.item.status === 'kept' ? e.kept : e.consumed));
  const itemMod = s.item ? modById(c, s.item.modId) : null;
  ctx.out.push({
    t: 'report',
    report: {
      kind, title: e.title, score, res: { ...s.res },
      item: s.item && itemMod ? { label: s.item.label, name: itemMod.name, icon: itemMod.icon, status: s.item.status } : null,
      upgrades: s.upgrades.map((id) => ({ name: upgradeById(c, id).name, icon: upgradeById(c, id).icon })),
      combos: s.combos.map((id) => c.combos.find((k) => k.id === id)!).map((k) => ({ name: k.name, icon: k.icon })),
    },
  });
  say(ctx, c.copy.again);
}

// ---------- re-prompt ----------

function nudge(ctx: Ctx): void {
  const { s, c } = ctx;
  switch (s.phase) {
    case 'new':
      s.phase = 'await_item';
      c.copy.intro.forEach((line) => say(ctx, line));
      break;
    case 'await_item':
      say(ctx, c.copy.awaitItemReminder);
      break;
    case 'confirm_item':
      say(ctx, c.copy.nudgeConfirm);
      break;
    case 'scan_failed':
      say(ctx, c.copy.nudgeScanFailed);
      break;
    case 'action':
      if (s.numberedShown || ctx.env.numbered || stageDef(ctx).mode === 'numbered') say(ctx, fmt(c.copy.nudgeNumbered, { max: visibleActions(s, c).length }));
      else prompt(ctx);
      break;
    case 'pick':
      say(ctx, c.copy.nudgePick);
      break;
    case 'ended':
      say(ctx, c.copy.ended);
      break;
  }
}

// ---------- read-only views ----------

/** Candidate actions for AI parsing: everything eligible, including hidden ones. */
export function actionCandidates(s: RunState, c: Content): { id: string; description: string }[] {
  const v = { item: s.item?.label ?? c.copy.defaultItem, mod: s.item ? modById(c, s.item.modId).name : c.copy.defaultMod };
  return eligibleActions(s, c).map((a) => ({ id: a.id, description: fmt(a.label, v) }));
}

export interface Snapshot {
  lang: RunState['lang'];
  stageNames: string[];
  phase: RunState['phase'];
  stage: number;
  stageName: string;
  eventTitle: string | null;
  res: RunState['res'];
  max: number;
  item: { label: string; name: string; icon: string; category: string; blurb: string; photoUrl?: string; status: string } | null;
  pendingItem: { label: string; name: string; icon: string; photoUrl?: string } | null;
  upgrades: { id: string; name: string; icon: string; rarity: string; effectText: string }[];
  combos: { id: string; name: string; icon: string }[];
  reductions: Record<Resource, number>;
  ending: RunState['ending'];
  version: number;
}

export function snapshot(s: RunState, c: Content): Snapshot {
  const stage = c.stages.find((x) => x.n === s.stage);
  const itemMod = s.item ? modById(c, s.item.modId) : null;
  const pendingMod = s.pendingItem ? modById(c, s.pendingItem.modId) : null;
  const red = (r: Resource) => reductionPct(s, c, r);
  return {
    lang: s.lang,
    stageNames: c.stages.map((x) => x.name),
    phase: s.phase,
    stage: s.stage,
    stageName: stage?.name ?? '',
    eventTitle: currentEvent(s, c)?.title ?? null,
    res: s.res,
    max: c.max,
    item: s.item && itemMod
      ? { label: s.item.label, name: itemMod.name, icon: itemMod.icon, category: c.categories[itemMod.category], blurb: s.item.blurb, photoUrl: s.item.photoUrl, status: s.item.status }
      : null,
    pendingItem: s.pendingItem && pendingMod
      ? { label: s.pendingItem.label, name: pendingMod.name, icon: pendingMod.icon, photoUrl: s.pendingItem.photoUrl }
      : null,
    upgrades: s.upgrades.map((id) => upgradeById(c, id)).map((u) => ({ id: u.id, name: u.name, icon: u.icon, rarity: u.rarity, effectText: u.effectText })),
    combos: s.combos.map((id) => c.combos.find((k) => k.id === id)!).map((k) => ({ id: k.id, name: k.name, icon: k.icon })),
    reductions: { fuel: red('fuel'), oxygen: red('oxygen'), hull: red('hull') },
    ending: s.ending,
    version: s.version,
  };
}
