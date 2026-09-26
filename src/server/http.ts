// Web server: static pages, phone-simulator API, bridge API, SSE.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize as normPath, resolve, sep } from 'node:path';
import type { GameService } from '../game/service.ts';
import type { Hub } from './sse.ts';

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

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heic',
};

const MAX_BODY = 14 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
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

export function createHttpServer(game: GameService, hub: Hub, webDir: string): Server {
  const mediaDir = game.store.mediaDir;

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const path = url.pathname;

      // ---------- pages ----------
      if (req.method === 'GET' && path === '/') return serveFile(res, join(webDir, 'index.html'));
      if (req.method === 'GET' && path === '/phone') return serveFile(res, join(webDir, 'phone.html'));
      if (req.method === 'GET' && /^\/bridge\/[\w-]+$/.test(path)) return serveFile(res, join(webDir, 'bridge.html'));
      if (req.method === 'GET' && path.startsWith('/static/')) {
        const file = resolve(webDir, normPath(decodeURIComponent(path.slice('/static/'.length))));
        if (!file.startsWith(resolve(webDir) + sep)) return send(res, 404, { error: 'not found' });
        return serveFile(res, file);
      }
      if (req.method === 'GET' && /^\/media\/[\w-]+\.\w+$/.test(path)) return serveFile(res, join(mediaDir, path.slice('/media/'.length)));

      // ---------- phone simulator ----------
      if (req.method === 'POST' && path === '/api/sim/new') {
        const body = await readJson(req);
        const nickname = typeof body.nickname === 'string' && body.nickname.trim() ? body.nickname.trim().slice(0, 24) : 'Crew';
        const address = `sim-${randomBytes(9).toString('base64url')}`;
        game.ensurePlayer('sim', address, nickname);
        return send(res, 200, { address });
      }
      if (req.method === 'GET' && path === '/api/sim/history') {
        const address = url.searchParams.get('address') ?? '';
        if (!game.store.getPlayer(address)) return send(res, 404, { error: 'unknown player' });
        const rec = game.currentRun(address);
        return send(res, 200, {
          transcript: rec?.transcript ?? [],
          bridgeUrl: rec ? game.bridgeUrl(rec.bridgeToken) : null,
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
          const ext = m ? IMAGE_EXT[m[1]] : undefined;
          if (!m || !ext) return send(res, 400, { error: 'unsupported image' });
          // TODO(P0 for Photon): convert HEIC to JPEG here so the bridge can display it.
          const name = `${randomBytes(12).toString('base64url')}${ext}`;
          writeFileSync(join(mediaDir, name), Buffer.from(m[2], 'base64'));
          image = { path: join(mediaDir, name), url: `/media/${name}`, mime: m[1] === 'image/heif' ? 'image/heic' : m[1] };
        }
        const text = typeof body.text === 'string' ? body.text.slice(0, 500) : undefined;
        if (!text && !image) return send(res, 400, { error: 'empty message' });
        void game.handleInbound({ channel: 'sim', address, msgId, text, image });
        return send(res, 202, { ok: true, imageUrl: image?.url });
      }
      if (req.method === 'GET' && path === '/api/sim/stream') {
        const address = url.searchParams.get('address') ?? '';
        if (!game.store.getPlayer(address)) return send(res, 404, { error: 'unknown player' });
        return hub.subscribe(`sim:${address}`, res);
      }

      // ---------- bridge ----------
      const bridge = path.match(/^\/api\/bridge\/([\w-]+)(\/stream)?$/);
      if (req.method === 'GET' && bridge) {
        const rec = game.store.runByToken(bridge[1]);
        if (!rec) return send(res, 404, { error: 'unknown bridge' });
        if (bridge[2]) return hub.subscribe(`bridge:${bridge[1]}`, res);
        const recent = rec.transcript.filter((e) => e.dir === 'out').slice(-40).map((e) => e.msg);
        return send(res, 200, { snapshot: game.snapshotFor(rec), recent });
      }

      if (req.method === 'GET' && path === '/api/health') {
        return send(res, 200, {
          ok: true,
          ai: game.ai.gemini.enabled ? (game.ai.rateLimited ? 'rate-limited' : 'on') : 'off (keyword mode)',
          eventMode: game.eventMode,
          sseClients: hub.count(),
        });
      }

      send(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    }
  });
}
