// Web server: pages, join flow, phone-simulator API, bridge API, host console, long-poll updates.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize as normPath, resolve, sep } from 'node:path';
import QRCode from 'qrcode';
import { RegistrationError, type PhotonUsers } from '../channel/photon-users.ts';
import { joinText } from '../game/join.ts';
import type { GameService } from '../game/service.ts';
import { saveImage } from '../media/save.ts';
import type { Hub } from './hub.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.json': 'application/json',
};

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const MAX_BODY = 14 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(res: ServerResponse, path: string): void {
  if (!existsSync(path)) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(path));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/** Requests that come through the tunnel carry Cloudflare/proxy headers; the host console is laptop-only. */
function isLocal(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? '';
  const proxied = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['cf-ray'];
  return !proxied && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
}

function clientIp(req: IncomingMessage): string {
  return String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '?');
}

/** Join-page registrations allowed from one address per 10 minutes. As many as the Photon seats on purpose:
 *  the whole event can reach us through one shared campus Wi-Fi address, and the seat cap bounds abuse. */
export const JOINS_PER_IP = 100;

const after = (url: URL) => Number(url.searchParams.get('after') ?? 0) || 0;

export interface HttpDeps {
  game: GameService;
  hub: Hub;
  webDir: string;
  photonUsers: PhotonUsers | null;
  /** iMessage connection, if configured. */
  imessage?: { status: string; lastError: string } | null;
}

