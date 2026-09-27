// File-backed store: one JSON file per run + a players index. Writes are atomic (tmp + rename).
// Good enough for the demo; swap for SQLite behind the same interface later.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from '../engine/types.ts';

export interface TranscriptEntry {
  dir: 'in' | 'out';
  at: number;
  msg: unknown;
}

export interface RunRecord {
  state: RunState;
  address: string;
  channel: string;
  bridgeToken: string;
  transcript: TranscriptEntry[];
  /** Gemini requests made during this run. */
  aiCalls?: number;
  /** Set when the run is waiting on a round's launch list (automatic rounds). */
  heldRound?: number;
  /** Paired with a computer's join page (that page already shows the bridge). */
  paired?: boolean;
}

export interface Player {
  address: string;
  channel: string;
  nickname: string;
  currentRunId: string | null;
}

const TRANSCRIPT_CAP = 400;

function atomicWrite(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

export class Store {
  readonly dir: string;
  private runs = new Map<string, RunRecord>();
  private players = new Map<string, Player>();
  private tokens = new Map<string, string>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, 'runs'), { recursive: true });
    mkdirSync(join(dir, 'media'), { recursive: true });
    const playersFile = join(dir, 'players.json');
    if (existsSync(playersFile)) for (const p of JSON.parse(readFileSync(playersFile, 'utf8')) as Player[]) this.players.set(p.address, p);
    for (const f of readdirSync(join(dir, 'runs'))) {
      if (!f.endsWith('.json')) continue;
      const rec = JSON.parse(readFileSync(join(dir, 'runs', f), 'utf8')) as RunRecord;
      this.runs.set(rec.state.runId, rec);
      this.tokens.set(rec.bridgeToken, rec.state.runId);
    }
  }

  get mediaDir(): string {
    return join(this.dir, 'media');
  }

  getPlayer(address: string): Player | undefined {
    return this.players.get(address);
  }

  savePlayer(p: Player): void {
    this.players.set(p.address, p);
    atomicWrite(join(this.dir, 'players.json'), [...this.players.values()]);
  }

  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  runByToken(token: string): RunRecord | undefined {
    const id = this.tokens.get(token);
    return id ? this.runs.get(id) : undefined;
  }

  saveRun(rec: RunRecord): void {
    if (rec.transcript.length > TRANSCRIPT_CAP) rec.transcript = rec.transcript.slice(-TRANSCRIPT_CAP);
    this.runs.set(rec.state.runId, rec);
    this.tokens.set(rec.bridgeToken, rec.state.runId);
    atomicWrite(join(this.dir, 'runs', `${rec.state.runId}.json`), rec);
  }

  allRuns(): RunRecord[] {
    return [...this.runs.values()];
  }
}
