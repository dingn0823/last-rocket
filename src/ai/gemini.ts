// Minimal Gemini REST client: JSON-only responses, hard timeouts, model fallback, rate-limit backoff.

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Fast free-tier models, best first (measured 2026-09-26: ~0.6s text, ~3s photo). Older 2.5 models 404 for new keys. */
export const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

export class Gemini {
  readonly key: string;
  readonly models: string[];
  /** Free-tier quotas are per model, so a 429 only benches that model for a minute. */
  private limitedUntil = new Map<string, number>();

  /** `model` may be one id or a comma-separated fallback list. */
  constructor(key: string, model?: string) {
    this.key = key;
    const list = (model ?? '').split(',').map((m) => m.trim()).filter(Boolean);
    this.models = list.length ? list : DEFAULT_MODELS;
  }

  get model(): string {
    return this.models[0];
  }

  get enabled(): boolean {
    return this.key.length > 0;
  }

  private usable(model: string): boolean {
    return Date.now() >= (this.limitedUntil.get(model) ?? 0);
  }

  /** False when there's no key or every model was rate-limited in the last minute. */
  get available(): boolean {
    return this.enabled && this.models.some((m) => this.usable(m));
  }

  get rateLimited(): boolean {
    return this.enabled && !this.available;
  }

  /**
   * Returns parsed JSON, or null on any failure (timeout, HTTP error, bad JSON). Never throws.
   * The whole call, including fallbacks to the next model on 404/5xx, stays inside `timeoutMs`.
   */
  async json(parts: Part[], timeoutMs: number): Promise<unknown | null> {
    if (!this.available) return null;
    const deadline = Date.now() + timeoutMs;
    for (const model of this.models) {
      if (!this.usable(model)) continue;
      const left = deadline - Date.now();
      if (left < 300) break;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 400 },
          }),
          signal: AbortSignal.timeout(left),
        });
        if (res.status === 429) {
          this.limitedUntil.set(model, Date.now() + 60_000);
          console.warn(`[ai] ${model}: rate limited for 60s${this.available ? ', trying next model' : '; all models limited, numbered options only'}`);
          continue;
        }
        if (res.status === 404 || res.status >= 500) {
          console.warn(`[ai] ${model}: HTTP ${res.status}, trying next model`);
          continue;
        }
        if (!res.ok) {
          console.warn(`[ai] ${model}: HTTP ${res.status}`);
          return null;
        }
        const body: any = await res.json();
        const text: unknown = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('');
        if (typeof text !== 'string' || !text) return null;
        const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        // Some models wrap the object in an array.
        return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed;
      } catch (err) {
        console.warn(`[ai] ${model}: ${(err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message}`);
        return null;
      }
    }
    return null;
  }
}
