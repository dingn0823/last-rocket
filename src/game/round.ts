// Automatic rounds for events: nobody has to drive it.
//   waiting ─(first player boards)→ boarding (30s) → flying (5 min) → ceremony (45s) → waiting …
// Players who board during waiting/boarding/ceremony are held and all launch together;
// players who arrive while a round is flying start straight away and still count.

export type RoundPhase = 'off' | 'waiting' | 'boarding' | 'flying' | 'ceremony';

export interface RoundConfig {
  boardingMs: number;
  flightMs: number;
  ceremonyMs: number;
}

export interface PodiumEntry {
  nickname: string;
  score: number;
  icon: string;
  item: string;
  kept: boolean;
}

export interface RoundHooks {
  /** Boarding is over: start everyone who is on the launch list. */
  onLaunch(roundNo: number): void;
  /** Flight time is over: compute the podium. */
  onFinish(round: { no: number; openedAt: number; endsAt: number }): PodiumEntry[];
  /** Anything changed (for the big screen). */
  onChange(): void;
}

export class RoundClock {
  readonly cfg: RoundConfig;
  private hooks: RoundHooks;
  phase: RoundPhase = 'off';
  no = 0;
  /** Start of the current round's window: everything from here on belongs to this round. */
  openedAt = 0;
  boardingEndsAt = 0;
  startedAt = 0;
  endsAt = 0;
  ceremonyEndsAt = 0;
  podium: PodiumEntry[] = [];
  participants = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(cfg: RoundConfig, hooks: RoundHooks) {
    this.cfg = cfg;
    this.hooks = hooks;
  }

  get enabled(): boolean {
    return this.phase !== 'off';
  }

  /** New players are held on the launch list instead of starting immediately. */
  get holding(): boolean {
    return this.phase === 'waiting' || this.phase === 'boarding' || this.phase === 'ceremony';
  }

  /** Milliseconds until the held players launch (for "liftoff in 20s"). */
  launchInMs(now = Date.now()): number {
    if (this.phase === 'boarding') return Math.max(0, this.boardingEndsAt - now);
    if (this.phase === 'ceremony') return Math.max(0, this.ceremonyEndsAt - now) + this.cfg.boardingMs;
    return this.cfg.boardingMs;
  }

  flightLeftMs(now = Date.now()): number {
    return this.phase === 'flying' ? Math.max(0, this.endsAt - now) : 0;
  }

  setEnabled(on: boolean): void {
    this.clear();
    if (on) this.openNext();
    else this.phase = 'off';
    this.hooks.onChange();
  }

  /** Someone just joined the launch list. */
  playerBoarded(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'boarding';
    this.boardingEndsAt = Date.now() + this.cfg.boardingMs;
    this.schedule(this.cfg.boardingMs, () => this.launch());
    this.hooks.onChange();
  }

  launchNow(): void {
    if (this.phase === 'waiting' || this.phase === 'boarding') this.launch();
  }

  endNow(): void {
    if (this.phase === 'flying') this.finish();
  }

  private launch(): void {
    this.clear();
    this.phase = 'flying';
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + this.cfg.flightMs;
    this.schedule(this.cfg.flightMs, () => this.finish());
    this.hooks.onLaunch(this.no);
    this.hooks.onChange();
  }

  private finish(): void {
    this.clear();
    this.endsAt = Math.min(this.endsAt, Date.now());
    this.podium = this.hooks.onFinish({ no: this.no, openedAt: this.openedAt, endsAt: this.endsAt });
    this.phase = 'ceremony';
    this.ceremonyEndsAt = Date.now() + this.cfg.ceremonyMs;
    this.schedule(this.cfg.ceremonyMs, () => this.afterCeremony());
    this.hooks.onChange();
  }

  /** Players who joined during the ceremony are already waiting: go straight to boarding. */
  private heldDuringCeremony = 0;

  noteHeld(): void {
    if (this.phase === 'ceremony') this.heldDuringCeremony++;
  }

  private afterCeremony(): void {
    const waiting = this.heldDuringCeremony;
    this.openNext();
    if (waiting > 0) this.playerBoarded();
    this.hooks.onChange();
  }

  private openNext(): void {
    this.no += 1;
    this.phase = 'waiting';
    this.openedAt = Date.now();
    this.podium = [];
    this.participants = 0;
    this.heldDuringCeremony = 0;
  }

  private schedule(ms: number, fn: () => void): void {
    this.clear();
    this.timer = setTimeout(fn, ms);
    this.timer.unref?.();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  snapshot(now = Date.now()) {
    return {
      phase: this.phase,
      no: this.no,
      now,
      boardingEndsAt: this.boardingEndsAt,
      endsAt: this.endsAt,
      ceremonyEndsAt: this.ceremonyEndsAt,
      flightMs: this.cfg.flightMs,
      podium: this.podium,
      participants: this.participants,
    };
  }
}
