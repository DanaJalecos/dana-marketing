// ══════════════════════════════════════════════════════════
// DMS — Sync Completo: Bling → Supabase
// Puxa TODO o histórico de pedidos, contatos, contas e produtos
// Rodar: node sync-completo.js
// ══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://comlppiwzniskjbeneos.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA4ODYyNiwiZXhwIjoyMDkxNjY0NjI2fQ.BnraJv6ta__8bMKoq8mldhb_1D8cJ-IAEFqIl3ovCWI';
const BLING_CLIENT_ID = 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19';
const BLING_CLIENT_SECRET = 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e';

// ── HELPERS ──
async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${path}: ${res.status} ${text}`);
  }
  return options.method === 'HEAD' ? null : res.json();
}

async function supaUpsert(table, rows) {
  if (!rows.length) return;
  // Upsert em lotes de 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(batch),
    });
  }
}

async function blingFetch(path, token) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.bling.com.br/Api/v3/${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.status === 429) {
        console.log('    Rate limit, aguardando 10s...');
        await sleep(10000);
        continue;
      }
      const text = await res.text();
      if (text.startsWith('<')) {
        console.log('    Resposta HTML (erro Bling), retentando em 10s...');
        await sleep(10000);
        continue;
      }
      return JSON.parse(text);
    } catch (e) {
      console.log(`    Erro: ${e.message}, retentando em 5s...`);
      await sleep(5000);
    }
  }
  return { data: [] };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TOKEN MANAGEMENT ──
async function getToken() {
  const rows = await supaFetch('bling_tokens?id=eq.1&select=*');
  if (!rows.length) throw new Error('Nenhum token encontrado na tabela bling_tokens!');
  const row = rows[0];

  // Testar token atual
  const test = await blingFetch('pedidos/vendas?pagina=1&limite=1', row.access_token);
  if (!test.error) {
    console.log('✓ Token válido');
    return row.access_token;
  }

  // Renovar token
  console.log('⟳ Renovando token...');
  const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64'),
    },
    body: `grant_type=refresh_token&refresh_token=${row.refresh_token}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Falha ao renovar token: ' + JSON.stringify(data));

  await fetch(`${SUPABASE_URL}/rest/v1/bling_tokens?id=eq.1`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      updated_at: new Date().toISOString(),
    }),
  });
  console.log('✓ Token renovado');
  return data.access_token;
}

// ── SYNC PEDIDOS (TUDO — 2025 + 2026) ──
async function syncPedidos(token) {
  console.log('\n═══ PEDIDOS ═══');
  let totalSynced = 0;

  // Sincronizar por períodos de 30 dias para pegar tudo
  const hoje = new Date();
  const inicio = new Date('2025-01-01');

  while (inicio < hoje) {
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 30);
    if (fim > hoje) fim.setTime(hoje.getTime());

    const di = inicio.toISOString().split('T')[0];
    const df = fim.toISOString().split('T')[0];
    console.log(`  Período: ${di} → ${df}`);

    for (let page = 1; page <= 100; page++) {
      const result = await blingFetch(
        `pedidos/vendas?pagina=${page}&limite=100&dataInicial=${di}&dataFinal=${df}`,
        token
      );
      if (!result.data?.length) break;

      const rows = result.data.map(p => ({
        id: p.id,
        numero: p.numero,
        numero_loja: p.numeroLoja || '',
        data: p.data,
        data_saida: p.dataSaida && p.dataSaida !== '0000-00-00' ? p.dataSaida : null,
        total_produtos: p.totalProdutos || 0,
        total: p.total || 0,
        contato_nome: p.contato?.nome || '',
        contato_tipo: p.contato?.tipoPessoa || '',
        situacao_id: p.situacao?.id || 0,
        loja_id: p.loja?.id || 0,
      }));

      await supaUpsert('pedidos', rows);
      totalSynced += rows.length;
      process.stdout.write(`    Página ${page}: ${rows.length} pedidos (total: ${totalSynced})\r`);
      await sleep(500);
    }

    inicio.setDate(inicio.getDate() + 31);
  }

  console.log(`\n  ✓ Pedidos sincronizados: ${totalSynced}`);
  return totalSynced;
}

