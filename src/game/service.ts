// Orchestration: inbound message → per-player serial queue → dedupe → understand input → engine step → save → send → push.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AI } from '../ai/ai.ts';
import type { Channel, Inbound } from '../channel/types.ts';
import { actionCandidates, newRun, snapshot, step } from '../engine/engine.ts';
import { interpretAction, interpretConfirm, interpretPick, interpretScanChoice, isAgain } from '../engine/interpret.ts';
import { randomSeed } from '../engine/rng.ts';
import { currentEvent, modById } from '../engine/rules.ts';
import { detectLang, fmt, type Lang } from '../engine/text.ts';
import type { Content, EngineInput, Outbound, RunState } from '../engine/types.ts';
import type { Hub } from '../server/sse.ts';
import type { Player, RunRecord, Store } from '../store/store.ts';

export interface ServiceOptions {
  contents: Record<Lang, Content>;
  store: Store;
  ai: AI;
  hub: Hub;
  channels: Channel[];
  eventMode: boolean;
  publicUrl: string;
}

interface Decision {
  input: EngineInput;
  /** Force numbered options for this step (AI timed out). */
  numbered?: boolean;
}

const PROCESSED_CAP = 200;

export class GameService {
  readonly contents: Record<Lang, Content>;
  readonly store: Store;
  readonly ai: AI;
  readonly hub: Hub;
  readonly publicUrl: string;
  eventMode: boolean;
  private channels = new Map<string, Channel>();
  private queues = new Map<string, Promise<void>>();

  constructor(opts: ServiceOptions) {
    this.contents = opts.contents;
    this.store = opts.store;
    this.ai = opts.ai;
    this.hub = opts.hub;
    this.eventMode = opts.eventMode;
    this.publicUrl = opts.publicUrl;
    for (const ch of opts.channels) this.channels.set(ch.name, ch);
  }

  /** Numbered options everywhere when in event mode or when the AI is rate-limited. */
  get numberedMode(): boolean {
    return this.eventMode || this.ai.rateLimited;
  }

  bridgeUrl(token: string): string {
    return `${this.publicUrl}/bridge/${token}`;
  }

  contentFor(s: RunState): Content {
    return this.contents[s.lang ?? 'en'] ?? this.contents.en;
  }

  handleInbound(msg: Inbound): Promise<void> {
    return this.enqueue(`${msg.channel}:${msg.address}`, () => this.process(msg));
  }

  ensurePlayer(channel: string, address: string, nickname = 'Crew'): Player {
    let p = this.store.getPlayer(address);
    if (!p) {
      p = { address, channel, nickname, currentRunId: null };
      this.store.savePlayer(p);
    }
    return p;
  }

  currentRun(address: string): RunRecord | undefined {
    const p = this.store.getPlayer(address);
    return p?.currentRunId ? this.store.getRun(p.currentRunId) : undefined;
  }

  snapshotFor(rec: RunRecord) {
    const p = this.store.getPlayer(rec.address);
    return { ...snapshot(rec.state, this.contentFor(rec.state)), nickname: p?.nickname ?? 'Crew' };
  }

  // ---------- internals ----------

  private enqueue(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => console.error(`[game] ${key}:`, err));
    this.queues.set(key, next);
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  private createRun(player: Player, lang: Lang): RunRecord {
    const now = Date.now();
    const rec: RunRecord = {
      state: newRun(randomUUID(), randomSeed(), this.contents[lang], now),
      address: player.address,
      channel: player.channel,
      bridgeToken: randomBytes(12).toString('base64url'),
      transcript: [],
      aiCalls: 0,
    };
    this.store.saveRun(rec);
    player.currentRunId = rec.state.runId;
    this.store.savePlayer(player);
    void this.channels.get(player.channel)?.runStarted?.(player.address, { runId: rec.state.runId, bridgeUrl: this.bridgeUrl(rec.bridgeToken), lang });
    return rec;
  }

