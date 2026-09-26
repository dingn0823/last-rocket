// Player photos → web-friendly JPEG. iPhones send HEIC, which browsers (and our bridge / card views) can't show.
// Pure JS (heic-decode + jpeg-js): no system libraries, works on Windows. Photos are also scaled down so
// Gemini uploads and bridge loads stay fast.
import decodeHeic from 'heic-decode';
import jpeg from 'jpeg-js';

export const MAX_SIDE = 1280;
const MAX_CONCURRENT = 2;
const HEIC = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function isHeic(mime: string, buf?: Buffer): boolean {
  if (HEIC.has(mime.toLowerCase())) return true;
  // "ftypheic" / "ftypmif1" etc. at byte 4, in case the MIME type was wrong.
  const brand = buf && buf.length > 12 ? buf.subarray(4, 12).toString('latin1') : '';
  return /^ftyp(heic|heix|hevc|mif1|msf1)$/.test(brand);
}

// ---------- simple concurrency gate: heavy decodes queue up instead of stalling the server ----------
let active = 0;
const waiting: (() => void)[] = [];
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/** Box-filter downscale of RGBA pixels by an integer factor. */
function downscale(data: Uint8ClampedArray | Uint8Array, width: number, height: number, factor: number) {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = Buffer.alloc(w * h * 4);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((y * factor + dy) * width + x * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

export interface NormalizedImage {
  buf: Buffer;
  mime: string;
  ext: string;
  converted: boolean;
}

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

/**
 * HEIC → downscaled JPEG. Other formats pass through untouched.
 * Throws if a HEIC file can't be decoded; callers treat that as a failed scan.
 */
export async function normalizeImage(buf: Buffer, mime: string): Promise<NormalizedImage> {
  if (!isHeic(mime, buf)) {
    const m = mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mime.toLowerCase();
    return { buf, mime: m, ext: EXT[m] ?? '.bin', converted: false };
  }
  return gate(async () => {
    const img = await decodeHeic({ buffer: buf });
    const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / MAX_SIDE));
    const px = factor > 1 ? downscale(img.data, img.width, img.height, factor) : { data: Buffer.from(img.data), width: img.width, height: img.height };
    const out = jpeg.encode(px, 85);
    return { buf: Buffer.from(out.data), mime: 'image/jpeg', ext: '.jpg', converted: true };
  });
}
