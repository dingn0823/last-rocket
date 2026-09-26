// Cloudflare quick tunnel: free, no account. Gives https://<random>.trycloudflare.com → localhost.
// The URL changes on every start, so we read it from cloudflared's log and hand it to the game.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findCloudflared(root: string): string | null {
  const local = join(root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(local)) return local;
  return process.env.CLOUDFLARED_PATH && existsSync(process.env.CLOUDFLARED_PATH) ? process.env.CLOUDFLARED_PATH : null;
}

/** Starts the tunnel and calls onUrl every time a (new) public URL is ready. Restarts it if it dies. */
export function startTunnel(bin: string, port: number, onUrl: (url: string) => void): { stop(): void } {
  let child: ChildProcess | null = null;
  let stopped = false;
  let restarts = 0;

  const launch = () => {
    child = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let found = false;
    const scan = (chunk: Buffer) => {
      if (found) return;
      const m = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        found = true;
        restarts = 0;
        onUrl(m[0]);
      }
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('exit', (code) => {
      if (stopped) return;
      const delay = Math.min(30_000, 2000 * 2 ** restarts++);
      console.warn(`[tunnel] cloudflared exited (${code}); restarting in ${delay / 1000}s`);
      setTimeout(launch, delay);
    });
  };
  launch();

  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}
