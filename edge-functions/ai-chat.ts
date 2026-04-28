// ══════════════════════════════════════════════════════════
// Edge Function: ai-chat
// Agente IA do DMS com tool-calling
// Motor primário: Groq (Llama 3.3 70B)
// Fallback automático: Gemini 2.5 Flash
//
// Uso:
//   POST /functions/v1/ai-chat
//   Body: { messages: [{role:'user',content:'...'}, ...] }
//   Headers: Authorization: Bearer <jwt_do_usuario>
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const GROQ_MODEL = 'llama-3.3-70b-versatile'
const GEMINI_MODEL = 'gemini-2.5-flash'
const MAX_TOOL_ROUNDS = 5

// ═════════ FERRAMENTAS (tool-calling) ═════════
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'consultar_faturamento',
      description: 'Retorna faturamento total, pedidos e ticket médio de um período. Use pra perguntas como "quanto faturamos em março?", "qual a receita do ano?", "resumo financeiro de abril".',
      parameters: {
        type: 'object',
        properties: {
          periodo: { type: 'string', description: 'Período: "hoje", "mes_atual", "mes_passado", "ano_atual", "ano_passado", ou data formato YYYY-MM (ex: 2026-03)' }
        },
        required: ['periodo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_contas_financeiras',
      description: 'Retorna status de contas a pagar/receber: abertas, atrasadas, valores totais. Use pra "quanto tenho a receber?", "contas atrasadas", "fluxo de caixa". Aceita filtro por empresa (Matriz/Piçarras, BC/Balneário Camboriú, ou ambas).',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', enum: ['matriz', 'bc', 'todas'], description: 'Empresa: "matriz" (Piçarras), "bc" (Balneário Camboriú), ou "todas" (default, ambas agregadas)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'top_clientes',
      description: 'Lista os melhores clientes por volume de pedidos ou receita num período. Use pra "meus melhores clientes", "top 5 clientes desse ano".',
      parameters: {
        type: 'object',
        properties: {
          periodo: { type: 'string', description: 'Período: "mes_atual", "ano_atual", "ano_passado", ou YYYY-MM' },
          limite: { type: 'number', description: 'Quantos retornar (padrão 5, máx 20)' },
          ordenar_por: { type: 'string', enum: ['receita', 'pedidos'], description: 'Padrão receita' }
        },
        required: ['periodo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'top_produtos',
      description: 'Produtos mais vendidos (quantidade) num período. Use pra "produto mais vendido", "top 10 produtos", "qual scrub vende mais".',
      parameters: {
        type: 'object',
        properties: {
          periodo: { type: 'string', description: '"mes_atual", "ano_atual", "ano_passado", ou YYYY-MM' },
          limite: { type: 'number', description: 'Padrão 10, máx 30' }
        },
        required: ['periodo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vendas_por_canal',
      description: 'Split de vendas por canal (Site, Loja+WhatsApp, Mercado Livre, Shopee, TikTok, Magalu) num período. Use pra "qual canal vende mais?", "comparar canais".',
      parameters: {
        type: 'object',
        properties: {
          periodo: { type: 'string', description: '"mes_atual", "ano_atual", "ano_passado", ou YYYY-MM' }
        },
        required: ['periodo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_tarefas',
      description: 'Lista tarefas do Kanban. Use pra perguntas sobre tarefas: "minhas tarefas", "tarefas urgentes", "tarefas pendentes", "tarefas de abril", "o que tem no cronograma", "tarefas atrasadas", "tarefas da Dana". Retorna título, coluna (status), prioridade, responsável, prazo, tag. NÃO retorna concluídas por padrão.',
      parameters: {
        type: 'object',
        properties: {
          coluna: { type: 'string', description: 'Opcional: filtra por coluna específica. Exemplos comuns: "afazer", "em_andamento", "revisao", "concluido", "produto", "criacao", "agencia"' },
          responsavel: { type: 'string', description: 'Opcional: nome (parcial) do responsável' },
          prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'], description: 'Opcional: filtrar por prioridade. Use "alta" pra perguntas sobre tarefas urgentes' },
          tag: { type: 'string', description: 'Opcional: filtrar por tag da tarefa (ex: "marketing", "comercial")' },
          prazo_de: { type: 'string', description: 'Opcional: prazo >= esta data (YYYY-MM-DD). Pra "tarefas de abril" use prazo_de=2026-04-01' },
          prazo_ate: { type: 'string', description: 'Opcional: prazo <= esta data (YYYY-MM-DD). Pra "tarefas de abril" use prazo_ate=2026-04-30' },
          incluir_concluidas: { type: 'boolean', description: 'Default false. Só coloque true se o usuário pediu especificamente tarefas concluídas' },
          atrasadas: { type: 'boolean', description: 'Se true, só retorna tarefas com prazo menor que hoje e não concluídas' },
          limite: { type: 'number', description: 'Padrão 20, máx 100' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resumo_kanban',
      description: 'Dá um panorama geral das tarefas: quantas em cada coluna, quantas por prioridade, quantas atrasadas, quantas por responsável. Use pra "como tá o kanban?", "resumo das tarefas", "panorama geral".',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_contato',
      description: 'Busca cliente/contato por nome (ou parcial). Retorna telefone, tipo (PF/PJ), histórico resumido. Use pra "achar a Maria Silva", "quem é o cliente X", "telefone da clínica Y".',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome ou parte dele' },
          limite: { type: 'number', description: 'Padrão 5' }
        },
        required: ['nome']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'info_produto',
      description: 'Info de produto: estoque, preço, vendas recentes. Use pra "tem estoque do scrub Manuela?", "preço do jaleco X", "como tá girando o produto Y".',
      parameters: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: 'Código ou nome (parcial)' }
        },
        required: ['busca']
      }
    }
  },
  // ─── FERRAMENTAS CLIENTE 360 ───
  {
    type: 'function',
    function: {
      name: 'resumo_cliente360',
      description: 'Panorama geral da carteira de clientes do Cliente 360 (CRM): total de clientes, VIPs, ativos, em risco, perdidos, faturamento, ticket médio, taxa de recompra. Use pra "como tá minha carteira", "quantos VIPs tenho", "resumo do Cliente 360", "minhas metricas de CRM".',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', enum: ['matriz', 'bc', 'ambas'], description: 'Padrão: ambas. Filtra por empresa (Matriz Piçarras ou BC).' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'alertas_cliente360',
      description: 'Lista clientes em uma das 4 categorias de alerta RFM do Cliente 360. Use pra "clientes prontos pra recompra", "VIPs sumidos", "novos sem segunda compra", "oportunidades de alto potencial", "quem contatar hoje".',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', enum: ['matriz', 'bc'], description: 'Empresa (obrigatório)' },
          tipo: {
            type: 'string',
            enum: ['prontos_recompra', 'vips_sem_comprar', 'novos_sem_segunda', 'alto_potencial'],
            description: 'prontos_recompra (score >=80 + 30+ dias) | vips_sem_comprar (VIP + 120+ dias) | novos_sem_segunda (1 pedido + 30+ dias) | alto_potencial (2+ pedidos + score >=70 + <90 dias)'
          },
          limite: { type: 'number', description: 'Padrão 10, máx 30' }
        },
        required: ['empresa', 'tipo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_segmentos_c360',
      description: 'Lista os 5 segmentos automáticos (VIP, Frequente, Ocasional, Em Risco, Inativo) com contagem, mais os segmentos customizados criados manualmente. Use pra "quais segmentos tenho", "quantos clientes em cada segmento", "segmentos customizados".',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', enum: ['matriz', 'bc'], description: 'Empresa (obrigatório pra contagens corretas)' }
        },
        required: ['empresa']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_campanhas_c360',
      description: 'Lista campanhas do Cliente 360 com progresso de envio (total alvo, enviados, respondidos). Use pra "campanhas ativas", "status das campanhas", "quantas campanhas rodando", "como tá a campanha X".',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', enum: ['matriz', 'bc', 'ambas'], description: 'Padrão: ambas' },
          status: { type: 'string', enum: ['rascunho', 'agendada', 'enviada', 'concluida', 'cancelada', 'todas'], description: 'Padrão: todas' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'detalhe_cliente_c360',
      description: 'Info completa de um cliente específico: score RFM decomposto, total pedidos, ticket médio, última compra, dias sem comprar, segmento, nível de risco, últimas notas e insights IA. Use pra "me fala do cliente X", "como tá a Maria Silva no CRM", "status RFM do cliente Y".',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome completo ou parcial do cliente' },
          empresa: { type: 'string', enum: ['matriz', 'bc'], description: 'Empresa' }
        },
        required: ['nome', 'empresa']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'minha_carteira',
      description: 'Retorna APENAS os clientes vinculados ao VENDEDOR LOGADO (via vendedor_mapping do Bling ou cliente_vendedor_manual). Use SEMPRE que o usuário for um vendedor e perguntar sobre "meus clientes", "minha carteira", "meu top cliente", "qual meu melhor cliente", "meus VIPs", "clientes que atendo", "quem está em risco na minha carteira", etc. Não use pra perguntas sobre a base inteira.',
      parameters: {
        type: 'object',
        properties: {
          empresa: { type: 'string', enum: ['matriz', 'bc', 'ambas'], description: 'Padrão: ambas' },
          ordenar_por: { type: 'string', enum: ['score', 'total_gasto', 'ultima_compra', 'dias_sem_compra', 'total_pedidos'], description: 'Padrão: score (decrescente). Use "dias_sem_compra" crescente pra achar quem sumiu.' },
          segmento: { type: 'string', description: 'Opcional. Valores: VIP, Frequente, Ocasional, Em Risco, Inativo, Novo' },
          limite: { type: 'number', description: 'Padrão 10, máx 50' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_notas_c360',
      description: 'Lista notas internas deixadas em clientes. Use pra "notas recentes do CRM", "o que a Dana comentou", "notas sobre cliente X", "últimas anotações".',
      parameters: {
        type: 'object',
        properties: {
          cliente_nome: { type: 'string', description: 'Opcional: filtrar notas de um cliente específico (busca parcial)' },
          autor: { type: 'string', description: 'Opcional: filtrar por quem escreveu a nota (busca parcial)' },
          dias_recentes: { type: 'number', description: 'Padrão 30, máx 180. Quantos dias olhar pra trás' },
          limite: { type: 'number', description: 'Padrão 10, máx 50' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_campanhas_internas',
      description: 'Lista as CAMPANHAS INTERNAS de marketing (organização da equipe por campanha, com funções, expedição, comentários, etc). Use pra "quais campanhas internas estão ativas", "em que campanhas o Juan está", "campanhas em produção", "expedições pendentes", "próximas entregas", "campanha [nome]", "minhas campanhas internas". NÃO CONFUNDA com a seção Campanhas do DMS (essa é de Ads/Briefings). "Campanhas Internas" é a aba nova de gestão operacional de equipe.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['planejamento','producao','ativa','encerrada','cancelada','todos'], description: 'Padrão: ativa (ou "todos")' },
          minhas: { type: 'boolean', description: 'Se true, filtra apenas campanhas em que o usuário logado está como responsável OU membro' },
          limite: { type: 'number', description: 'Padrão 10, máx 30' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'detalhe_campanha_interna',
      description: 'Retorna tudo sobre uma campanha interna específica: dados gerais, equipe com funções, expedições pendentes, comentários recentes, materiais anexados, timeline. Use pra "me fala tudo sobre a campanha X", "quem está na campanha Y", "qual a próxima expedição da campanha Z".',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'UUID da campanha (pegue via listar_campanhas_internas)' },
          nome: { type: 'string', description: 'Nome parcial da campanha (alternativa ao id — busca com ilike)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_schema',
      description: 'Lista TODAS as tabelas disponíveis e suas colunas. Use ANTES de consultar_tabela quando não souber qual tabela/coluna usar. Também use quando perguntar algo fora do escopo das outras ferramentas ("quantos influenciadores", "criativos aprovados", "alertas não lidos", etc).',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_tabela',
      description: 'Consulta genérica (SELECT) em qualquer tabela do sistema. Use quando as ferramentas específicas não cobrem a pergunta. Sempre chame listar_schema primeiro se não souber a tabela/coluna certa. LIMITE: 100 linhas por query. Não aceita JOINs, agregações ou SQL cru — use os filtros do parâmetro. Se precisar agrupar/somar, busque os dados e faça o cálculo na sua cabeça (ou peça outra ferramenta).',
      parameters: {
        type: 'object',
        properties: {
          tabela: { type: 'string', description: 'Nome da tabela ou view. Ex: "criativos", "influenciadores", "canais_aquisicao", "alertas", "dashboard_resumo", "cliente_scoring"' },
          colunas: { type: 'string', description: 'Colunas separadas por vírgula. "*" pra todas. Ex: "id,nome,status" ou "*"' },
          filtros: {
            type: 'array',
            description: 'Lista de filtros. Cada filtro: {coluna, operador, valor}. Operadores: eq, neq, gt, gte, lt, lte, like, ilike, is, in. Para "is" use valor "null" ou "true"/"false". Pra "in" passe valor array.',
            items: {
              type: 'object',
              properties: {
                coluna: { type: 'string' },
                operador: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in'] },
                valor: {}
              },
              required: ['coluna', 'operador', 'valor']
            }
          },
          ordenar: { type: 'string', description: 'Coluna pra ordenar. Prefixo "-" pra DESC. Ex: "created_at" ou "-total"' },
          limite: { type: 'number', description: 'Padrão 20, máx 100' }
        },
        required: ['tabela']
      }
    }
  }
]

// Mapa ferramenta → seções exigidas (o usuário precisa ter permissão em pelo menos UMA)
const TOOL_SECOES: Record<string, string[]> = {
  consultar_faturamento:          ['financeiro', 'home', 'marketplaces', 'canaisvendas', 'relatorio'],
  consultar_contas_financeiras:   ['financeiro'],
  top_clientes:                   ['comunidade', 'financeiro'],
  top_produtos:                   ['marketplaces', 'home', 'financeiro'],
  vendas_por_canal:               ['financeiro', 'marketplaces', 'canaisvendas', 'home'],
  buscar_tarefas:                 ['tarefas'],
  resumo_kanban:                  ['tarefas'],
  buscar_contato:                 ['comunidade'],
  info_produto:                   ['marketplaces', 'home'],
  // Cliente 360
  resumo_cliente360:              ['cliente360'],
  alertas_cliente360:             ['cliente360'],
  listar_segmentos_c360:          ['cliente360'],
  listar_campanhas_c360:          ['cliente360'],
  detalhe_cliente_c360:           ['cliente360'],
  buscar_notas_c360:              ['cliente360'],
  minha_carteira:                 ['meus_clientes'],
  // Campanhas Internas
  listar_campanhas_internas:      ['campanhas_internas'],
  detalhe_campanha_interna:       ['campanhas_internas'],
  // Internas
  listar_schema:                  [], // disponível pra todos
  consultar_tabela:               ['admin'], // só admins
}

// Whitelist de tabelas/views que o agente pode consultar (read-only)
const TABELAS_PERMITIDAS = new Set([
  // Dados Bling
  'pedidos', 'pedidos_itens', 'contatos', 'produtos', 'vendedores',
  'contas_receber', 'contas_pagar',
  // Sistema
  'tarefas', 'kanban_colunas', 'alertas', 'sync_log',
  // Features novas
  'briefings_campanha', 'materiais_briefing', 'brandkit_itens',
  'criativos', 'canais_aquisicao', 'concorrentes',
  'influenciadores', 'referencias_conteudo', 'revendas_parceiros',
  // Cliente 360 (Fases 2-7)
  'cliente_insights', 'cliente_notas', 'cliente_segmentos_custom',
  'cliente_campanhas', 'cliente_campanha_envios',
  // Campanhas Internas
  'campanhas_internas', 'campanha_interna_membros', 'campanha_expedicoes',
  'campanha_interna_comentarios', 'campanha_interna_materiais', 'campanha_interna_historico',
  // Prova Social UGC
  'prova_social_conteudo',
  // Views
  'dashboard_resumo', 'dashboard_mensal', 'dashboard_contas',
  'cliente_scoring', 'cliente_scoring_full', 'cliente_scoring_resumo',
  'funil_vendas', 'receita_historica',
  'top_produtos', 'top_produtos_mes', 'top_produtos_marketplaces',
  'top_produtos_marketplaces_mes',
])

// Tabelas BLOQUEADAS (segurança): profiles, bling_tokens, ai_chat_log, cargo_permissoes, activity_log
// Essas têm dados sensíveis (tokens, UUIDs de auth, logs de outros usuários)

// ═════════ IMPLEMENTAÇÃO DAS FERRAMENTAS ═════════
function resolverPeriodo(periodo: string): { inicio: string, fim: string, label: string } {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth()
  const pad = (n: number) => String(n).padStart(2, '0')

  if (periodo === 'hoje') {
    const d = `${ano}-${pad(mes + 1)}-${pad(hoje.getDate())}`
    return { inicio: d, fim: d, label: 'hoje' }
  }
  if (periodo === 'mes_atual') {
    return {
      inicio: `${ano}-${pad(mes + 1)}-01`,
      fim: `${ano}-${pad(mes + 2)}-01`,
      label: `${pad(mes + 1)}/${ano}`
    }
  }
  if (periodo === 'mes_passado') {
    const m = mes === 0 ? 12 : mes
    const a = mes === 0 ? ano - 1 : ano
    const mNext = mes === 0 ? 1 : mes + 1
    const aNext = mes === 0 ? ano : ano
    return {
      inicio: `${a}-${pad(m)}-01`,
      fim: `${aNext}-${pad(mNext)}-01`,
      label: `${pad(m)}/${a}`
    }
  }
  if (periodo === 'ano_atual') return { inicio: `${ano}-01-01`, fim: `${ano + 1}-01-01`, label: String(ano) }
  if (periodo === 'ano_passado') return { inicio: `${ano - 1}-01-01`, fim: `${ano}-01-01`, label: String(ano - 1) }

  // Formato YYYY-MM
  if (/^\d{4}-\d{2}$/.test(periodo)) {
    const [a, m] = periodo.split('-').map(Number)
    const mNext = m === 12 ? 1 : m + 1
    const aNext = m === 12 ? a + 1 : a
    return { inicio: `${a}-${pad(m)}-01`, fim: `${aNext}-${pad(mNext)}-01`, label: `${pad(m)}/${a}` }
  }
  // Formato YYYY
  if (/^\d{4}$/.test(periodo)) return { inicio: `${periodo}-01-01`, fim: `${+periodo + 1}-01-01`, label: periodo }

  // Default: mês atual
  return resolverPeriodo('mes_atual')
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function executarFerramenta(nome: string, args: any, contextoUsuario: { cargo: string, secoes: Set<string>, profileId?: string, nome?: string }): Promise<any> {
  try {
    // Gate de permissão antes de tocar em qualquer tabela
    const secoesExigidas = TOOL_SECOES[nome] || []
    if (secoesExigidas.length > 0) {
      const ehAdmin = contextoUsuario.cargo === 'admin'
      const temAlguma = secoesExigidas.some(s => contextoUsuario.secoes.has(s))
      if (!ehAdmin && !temAlguma) {
        return { erro_permissao: `Usuário sem acesso à(s) seção(ões) ${secoesExigidas.join(', ')}. Não posso responder sobre esse tópico.` }
      }
    }
    if (nome === 'consultar_faturamento') {
      const { inicio, fim, label } = resolverPeriodo(args.periodo || 'mes_atual')
      const { data, error } = await supabaseAdmin.from('pedidos')
        .select('total, total_produtos')
        .gte('data', inicio).lt('data', fim)
      if (error) return { erro: error.message }
      const pedidos = data?.length || 0
      const receita = (data || []).reduce((s, p) => s + (+p.total || +p.total_produtos || 0), 0)
      const ticket = pedidos > 0 ? receita / pedidos : 0
      return {
        periodo: label,
        receita_total: Math.round(receita),
        pedidos_total: pedidos,
        ticket_medio: Math.round(ticket),
      }
    }

    if (nome === 'consultar_contas_financeiras') {
      const empresa = args.empresa || 'todas'
      const { data: r } = await supabaseAdmin.from('dashboard_contas').select('*').eq('empresa', empresa).maybeSingle()
      return r || { empresa, aviso: 'Nenhum dado encontrado pra empresa solicitada' }
    }

    if (nome === 'top_clientes') {
      const { inicio, fim, label } = resolverPeriodo(args.periodo || 'mes_atual')
      const limite = Math.min(+args.limite || 5, 20)
      const { data } = await supabaseAdmin.from('pedidos')
        .select('contato_nome, total, total_produtos')
        .gte('data', inicio).lt('data', fim)
        .not('contato_nome', 'is', null)
        .limit(10000)
      const agg: Record<string, { receita: number, pedidos: number }> = {}
      ;(data || []).forEach((p: any) => {
        const n = p.contato_nome || 'Sem nome'
        if (!agg[n]) agg[n] = { receita: 0, pedidos: 0 }
        agg[n].receita += (+p.total || +p.total_produtos || 0)
        agg[n].pedidos += 1
      })
      const ordem = (args.ordenar_por === 'pedidos') ? 'pedidos' : 'receita'
      const lista = Object.entries(agg)
        .sort((a, b) => (b[1] as any)[ordem] - (a[1] as any)[ordem])
        .slice(0, limite)
        .map(([nome, v]) => ({ nome, receita: Math.round(v.receita), pedidos: v.pedidos }))
      return { periodo: label, total_clientes: Object.keys(agg).length, top: lista }
    }

    if (nome === 'top_produtos') {
      const { inicio, fim, label } = resolverPeriodo(args.periodo || 'mes_atual')
      const limite = Math.min(+args.limite || 10, 30)
      const { data: peds } = await supabaseAdmin.from('pedidos')
        .select('id').gte('data', inicio).lt('data', fim).limit(10000)
      const ids = (peds || []).map((p: any) => p.id)
      if (ids.length === 0) return { periodo: label, top: [] }
      // Chunks de 200 pra IN clause
      const agg: Record<string, { qtd: number, descricao: string }> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { data } = await supabaseAdmin.from('pedidos_itens')
          .select('codigo, descricao, quantidade').in('pedido_id', chunk)
        ;(data || []).forEach((it: any) => {
          const k = it.codigo || it.descricao
          if (!agg[k]) agg[k] = { qtd: 0, descricao: it.descricao }
          agg[k].qtd += +it.quantidade || 0
        })
      }
      const lista = Object.entries(agg)
        .sort((a, b) => b[1].qtd - a[1].qtd)
        .slice(0, limite)
        .map(([cod, v]) => ({ codigo: cod, descricao: v.descricao, quantidade: v.qtd }))
      return { periodo: label, top: lista }
    }

    if (nome === 'vendas_por_canal') {
      const { inicio, fim, label } = resolverPeriodo(args.periodo || 'mes_atual')
      const { data } = await supabaseAdmin.from('pedidos')
        .select('loja_id, total, total_produtos')
        .gte('data', inicio).lt('data', fim).limit(10000)
      const canais: Record<string, { nome: string, pedidos: number, receita: number }> = {}
      const mapCanal = (id: any) => {
        if (id == null || id === 0) return 'Site/B2B'
        if (id === 203536978) return 'Loja + WhatsApp'
        if (id === 205337834) return 'Mercado Livre'
        if (id === 205430008) return 'TikTok'
        if (id === 205522474) return 'Shopee'
        return 'Magalu/Outros'
      }
      ;(data || []).forEach((p: any) => {
        const c = mapCanal(p.loja_id)
        if (!canais[c]) canais[c] = { nome: c, pedidos: 0, receita: 0 }
        canais[c].pedidos += 1
        canais[c].receita += (+p.total || +p.total_produtos || 0)
      })
      const lista = Object.values(canais)
        .map(c => ({ ...c, receita: Math.round(c.receita) }))
        .sort((a, b) => b.receita - a.receita)
      return { periodo: label, canais: lista }
    }

    if (nome === 'buscar_tarefas') {
      const hoje = new Date().toISOString().slice(0, 10)
      let q = supabaseAdmin.from('tarefas').select('titulo, coluna, prioridade, responsavel, prazo, tag, concluido')
        .limit(Math.min(+args.limite || 20, 100))
      if (args.coluna) q = q.eq('coluna', args.coluna)
      if (args.responsavel) q = q.ilike('responsavel', `%${args.responsavel}%`)
      if (args.prioridade) q = q.eq('prioridade', args.prioridade)
      if (args.tag) q = q.ilike('tag', `%${args.tag}%`)
      if (args.prazo_de) q = q.gte('prazo', args.prazo_de)
      if (args.prazo_ate) q = q.lte('prazo', args.prazo_ate)
      if (args.atrasadas) { q = q.lt('prazo', hoje).eq('concluido', false) }
      if (!args.incluir_concluidas && !args.atrasadas) q = q.eq('concluido', false)
      q = q.order('prazo', { ascending: true, nullsFirst: false })
      const { data, error } = await q
      if (error) return { erro: error.message }
      return { total: data?.length || 0, tarefas: data || [] }
    }

    if (nome === 'resumo_kanban') {
      const hoje = new Date().toISOString().slice(0, 10)
      const { data } = await supabaseAdmin.from('tarefas')
        .select('coluna, prioridade, responsavel, prazo, concluido').limit(5000)
      const naoConc = (data || []).filter((t: any) => !t.concluido)
      const porColuna: Record<string, number> = {}
      const porPrioridade: Record<string, number> = {}
      const porResp: Record<string, number> = {}
      let atrasadas = 0
      for (const t of naoConc) {
        porColuna[t.coluna || 'sem'] = (porColuna[t.coluna || 'sem'] || 0) + 1
        if (t.prioridade) porPrioridade[t.prioridade] = (porPrioridade[t.prioridade] || 0) + 1
        if (t.responsavel) porResp[t.responsavel] = (porResp[t.responsavel] || 0) + 1
        if (t.prazo && t.prazo < hoje) atrasadas++
      }
      return {
        total_nao_concluidas: naoConc.length,
        total_concluidas: (data?.length || 0) - naoConc.length,
        atrasadas,
        por_coluna: porColuna,
        por_prioridade: porPrioridade,
        top_responsaveis: Object.entries(porResp).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nome, qtd]) => ({ nome, qtd }))
      }
    }

    if (nome === 'buscar_contato') {
      const { data } = await supabaseAdmin.from('contatos')
        .select('id, nome, telefone, celular, tipo_pessoa')
        .ilike('nome', `%${args.nome}%`)
        .limit(Math.min(+args.limite || 5, 20))
      if (!data || !data.length) return { total: 0, contatos: [] }
      // Pra cada contato, puxa resumo de pedidos
      const ids = data.map((c: any) => c.id)
      const { data: peds } = await supabaseAdmin.from('pedidos')
        .select('contato_nome, total, total_produtos, data')
        .in('contato_nome', data.map((c: any) => c.nome))
        .limit(1000)
      const agg: Record<string, { pedidos: number, receita: number, ultima: string }> = {}
      ;(peds || []).forEach((p: any) => {
        const n = p.contato_nome
        if (!agg[n]) agg[n] = { pedidos: 0, receita: 0, ultima: '' }
        agg[n].pedidos++
        agg[n].receita += (+p.total || +p.total_produtos || 0)
        if (!agg[n].ultima || p.data > agg[n].ultima) agg[n].ultima = p.data
      })
      return {
        total: data.length,
        contatos: data.map((c: any) => ({
          ...c,
          historico: agg[c.nome] ? {
            pedidos: agg[c.nome].pedidos,
            receita_total: Math.round(agg[c.nome].receita),
            ultima_compra: agg[c.nome].ultima
          } : null
        }))
      }
    }

    if (nome === 'info_produto') {
      const busca = String(args.busca || '')
      const { data } = await supabaseAdmin.from('produtos')
        .select('id, codigo, nome, preco, estoque_virtual, imagem_url')
        .or(`codigo.ilike.%${busca}%,nome.ilike.%${busca}%`)
        .limit(10)
      return { total: data?.length || 0, produtos: data || [] }
    }

    // ─── CLIENTE 360 ───
    if (nome === 'resumo_cliente360') {
      const empresa = args.empresa || 'ambas'
      const { data, error } = await supabaseAdmin.from('cliente_scoring_resumo')
        .select('*').eq('empresa', empresa).maybeSingle()
      if (error) return { erro: error.message }
      if (!data) return { empresa, aviso: 'Nenhum dado encontrado. Use empresa=matriz, bc ou ambas.' }
      return { empresa, ...data }
    }

    if (nome === 'alertas_cliente360') {
      const empresa = args.empresa
      const tipo = args.tipo
      const limite = Math.min(+args.limite || 10, 30)
      if (!empresa || !tipo) return { erro: 'empresa e tipo são obrigatórios' }

      let q = supabaseAdmin.from('cliente_scoring_full')
        .select('contato_nome, telefone, celular, segmento, score, total_pedidos, total_gasto, ultima_compra, dias_sem_compra')
        .eq('empresa', empresa)

      if (tipo === 'prontos_recompra') {
        q = q.gte('score', 80).gte('dias_sem_compra', 30)
      } else if (tipo === 'vips_sem_comprar') {
        q = q.eq('segmento', 'VIP').gte('dias_sem_compra', 120)
      } else if (tipo === 'novos_sem_segunda') {
        q = q.eq('total_pedidos', 1).gte('dias_sem_compra', 30)
      } else if (tipo === 'alto_potencial') {
        q = q.gte('total_pedidos', 2).gte('score', 70).lte('dias_sem_compra', 90)
      } else {
        return { erro: `tipo inválido: ${tipo}. Use: prontos_recompra, vips_sem_comprar, novos_sem_segunda, alto_potencial` }
      }

      const { data, error } = await q.order('score', { ascending: false }).limit(limite)
      if (error) return { erro: error.message }
      return {
        empresa, tipo, total: data?.length || 0,
        clientes: (data || []).map((c: any) => ({
          nome: c.contato_nome,
          telefone: c.celular || c.telefone,
          segmento: c.segmento,
          score: c.score,
          total_pedidos: c.total_pedidos,
          total_gasto: Math.round(+c.total_gasto || 0),
          ultima_compra: c.ultima_compra,
          dias_sem_compra: c.dias_sem_compra,
        }))
      }
    }

    if (nome === 'listar_segmentos_c360') {
      const empresa = args.empresa
      if (!empresa) return { erro: 'empresa obrigatória' }

      // Contagens dos 5 automaticos direto na view
      const { data: contagens, error: e1 } = await supabaseAdmin.from('cliente_scoring_full')
        .select('segmento')
        .eq('empresa', empresa)
      if (e1) return { erro: e1.message }
      const segAutos: Record<string, number> = { VIP: 0, Frequente: 0, Ocasional: 0, 'Em Risco': 0, Inativo: 0 }
      for (const r of (contagens || []) as any[]) {
        if (segAutos[r.segmento] !== undefined) segAutos[r.segmento]++
      }

      // Customizados
      const { data: custos } = await supabaseAdmin.from('cliente_segmentos_custom')
        .select('id, nome, descricao, filtros, empresa, user_nome, created_at')
        .in('empresa', [empresa, 'ambas'])
      return {
        empresa,
        automaticos: Object.entries(segAutos).map(([nome, total]) => ({ nome, total, tipo: 'automatico' })),
        customizados: (custos || []).map((s: any) => ({
          id: s.id, nome: s.nome, descricao: s.descricao, criado_por: s.user_nome,
          empresa_aplicavel: s.empresa, criado_em: s.created_at, tipo: 'custom',
        }))
      }
    }

    if (nome === 'listar_campanhas_c360') {
      const empresa = args.empresa || 'ambas'
      const status = args.status || 'todas'
      let q = supabaseAdmin.from('cliente_campanhas')
        .select('id, nome, descricao, empresa, segmento_nome_cache, canal, status, data_envio, total_alvo, total_enviados, total_respondidos, total_falhados, criado_por_nome, created_at')
        .order('created_at', { ascending: false }).limit(30)
      if (empresa !== 'ambas') q = q.in('empresa', [empresa, 'ambas'])
      if (status !== 'todas') q = q.eq('status', status)
      const { data, error } = await q
      if (error) return { erro: error.message }
      return {
        empresa, status_filtro: status, total: data?.length || 0,
        campanhas: (data || []).map((c: any) => ({
          nome: c.nome,
          descricao: c.descricao,
          empresa: c.empresa,
          segmento: c.segmento_nome_cache,
          canal: c.canal,
          status: c.status,
          data_envio: c.data_envio,
          total_alvo: c.total_alvo,
          enviados: c.total_enviados,
          respondidos: c.total_respondidos,
          falhados: c.total_falhados,
          taxa_envio: c.total_alvo > 0 ? Math.round((c.total_enviados / c.total_alvo) * 100) + '%' : '0%',
          taxa_resposta: c.total_enviados > 0 ? Math.round((c.total_respondidos / c.total_enviados) * 100) + '%' : '0%',
          criado_por: c.criado_por_nome,
          criado_em: c.created_at,
        }))
      }
    }

    if (nome === 'detalhe_cliente_c360') {
      const nomeBusca = String(args.nome || '').trim()
      const empresa = args.empresa
      if (!nomeBusca || !empresa) return { erro: 'nome e empresa obrigatorios' }

      const { data: cliente, error: e1 } = await supabaseAdmin.from('cliente_scoring_full')
        .select('*').eq('empresa', empresa)
        .ilike('contato_nome', `%${nomeBusca}%`)
        .order('score', { ascending: false })
        .limit(1).maybeSingle()
      if (e1) return { erro: e1.message }
      if (!cliente) return { aviso: `Nenhum cliente encontrado com "${nomeBusca}" na empresa ${empresa}` }

      // Busca notas e insights recentes
      const [notas, insights] = await Promise.all([
        supabaseAdmin.from('cliente_notas')
          .select('texto, user_nome, created_at')
          .eq('empresa', empresa)
          .eq('contato_nome', cliente.contato_nome)
          .order('created_at', { ascending: false }).limit(5),
        supabaseAdmin.from('cliente_insights')
          .select('conteudo, user_nome, created_at')
          .eq('empresa', empresa)
          .eq('contato_nome', cliente.contato_nome)
          .order('created_at', { ascending: false }).limit(3),
      ])

      return {
        nome: cliente.contato_nome,
        empresa,
        telefone: cliente.celular || cliente.telefone,
        tipo_pessoa: cliente.tipo_pessoa,
        documento: cliente.numero_documento,
        score: cliente.score,
        segmento: cliente.segmento,
        total_pedidos: cliente.total_pedidos,
        total_gasto: Math.round(+cliente.total_gasto || 0),
        ticket_medio: Math.round(+cliente.ticket_medio || 0),
        ultima_compra: cliente.ultima_compra,
        dias_sem_compra: cliente.dias_sem_compra,
        meses_ativos: cliente.meses_ativos,
        notas_recentes: (notas.data || []).map((n: any) => ({
          texto: n.texto, autor: n.user_nome, data: n.created_at
        })),
        insights_ia: (insights.data || []).map((i: any) => ({
          resumo: String(i.conteudo || '').slice(0, 400) + (i.conteudo?.length > 400 ? '...' : ''),
          gerado_por: i.user_nome,
          data: i.created_at,
        })),
      }
    }

    if (nome === 'minha_carteira') {
      if (!contextoUsuario.profileId) return { erro: 'Usuário sem profile identificado' }
      const empresa = args.empresa || 'ambas'
      let q = supabaseAdmin.from('cliente_scoring_vendedor')
        .select('contato_nome, empresa, segmento, score, total_pedidos, total_gasto, ticket_medio, ultima_compra, dias_sem_compra, vendedor_fonte')
        .eq('vendedor_profile_id', contextoUsuario.profileId)
      if (empresa !== 'ambas') q = q.eq('empresa', empresa)
      if (args.segmento) q = q.eq('segmento', args.segmento)
      const ord = args.ordenar_por || 'score'
      const asc = (ord === 'dias_sem_compra') ? true : false
      q = q.order(ord, { ascending: asc }).limit(Math.min(+args.limite || 10, 50))
      const { data, error } = await q
      if (error) return { erro: error.message }
      // Resumo agregado
      const total = data?.length || 0
      const fat = (data || []).reduce((s: number, c: any) => s + (+c.total_gasto || 0), 0)
      return {
        vendedor: contextoUsuario.nome || 'voce',
        filtros: { empresa, segmento: args.segmento || 'todos', ordenar_por: ord },
        total_retornado: total,
        faturamento_dos_retornados: Math.round(fat),
        clientes: (data || []).map((c: any) => ({
          nome: c.contato_nome,
          empresa: c.empresa,
          segmento: c.segmento,
          score: c.score,
          pedidos: c.total_pedidos,
          total_gasto: Math.round(+c.total_gasto || 0),
          ticket_medio: Math.round(+c.ticket_medio || 0),
          ultima_compra: c.ultima_compra,
          dias_sem_compra: c.dias_sem_compra,
        }))
      }
    }

    if (nome === 'listar_campanhas_internas') {
      const status = args.status || 'ativa'
      const limite = Math.min(+args.limite || 10, 30)
      let q = supabaseAdmin.from('campanhas_internas')
        .select('id, nome, tipo, status, data_inicio, data_fim, objetivo, meta_tipo, meta_valor, responsavel_id, oferta_principal, produtos_foco, argumento_central')
        .order('data_inicio', { ascending: false }).limit(limite)
      if (status !== 'todos') q = q.eq('status', status)
      if (args.minhas && contextoUsuario.profileId) {
        // filtra campanhas onde sou responsável OU membro
        const { data: membroOf } = await supabaseAdmin.from('campanha_interna_membros')
          .select('campanha_id').eq('profile_id', contextoUsuario.profileId)
        const ids = (membroOf || []).map((m: any) => m.campanha_id)
        q = q.or(`responsavel_id.eq.${contextoUsuario.profileId}${ids.length ? ',id.in.(' + ids.join(',') + ')' : ''}`)
      }
      const { data, error } = await q
      if (error) return { erro: error.message }
      // Nomes dos responsáveis
      const respIds = [...new Set((data || []).map((c: any) => c.responsavel_id).filter(Boolean))]
      const { data: profs } = respIds.length
        ? await supabaseAdmin.from('profiles').select('id, nome').in('id', respIds)
        : { data: [] } as any
      const mapaProf: Record<string,string> = {}
      ;(profs || []).forEach((p: any) => { mapaProf[p.id] = p.nome })
      return {
        filtros: { status, minhas: !!args.minhas },
        total: data?.length || 0,
        campanhas: (data || []).map((c: any) => ({
          id: c.id, nome: c.nome, tipo: c.tipo, status: c.status,
          inicio: c.data_inicio, fim: c.data_fim,
          responsavel: mapaProf[c.responsavel_id] || null,
          objetivo: c.objetivo, meta: c.meta_tipo ? `${c.meta_tipo}: ${c.meta_valor}` : null,
          oferta_principal: c.oferta_principal, argumento_central: c.argumento_central,
          produtos_foco: c.produtos_foco,
        }))
      }
    }

    if (nome === 'detalhe_campanha_interna') {
      let q = supabaseAdmin.from('campanhas_internas').select('*')
      if (args.id) q = q.eq('id', args.id)
      else if (args.nome) q = q.ilike('nome', `%${args.nome}%`)
      else return { erro: 'Passe id OU nome' }
      const { data: camps, error } = await q.limit(1)
      if (error) return { erro: error.message }
      if (!camps?.length) return { erro: 'Campanha não encontrada' }
      const c = camps[0]

      // Membros com funções
      const { data: membros } = await supabaseAdmin.from('campanha_interna_membros')
        .select('profile_id, funcoes, status, observacao').eq('campanha_id', c.id)
      const membroIds = (membros || []).map((m: any) => m.profile_id)
      const { data: profsMembros } = membroIds.length
        ? await supabaseAdmin.from('profiles').select('id, nome').in('id', membroIds)
        : { data: [] } as any
      const mapNomes: Record<string,string> = {}
      ;(profsMembros || []).forEach((p: any) => { mapNomes[p.id] = p.nome })

      // Expedições
      const { data: expeds } = await supabaseAdmin.from('campanha_expedicoes')
        .select('tipo_destino, destinatario_nome, data_envio, status, brinde_nome, compra_minima, desconto_pct')
        .eq('campanha_id', c.id).order('data_envio').limit(20)

      // Últimos 5 comentários
      const { data: coms } = await supabaseAdmin.from('campanha_interna_comentarios')
        .select('texto, autor_nome, created_at').eq('campanha_id', c.id)
        .order('created_at', { ascending: false }).limit(5)

      // Materiais
      const { data: mats } = await supabaseAdmin.from('campanha_interna_materiais')
        .select('nome, link, tipo').eq('campanha_id', c.id).limit(20)

      return {
        campanha: {
          id: c.id, nome: c.nome, tipo: c.tipo, status: c.status,
          inicio: c.data_inicio, fim: c.data_fim,
          objetivo: c.objetivo, meta: c.meta_tipo ? `${c.meta_tipo}: ${c.meta_valor}` : null,
          publico_alvo: c.publico_alvo, canais: c.canais,
          oferta_principal: c.oferta_principal,
          produtos_foco: c.produtos_foco,
          argumento_central: c.argumento_central,
          risco: c.risco_gargalo,
        },
        equipe: (membros || []).map((m: any) => ({
          nome: mapNomes[m.profile_id] || '(desconhecido)',
          funcoes: m.funcoes, status: m.status, observacao: m.observacao,
        })),
        expedicoes: expeds || [],
        comentarios_recentes: coms || [],
        materiais_anexados: mats || [],
      }
    }

    if (nome === 'buscar_notas_c360') {
      const dias = Math.min(+args.dias_recentes || 30, 180)
      const limite = Math.min(+args.limite || 10, 50)
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
      let q = supabaseAdmin.from('cliente_notas')
        .select('texto, user_nome, contato_nome, empresa, created_at')
        .gte('created_at', desde)
        .order('created_at', { ascending: false }).limit(limite)
      if (args.cliente_nome) q = q.ilike('contato_nome', `%${args.cliente_nome}%`)
      if (args.autor) q = q.ilike('user_nome', `%${args.autor}%`)
      const { data, error } = await q
      if (error) return { erro: error.message }
      return {
        periodo_dias: dias,
        total: data?.length || 0,
        notas: (data || []).map((n: any) => ({
          cliente: n.contato_nome,
          empresa: n.empresa,
          autor: n.user_nome,
          data: n.created_at,
          texto: n.texto,
        }))
      }
    }

    if (nome === 'listar_schema') {
      // Para cada tabela na whitelist, pega as colunas via information_schema
      const tabelas = Array.from(TABELAS_PERMITIDAS)
      const { data, error } = await supabaseAdmin.rpc('__bogus_fn_____', {})
      // Fallback: retorna mapa estático que criamos manualmente (mais rápido que consultar information_schema)
      return {
        tabelas_disponiveis: tabelas,
        tabelas_bloqueadas: ['profiles', 'bling_tokens', 'ai_chat_log', 'cargo_permissoes', 'activity_log'],
        nota: 'Use consultar_tabela(tabela, colunas, filtros) pra SELECT em qualquer tabela acima. Não conhece as colunas? Faça uma query com colunas="*" e limite=1 pra inspecionar a estrutura.',
        principais_schemas: {
          pedidos: 'id, numero, data, total, total_produtos, contato_nome, contato_tipo, situacao_id, loja_id, vendedor_id, vendedor_nome',
          contatos: 'id, nome, telefone, celular, tipo_pessoa',
          produtos: 'id, codigo, nome, preco, estoque_virtual, imagem_url',
          tarefas: 'id, titulo, descricao, coluna, prioridade, responsavel, tag, prazo, data_inicio, data_fim, concluido, concluido_em',
          criativos: 'id, titulo, briefing_id, briefing_titulo, formato, designer_nome, status, observacoes, prazo_entrega, created_at',
          influenciadores: 'id, nome, instagram, cidade, regiao, nicho, seguidores, status, codigo_cupom, usos_cupom, vendas_geradas, receita',
          concorrentes: 'id, nome, link_instagram, link_tiktok, seguidores, plataforma_principal, eh_propria_marca',
          canais_aquisicao: 'id, nome, tipo, investimento_mensal, status, responsavel',
          alertas: 'id, tipo, nivel, titulo, mensagem, lido, audiencia, destinatario_id, created_at',
          briefings_campanha: 'id, titulo, publico, problema, conceito, oferta, canais, orcamento, created_at',
          referencias_conteudo: 'id, titulo, descricao, link, influenciador_nome, status, prioridade, prazo',
          contas_receber: 'id, situacao, vencimento, valor, data_emissao, contato_nome, origem_tipo, conta_contabil',
          contas_pagar: 'id, situacao, vencimento, valor, contato_id',
          // Cliente 360 (prefira usar as tools dedicadas: resumo_cliente360, alertas_cliente360, etc)
          cliente_scoring_full: 'empresa, contato_nome, contato_id, telefone, celular, tipo_pessoa, numero_documento, segmento, score, total_pedidos, total_gasto, ticket_medio, ultima_compra, dias_sem_compra, meses_ativos',
          cliente_scoring_resumo: 'empresa, total_clientes, clientes_ativos, vip_count, em_risco, perdidos, prontos_recompra, vips_sem_comprar, novos_sem_2a, alto_potencial, faturamento_total, ticket_medio_global, ciclo_medio_aprox, taxa_recompra, fieis (1 row por empresa: matriz/bc/ambas)',
          cliente_campanhas: 'id, empresa, nome, descricao, segmento_nome_cache, canal (whatsapp/email/sms), status (rascunho/agendada/enviada/concluida/cancelada), data_envio, total_alvo, total_enviados, total_respondidos, total_falhados, criado_por_nome',
          cliente_campanha_envios: 'id, campanha_id, contato_nome, contato_telefone, status (pendente/enviado/entregue/lido/respondido/falhou), enviado_em, respondido_em',
          cliente_notas: 'id, empresa, contato_nome, texto, user_nome, created_at',
          cliente_insights: 'id, empresa, contato_nome, conteudo, user_nome, created_at (insights IA por cliente)',
          cliente_segmentos_custom: 'id, nome, descricao, empresa, filtros (jsonb), cor, user_nome',
        }
      }
    }

    if (nome === 'consultar_tabela') {
      const tabela = String(args.tabela || '').trim()
      if (!TABELAS_PERMITIDAS.has(tabela)) {
        return { erro: `Tabela "${tabela}" não permitida. Use listar_schema() pra ver disponíveis.` }
      }
      const colunas = String(args.colunas || '*')
      const limite = Math.min(+args.limite || 20, 100)
      let q = supabaseAdmin.from(tabela).select(colunas).limit(limite)
      const filtros = Array.isArray(args.filtros) ? args.filtros : []
      for (const f of filtros) {
        if (!f.coluna || !f.operador) continue
        const op = f.operador
        const v = f.valor
        try {
          if (op === 'eq') q = q.eq(f.coluna, v)
          else if (op === 'neq') q = q.neq(f.coluna, v)
          else if (op === 'gt') q = q.gt(f.coluna, v)
          else if (op === 'gte') q = q.gte(f.coluna, v)
          else if (op === 'lt') q = q.lt(f.coluna, v)
          else if (op === 'lte') q = q.lte(f.coluna, v)
          else if (op === 'like') q = q.like(f.coluna, `%${v}%`)
          else if (op === 'ilike') q = q.ilike(f.coluna, `%${v}%`)
          else if (op === 'is') {
            if (v === 'null' || v === null) q = q.is(f.coluna, null)
            else if (v === true || v === 'true') q = q.is(f.coluna, true)
            else if (v === false || v === 'false') q = q.is(f.coluna, false)
          }
          else if (op === 'in') q = q.in(f.coluna, Array.isArray(v) ? v : [v])
        } catch (e: any) {
          return { erro: `Filtro inválido: ${e.message}` }
        }
      }
      if (args.ordenar) {
        const col = String(args.ordenar)
        if (col.startsWith('-')) q = q.order(col.slice(1), { ascending: false })
        else q = q.order(col, { ascending: true })
      }
      const { data, error } = await q
      if (error) return { erro: error.message }
      return { total: data?.length || 0, linhas: data || [] }
    }

    return { erro: 'Ferramenta desconhecida: ' + nome }
  } catch (e: any) {
    return { erro: e.message }
  }
}

// ═════════ SYSTEM PROMPT ═════════
const SYSTEM_PROMPT = `Você é o assistente de IA do DMS (Dana Marketing System), o sistema interno de gestão da Dana Jalecos Exclusivos.

SOBRE A EMPRESA:
- Dana Jalecos Exclusivos · fundadora Daniela Binhotti Santos (2016)
- Fábrica + loja em Piçarras SC · 2ª loja em Balneário Camboriú SC
- Produtos: jalecos, scrubs e uniformes profissionais de saúde
- Canais: site danajalecos.com.br (Magazord), Mercado Livre, Shopee, TikTok Shop, Magalu, loja física, WhatsApp comercial
- ERP: Bling v3 (read-only). Sincronização Bling → Supabase rodando 24/7.

SEÇÕES DO SITE DMS (pra referenciar quando relevante):
- Dashboard: visão geral de receita, pedidos, contas
- E-commerce: placeholder, aguardando API Magazord
- Loja Física + WhatsApp: vendas presenciais (Piçarras + BC + WhatsApp)
- Marketplaces: ML, Shopee, TikTok, Magalu
- Canais de Aquisição: pagos e orgânicos
- Financeiro: contas a pagar e a receber
- Projeções: previsões de fluxo de caixa
- Performance: funil e analytics
- Comunidade e CRM: scoring de clientes
- Tarefas e Kanban: gestão de tarefas
- Calendário: eventos e prazos
- Construtor de Campanha: geração de briefings
- Briefing Visual: galeria de briefings, materiais, Brand Kit
- Criativos: workflow de aprovação (aguardando/aprovado/reprovado/to-do/publicado)
- Influenciadores: cadastro, KPIs, referências de conteúdo
- Públicos Ideais: 5 personas + Persona Real baseada em dados
- Mercado e Tendências: notícias, buscas, concorrentes
- Prova Social: UGC (em desenvolvimento)
- Analytics: links pros dashboards externos (Meta, GA4, etc)
- Administrador: usuários, permissões, log

SUAS CAPACIDADES:
Você tem ferramentas pra consultar dados reais do Supabase. NUNCA invente números.

Ferramentas específicas (use primeiro pra perguntas comuns):
- consultar_faturamento: receita, pedidos, ticket médio por período
- consultar_contas_financeiras: status CP/CR
- top_clientes, top_produtos: rankings
- vendas_por_canal: split por loja/marketplace
- buscar_tarefas: filtros de kanban (coluna, prioridade, prazo, etc)
- resumo_kanban: panorama geral
- buscar_contato: cliente por nome + histórico
- info_produto: estoque, preço, busca por código/nome
- minha_carteira: APENAS pros clientes vinculados ao vendedor logado. Use SEMPRE que a pergunta for sobre "meus clientes", "minha carteira", "meu top", "meus VIPs", etc. Se o usuário for vendedor, essa é a ferramenta primária pra qualquer pergunta sobre clientes dele.
- listar_campanhas_internas: lista as CAMPANHAS INTERNAS (organização interna de equipe por campanha — não confunda com Campanhas Ads do DMS). Use pra "campanhas internas ativas", "em que campanhas estou", "quais estão em produção", "próximas expedições", "campanhas da Manuela". Filtro "minhas=true" pega só as que o usuário é membro/responsável.
- detalhe_campanha_interna: detalhes completos de uma campanha interna (equipe com funções, expedições, comentários, materiais, timeline). Use por nome aproximado ou id. Perfeito pra "me fala tudo sobre a campanha X", "quem tá na campanha Y", "o que falta fazer na campanha Z".

IMPORTANTE: se o usuário for cargo=vendedor, ele SÓ tem acesso à própria carteira. Quando ele perguntar genericamente sobre "clientes" (ex: "qual cliente tem melhor score", "meus VIPs", "quem sumiu"), assuma que se refere à carteira dele e use minha_carteira. Não use resumo_cliente360, listar_segmentos_c360 ou buscar_contato pra perguntas de vendedor — essas retornam dados globais que ele não deve ver.

Ferramentas genéricas (fallback — use quando as específicas não cobrem):
- listar_schema: mostra TODAS as tabelas/views disponíveis e suas colunas
- consultar_tabela: SELECT genérico em qualquer tabela permitida, com filtros

ESTRATÉGIA:
1. Pergunta simples (vendas, clientes, tarefas, produtos) → use ferramentas específicas
2. Pergunta que envolva criativos, influenciadores, concorrentes, canais, alertas, briefings, etc → use consultar_tabela (chame listar_schema primeiro se não souber a coluna exata)
3. Pergunta completamente nova → chame listar_schema pra ver o que existe, depois consulte

IMPORTANTE:
- Dados monetários em Real brasileiro (R$)
- Ano atual: 2026
- Se o usuário não especificar período, assuma "mês atual"
- E-commerce (site danajalecos.com.br) está aguardando API Magazord — não afirme números "do site" isoladamente sem ressalvas
- Seja direto, conciso, em português BR informal (tom empresarial amigável)
- Use markdown leve (bold, listas) quando ajudar
- Se ferramenta retornar erro, explique pro usuário e sugira reformular
- Se a pergunta não for sobre dados da empresa, responda que é especializado no DMS`

// ═════════ CHAMADA PRO GROQ ═════════
async function chamarGroq(messages: any[]): Promise<any> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 1024,
    })
  })
  if (!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`)
  return await r.json()
}

// ═════════ CHAMADA PRO GEMINI (formato próprio) ═════════
async function chamarGemini(messages: any[]): Promise<any> {
  // Converter formato OpenAI → Gemini
  const contents = []
  let sys = ''
  for (const m of messages) {
    if (m.role === 'system') { sys = m.content; continue }
    if (m.role === 'tool') {
      contents.push({ role: 'user', parts: [{ functionResponse: { name: m.name, response: { content: m.content } } }] })
      continue
    }
    const role = m.role === 'assistant' ? 'model' : 'user'
    const parts: any[] = []
    if (m.content) parts.push({ text: m.content })
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        parts.push({ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } })
      }
    }
    contents.push({ role, parts })
  }
  const geminiTools = [{
    functionDeclarations: TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }))
  }]
  const body: any = {
    contents,
    tools: geminiTools,
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
  }
  if (sys) body.systemInstruction = { parts: [{ text: sys }] }

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`)
  const data = await r.json()

  // Normalizar pro formato OpenAI
  const cand = data.candidates?.[0]
  if (!cand) throw new Error('Gemini: sem resposta')
  const parts = cand.content?.parts || []
  const toolCalls: any[] = []
  let text = ''
  for (const p of parts) {
    if (p.text) text += p.text
    if (p.functionCall) {
      toolCalls.push({
        id: `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) }
      })
    }
  }
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.length ? toolCalls : undefined
      }
    }],
    usage: { total_tokens: data.usageMetadata?.totalTokenCount || 0 }
  }
}

// ═════════ RETRY UTIL pra erros transientes (503, 429, sobrecarga) ═════════
function ehTransiente(msg: string): boolean {
  return /\b503\b|\b429\b|UNAVAILABLE|overloaded|high demand|rate.?limit|ECONN|timeout/i.test(msg || '')
}
async function comRetry<T>(fn: () => Promise<T>, tentativas = 2, delayMs = 1500): Promise<T> {
  let ultimoErro: any
  for (let i = 0; i <= tentativas; i++) {
    try {
      return await fn()
    } catch (e: any) {
      ultimoErro = e
      const msg = String(e?.message || '')
      if (i < tentativas && ehTransiente(msg)) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)))
        continue
      }
      throw e
    }
  }
  throw ultimoErro
}

// ═════════ LOOP PRINCIPAL (chat completion com tool-calling) ═════════
async function rodarAgente(messages: any[], contextoUsuario: { cargo: string, secoes: Set<string>, profileId?: string, nome?: string }): Promise<{ resposta: string, modelo: string, tools: string[], tokens: number }> {
  // System prompt personalizado com info de permissões do usuário
  const secoesLista = Array.from(contextoUsuario.secoes).sort().join(', ')
  const ehVendedor = contextoUsuario.cargo === 'vendedor'
  const contextoExtra = `\n\nCONTEXTO DO USUÁRIO ATUAL:\n- Nome: ${contextoUsuario.nome || '(desconhecido)'}\n- Cargo: ${contextoUsuario.cargo}\n- Seções com acesso: ${secoesLista || '(nenhuma)'}${ehVendedor ? '\n\n⚠ ESTE USUÁRIO É UM VENDEDOR: ele só pode ver/perguntar sobre clientes DA CARTEIRA DELE. Quando ele perguntar genericamente sobre "cliente", "meu cliente", "top", "VIP", etc — SEMPRE use minha_carteira (NUNCA resumo_cliente360, listar_segmentos_c360, alertas_cliente360, top_clientes, buscar_contato, pois esses retornam dados globais que ele não tem permissão de ver). Responda se dirigindo pessoalmente ("sua carteira tem X clientes", "seu top cliente é Y").' : ''}\n\nRESTRIÇÕES POR CARGO (REGRA OBRIGATÓRIA):\n- Você SÓ pode responder sobre tópicos cujas seções o usuário tem acesso.\n- Se a pergunta exigir dados de seção que ele não tem, responda educadamente: "Essa informação está em [nome da seção], que você não tem acesso. Fale com o admin (Dana ou Juan) se precisar."\n- Tool que retornar "erro_permissao" → explique ao usuário que ele não tem acesso, sem revelar os valores ou detalhes dos dados.\n- Usuários com cargo "designer", "vendedor", "expedicao", "producao_conteudo", "analista_marketplace" tipicamente NÃO veem financeiro/vendas.`
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT + contextoExtra }, ...messages]
  const toolsUsadas: string[] = []
  let usouFallback = false
  let tokensTotal = 0

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    let resp: any
    try {
      // Se ja caiu no fallback (Gemini) em loops anteriores, continua no Gemini COM retry
      // Senao, tenta Groq (sem retry — mais rapido cair no Gemini)
      resp = usouFallback ? await comRetry(() => chamarGemini(msgs), 1, 1500) : await chamarGroq(msgs)
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (!usouFallback) {
        // Groq falhou → tenta Gemini com retry
        console.warn('Groq falhou, tentando Gemini:', msg)
        usouFallback = true
        try {
          resp = await comRetry(() => chamarGemini(msgs), 1, 1500)
        } catch (e2: any) {
          // Gemini tambem falhou — ultima tentativa: Groq de novo (rate limit pode ter passado)
          console.warn('Gemini tambem falhou, ultima tentativa Groq:', e2?.message)
          try {
            resp = await chamarGroq(msgs)
            usouFallback = false
          } catch (e3: any) {
            // Tudo falhou — erro amigavel
            if (ehTransiente(msg) || ehTransiente(String(e2?.message || '')) || ehTransiente(String(e3?.message || ''))) {
              throw new Error('O assistente IA esta temporariamente sobrecarregado (Groq/Gemini). Tenta de novo em 30-60 segundos.')
            }
            throw e3
          }
        }
      } else {
        // Ja era fallback e mesmo com retry falhou
        if (ehTransiente(msg)) {
          throw new Error('O assistente IA esta temporariamente sobrecarregado (Gemini). Tenta de novo em 30-60 segundos.')
        }
        throw e
      }
    }
    tokensTotal += resp.usage?.total_tokens || 0
    const msg = resp.choices[0].message
    msgs.push(msg)

    // Se chamou ferramentas, executar e loop
    if (msg.tool_calls && msg.tool_calls.length) {
      for (const tc of msg.tool_calls) {
        const nome = tc.function.name
        const args = JSON.parse(tc.function.arguments || '{}')
        toolsUsadas.push(nome)
        const resultado = await executarFerramenta(nome, args, contextoUsuario)
        msgs.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: nome,
          content: JSON.stringify(resultado)
        })
      }
      continue
    }

    // Resposta final
    return {
      resposta: msg.content || 'Sem resposta',
      modelo: usouFallback ? 'gemini-2.5-flash' : 'llama-3.3-70b',
      tools: toolsUsadas,
      tokens: tokensTotal
    }
  }
  return { resposta: 'Loop de ferramentas atingiu limite. Reformule.', modelo: 'timeout', tools: toolsUsadas, tokens: tokensTotal }
}

// ═════════ HANDLER HTTP ═════════
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const t0 = Date.now()
  let userId: string | null = null
  let userNome: string | null = null

  try {
    // Validar JWT do usuário
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'Autenticação obrigatória' }, 401)

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'JWT inválido' }, 401)
    userId = userData.user.id

    const { data: profile } = await supabaseAdmin.from('profiles').select('nome, cargo').eq('id', userId).single()
    userNome = profile?.nome || userData.user.email
    const cargo = profile?.cargo || 'vendedor'

    // Carregar seções permitidas do cargo
    const { data: perms } = await supabaseAdmin.from('cargo_permissoes')
      .select('secao').eq('cargo', cargo).eq('permitido', true)
    const secoes = new Set<string>((perms || []).map((p: any) => p.secao))
    const contextoUsuario = { cargo, secoes, profileId: userId || undefined, nome: userNome || undefined }

    // Rate limit: 50/hora
    const umaHoraAtras = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await supabaseAdmin.from('ai_chat_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', umaHoraAtras)
    if ((count || 0) >= 50) {
      return json({ error: 'Limite de 50 perguntas/hora atingido. Aguarde uns minutos.' }, 429)
    }

    // Body
    const body = await req.json()
    const messages = body.messages || []
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: 'messages[] obrigatório' }, 400)

    const ultimaPergunta = [...messages].reverse().find(m => m.role === 'user')?.content || ''

    // Rodar agente com contexto de permissões
    const { resposta, modelo, tools, tokens } = await rodarAgente(messages, contextoUsuario)
    const duracao = Date.now() - t0

    // Log
    await supabaseAdmin.from('ai_chat_log').insert({
      user_id: userId,
      user_nome: userNome,
      pergunta: ultimaPergunta,
      resposta,
      modelo,
      tools_usadas: tools,
      tokens_total: tokens,
      duracao_ms: duracao,
    })

    return json({ resposta, modelo, tools_usadas: tools, tokens, duracao_ms: duracao })
  } catch (e: any) {
    const duracao = Date.now() - t0
    console.error('ai-chat error:', e)
    const msg = String(e?.message || 'Erro desconhecido')
    const transiente = ehTransiente(msg) || /temporariamente sobrecarregado/i.test(msg)
    if (userId) {
      try {
        await supabaseAdmin.from('ai_chat_log').insert({
          user_id: userId, user_nome: userNome, pergunta: '',
          erro: msg, duracao_ms: duracao
        })
      } catch {}
    }
    // 503 pra transientes, 500 pra resto
    return json({ error: msg }, transiente ? 503 : 500)
  }
})

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
