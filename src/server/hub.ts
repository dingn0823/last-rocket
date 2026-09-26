// Live updates for the web pages via long polling.
// We tried SSE first, but Cloudflare quick tunnels buffer event streams (nothing arrives), while ordinary
// requests pass fine. So clients ask "anything after seq N?" and the server answers as soon as there is,
// or after ~25s with nothing. Works identically on localhost and through any tunnel or proxy.
import type { ServerResponse } from 'node:http';

export interface HubEvent {
  seq: number;
  event: string;
  data: unknown;
}

interface Waiter {
  after: number;
  res: ServerResponse;
  timer: NodeJS.Timeout;
}

const KEEP_PER_TOPIC = 100;
const WAIT_MS = 25_000;

export class Hub {
  private seq = 0;
  private buffers = new Map<string, HubEvent[]>();
  private waiters = new Map<string, Set<Waiter>>();

  /** Latest sequence number; clients start polling from here so they don't replay old events. */
  get cursor(): number {
    return this.seq;
  }

  publish(topic: string, event: string, data: unknown): void {
    const e: HubEvent = { seq: ++this.seq, event, data };
    const buf = this.buffers.get(topic) ?? [];
    buf.push(e);
    if (buf.length > KEEP_PER_TOPIC) buf.splice(0, buf.length - KEEP_PER_TOPIC);
    this.buffers.set(topic, buf);
    const ws = this.waiters.get(topic);
    if (ws) for (const w of [...ws]) this.flush(topic, w);
  }

  /** Answer with events after `after`, now or when one arrives (max ~25s). */
  poll(topic: string, after: number, res: ServerResponse): void {
    const w: Waiter = { after, res, timer: setTimeout(() => this.flush(topic, w, true), WAIT_MS) };
    const pending = (this.buffers.get(topic) ?? []).some((e) => e.seq > after);
    let set = this.waiters.get(topic);
    if (!set) this.waiters.set(topic, (set = new Set()));
    set.add(w);
    res.on('close', () => this.drop(topic, w));
    if (pending) this.flush(topic, w);
  }

  private flush(topic: string, w: Waiter, timeout = false): void {
    const events = (this.buffers.get(topic) ?? []).filter((e) => e.seq > w.after);
    if (!events.length && !timeout) return;
    this.drop(topic, w);
    if (w.res.writableEnded) return;
    w.res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    w.res.end(JSON.stringify({ cursor: this.seq, events }));
  }

  private drop(topic: string, w: Waiter): void {
    clearTimeout(w.timer);
    const set = this.waiters.get(topic);
    set?.delete(w);
    if (set && set.size === 0) this.waiters.delete(topic);
  }

  count(): number {
    let n = 0;
    for (const s of this.waiters.values()) n += s.size;
    return n;
  }
}
