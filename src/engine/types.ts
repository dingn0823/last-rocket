// Engine types. The engine is a pure state machine: no I/O, no Spectrum, no web.
import type { Lang } from './text.ts';

export type Resource = 'fuel' | 'oxygen' | 'hull';
export const RESOURCES: Resource[] = ['fuel', 'oxygen', 'hull'];
export type Resources = Record<Resource, number>;
export type Deltas = Partial<Record<Resource, number>>;

export type Effect =
  | { type: 'refill'; resource: Resource; amount: number }
  | { type: 'reduce'; resource: Resource; pct: number }
  | { type: 'swap'; from: Resource; to: Resource; cost: number; gain: number }
  | { type: 'shield'; restore: number }
  /** One-time automatic top-up the first time `resource` drops below `below`. */
  | { type: 'reserve'; resource: Resource; amount: number; below: number };

export type Rarity = 'common' | 'rare' | 'legendary';

export interface Mod {
  id: string;
  name: string;
  category: string;
  icon: string;
  tags: string[];
  effects: Effect[];
  effectText: string;
  blurb: string;
  keywords: string[];
}

export interface Upgrade {
  id: string;
  name: string;
  rarity: Rarity;
  icon: string;
  tags: string[];
  effects: Effect[];
  effectText: string;
  keywords: string[];
}

export interface Combo {
  id: string;
  name: string;
  icon: string;
  /** Each entry must hold. An entry may be "a|b" meaning either. Terms: upgrade:<id>, tag:<tag>. */
  requires: string[];
  effects: Effect[];
  text: string;
}

export interface PickConfig {
  intro: string;
  weights: Record<Rarity, number>;
  guaranteeCombo: boolean;
}

export interface Outcome {
  delta?: Deltas;
  text: string;
  item?: 'consumed';
}

export interface Action {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  requires?: string[];
  hidden?: boolean;
  outcome?: Outcome;
  chance?: { p: number; success: Outcome; fail: Outcome };
}

export interface GameEvent {
  id: string;
  title: string;
  scene: string;
  intro: string[];
  actions: Action[];
}

export interface Stage {
  n: number;
  name: string;
  mode: 'numbered' | 'free';
  pickAfter?: number;
  interludeAfter?: boolean;
  opening?: string;
  fx?: string;
  pool: GameEvent[];
}

export interface Interlude {
  id: string;
  text: string;
  delta: Deltas;
  guard?: { requires: string[]; text: string; delta: Deltas };
}

export interface EndingText {
  title: string;
  fx: string;
  lines: string[];
  kept: string;
  consumed: string;
}

export type EndingKind = 'success' | 'rescue' | 'failure';

export interface Content {
  lang: Lang;
  categories: Record<string, string>;
  mods: Mod[];
  upgrades: Upgrade[];
  picks: PickConfig[];
  combos: Combo[];
  start: Resources;
  max: number;
  lifeSupportPerStage: number;
  /** Random spread applied to event deltas, e.g. 0.25 = ±25%. */
  variance: number;
  /** Difficulty knob: every event cost (negative delta) is multiplied by this. */
  costScale: number;
  interludeChance: number;
  stages: Stage[];
  interludes: Interlude[];
  endings: Record<EndingKind, EndingText> & {
    causes: Record<Resource, string>;
    score: { success: number; rescue: number; failure: number; perCombo: number; itemKept: number };
  };
  copy: Record<string, string> & { intro: string[]; listSep: string; or2: string; orLast: string };
}

// ---------- run state ----------

export type Phase = 'new' | 'await_item' | 'confirm_item' | 'scan_failed' | 'action' | 'pick' | 'ended';

export interface ItemInfo {
  modId: string;
  /** What the player's object is, e.g. "a wool scarf" (from AI or keyword). */
  label: string;
  /** One-line personal modification note, e.g. "your scarf, stitched into an impact pad". */
  blurb: string;
  /** English grammar: label is plural ("keys"). Guessed from the label when absent. */
  plural?: boolean;
  photoUrl?: string;
}

export interface HistoryEntry {
  stage: number;
  eventId: string;
  actionId: string;
  success?: boolean;
}

export interface RunState {
  runId: string;
  /** Language of this run, chosen by the first message ("join" / "加入"). */
  lang: Lang;
  version: number;
  rng: number;
  phase: Phase;
  stage: number;
  res: Resources;
  item: (ItemInfo & { status: 'kept' | 'consumed' }) | null;
  pendingItem: ItemInfo | null;
  retakesUsed: number;
  upgrades: string[];
  combos: string[];
  /** ids of gear ("upgrade:x", "item", "combo:x") whose one-time shield has been spent */
  shieldsUsed: string[];
  offer: string[] | null;
  pickIndex: number;
  eventId: string | null;
  clarifyCount: number;
  numberedShown: boolean;
  history: HistoryEntry[];
  ending: { kind: EndingKind; cause?: Resource; score: number } | null;
  processed: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------- engine I/O ----------

export type EngineInput =
  | { type: 'start' }
  | { type: 'item_scanned'; item: ItemInfo }
  | { type: 'scan_failed' }
  | { type: 'confirm'; yes: boolean }
  | { type: 'scan_choice'; retry: boolean }
  | { type: 'choose'; actionId: string }
  | { type: 'unclear'; candidates: string[]; multi?: boolean }
  | { type: 'pick'; index: number }
  | { type: 'nudge' }
  | { type: 'photo_not_now' };

export interface GearCard {
  kind: 'item' | 'upgrade';
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  effectText: string;
  blurb?: string;
  photoUrl?: string;
  rarity?: Rarity;
}

export interface Report {
  kind: EndingKind;
  title: string;
  score: number;
  res: Resources;
  item: { label: string; name: string; icon: string; status: 'kept' | 'consumed' } | null;
  upgrades: { name: string; icon: string }[];
  combos: { name: string; icon: string }[];
}

export type Outbound =
  | { t: 'text'; text: string }
  | { t: 'scene'; stage: number; title: string; icon: string }
  | { t: 'gear_card'; card: GearCard }
  | { t: 'fx'; fx: string; text: string; label: string }
  | { t: 'report'; report: Report };

export interface StepEnv {
  /** Force numbered options for free-text stages (event mode or AI rate-limited). */
  numbered: boolean;
  now: number;
}

export interface StepResult {
  state: RunState;
  out: Outbound[];
}
