// ══════════════════════════════════════════════════════════════
// Edge Function: sync-contatos-detalhes
//
// Puxa GET /contatos/{id} pra ler `dadosAdicionais.dataNascimento`
// e `dadosAdicionais.sexo` (não vem na lista, só no detalhe).
//
// Modos:
//   - 'carteira'        → só contatos com vendedor (~3.600) [FASE 1]
//   - 'ativos'          → contatos com pedido 12m sem vendedor [FASE 2]
//   - 'todos'           → varredura ampla
//   - contato_id_unico  → processa 1 só (hook do C360 sob demanda)
//
// Rate limit Bling: ~3 req/s. Usamos 350ms/call (~2.85 req/s) com
// backoff 8/16/24s em 429. Timeout edge 150s → ~300 contatos/exec.
//
// Body POST: { modo: 'carteira', limite?: 300 }
//        ou: { contato_id_unico: 16386457953 }
// Headers:  x-system-cron: true  OU  Authorization (Bearer JWT do user admin)
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Bling tem 2 contas: matriz (token id=1) e BC/Balneário (token id=2),
// cada uma com client_id/secret próprios. Contato BC só é legível com o
// token BC — por isso o sync precisa ser por-empresa.
const BLING_CONTAS: Record<string, { tokenId: number, clientId: string, secret: string }> = {
  matriz: { tokenId: 1, clientId: 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19', secret: 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e' },
  bc:     { tokenId: 2, clientId: '0401d014dd4186dee8968f6a96e16b06501c7184', secret: 'b4d47645a9cce7e476eef7cdd70473db4e58f929df586bc5049c5cc3b27d' },
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const _tokenCache: Record<string, string> = {}

async function getToken(empresa: string): Promise<string> {
  const conta = BLING_CONTAS[empresa] || BLING_CONTAS.matriz
  if (_tokenCache[empresa]) return _tokenCache[empresa]
  const { data: row } = await admin.from('bling_tokens').select('*').eq('id', conta.tokenId).single()
  if (!row) throw new Error(`No bling token row id=${conta.tokenId} (empresa=${empresa})`)
  try {
    const test = await fetch('https://api.bling.com.br/Api/v3/contatos?pagina=1&limite=1', {
      headers: { Authorization: `Bearer ${row.access_token}` }
    })
    if (test.ok) { _tokenCache[empresa] = row.access_token; return row.access_token }
  } catch {}
  const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${conta.clientId}:${conta.secret}`),
    },
    body: `grant_type=refresh_token&refresh_token=${row.refresh_token}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed (empresa=${empresa}): ` + JSON.stringify(data))
  await admin.from('bling_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    updated_at: new Date().toISOString(),
  }).eq('id', conta.tokenId)
  _tokenCache[empresa] = data.access_token
  return data.access_token
}

async function fetchContatoDetalhe(id: number, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.bling.com.br/Api/v3/contatos/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (r.status === 429) {
      const wait = 8000 * (i + 1)  // 8, 16, 24s
      console.warn(`[429] contato=${id} retry em ${wait}ms`)
      await sleep(wait)
      continue
    }
    if (r.status === 404) return null  // contato sumiu do Bling
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      throw new Error(`Bling ${r.status} contato=${id}: ${txt.slice(0,200)}`)
    }
    return await r.json()
  }
  throw new Error(`Bling: retry exhausted contato=${id}`)
}

function extrairNascimento(detalhe: any): { data: string | null, sexo: string | null } {
  const da = detalhe?.data?.dadosAdicionais || detalhe?.dadosAdicionais || {}
  const raw = da.dataNascimento
  const sexo = da.sexo || null
  // Valida: precisa ser AAAA-MM-DD e não 0000-00-00
  if (raw && raw !== '0000-00-00' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { data: raw, sexo }
  }
  return { data: null, sexo }
}

Deno.serve(async (req) => {
  const inicio = Date.now()
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
    }
    const body = await req.json().catch(() => ({})) as any

    // Modo "1 contato só" (hook do C360 sob demanda)
    if (body.contato_id_unico) {
      // descobre a empresa do contato pra escolher o token Bling certo
      const { data: ct } = await admin.from('contatos').select('empresa').eq('id', Number(body.contato_id_unico)).maybeSingle()
      const token = await getToken(ct?.empresa || 'matriz')
      const detalhe = await fetchContatoDetalhe(Number(body.contato_id_unico), token)
      if (!detalhe) {
        return Response.json({ ok: false, erro: 'contato_nao_existe_no_bling' })
      }
      const { data: nasc, sexo } = extrairNascimento(detalhe)
      await admin.from('contatos').update({
        data_nascimento: nasc,
        sexo,
        nascimento_sincronizado_em: new Date().toISOString(),
      }).eq('id', Number(body.contato_id_unico))
      return Response.json({ ok: true, contato_id: body.contato_id_unico, data_nascimento: nasc, sexo })
    }

    // Modo batch
    const modo = body.modo || 'carteira'
    const limite = Math.min(Math.max(Number(body.limite) || 300, 1), 500)

    const { data: fila, error: errFila } = await admin.rpc('contatos_para_sync_nascimento', {
      modo, p_limite: limite,
    })
    if (errFila) throw errFila

    if (!fila || fila.length === 0) {
      await admin.from('sync_log').insert({
        tabela: 'contatos-detalhes', registros: 0, status: 'ok',
        detalhes: `modo=${modo} · fila_vazia`
      })
      return Response.json({ ok: true, processados: 0, fila_vazia: true })
    }

    let processados = 0, comNascimento = 0, semNascimento = 0, erros = 0

    for (const c of fila) {
      // Timeout guard: encerra graciosamente em 140s
      if (Date.now() - inicio > 140_000) {
        console.warn(`[timeout-guard] encerrando após ${processados}/${fila.length}`)
        break
      }
      try {
        const token = await getToken(c.empresa || 'matriz')  // token por empresa (matriz/bc)
        const detalhe = await fetchContatoDetalhe(Number(c.contato_id), token)
        const { data: nasc, sexo } = detalhe ? extrairNascimento(detalhe) : { data: null, sexo: null }
        await admin.from('contatos').update({
          data_nascimento: nasc,
          sexo,
          nascimento_sincronizado_em: new Date().toISOString(),
        }).eq('id', Number(c.contato_id))
        if (nasc) comNascimento++
        else semNascimento++
        processados++
      } catch (e: any) {
        erros++
        console.warn(`[erro] contato=${c.contato_id}: ${e.message}`)
        // não atualiza nascimento_sincronizado_em → tenta de novo na próxima exec
      }
      await sleep(350)  // rate limit Bling
    }

    const duracao = Math.round((Date.now() - inicio) / 1000)
    await admin.from('sync_log').insert({
      tabela: 'contatos-detalhes',
      registros: processados,
      status: erros > processados / 2 ? 'error' : 'ok',
      detalhes: `modo=${modo} · com_nasc=${comNascimento} · sem_nasc=${semNascimento} · erros=${erros} · ${duracao}s`,
    })

    return Response.json({
      ok: true,
      modo,
      processados,
      com_nascimento: comNascimento,
      sem_nascimento: semNascimento,
      erros,
      fila_restante_aprox: Math.max(0, fila.length - processados),
      duracao_seg: duracao,
    })
  } catch (e: any) {
    await admin.from('sync_log').insert({
      tabela: 'contatos-detalhes', registros: 0, status: 'error',
      erro: e.message || String(e),
    })
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
