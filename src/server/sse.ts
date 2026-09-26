import type { ServerResponse } from 'node:http';

/** Tiny SSE pub/sub keyed by topic ("sim:<address>", "bridge:<token>"). */
export class Hub {
  private topics = new Map<string, Set<ServerResponse>>();

  constructor() {
    // Keep connections alive through tunnels / proxies.
    setInterval(() => {
      for (const set of this.topics.values()) for (const res of set) res.write(': ping\n\n');
    }, 20_000).unref();
  }

  subscribe(topic: string, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    let set = this.topics.get(topic);
    if (!set) this.topics.set(topic, (set = new Set()));
    set.add(res);
    res.on('close', () => {
      set!.delete(res);
      if (set!.size === 0) this.topics.delete(topic);
    });
  }

  publish(topic: string, event: string, data: unknown): void {
    const set = this.topics.get(topic);
    if (!set) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(payload);
  }

  count(): number {
    let n = 0;
    for (const s of this.topics.values()) n += s.size;
    return n;
  }
}
