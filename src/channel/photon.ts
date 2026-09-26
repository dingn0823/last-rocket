// Photon Spectrum iMessage channel. Inbound iMessages → Inbound; engine Outbound → iMessage bubbles.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Spectrum } from 'spectrum-ts';
import { effect, imessage } from 'spectrum-ts/providers/imessage';
import type { Outbound } from '../engine/types.ts';
import type { Channel, Inbound } from './types.ts';

/** Full-screen iMessage effect per game fx. */
const FX_EFFECT: Record<string, keyof typeof imessage.effect.message> = {
  launch: 'lasers',
  combo: 'fireworks',
  legendary: 'sparkles',
  shield: 'slam',
  landing: 'confetti',
  drift: 'spotlight',
  crash: 'gentle',
};

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heic', 'image/heic-sequence': '.heic',
};

export interface PhotonOptions {
  projectId: string;
  projectSecret: string;
  mediaDir: string;
  /** Called for every usable inbound message. Not awaited, so one slow player never blocks the others. */
  onInbound: (msg: Inbound) => unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PhotonChannel implements Channel {
  readonly name = 'imessage';
  readonly opts: PhotonOptions;
  private app: any = null;
  private spaces = new Map<string, any>();
  /** What we've seen so far; logged so we can verify photo formats and multi-send on real devices. */
  stats = { inbound: 0, sent: 0, sendErrors: 0, photos: {} as Record<string, number> };

  constructor(opts: PhotonOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.app = await Spectrum({
      projectId: this.opts.projectId,
      projectSecret: this.opts.projectSecret,
      providers: [imessage.config()],
      options: { logLevel: 'warn' },
    });
    console.log(`[photon] connected to Spectrum project "${this.app.config?.name ?? this.opts.projectId}"`);
    void this.loop();
  }

  async stop(): Promise<void> {
    await this.app?.stop?.();
  }

  private async loop(): Promise<void> {
    for await (const [space, message] of this.app.messages) {
      try {
        await this.onMessage(space, message);
      } catch (err) {
        console.error('[photon] inbound error:', err);
      }
    }
  }

  private async onMessage(space: any, message: any): Promise<void> {
    const address: string | undefined = message.sender?.id;
    if (!address || space?.type === 'group') return;
    let content = message.content;
    if (content?.type === 'reply') content = content.content;
    const parts: any[] = content?.type === 'group' ? content.items.map((i: any) => i.content) : [content];

    const texts: string[] = [];
    let photo: any = null;
    for (const p of parts) {
      if (p?.type === 'text' && p.text?.trim()) texts.push(p.text.trim());
      else if (p?.type === 'attachment' && String(p.mimeType ?? '').startsWith('image/') && !photo) photo = p;
      else if (p?.type === 'poll_option' && p.selected) texts.push(String(p.title ?? p.option?.title ?? ''));
    }
    // Reactions, read receipts, stickers, etc. are not game input.
    if (!texts.length && !photo) return;

    this.spaces.set(address, space);
    this.stats.inbound += 1;

    let image: Inbound['image'];
    if (photo) {
      const buf: Buffer = await photo.read();
      const mime = String(photo.mimeType).toLowerCase();
      this.stats.photos[mime] = (this.stats.photos[mime] ?? 0) + 1;
      console.log(`[photon] photo received: mime=${mime} name=${photo.name} size=${(buf.length / 1024).toFixed(0)}KB`);
      const ext = IMAGE_EXT[mime] ?? '.bin';
      const file = `${randomBytes(12).toString('base64url')}${ext}`;
      writeFileSync(join(this.opts.mediaDir, file), buf);
      image = { path: join(this.opts.mediaDir, file), url: `/media/${file}`, mime: mime === 'image/heif' ? 'image/heic' : mime };
    }
    void this.opts.onInbound({ channel: this.name, address, msgId: String(message.id), text: texts.join('\n') || undefined, image });
  }

  private async spaceFor(address: string): Promise<any> {
    let space = this.spaces.get(address);
    if (!space) {
      // Proactive send to someone we haven't heard from since restart.
      space = await imessage(this.app).space.create(address);
      this.spaces.set(address, space);
    }
    return space;
  }

  async typing(address: string): Promise<void> {
    const space = await this.spaceFor(address);
    await space.startTyping?.().catch(() => {});
  }

  async send(address: string, msgs: Outbound[]): Promise<void> {
    if (!this.app) throw new Error('Photon channel not started');
    const space = await this.spaceFor(address);
    try {
      for (const m of msgs) {
        const content = render(m);
        if (content === null) continue;
        await space.startTyping?.().catch(() => {});
        await sleep(m.t === 'text' ? Math.min(300 + m.text.length * 6, 1200) : 500);
        await space.send(content);
        this.stats.sent += 1;
      }
    } catch (err) {
      this.stats.sendErrors += 1;
      throw err;
    } finally {
      await space.stopTyping?.().catch(() => {});
    }
  }
}

/** Engine output → iMessage content. Text-only for now; cards and scenes become images later. */
function render(m: Outbound): any {
  switch (m.t) {
    case 'text':
      return m.text;
    case 'scene':
      return `${m.icon} ${m.title}`;
    case 'gear_card': {
      const c = m.card;
      return [`${c.icon} ${c.name}`, c.subtitle, c.effectText, c.blurb ? `“${c.blurb}”` : ''].filter(Boolean).join('\n');
    }
    case 'fx': {
      const name = FX_EFFECT[m.fx];
      const label = m.text && !m.label.includes(m.text) ? `${m.label} · ${m.text}` : m.label;
      return name ? effect(label, imessage.effect.message[name]) : label;
    }
    case 'report': {
      const r = m.report;
      const lines = [`🏁 ${r.title} · 🏆 ${r.score}`, `⛽ ${r.res.fuel} · 🫁 ${r.res.oxygen} · 🛠️ ${r.res.hull}`];
      if (r.item) {
        const same = r.item.label.trim().toLowerCase() === r.item.name.trim().toLowerCase();
        lines.push(`${r.item.icon} ${same ? '' : `${r.item.label} → `}${r.item.name} ${r.item.status === 'kept' ? '✅' : '💔'}`);
      }
      if (r.upgrades.length) lines.push(`🧰 ${r.upgrades.map((u) => `${u.icon} ${u.name}`).join(' · ')}`);
      if (r.combos.length) lines.push(`⚡ ${r.combos.map((k) => `${k.icon} ${k.name}`).join(' · ')}`);
      return lines.join('\n');
    }
  }
  return null;
}
