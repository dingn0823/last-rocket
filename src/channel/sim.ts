// Web phone simulator channel: stands in for iMessage during development and as a demo fallback.
import type { Outbound } from '../engine/types.ts';
import type { Hub } from '../server/hub.ts';
import type { Channel } from './types.ts';

export class SimChannel implements Channel {
  readonly name = 'sim';
  readonly hub: Hub;

  constructor(hub: Hub) {
    this.hub = hub;
  }

  async send(address: string, msgs: Outbound[]): Promise<void> {
    this.hub.publish(`sim:${address}`, 'out', msgs);
  }

  async typing(address: string): Promise<void> {
    this.hub.publish(`sim:${address}`, 'typing', {});
  }

  async runStarted(address: string, info: { runId: string; bridgeUrl: string; lang: string }): Promise<void> {
    this.hub.publish(`sim:${address}`, 'run', info);
  }
}
