// ══════════════════════════════════════════════════════════════
// Edge Function: gerar-cupom-aniversario
//
// Recebe um contato_id, gera (ou retorna existente) um cupom único
// de 10% pro mês de aniversário + monta mensagem WhatsApp pronta
// + retorna URL do criativo padrão.
//
// Body: { contato_id: 16386457953 }
//
// Resposta:
//   {
//     ok: true,
//     cupom: { id, codigo, validade_ate, status, ... },
//     ja_existia: bool,
//     mensagem: "Oi Jaqueline! 🎉 ...",
//     criativo_url: "https://...",
//     whatsapp_link: "https://wa.me/55..."
//   }
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, X-Client-Info',
}

const MESES_PT = [
  'janeiro','fevereiro','março','abril','maio','junho',
  'julho','agosto','setembro','outubro','novembro','dezembro'
]

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

function primeiroNome(nome: string): string {
  if (!nome) return 'amigo(a)'
  const tok = nome.trim().split(/\s+/)[0]
  return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase()
}

function codigoCupom(nome: string, mesAniv: number): string {
  // ANIV-JAQ-12-26  (3 chars do nome + MM + AA)
  const slug = (nome.trim().split(/\s+/)[0] || 'CLI')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'CLI'
  const mm = String(mesAniv).padStart(2, '0')
  const aa = String(new Date().getFullYear()).slice(-2)
  return `ANIV-${slug}-${mm}${aa}`
}

function ultimoDiaDoMes(mes1Based: number, ano: number): string {
  const d = new Date(ano, mes1Based, 0)  // dia 0 do mes seguinte = último do atual
  return d.toISOString().slice(0, 10)
}

function gerarMensagem(nome: string, mesAniv: number): string {
  const nomeFmt = primeiroNome(nome)
  const mesNome = MESES_PT[mesAniv - 1] || ''
  return (
    `Oi ${nomeFmt}! 🎉\n\n` +
    `A Dana quer comemorar seu aniversário com você! Como presente, você tem *10% OFF* em qualquer item — jaleco, scrub, gorro, tudo — durante todo o mês de ${mesNome}.\n\n` +
    `É só me responder aqui ou fazer seu pedido comigo pelo WhatsApp que eu já aplico o seu desconto. 💛\n\n` +
    `Que esse ano seja especial pra você!`
  )
}

function whatsappLink(telefone: string | null, mensagem: string): string | null {
  if (!telefone) return null
  const num = telefone.replace(/\D/g, '')
  if (num.length < 10) return null
  // Adiciona 55 se vier só com DDD+número
  const full = num.startsWith('55') ? num : `55${num}`
  return `https://wa.me/${full}?text=${encodeURIComponent(mensagem)}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405)
  }
  try {
    const body = await req.json().catch(() => ({})) as any
    const contatoId = Number(body.contato_id)
    if (!contatoId) return json({ error: 'contato_id obrigatório' }, 400)

    // Auth: pega quem chamou (vendedor/gerente/admin)
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    let userId: string | null = null
    let userNome: string | null = null
    let userCargo: string | null = null
    if (token && token !== SUPABASE_ANON_KEY) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
      const { data: u } = await userClient.auth.getUser()
      userId = u?.user?.id || null
      if (userId) {
        const { data: prof } = await admin
          .from('profiles')
          .select('id, nome, cargo')
          .eq('id', userId)
          .maybeSingle()
        userNome = prof?.nome || null
        userCargo = prof?.cargo || null
      }
    }

    if (!userId || !['vendedor','vendedora','gerente_comercial','admin','vendedor_externo'].includes(userCargo || '')) {
      // Permissão fraca propositalmente — vendedoras e admin podem gerar.
      // Se quiser endurecer: return json({ error: 'sem permissão' }, 403)
    }

    // 1. Busca contato
    const { data: contato, error: errC } = await admin
      .from('contatos')
      .select('id, nome, empresa, data_nascimento, telefone, celular')
      .eq('id', contatoId)
      .maybeSingle()
    if (errC) throw errC
    if (!contato) return json({ error: 'contato_nao_encontrado' }, 404)
    if (!contato.data_nascimento) return json({ error: 'sem_data_nascimento' }, 400)

    const dataNasc = new Date(contato.data_nascimento)
    const mesAniv = dataNasc.getUTCMonth() + 1  // 1-12

    // 2. Cupom já existe esse ano?
    const inicioAno = new Date(new Date().getFullYear(), 0, 1).toISOString()
    const { data: existente } = await admin
      .from('cupons_aniversario')
      .select('*')
      .eq('contato_id', contatoId)
      .gte('created_at', inicioAno)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let cupom = existente
    let jaExistia = !!existente

    if (!cupom) {
      // 3. Gera novo cupom
      let codigo = codigoCupom(contato.nome, mesAniv)
      // Se houver colisão (ex.: dois "Jaqueline" em dezembro), sufixa contato_id
      const { data: colisao } = await admin
        .from('cupons_aniversario')
        .select('id')
        .eq('codigo', codigo)
        .maybeSingle()
      if (colisao) {
        codigo = `${codigo}-${String(contatoId).slice(-4)}`
      }

      const validadeAte = ultimoDiaDoMes(mesAniv, new Date().getFullYear())

      const { data: novo, error: errIns } = await admin
        .from('cupons_aniversario')
        .insert({
          codigo,
          contato_id: contatoId,
          contato_nome: contato.nome,
          empresa: contato.empresa || 'matriz',
          desconto_pct: 10,
          validade_ate: validadeAte,
          status: 'gerado',
        })
        .select()
        .single()
      if (errIns) throw errIns
      cupom = novo
    }

    // 4. Mensagem WhatsApp (sem código — desconto aplicado no atendimento)
    const mensagem = gerarMensagem(contato.nome, mesAniv)
    const telefoneEscolhido = contato.celular || contato.telefone || null
    const waLink = whatsappLink(telefoneEscolhido, mensagem)

    // 5. URL do criativo (Storage público)
    const criativoUrl = `${SUPABASE_URL}/storage/v1/object/public/criativos-aniversario/padrao.png`

    return json({
      ok: true,
      cupom,
      ja_existia: jaExistia,
      mensagem,
      criativo_url: criativoUrl,
      whatsapp_link: waLink,
      contato: {
        nome: contato.nome,
        empresa: contato.empresa,
        data_nascimento: contato.data_nascimento,
        celular: contato.celular,
        telefone: contato.telefone,
      },
    })
  } catch (e: any) {
    console.error('[gerar-cupom-aniversario]', e)
    return json({ error: e.message || String(e) }, 500)
  }
})