// ── SYNC CONTATOS (TODOS) ──
async function syncContatos(token) {
  console.log('\n═══ CONTATOS ═══');
  let total = 0;

  for (let page = 1; page <= 500; page++) {
    const result = await blingFetch(`contatos?pagina=${page}&limite=100`, token);
    if (!result.data?.length) break;

    const rows = result.data.map(c => ({
      id: c.id,
      nome: c.nome || '',
      codigo: c.codigo || '',
      situacao: c.situacao || '',
      tipo_pessoa: c.tipoPessoa || c.tipo || '',
      numero_documento: c.numeroDocumento || '',
      telefone: c.telefone || '',
      celular: c.celular || '',
    }));

    await supaUpsert('contatos', rows);
    total += rows.length;
    process.stdout.write(`  Página ${page}: ${rows.length} contatos (total: ${total})\r`);
    await sleep(500);
  }

  console.log(`\n  ✓ Contatos sincronizados: ${total}`);
  return total;
}

// ── SYNC CONTAS A RECEBER (TODAS AS SITUAÇÕES) ──
async function syncContasReceber(token) {
  console.log('\n═══ CONTAS A RECEBER ═══');
  let total = 0;

  // Puxar todas as situações: 1 (aberto), 2 (recebido), 3 (atrasado)
  for (const sit of [1, 2, 3]) {
    const sitLabel = { 1: 'aberto', 2: 'recebido', 3: 'atrasado' }[sit];
    console.log(`  Situação: ${sitLabel} (${sit})`);

    for (let page = 1; page <= 100; page++) {
      const result = await blingFetch(`contas/receber?pagina=${page}&limite=100&situacao=${sit}`, token);
      if (!result.data?.length) break;

      const rows = result.data.map(c => ({
        id: c.id,
        situacao: c.situacao,
        vencimento: c.vencimento,
        valor: c.valor || 0,
        data_emissao: c.dataEmissao && c.dataEmissao !== '0000-00-00' ? c.dataEmissao : null,
        contato_nome: c.contato?.nome || '',
        contato_tipo: c.contato?.tipo || '',
        origem_tipo: c.origem?.tipoOrigem || '',
        origem_numero: c.origem?.numero || '',
        conta_contabil: c.contaContabil?.descricao || '',
      }));

      await supaUpsert('contas_receber', rows);
      total += rows.length;
      process.stdout.write(`    Página ${page}: ${rows.length} (total: ${total})\r`);
      await sleep(500);
    }
  }

  console.log(`\n  ✓ Contas a receber sincronizadas: ${total}`);
  return total;
}

// ── SYNC CONTAS A PAGAR (TODAS AS SITUAÇÕES) ──
async function syncContasPagar(token) {
  console.log('\n═══ CONTAS A PAGAR ═══');
  let total = 0;

  for (const sit of [1, 2, 3]) {
    const sitLabel = { 1: 'aberto', 2: 'pago', 3: 'atrasado' }[sit];
    console.log(`  Situação: ${sitLabel} (${sit})`);

    for (let page = 1; page <= 100; page++) {
      const result = await blingFetch(`contas/pagar?pagina=${page}&limite=100&situacao=${sit}`, token);
      if (!result.data?.length) break;

      const rows = result.data.map(c => ({
        id: c.id,
        situacao: c.situacao,
        vencimento: c.vencimento,
        valor: c.valor || 0,
        contato_id: c.contato?.id || 0,
      }));

      await supaUpsert('contas_pagar', rows);
      total += rows.length;
      process.stdout.write(`    Página ${page}: ${rows.length} (total: ${total})\r`);
      await sleep(500);
    }
  }

  console.log(`\n  ✓ Contas a pagar sincronizadas: ${total}`);
  return total;
}

