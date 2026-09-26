import type { Outbound } from '../engine/types.ts';

/** A message coming in from any channel (web simulator now, Photon iMessage later). */
export interface Inbound {
  channel: string;
  /** Stable player address on that channel (phone number handle, sim id...). */
  address: string;
  /** Channel-level message id, used for de-duplication. */
  msgId: string;
  text?: string;
  image?: { path: string; url: string; mime: string };
}

export interface Channel {
  readonly name: string;
  /** Deliver engine output to the player. Must not throw into game logic. */
  send(address: string, msgs: Outbound[]): Promise<void>;
  /** Optional "typing..." indicator. */
  typing?(address: string): Promise<void>;
  /** Optional hook when a new run (and bridge link) is created for this player. */
  runStarted?(address: string, info: { runId: string; bridgeUrl: string }): Promise<void>;
}
