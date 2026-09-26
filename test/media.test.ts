import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isHeic, MAX_SIDE, normalizeImage } from '../src/media/image.ts';

// No photos are committed to the repo; the HEIC test uses a real iPhone photo from data/media if one exists.
const mediaDir = join(import.meta.dirname, '..', 'data', 'media');
const heic = existsSync(mediaDir) ? readdirSync(mediaDir).find((f) => f.endsWith('.heic')) : undefined;

function jpegSize(buf: Buffer): { w: number; h: number } {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) return { w: 0, h: 0 };
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { w: 0, h: 0 };
}

describe('media', () => {
  it('HEIC → downscaled JPEG', { skip: heic ? false : 'no .heic in data/media' }, async () => {
    const src = readFileSync(join(mediaDir, heic!));
    assert.ok(isHeic('application/octet-stream', src), 'detected by file signature too');
    const out = await normalizeImage(src, 'image/heic');
    assert.equal(out.mime, 'image/jpeg');
    assert.equal(out.converted, true);
    assert.deepEqual([out.buf[0], out.buf[1]], [0xff, 0xd8], 'JPEG magic bytes');
    const { w, h } = jpegSize(out.buf);
    assert.ok(w > 0 && h > 0 && Math.max(w, h) <= MAX_SIDE, `size ${w}x${h}`);
  });

  it('other formats pass through untouched', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const out = await normalizeImage(png, 'image/png');
    assert.equal(out.converted, false);
    assert.equal(out.buf, png);
    assert.equal(isHeic('image/jpeg', png), false);
  });
});