  private async process(msg: Inbound): Promise<void> {
    const player = this.ensurePlayer(msg.channel, msg.address);
    const existing = player.currentRunId ? this.store.getRun(player.currentRunId) : undefined;
    // The first message picks the language: "join" → English, "加入" → Chinese. Same for "again" / "再来一局".
    let rec = existing ?? this.createRun(player, detectLang(msg.text));
    if (rec.state.processed.includes(msg.msgId)) {
      console.log(`[game] duplicate ${msg.msgId} dropped`);
      return;
    }

    if (rec.state.phase === 'ended' && msg.text && isAgain(msg.text)) {
      rec.state = { ...rec.state, processed: [...rec.state.processed, msg.msgId].slice(-PROCESSED_CAP) };
      this.store.saveRun(rec);
      rec = this.createRun(player, detectLang(msg.text));
    }
    rec.transcript.push({ dir: 'in', at: Date.now(), msg: { text: msg.text, imageUrl: msg.image?.url } });
    const startVersion = rec.state.version;
    const callsBefore = this.ai.calls;
    const decision: Decision = rec.state.phase === 'new' ? { input: { type: 'start' } } : await this.decide(rec, msg);
    rec.aiCalls = (rec.aiCalls ?? 0) + (this.ai.calls - callsBefore);

    // Anything that changed the run while we were waiting on AI makes this input stale.
    const latest = this.store.getRun(rec.state.runId);
    if (!latest || latest.state.version !== startVersion) {
      console.log(`[game] stale input ${msg.msgId} dropped`);
      return;
    }

    const c = this.contentFor(rec.state);
    const wasEnded = rec.state.phase === 'ended';
    const numbered = this.numberedMode || !!decision.numbered;
    const result = step(rec.state, decision.input, c, { numbered, now: Date.now() });
    result.state.processed = [...result.state.processed, msg.msgId].slice(-PROCESSED_CAP);
    rec.state = result.state;
    for (const o of result.out) rec.transcript.push({ dir: 'out', at: Date.now(), msg: o });

    // Save first, then send. A failed send never re-runs the step.
    this.store.saveRun(rec);
    await this.deliver(rec, result.out);

    if (!wasEnded && rec.state.phase === 'ended') {
      await this.narrate(rec);
      console.log(`[game] run ${rec.state.runId} ended (${rec.state.ending?.kind}); Gemini calls this run: ${rec.aiCalls}`);
    }
  }

  private async decide(rec: RunRecord, msg: Inbound): Promise<Decision> {
    const s = rec.state;
    const c = this.contentFor(s);
    const text = msg.text?.trim() ?? '';
    switch (s.phase) {
      case 'new':
        return { input: { type: 'start' } };

      case 'await_item':
      case 'confirm_item':
      case 'scan_failed': {
        if (!msg.image) {
          if (s.phase === 'confirm_item') {
            const r = interpretConfirm(text);
            if (r !== 'other') return { input: { type: 'confirm', yes: r === 'yes' } };
          }
          if (s.phase === 'scan_failed') {
            const r = interpretScanChoice(text);
            if (r !== 'other') return { input: { type: 'scan_choice', retry: r === 'retry' } };
          }
          if (!text) return { input: { type: 'nudge' } };
          const res = await this.ai.classifyText(c, text);
          if (res.ok) return { input: { type: 'item_scanned', item: res.item } };
          // Unrecognizable chatter ("hi", "what?") gets a friendly hint, not a burned retake.
          return { input: { type: 'nudge' } };
        }
        await this.scanning(rec, msg.image.url);
        const res = await this.ai.classifyPhoto(
          c,
          { base64: readFileSync(msg.image.path).toString('base64'), mime: msg.image.mime },
          text || undefined,
        );
        if (res.ok) return { input: { type: 'item_scanned', item: { ...res.item, photoUrl: msg.image.url } } };
        return { input: { type: 'scan_failed' } };
      }

      case 'action': {
        if (msg.image) return { input: { type: 'photo_not_now' } };
        const reading = interpretAction(s, c, text);
        if (reading.kind === 'action') return { input: { type: 'choose', actionId: reading.id } };
        if (reading.kind === 'ambiguous') return { input: { type: 'unclear', candidates: reading.ids } };
        if (reading.kind === 'multi') return { input: { type: 'unclear', candidates: [], multi: true } };
        if (this.numberedMode || s.numberedShown || !this.ai.gemini.available) return { input: { type: 'unclear', candidates: [] } };
        const ev = currentEvent(s, c);
        const parsed = await this.ai.parseAction(text, `${ev?.title}: ${ev?.intro.join(' ')}`, actionCandidates(s, c));
        if (!parsed) return { input: { type: 'unclear', candidates: [] }, numbered: true };
        if ('actionId' in parsed) return { input: { type: 'choose', actionId: parsed.actionId } };
        return { input: { type: 'unclear', candidates: parsed.ids } };
      }

      case 'pick': {
        if (msg.image) return { input: { type: 'photo_not_now' } };
        const idx = interpretPick(s, c, text);
        return { input: idx === null ? { type: 'nudge' } : { type: 'pick', index: idx } };
      }

      case 'ended':
        return { input: { type: 'nudge' } };
    }
  }

