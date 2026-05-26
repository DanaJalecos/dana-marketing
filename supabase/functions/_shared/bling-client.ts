// ════════════════════════════════════════════════════════════════════════════
// _shared/bling-client.ts — HTTP client Bling com rate limit + backoff
// Limites: 3 req/s, 120k req/dia. Default sleep 350ms entre chamadas.
// ════════════════════════════════════════════════════════════════════════════

const BLING_BASE = 'https://api.bling.com.br/Api/v3';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type BlingQuery = Record<string, string | number | boolean | undefined>;

export interface BlingGetResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  errorBody?: string;
}

/**
 * GET autenticado no Bling com backoff em 429.
 * Não faz throw em erro — retorna {ok:false, status, errorBody} pra caller decidir.
 *
 * Comportamento:
 *   200 → {ok:true, data}
 *   429 → backoff exponencial (1s, 2s, 4s, 8s, 16s), depois desiste
 *   4xx (outros) → {ok:false, status, errorBody}
 *   5xx → retry 3x com backoff curto (1s, 2s, 4s)
 */
export async function blingGet<T = unknown>(
  token: string,
  path: string,
  params: BlingQuery = {},
  opts: { maxRetries429?: number; maxRetries5xx?: number; timeoutMs?: number } = {}
): Promise<BlingGetResult<T>> {
  const max429 = opts.maxRetries429 ?? 5;
  const max5xx = opts.maxRetries5xx ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30000;

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  const url = qs ? `${BLING_BASE}${path}?${qs}` : `${BLING_BASE}${path}`;
  let attempts429 = 0;
  let attempts5xx = 0;

  while (true) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(tid);
      if (attempts5xx < max5xx) {
        attempts5xx++;
        await sleep(1000 * Math.pow(2, attempts5xx - 1));
        continue;
      }
      return { ok: false, status: 0, errorBody: `network: ${String(e).slice(0, 200)}` };
    }
    clearTimeout(tid);

    if (res.status === 200) {
      const data = (await res.json().catch(() => null)) as T;
      return { ok: true, status: 200, data };
    }

    if (res.status === 429) {
      if (attempts429 >= max429) {
        const body = await res.text();
        return { ok: false, status: 429, errorBody: body.slice(0, 300) };
      }
      attempts429++;
      const delay = 1000 * Math.pow(2, attempts429 - 1); // 1s, 2s, 4s, 8s, 16s
      await sleep(delay);
      continue;
    }

    if (res.status >= 500 && res.status < 600) {
      if (attempts5xx >= max5xx) {
        const body = await res.text();
        return { ok: false, status: res.status, errorBody: body.slice(0, 300) };
      }
      attempts5xx++;
      await sleep(1000 * Math.pow(2, attempts5xx - 1));
      continue;
    }

    // 4xx outros (401, 403, 404, etc) — não retry, retorna pra caller
    const body = await res.text();
    return { ok: false, status: res.status, errorBody: body.slice(0, 300) };
  }
}