export function createHttpServer({ game, hub, webDir, photonUsers, imessage }: HttpDeps): Server {
  const imessageStatus = () => (imessage ? { status: imessage.status, error: imessage.lastError || null } : { status: 'off', error: null });
  const mediaDir = game.store.mediaDir;
  const joinsByIp = new Map<string, number[]>();

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const path = url.pathname;
      const get = req.method === 'GET';

      // ---------- pages ----------
      if (get && path === '/') return serveFile(res, join(webDir, 'index.html'));
      if (get && path === '/join') return serveFile(res, join(webDir, 'join.html'));
      // Links pasted from chats often drag punctuation along ("/join**；…"): send them to the real page.
      if (get && path.startsWith('/join') && !path.startsWith('/join/')) {
        res.writeHead(302, { location: '/join' });
        return res.end();
      }
      if (get && path === '/phone') return serveFile(res, join(webDir, 'phone.html'));
      if (get && path === '/screen') return serveFile(res, join(webDir, 'screen.html'));
      if (get && /^\/bridge\/[\w-]+$/.test(path)) return serveFile(res, join(webDir, 'bridge.html'));
      if (get && path === '/host') {
        if (!isLocal(req)) return send(res, 403, { error: 'host console is only available on the host laptop' });
        return serveFile(res, join(webDir, 'host.html'));
      }
      if (get && path.startsWith('/static/')) {
        const file = resolve(webDir, normPath(decodeURIComponent(path.slice('/static/'.length))));
        if (!file.startsWith(resolve(webDir) + sep)) return send(res, 404, { error: 'not found' });
        return serveFile(res, file);
      }
      if (get && /^\/media\/[\w-]+\.\w+$/.test(path)) return serveFile(res, join(mediaDir, path.slice('/media/'.length)));
      if (get && path === '/api/ui') return serveFile(res, join(webDir, '..', 'content', 'ui.json'));

      if (get && path === '/api/qr') {
        const text = (url.searchParams.get('text') ?? '').slice(0, 300);
        if (!text) return send(res, 400, { error: 'missing text' });
        const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' });
        return res.end(svg);
      }

      // ---------- join: computer page ↔ phone pairing ----------
      if (req.method === 'POST' && path === '/api/join') {
        const body = await readJson(req);
        const nickname = String(body.nickname ?? '').trim().slice(0, 24);
        const lang = body.lang === 'zh' ? 'zh' : 'en';
        if (!nickname) return send(res, 400, { error: 'bad_nickname' });
        if (!photonUsers) return send(res, 503, { error: 'registration_unavailable' });
        const ip = clientIp(req);
        const recent = (joinsByIp.get(ip) ?? []).filter((t) => t > Date.now() - 10 * 60_000);
        if (recent.length >= JOINS_PER_IP) return send(res, 429, { error: 'too_many' });
        joinsByIp.set(ip, [...recent, Date.now()]);
        try {
          const { assignedNumber } = await photonUsers.register(String(body.phone ?? ''), nickname);
          const j = game.joins.create({ nickname, lang, assignedNumber });
          const text = joinText(lang, j.code);
          return send(res, 200, {
            token: j.token,
            code: j.code,
            number: assignedNumber,
            text,
            // iOS camera understands SMSTO: in QR codes; the button uses the sms: URL scheme.
            qr: `/api/qr?text=${encodeURIComponent(`SMSTO:${assignedNumber}:${text}`)}`,
            sms: `sms:${assignedNumber}&body=${encodeURIComponent(text)}`,
            cursor: hub.cursor,
          });
        } catch (err) {
          const code = err instanceof RegistrationError ? err.code : 'photon_error';
          console.warn(`[join] registration failed (${code}): ${(err as Error).message}`);
          return send(res, code === 'bad_phone' ? 400 : 503, { error: code });
        }
      }
      const joinRoute = path.match(/^\/api\/join\/([\w-]+)(\/poll)?$/);
      if (get && joinRoute) {
        const j = game.joins.get(joinRoute[1]);
        if (!j) return send(res, 404, { error: 'unknown join' });
        if (joinRoute[2]) return hub.poll(`join:${j.token}`, after(url), res);
        return send(res, 200, { paired: j.pairedPath ?? null, cursor: hub.cursor });
      }

      // ---------- phone simulator ----------
      if (req.method === 'POST' && path === '/api/sim/new') {
        const body = await readJson(req);
        const nickname = typeof body.nickname === 'string' && body.nickname.trim() ? body.nickname.trim().slice(0, 24) : 'Crew';
        const address = `sim-${randomBytes(9).toString('base64url')}`;
        game.ensurePlayer('sim', address, nickname);
        return send(res, 200, { address });
      }
      if (get && path === '/api/sim/history') {
        const address = url.searchParams.get('address') ?? '';
        if (!game.store.getPlayer(address)) return send(res, 404, { error: 'unknown player' });
        const rec = game.currentRun(address);
        return send(res, 200, {
          transcript: rec?.transcript ?? [],
          bridgeUrl: rec ? game.bridgePath(rec.bridgeToken) : null,
          lang: rec?.state.lang ?? null,
          cursor: hub.cursor,
        });
      }
      if (req.method === 'POST' && path === '/api/sim/message') {
        const body = await readJson(req);
        const address = String(body.address ?? '');
        if (!game.store.getPlayer(address)) return send(res, 404, { error: 'unknown player' });
        const msgId = typeof body.msgId === 'string' && body.msgId ? body.msgId.slice(0, 64) : randomBytes(8).toString('hex');
        let image: { path: string; url: string; mime: string } | undefined;
        if (typeof body.image === 'string') {
          const m = body.image.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/);
          if (!m || !IMAGE_MIME.has(m[1])) return send(res, 400, { error: 'unsupported image' });
          image = await saveImage(mediaDir, Buffer.from(m[2], 'base64'), m[1] === 'image/heif' ? 'image/heic' : m[1]);
        }
        const text = typeof body.text === 'string' ? body.text.slice(0, 500) : undefined;
        if (!text && !image) return send(res, 400, { error: 'empty message' });
        void game.handleInbound({ channel: 'sim', address, msgId, text, image });
        return send(res, 202, { ok: true, imageUrl: image?.url });
      }
      if (get && path === '/api/sim/poll') {
        const address = url.searchParams.get('address') ?? '';
        if (!game.store.getPlayer(address)) return send(res, 404, { error: 'unknown player' });
        return hub.poll(`sim:${address}`, after(url), res);
      }

      // ---------- bridge ----------
      const bridge = path.match(/^\/api\/bridge\/([\w-]+)(\/poll)?$/);
      if (get && bridge) {
        const rec = game.store.runByToken(bridge[1]);
        if (!rec) return send(res, 404, { error: 'unknown bridge' });
        if (bridge[2]) return hub.poll(`bridge:${bridge[1]}`, after(url), res);
        const recent = rec.transcript.filter((e) => e.dir === 'out').slice(-40).map((e) => e.msg);
        // A newer run by the same player: tell the page to move on.
        const current = game.currentRun(rec.address);
        const next = current && current.state.runId !== rec.state.runId ? game.bridgePath(current.bridgeToken) : null;
        return send(res, 200, { snapshot: game.snapshotFor(rec), recent, next, round: game.rounds.snapshot(), cursor: hub.cursor });
      }

      // ---------- big screen (read-only: nicknames and gear, never photos) ----------
      if (get && path === '/api/screen/state') {
        return send(res, 200, {
          ...game.screenState(url.searchParams.get('sim') === '1' || game.screenIncludesSim),
          stageNames: game.contents.en.stages.map((s) => s.name),
          joinUrl: `${game.publicUrl || 'http://localhost:' + (req.socket.localPort ?? 3000)}/join`,
          shortUrl: game.shortUrl || null,
          cursor: hub.cursor,
        });
      }
      if (get && path === '/api/screen/poll') return hub.poll('screen', after(url), res);

      // ---------- host console (laptop only) ----------
      if (req.method === 'POST' && path === '/api/host/rounds') {
        if (!isLocal(req)) return send(res, 403, { error: 'forbidden' });
        const body = await readJson(req);
        if (body.action === 'auto') game.rounds.setEnabled(true);
        else if (body.action === 'off') game.rounds.setEnabled(false);
        else if (body.action === 'launch') game.rounds.launchNow();
        else if (body.action === 'end') game.rounds.endNow();
        console.log(`[host] rounds: ${body.action} → ${game.rounds.phase}`);
        return send(res, 200, game.rounds.snapshot());
      }
      if (req.method === 'POST' && path === '/api/host/clear-screen') {
        if (!isLocal(req)) return send(res, 403, { error: 'forbidden' });
        game.clearScreen();
        console.log('[host] big screen cleared');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/host/event-mode') {
        if (!isLocal(req)) return send(res, 403, { error: 'forbidden' });
        const body = await readJson(req);
        game.eventMode = !!body.on;
        console.log(`[host] event mode ${game.eventMode ? 'ON: numbered options, no AI parsing' : 'OFF: free text'}`);
        return send(res, 200, { eventMode: game.eventMode });
      }
      if (get && path === '/api/host/state') {
        if (!isLocal(req)) return send(res, 403, { error: 'forbidden' });
        const runs = game.store.allRuns()
          .filter((r) => r.state.phase !== 'new')
          .sort((a, b) => b.state.updatedAt - a.state.updatedAt)
          .slice(0, 60)
          .map((r) => ({
            nickname: game.store.getPlayer(r.address)?.nickname ?? 'Crew',
            channel: r.channel,
            lang: r.state.lang,
            stage: r.state.stage,
            phase: r.state.phase,
            ending: r.state.ending,
            res: r.state.res,
            updatedAt: r.state.updatedAt,
            current: game.store.getPlayer(r.address)?.currentRunId === r.state.runId,
            bridge: game.bridgePath(r.bridgeToken),
          }));
        return send(res, 200, {
          publicUrl: game.publicUrl || null,
          shortUrl: game.shortUrl || null,
          joinUrl: `${game.publicUrl || 'http://localhost:' + (req.socket.localPort ?? 3000)}/join`,
          ai: game.ai.gemini.enabled ? (game.ai.rateLimited ? 'rate-limited' : 'on') : 'off',
          eventMode: game.eventMode,
          round: game.rounds.snapshot(),
          imessage: imessageStatus(),
          photon: photonUsers ? await photonUsers.status() : { ok: false, users: 0, limit: 0, error: 'iMessage is off' },
          runs,
        });
      }

      if (get && path === '/api/health') {
        return send(res, 200, {
          ok: true,
          ai: game.ai.gemini.enabled ? (game.ai.rateLimited ? 'rate-limited' : 'on') : 'off (keyword mode)',
          eventMode: game.eventMode,
          imessage: imessageStatus().status,
          waiting: hub.count(),
        });
      }

      send(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    }
  });
}
