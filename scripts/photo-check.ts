// Classify the newest photo in data/media with the real Gemini, in both languages.
//   node scripts/photo-check.ts [path]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { AI } from '../src/ai/ai.ts';
import { Gemini } from '../src/ai/gemini.ts';
import { loadAllContent } from '../src/engine/content.ts';

const root = join(import.meta.dirname, '..');
process.loadEnvFile(join(root, '.env'));
const dir = join(root, 'data', 'media');
const file = process.argv[2] ?? join(dir, readdirSync(dir).sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)[0]);
const mime = { '.heic': 'image/heic', '.png': 'image/png' }[extname(file).toLowerCase()] ?? 'image/jpeg';
const contents = loadAllContent(join(root, 'content'));
const ai = new AI(new Gemini(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_MODEL));
const image = { base64: readFileSync(file).toString('base64'), mime };
for (const lang of ['zh', 'en'] as const) {
  const r = await ai.classifyPhoto(contents[lang], image);
  console.log(lang, JSON.stringify(r));
}
