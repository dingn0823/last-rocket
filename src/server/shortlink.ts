// Keeps a fixed short link (GitHub Pages, e.g. https://<user>.github.io/moon) pointing at the current tunnel.
// The Pages site is shortlink/index.html, which reads url.json; we only rewrite url.json.
import { execFileSync } from 'node:child_process';

function githubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true }).trim() || null;
  } catch {
    return null;
  }
}

/** Point `repo`'s url.json at `url`. Returns true if the link now points there. Never throws. */
export async function updateShortlink(repo: string, url: string): Promise<boolean> {
  const token = githubToken();
  if (!token) {
    console.warn('[shortlink] no GitHub token (run `gh auth login` or set GITHUB_TOKEN)');
    return false;
  }
  const api = `https://api.github.com/repos/${repo}/contents/url.json`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'last-rocket' };
  try {
    const cur = await fetch(api, { headers, signal: AbortSignal.timeout(15_000) });
    const existing = cur.ok ? ((await cur.json()) as { sha: string; content: string }) : null;
    if (existing && Buffer.from(existing.content, 'base64').toString('utf8').includes(`"${url}"`)) return true;
    const body = JSON.stringify({ url, updatedAt: new Date().toISOString() });
    const res = await fetch(api, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message: `Point short link at ${url}`, content: Buffer.from(body).toString('base64'), sha: existing?.sha }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[shortlink] GitHub API ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[shortlink] update failed:', (err as Error).message);
    return false;
  }
}
