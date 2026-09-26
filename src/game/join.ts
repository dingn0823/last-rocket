// Pairs a computer (join page) with a phone: the page shows a QR that pre-fills "join 4821" / "加入 4821";
// when that text arrives over iMessage, the page is told which bridge to open.
import { randomBytes, randomInt } from 'node:crypto';
import type { Lang } from '../engine/text.ts';

export interface JoinRequest {
  token: string;
  code: string;
  nickname: string;
  lang: Lang;
  assignedNumber: string;
  createdAt: number;
  pairedPath?: string;
}

const TTL_MS = 30 * 60_000;
const PATTERN = /^\s*(?:join|加入)\s*#?\s*(\d{4})\s*$/i;

export class JoinRegistry {
  private byToken = new Map<string, JoinRequest>();
  private byCode = new Map<string, JoinRequest>();

  create(input: { nickname: string; lang: Lang; assignedNumber: string }): JoinRequest {
    this.expire();
    let code = '';
    do code = String(randomInt(1000, 10000));
    while (this.byCode.has(code));
    const j: JoinRequest = { ...input, token: randomBytes(12).toString('base64url'), code, createdAt: Date.now() };
    this.byToken.set(j.token, j);
    this.byCode.set(code, j);
    return j;
  }

  get(token: string): JoinRequest | undefined {
    return this.byToken.get(token);
  }

  /** If `text` is "join 1234" / "加入 1234" for a live join request, claim it. */
  claim(text: string | undefined): JoinRequest | undefined {
    const m = text?.match(PATTERN);
    if (!m) return undefined;
    this.expire();
    const j = this.byCode.get(m[1]);
    if (!j || j.pairedPath) return undefined;
    this.byCode.delete(m[1]);
    return j;
  }

  private expire(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [token, j] of this.byToken) {
      if (j.createdAt >= cutoff) continue;
      this.byToken.delete(token);
      if (this.byCode.get(j.code) === j) this.byCode.delete(j.code);
    }
  }
}

/** The text the phone should send, in the chosen language. */
export function joinText(lang: Lang, code: string): string {
  return `${lang === 'zh' ? '加入' : 'join'} ${code}`;
}
