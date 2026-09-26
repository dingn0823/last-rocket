// Verify that we can send an iMessage proactively (no inbound message to reply to).
// Sends one test message to the most recent iMessage player in data/players.json.
//   node scripts/photon-probe.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';

const root = join(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const players = JSON.parse(readFileSync(join(root, 'data', 'players.json'), 'utf8')) as { address: string; channel: string }[];
const target = players.filter((p) => p.channel === 'imessage').pop();
if (!target) throw new Error('no iMessage player yet: text the project number first');

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
  options: { logLevel: 'warn' },
});
const space = await imessage(app).space.create(target.address);
const t0 = Date.now();
await space.send('📡 （测试）这是一条程序主动发送的消息，不用回复。');
await space.send('📡 （测试）第二条，确认可以连续主动发送。');
console.log(`proactive send ok: 2 messages in ${Date.now() - t0} ms`);
await app.stop();
