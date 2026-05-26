// ════════════════════════════════════════════════════════════════════════════
// _shared/bling-oauth.ts — Helper centralizado de token Bling via Vault
// Substitui os 7 edges hardcoded CLIENT_ID/CLIENT_SECRET.
// Lê de vault.secrets via funções PL/pgSQL (bling_token_get, bling_client_creds).
// ════════════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type Empresa = 'matriz' | 'bc';

export interface BlingTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
}

export interface BlingClientCreds {
  client_id: string;
  client_secret: string;
}

// Cache em memória (durante vida da edge, 5min default Deno)
const tokenCache = new Map<Empresa, { tokens: BlingTokens; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5min — Bling token vive ~6h, margem de 1h

export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!url || !srk) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, srk, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Lê tokens do Vault (cifrado). Cache 5min em memória da edge.
 * Se expirar ou estiver perto de expirar (< 10min), faz refresh inline.
 */
export async function getValidToken(sb: SupabaseClient, empresa: Empresa): Promise<string> {
  // Cache hit?
  const cached = tokenCache.get(empresa);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    const exp = cached.tokens.expires_at ? new Date(cached.tokens.expires_at).getTime() : 0;
    if (exp - Date.now() > 10 * 60 * 1000) {
      return cached.tokens.access_token;
    }
    // Próximo de expirar: refresca
  }

  // Lê do Vault
  const tokens = await readTokens(sb, empresa);

  // Se expirar em < 10min OU expires_at null (legacy) → refresh proativo
  const expMs = tokens.expires_at ? new Date(tokens.expires_at).getTime() : 0;
  const minutesUntilExpiry = (expMs - Date.now()) / 60000;
  if (!tokens.expires_at || minutesUntilExpiry < 10) {
    const refreshed = await refreshToken(sb, empresa, tokens.refresh_token);
    tokenCache.set(empresa, { tokens: refreshed, cachedAt: Date.now() });
    return refreshed.access_token;
  }

  tokenCache.set(empresa, { tokens, cachedAt: Date.now() });
  return tokens.access_token;
}

/**
 * Leitura crua do Vault via RPC.
 */
export async function readTokens(sb: SupabaseClient, empresa: Empresa): Promise<BlingTokens> {
  const { data, error } = await sb.rpc('bling_token_get', { p_empresa: empresa });
  if (error) throw new Error(`bling_token_get(${empresa}): ${error.message}`);
  if (!data || !data.length) throw new Error(`Sem tokens no Vault pra ${empresa}`);
  const row = data[0];
  if (!row.access_token || !row.refresh_token) {
    throw new Error(`Tokens vazios no Vault pra ${empresa}`);
  }
  return row as BlingTokens;
}

/**
 * Lê client_id + client_secret do Vault.
 */
export async function readClientCreds(sb: SupabaseClient, empresa: Empresa): Promise<BlingClientCreds> {
  const { data, error } = await sb.rpc('bling_client_creds', { p_empresa: empresa });
  if (error) throw new Error(`bling_client_creds(${empresa}): ${error.message}`);
  if (!data || !data.length) throw new Error(`Sem client_creds pra ${empresa}`);
  return data[0] as BlingClientCreds;
}

/**
 * Chama POST /Api/v3/oauth/token com refresh_token, atualiza Vault + tabela
 * via bling_token_upsert(). Bling rotaciona refresh em algumas requests.
 */
export async function refreshToken(
  sb: SupabaseClient,
  empresa: Empresa,
  refresh_token: string
): Promise<BlingTokens> {
  const creds = await readClientCreds(sb, empresa);
  const basic = btoa(`${creds.client_id}:${creds.client_secret}`);

  const r = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
    }),
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Refresh Bling ${empresa} falhou (${r.status}): ${body.slice(0, 300)}`);
  }

  const tok = await r.json();
  const access = tok.access_token as string;
  const refresh = (tok.refresh_token as string) || refresh_token; // Bling pode não rotacionar
  const expires_in = Number(tok.expires_in) || 21600; // 6h default
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  // Salva via wrapper (escreve no Vault E na tabela legacy)
  const { error: upErr } = await sb.rpc('bling_token_upsert', {
    p_empresa: empresa,
    p_access: access,
    p_refresh: refresh,
    p_expires_at: expires_at,
  });
  if (upErr) throw new Error(`bling_token_upsert(${empresa}): ${upErr.message}`);

  // Invalida cache
  tokenCache.delete(empresa);

  return { access_token: access, refresh_token: refresh, expires_at };
}
