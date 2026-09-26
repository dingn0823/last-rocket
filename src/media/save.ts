// Save an incoming player photo into data/media, converting HEIC to JPEG first.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeImage } from './image.ts';

const RAW_EXT: Record<string, string> = { 'image/heic': '.heic', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

export async function saveImage(mediaDir: string, buf: Buffer, mime: string): Promise<{ path: string; url: string; mime: string }> {
  let out = { buf, mime, ext: RAW_EXT[mime] ?? '.bin' };
  try {
    const t = Date.now();
    const n = await normalizeImage(buf, mime);
    if (n.converted) console.log(`[media] ${mime} → ${n.mime} in ${Date.now() - t}ms (${(buf.length / 1024) | 0}KB → ${(n.buf.length / 1024) | 0}KB)`);
    out = n;
  } catch (err) {
    // Gemini can still read the original HEIC; only the web views lose the picture.
    console.warn(`[media] could not convert ${mime}; keeping the original:`, (err as Error).message);
  }
  const name = `${randomBytes(12).toString('base64url')}${out.ext}`;
  writeFileSync(join(mediaDir, name), out.buf);
  return { path: join(mediaDir, name), url: `/media/${name}`, mime: out.mime };
}
