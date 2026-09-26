// Auto-registers players as Photon Spectrum project users so their phone can text the agent.
// Uses the Photon dashboard API with the CLI login stored on this laptop (`npx @photon-ai/cli login`),
// or PHOTON_TOKEN if set. Registration must happen BEFORE the player texts, otherwise Photon auto-replies
// "unrecognized".
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = 'https://app.photon.codes';
const MAX_CONCURRENT = 3;

export interface PhotonUser {
  id: string;
  phoneNumber?: string;
  assignedPhoneNumber?: string;
  firstName?: string;
}

export class RegistrationError extends Error {
  readonly code: 'bad_phone' | 'not_logged_in' | 'full' | 'no_line' | 'photon_error';
  constructor(code: RegistrationError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** "+1 (555) 123-4567" → "+15551234567". Requires a country code. */
export function normalizePhone(input: string): string | null {
  const s = input.trim().replace(/[\s().-]/g, '');
  const m = s.match(/^(?:\+|00)(\d{7,15})$/);
  return m ? `+${m[1]}` : null;
}

const digits = (p?: string) => (p ?? '').replace(/\D/g, '');

export class PhotonUsers {
  readonly projectId: string;
  readonly limit: number;
  private cache: { at: number; users: PhotonUser[] } | null = null;
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(projectId: string, limit = 100) {
    this.projectId = projectId;
    this.limit = limit;
  }

  private token(): string | null {
    if (process.env.PHOTON_TOKEN) return process.env.PHOTON_TOKEN;
    const dir = process.env.PHOTON_CONFIG_DIR ?? join(homedir(), '.config', 'photon');
    const file = join(dir, 'credentials', 'production.json');
    if (!existsSync(file)) return null;
    try {
      return (JSON.parse(readFileSync(file, 'utf8')) as { accessToken?: string }).accessToken ?? null;
    } catch {
      return null;
    }
  }

  private async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const token = this.token();
    if (!token) throw new RegistrationError('not_logged_in', 'Photon CLI is not logged in on this laptop');
    const res = await fetch(`${API}/api/projects/${this.projectId}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    if (res.status === 401 || res.status === 403) throw new RegistrationError('not_logged_in', `Photon API ${res.status}: log in again`);
    if (!res.ok || (json && typeof json.error === 'string')) {
      const msg = typeof json?.error === 'string' ? json.error : json?.error?.message ?? json?.message ?? `HTTP ${res.status}`;
      const code = json?.error?.code ?? json?.code;
      if (code === 'shared_line_unavailable') throw new RegistrationError('no_line', msg);
      if (/limit|maximum|seat|quota|upgrade/i.test(String(msg))) throw new RegistrationError('full', msg);
      throw new RegistrationError('photon_error', String(msg));
    }
    return json;
  }

  async list(fresh = false): Promise<PhotonUser[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 10_000) return this.cache.users;
    const json = await this.api('GET', '/spectrum/users');
    const users: PhotonUser[] = Array.isArray(json) ? json : (json?.users ?? []);
    this.cache = { at: Date.now(), users };
    return users;
  }

  /** Is the CLI login usable, and how many seats are taken? */
  async status(): Promise<{ ok: boolean; users: number; limit: number; error?: string }> {
    try {
      const users = await this.list(); // cached ~10s: the host console asks every few seconds
      return { ok: true, users: users.length, limit: this.limit };
    } catch (err) {
      return { ok: false, users: 0, limit: this.limit, error: (err as Error).message };
    }
  }

  private async gate<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>((r) => this.queue.push(r));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  /**
   * Make sure this phone is a project user and return the number it should text.
   * Reuses an existing registration (never delete + re-add: that changes the assigned number).
   */
  register(phoneInput: string, nickname: string): Promise<{ assignedNumber: string; created: boolean }> {
    const phone = normalizePhone(phoneInput);
    if (!phone) return Promise.reject(new RegistrationError('bad_phone', 'phone number needs a country code, e.g. +1 555 123 4567'));
    return this.gate(async () => {
      const find = (users: PhotonUser[]) => users.find((u) => digits(u.phoneNumber) === digits(phone));
      let user = find(await this.list(true));
      let created = false;
      if (!user) {
        if ((this.cache?.users.length ?? 0) >= this.limit) throw new RegistrationError('full', `project is full (${this.limit} users)`);
        const hash = createHash('sha256').update(phone).digest('hex').slice(0, 12);
        const res = await this.api('POST', '/spectrum/users', {
          firstName: nickname.slice(0, 40) || 'Crew',
          lastName: 'Player',
          // Photon requires an email; we don't collect one from players.
          email: `player-${hash}@example.com`,
          phoneNumber: phone,
          sendInvite: false,
        });
        created = true;
        user = res?.user ?? res;
        console.log(`[photon-users] registered a new player (${(this.cache?.users.length ?? 0) + 1}/${this.limit})`);
      }
      // The shared line can take a moment to be assigned.
      for (let i = 0; i < 8 && !user?.assignedPhoneNumber; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        user = find(await this.list(true)) ?? user;
      }
      if (!user?.assignedPhoneNumber) throw new RegistrationError('no_line', 'Photon did not assign a number yet');
      return { assignedNumber: user.assignedPhoneNumber, created };
    });
  }
}