  /** "Scanning..." bubble + hologram on the bridge while the AI looks at the photo. Not a state change. */
  private async scanning(rec: RunRecord, photoUrl: string): Promise<void> {
    const out: Outbound[] = [{ t: 'text', text: this.contentFor(rec.state).copy.scanning }];
    rec.transcript.push({ dir: 'out', at: Date.now(), msg: out[0] });
    this.hub.publish(`bridge:${rec.bridgeToken}`, 'scanning', { photoUrl });
    const ch = this.channels.get(rec.channel);
    try {
      await ch?.send(rec.address, out);
      await ch?.typing?.(rec.address);
    } catch (err) {
      console.error('[game] send failed (scanning):', err);
    }
  }

  private async deliver(rec: RunRecord, out: Outbound[]): Promise<void> {
    this.hub.publish(`bridge:${rec.bridgeToken}`, 'update', { snapshot: this.snapshotFor(rec), out });
    try {
      await this.channels.get(rec.channel)?.send(rec.address, out);
    } catch (err) {
      console.error(`[game] send failed for run ${rec.state.runId}:`, err);
    }
  }

  private async narrate(rec: RunRecord): Promise<void> {
    const c = this.contentFor(rec.state);
    const version = rec.state.version;
    const callsBefore = this.ai.calls;
    const text = await this.ai.narrateEnding(c, summarize(rec.state, c));
    rec.aiCalls = (rec.aiCalls ?? 0) + (this.ai.calls - callsBefore);
    if (!text || this.store.getRun(rec.state.runId)?.state.version !== version) {
      this.store.saveRun(rec);
      return;
    }
    const out: Outbound[] = [{ t: 'text', text: fmt(c.copy.captainsLog, { text }) }];
    rec.transcript.push({ dir: 'out', at: Date.now(), msg: out[0] });
    this.store.saveRun(rec);
    await this.deliver(rec, out);
  }
}

function summarize(s: RunState, c: Content): string {
  const item = s.item ? `${s.item.label} (rigged as ${modById(c, s.item.modId).name}, ${s.item.status})` : 'nothing';
  const moves = s.history.map((h) => `stage ${h.stage} ${h.eventId}: ${h.actionId}${h.success === false ? ' (went badly)' : ''}`).join('; ');
  return `Ending: ${s.ending?.kind}${s.ending?.cause ? ` (${s.ending.cause})` : ''}. Brought: ${item}. Upgrades: ${s.upgrades.join(', ') || 'none'}. Combos: ${s.combos.join(', ') || 'none'}. Moves: ${moves}.`;
}