// ── SYNC PRODUTOS (TODOS OS ATIVOS) ──
async function syncProdutos(token) {
  console.log('\n═══ PRODUTOS ═══');
  let total = 0;

  for (let page = 1; page <= 100; page++) {
    const result = await blingFetch(`produtos?pagina=${page}&limite=100&tipo=P&situacao=A`, token);
    if (!result.data?.length) break;

    const rows = result.data.map(p => ({
      id: p.id,
      nome: p.nome,
      codigo: p.codigo || '',
      preco: p.preco || 0,
      preco_custo: p.precoCusto || 0,
      estoque_virtual: p.estoque?.saldoVirtualTotal || 0,
      tipo: p.tipo,
      situacao: p.situacao,
      formato: p.formato,
      imagem_url: p.imagemURL || '',
    }));

    await supaUpsert('produtos', rows);
    total += rows.length;
    process.stdout.write(`  Página ${page}: ${rows.length} produtos (total: ${total})\r`);
    await sleep(500);
  }

  console.log(`\n  ✓ Produtos sincronizados: ${total}`);
  return total;
}

// ── SYNC VENDEDORES ──
async function syncVendedores(token) {
  console.log('\n═══ VENDEDORES ═══');
  let total = 0;

  for (let page = 1; page <= 20; page++) {
    const result = await blingFetch(`vendedores?pagina=${page}&limite=100`, token);
    if (!result.data?.length) break;

    const rows = result.data.map(v => ({
      id: v.id,
      nome: v.nome || '',
      situacao: v.situacao || '',
      desconto_limite: v.descontoLimite || 0,
      loja_id: v.loja?.id || 0,
    }));

    await supaUpsert('vendedores', rows);
    total += rows.length;
    await sleep(500);
  }

  console.log(`  ✓ Vendedores sincronizados: ${total}`);
  return total;
}

// ── SYNC DEPOSITOS ──
async function syncDepositos(token) {
  console.log('\n═══ DEPÓSITOS ═══');
  let total = 0;

  for (let page = 1; page <= 5; page++) {
    const result = await blingFetch(`depositos?pagina=${page}&limite=100`, token);
    if (!result.data?.length) break;

    const rows = result.data.map(d => ({
      id: d.id,
      descricao: d.descricao || '',
      situacao: d.situacao || 0,
      padrao: d.padrao || false,
    }));

    await supaUpsert('depositos', rows);
    total += rows.length;
    await sleep(500);
  }

  console.log(`  ✓ Depósitos sincronizados: ${total}`);
  return total;
}

// ── LOG DE SYNC ──
async function logSync(tabela, registros, status, erro = null) {
  await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tabela,
      registros,
      status,
      erro,
      created_at: new Date().toISOString(),
    }),
  });
}

// ── MAIN ──
async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  DMS — Sync Completo: Bling → Supabase');
  console.log('  Projeto: comlppiwzniskjbeneos');
  console.log('  Data: ' + new Date().toLocaleString('pt-BR'));
  console.log('══════════════════════════════════════════════════\n');

  try {
    const token = await getToken();
    const start = Date.now();

    const pedidos = await syncPedidos(token);
    await logSync('pedidos', pedidos, 'ok');

    const contatos = await syncContatos(token);
    await logSync('contatos', contatos, 'ok');

    const cr = await syncContasReceber(token);
    await logSync('contas_receber', cr, 'ok');

    const cp = await syncContasPagar(token);
    await logSync('contas_pagar', cp, 'ok');

    const produtos = await syncProdutos(token);
    await logSync('produtos', produtos, 'ok');

    const vendedores = await syncVendedores(token);
    await logSync('vendedores', vendedores, 'ok');

    const depositos = await syncDepositos(token);
    await logSync('depositos', depositos, 'ok');

    await logSync('all', pedidos + contatos + cr + cp + produtos + vendedores + depositos, 'ok');

    const elapsed = Math.round((Date.now() - start) / 1000);

    console.log('\n══════════════════════════════════════════════════');
    console.log('  ✓ SYNC COMPLETO FINALIZADO');
    console.log(`  Tempo: ${elapsed}s`);
    console.log(`  Pedidos: ${pedidos}`);
    console.log(`  Contatos: ${contatos}`);
    console.log(`  Contas Receber: ${cr}`);
    console.log(`  Contas Pagar: ${cp}`);
    console.log(`  Produtos: ${produtos}`);
    console.log(`  Vendedores: ${vendedores}`);
    console.log(`  Depósitos: ${depositos}`);
    console.log('══════════════════════════════════════════════════');

  } catch (e) {
    console.error('\n✗ ERRO:', e.message);
    await logSync('all', 0, 'error', e.message);
    process.exit(1);
  }
}

main();
