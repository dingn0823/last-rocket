// Minimal Gemini REST client: JSON-only responses, hard timeouts, rate-limit backoff.

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export class Gemini {
  readonly key: string;
  readonly model: string;
  limitedUntil = 0;

  constructor(key: string, model: string) {
    this.key = key;
    this.model = model;
  }

  get enabled(): boolean {
    return this.key.length > 0;
  }

  /** False when there's no key or we were rate-limited in the last minute. */
  get available(): boolean {
    return this.enabled && Date.now() >= this.limitedUntil;
  }

  get rateLimited(): boolean {
    return this.enabled && Date.now() < this.limitedUntil;
  }

  /** Returns parsed JSON, or null on any failure (timeout, HTTP error, bad JSON). Never throws. */
  async json(parts: Part[], timeoutMs: number): Promise<unknown | null> {
    if (!this.available) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        this.limitedUntil = Date.now() + 60_000;
        console.warn('[ai] rate limited; falling back to numbered options for 60s');
        return null;
      }
      if (!res.ok) {
        console.warn(`[ai] HTTP ${res.status}`);
        return null;
      }
      const body: any = await res.json();
      const text: unknown = body?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') return null;
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch (err) {
      console.warn(`[ai] ${(err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message}`);
      return null;
    }
  }
}
