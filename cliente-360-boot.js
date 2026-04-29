// ══════════════════════════════════════════════════════════
// Cliente 360 — Boot script (Fase 2: dados reais do Supabase)
// ══════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Overlay de loading IMEDIATO ───
  // Evita flash dos dados demo (30 clientes, R$41k) enquanto buscamos os reais
  function showBootOverlay() {
    if (document.getElementById('c360-boot-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'c360-boot-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:oklch(9% 0.008 260);z-index:99999;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-family:Inter,sans-serif;font-size:13px;transition:opacity 0.2s';
    ov.innerHTML = '<div style="text-align:center"><div style="font-size:28px;margin-bottom:12px;animation:c360spin 1s linear infinite;display:inline-block">⏳</div><div>Carregando Cliente 360...</div></div><style>@keyframes c360spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>';
    (document.body || document.documentElement).appendChild(ov);
  }
  function hideBootOverlay() {
    const ov = document.getElementById('c360-boot-overlay');
    if (!ov) return;
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 200);
  }
  // Mostra IMEDIATAMENTE (script eh carregado ao final do HTML, body ja existe)
  if (document.body) showBootOverlay();
  else document.addEventListener('DOMContentLoaded', showBootOverlay);

  const SUPABASE_URL = 'https://wltmiqbhziefusnzmmkt.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY';
  const PAGE_SIZE = 50;

  // Estado global simples
  const state = {
    sb: null,
    empresa: localStorage.getItem('c360_empresa') || 'matriz',
    clientes: [],
    filtered: [],
    segmentFilter: 'todos',
    ufFilter: 'todos',
    searchQuery: '',
    page: 0,
    loadingList: false,
    clientSelected: null,
  };
  // Cache por empresa (TTL 5min) - evita reload ao trocar matriz<->bc
  const cache = { matriz: null, bc: null };
  const CACHE_TTL = 5 * 60 * 1000;

  // ─── DDD (2 primeiros digitos do fone) -> UF ───
  const DDD_TO_UF = {
    11:'SP',12:'SP',13:'SP',14:'SP',15:'SP',16:'SP',17:'SP',18:'SP',19:'SP',
    21:'RJ',22:'RJ',24:'RJ',
    27:'ES',28:'ES',
    31:'MG',32:'MG',33:'MG',34:'MG',35:'MG',37:'MG',38:'MG',
    41:'PR',42:'PR',43:'PR',44:'PR',45:'PR',46:'PR',
    47:'SC',48:'SC',49:'SC',
    51:'RS',53:'RS',54:'RS',55:'RS',
    61:'DF', 62:'GO',64:'GO', 63:'TO',
    65:'MT',66:'MT', 67:'MS',
    68:'AC', 69:'RO',
    71:'BA',73:'BA',74:'BA',75:'BA',77:'BA', 79:'SE',
    81:'PE',87:'PE', 82:'AL', 83:'PB', 84:'RN', 85:'CE',88:'CE', 86:'PI',89:'PI',
    91:'PA',93:'PA',94:'PA', 92:'AM',97:'AM', 95:'RR', 96:'AP', 98:'MA',99:'MA'
  };

  function phoneToUF(fone) {
    if (!fone) return null;
    const d = String(fone).replace(/\D/g,'');
    if (d.length < 10) return null;
    // Pula prefixo '55' se vier (codigo do Brasil)
    const digits = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
    const ddd = parseInt(digits.slice(0,2), 10);
    return DDD_TO_UF[ddd] || null;
  }

  // ─── Helpers ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const fmtBRL = (n) => (Number(n)||0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtNum = (n) => (Number(n)||0).toLocaleString('pt-BR');
  const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
  const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Empresa label
  const EMPRESA_LABELS = { matriz: 'Matriz (Piçarras)', bc: 'Balneário Camboriú' };

  // ─── Toggle de empresa (sidebar interno) ───
  function updateEmpresaToggleUI() {
    const btns = document.querySelectorAll('.c360-emp-btn');
    btns.forEach(b => {
      const emp = b.getAttribute('data-emp');
      const ativo = emp === state.empresa;
      if (ativo) {
        b.style.background = 'oklch(88% 0.018 80)';
        b.style.color = 'oklch(9% 0.008 260)';
        b.style.borderColor = 'oklch(88% 0.018 80)';
      } else {
        b.style.background = 'rgba(255,255,255,0.04)';
        b.style.color = 'rgba(255,255,255,0.7)';
        b.style.borderColor = 'rgba(255,255,255,0.1)';
      }
    });
  }

  window.c360SetEmpresa = async function(emp) {
    if (emp !== 'matriz' && emp !== 'bc') return;
    if (emp === state.empresa) return;
    state.empresa = emp;
    localStorage.setItem('c360_empresa', emp);
    updateEmpresaToggleUI();
    state.page = 0;
    await Promise.all([loadClientes(), loadDashboardResumo()]);
    // Re-renderiza segmentos se for a aba ativa (a funcao é definida adiante)
    if (typeof window.c360ReRenderSegmentosIfActive === 'function') {
      await window.c360ReRenderSegmentosIfActive();
    }
    // Re-renderiza campanhas se for a aba ativa
    if (typeof window.c360ReRenderCampanhasIfActive === 'function') {
      await window.c360ReRenderCampanhasIfActive();
    }
    // Re-renderiza meus clientes se for a aba ativa
    if (typeof window.c360McReRenderIfActive === 'function') {
      await window.c360McReRenderIfActive();
    }
  };

  // Segmento -> badge style
  const SEGMENT_STYLES = {
    'VIP': { bg: 'bg-amber-500/15', fg: 'text-amber-400', border: 'border-amber-500/30' },
    'Frequente': { bg: 'bg-violet-500/15', fg: 'text-violet-400', border: 'border-violet-500/30' },
    'Ocasional': { bg: 'bg-blue-500/15', fg: 'text-blue-400', border: 'border-blue-500/30' },
    'Em Risco': { bg: 'bg-orange-500/15', fg: 'text-orange-400', border: 'border-orange-500/30' },
    'Inativo': { bg: 'bg-red-500/15', fg: 'text-red-400', border: 'border-red-500/30' },
    'Novo': { bg: 'bg-emerald-500/15', fg: 'text-emerald-400', border: 'border-emerald-500/30' },
    'Sem histórico': { bg: 'bg-zinc-500/15', fg: 'text-zinc-400', border: 'border-zinc-500/30' },
  };

  // Score color (barra horizontal)
  const scoreColor = (score) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Risco baseado em dias sem compra + segmento
  const riscoBadge = (cliente) => {
    const dias = cliente.dias_sem_compra || 0;
    const seg = cliente.segmento;
    if (seg === 'Inativo' || dias > 365) return { label: 'Alto', cls: 'bg-red-500/15 text-red-400 border-red-500/30' };
    if (seg === 'Em Risco' || dias > 180) return { label: 'Médio', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' };
    if (dias > 90) return { label: 'Baixo', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
    return { label: 'Ativo', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
  };

  // ─── Autenticação ───
  async function waitForSupabase() {
    // Espera o script @supabase/supabase-js carregar
    for (let i = 0; i < 50; i++) {
      if (window.supabase && window.supabase.createClient) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async function initSupabase() {
    const ok = await waitForSupabase();
    if (!ok) { console.error('[c360] Supabase SDK não carregou'); return false; }
    state.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // Verifica sessão (compartilhada via localStorage, mesmo dominio)
    const { data: { session } } = await state.sb.auth.getSession();
    if (!session) {
      console.warn('[c360] Sem sessão — redirecionando pra login');
      if (window.parent && window.parent !== window.self) {
        window.parent.location.hash = '';
      }
      return false;
    }
    console.log('[c360] Autenticado como', session.user.email);
    return true;
  }

  // ─── Carrega clientes do Supabase ───
  function setLoadingIndicator(on) {
    const tbody = document.querySelector('#page-clientes table tbody');
    if (on && tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-12 text-center text-muted-foreground">⏳ Carregando clientes...</td></tr>';
    }
  }

  async function loadClientes() {
    if (state.loadingList) return;
    state.loadingList = true;
    try {
      // Cache hit?
      const c = cache[state.empresa];
      if (c && Date.now() - c.ts < CACHE_TTL) {
        state.clientes = c.rows;
        console.log(`[c360] cache hit (${state.empresa}): ${state.clientes.length}`);
        buildUfOptions();
        applyFilters();
        return;
      }

      setLoadingIndicator(true);

      // 1 query só — view server-side ja traz telefone/celular
      const { data, error } = await state.sb
        .from('cliente_scoring_full')
        .select('*')
        .eq('empresa', state.empresa)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(5000);

      if (error) {
        console.error('[c360] erro load clientes:', error);
        return;
      }

      // Enriquece cada row com uf calculada (cliente-side)
      const rows = (data || []).map(r => ({
        ...r,
        uf: phoneToUF(r.celular || r.telefone)
      }));

      state.clientes = rows;
      cache[state.empresa] = { rows, ts: Date.now() };
      console.log(`[c360] ${rows.length} clientes (empresa=${state.empresa}) em 1 query`);

      buildUfOptions();
      applyFilters();
    } catch (e) {
      console.error('[c360] exception load:', e);
    } finally {
      state.loadingList = false;
    }
  }

  // Popula o <select> de UF com os estados realmente presentes
  function buildUfOptions() {
    const sel = document.getElementById('c360-uf-select');
    if (!sel) return;
    const ufs = {};
    for (const c of state.clientes) {
      if (c.uf) ufs[c.uf] = (ufs[c.uf] || 0) + 1;
    }
    const ordenados = Object.entries(ufs).sort((a,b) => b[1]-a[1]);
    const opts = ['<option value="todos">Todos os estados</option>']
      .concat(ordenados.map(([uf,c]) => `<option value="${uf}">${uf} (${c})</option>`))
      .concat(['<option value="null">Sem telefone</option>']);
    sel.innerHTML = opts.join('');
    sel.value = state.ufFilter;
  }

  function applyFilters() {
    const q = (state.searchQuery || '').trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    state.filtered = state.clientes.filter(c => {
      if (state.segmentFilter !== 'todos' && c.segmento !== state.segmentFilter) return false;
      if (state.ufFilter !== 'todos') {
        if (state.ufFilter === 'null') { if (c.uf) return false; }
        else { if (c.uf !== state.ufFilter) return false; }
      }
      if (q) {
        const nome = String(c.contato_nome || '').toLowerCase();
        const tel = String(c.telefone || '').toLowerCase();
        const cel = String(c.celular || '').toLowerCase();
        const telDigits = String(c.telefone || '').replace(/\D/g,'');
        const celDigits = String(c.celular || '').replace(/\D/g,'');
        const achou = nome.includes(q)
          || tel.includes(q) || cel.includes(q)
          || (qDigits.length >= 3 && (telDigits.includes(qDigits) || celDigits.includes(qDigits)));
        if (!achou) return false;
      }
      return true;
    });
    state.page = 0;
    renderList();
  }

  // ─── Renderiza lista de clientes ───
  function renderList() {
    // Acha a tabela de clientes na aba "clientes"
    const tbody = document.querySelector('#page-clientes table tbody');
    if (!tbody) { console.warn('[c360] tbody de clientes não encontrado'); return; }

    const total = state.filtered.length;
    const start = state.page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, total);
    const slice = state.filtered.slice(start, end);

    if (slice.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-12 text-center text-muted-foreground">Nenhum cliente encontrado.</td></tr>';
      renderPager(total, start, end);
      return;
    }

    const rows = slice.map(c => {
      const seg = c.segmento || 'Sem histórico';
      const segStyle = SEGMENT_STYLES[seg] || SEGMENT_STYLES['Sem histórico'];
      const risco = riscoBadge(c);
      const score = Number(c.score) || 0;
      const bar = scoreColor(score);
      const nome = escapeHtml(c.contato_nome || '—');
      const encoded = encodeURIComponent(c.contato_nome || '');

      return `
        <tr class="border-b border-border/50 hover:bg-white/3 cursor-pointer transition-colors group" onclick="showClientDetail('${encoded}')" style="cursor:pointer">
          <td class="px-4 py-3.5">
            <div>
              <p class="font-medium text-foreground text-sm group-hover:text-primary transition-colors">${nome}</p>
              <p class="text-xs text-muted-foreground/60">${EMPRESA_LABELS[c.empresa] || c.empresa}</p>
            </div>
          </td>
          <td class="px-4 py-3.5"><span class="inline-flex items-center rounded-full font-medium text-xs px-2.5 py-1 ${segStyle.bg} ${segStyle.fg} border ${segStyle.border}">${seg}</span></td>
          <td class="px-4 py-3.5 text-right"><span class="text-sm font-semibold text-foreground">${fmtNum(c.total_pedidos)}</span></td>
          <td class="px-4 py-3.5 text-right"><span class="text-sm font-semibold text-foreground">${fmtBRL(c.total_gasto)}</span></td>
          <td class="px-4 py-3.5 text-right"><span class="text-sm text-muted-foreground">${fmtBRL(c.ticket_medio)}</span></td>
          <td class="px-4 py-3.5">
            <div class="text-sm text-foreground">${fmtDate(c.ultima_compra)}</div>
            <div class="text-xs text-muted-foreground">Há ${fmtNum(c.dias_sem_compra)} dias</div>
          </td>
          <td class="px-4 py-3.5">
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden min-w-[60px]">
                <div class="h-full ${bar} rounded-full" style="width:${score}%"></div>
              </div>
              <span class="text-xs font-semibold text-foreground w-7 text-right">${score}</span>
            </div>
          </td>
          <td class="px-4 py-3.5"><span class="inline-flex items-center rounded-full font-medium text-xs px-2.5 py-1 ${risco.cls} border">${risco.label}</span></td>
        </tr>`;
    }).join('');

    tbody.innerHTML = rows;
    renderPager(total, start, end);
    updateCountLabel();
  }

  // Atualiza o subtitulo "X clientes encontrados" no header da pagina Clientes
  function updateCountLabel() {
    const el = Array.from(document.querySelectorAll('#page-clientes p'))
      .find(p => /clientes?\s+encontrad/i.test(p.textContent || ''));
    if (el) {
      const n = state.filtered.length;
      el.textContent = n === 1 ? '1 cliente encontrado' : `${fmtNum(n)} clientes encontrados`;
    }
  }

  function renderPager(total, start, end) {
    // Inserir um pager abaixo da tabela se ainda não existir
    let pager = document.getElementById('c360-pager');
    const tbl = document.querySelector('#page-clientes table');
    if (!pager && tbl && tbl.parentElement) {
      pager = document.createElement('div');
      pager.id = 'c360-pager';
      pager.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:rgb(161,161,170)';
      tbl.parentElement.appendChild(pager);
    }
    if (pager) {
      const totalPages = Math.ceil(total / PAGE_SIZE);
      pager.innerHTML = `
        <div>${total > 0 ? `Mostrando ${start+1}-${end} de ${fmtNum(total)}` : 'Sem resultados'}</div>
        <div style="display:flex;gap:8px">
          <button ${state.page<=0?'disabled':''} onclick="window.c360PagePrev()" class="px-3 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed">← Anterior</button>
          <span style="padding:4px 8px">Pág ${state.page+1}/${Math.max(1,totalPages)}</span>
          <button ${state.page>=totalPages-1?'disabled':''} onclick="window.c360PageNext()" class="px-3 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed">Próxima →</button>
        </div>
      `;
    }
  }

  window.c360PagePrev = () => { if (state.page > 0) { state.page--; renderList(); window.scrollTo(0,0); } };
  window.c360PageNext = () => {
    const total = state.filtered.length;
    if ((state.page+1) * PAGE_SIZE < total) { state.page++; renderList(); window.scrollTo(0,0); }
  };

  // ─── Filtros: busca + segmento + UF ───
  function wireSearchAndFilters() {
    // 1) Input de busca
    const searchInput = document.querySelector('#page-clientes input[placeholder*="Buscar"]');
    if (searchInput) {
      // Anti-autofill do Chrome — tecnica a prova de balas:
      // Chrome nao autofill inputs readonly. Ao clicar, removemos o readonly.
      // Ate o usuario clicar, o Chrome ja perdeu a janela de autofill.
      searchInput.setAttribute('type', 'search');
      searchInput.setAttribute('autocomplete', 'off');
      searchInput.setAttribute('autocorrect', 'off');
      searchInput.setAttribute('autocapitalize', 'off');
      searchInput.setAttribute('spellcheck', 'false');
      searchInput.setAttribute('name', 'c360-q-' + Math.random().toString(36).slice(2, 10));
      searchInput.setAttribute('readonly', 'readonly');
      searchInput.value = '';

      const unlock = () => {
        searchInput.removeAttribute('readonly');
        searchInput.removeEventListener('focus', unlock);
        searchInput.removeEventListener('mousedown', unlock);
        searchInput.removeEventListener('touchstart', unlock);
      };
      searchInput.addEventListener('focus', unlock);
      searchInput.addEventListener('mousedown', unlock);
      searchInput.addEventListener('touchstart', unlock);

      // Defensivo: se Chrome conseguiu inserir email async antes do readonly, zera
      setTimeout(() => {
        if (searchInput.value && /@/.test(searchInput.value)) searchInput.value = '';
      }, 200);
      setTimeout(() => {
        if (searchInput.value && /@/.test(searchInput.value)) searchInput.value = '';
      }, 800);

      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value || '';
        applyFilters();
      });
    }

    // 2) Substituir os botoes Radix Select por <select> nativos
    // color-scheme:dark faz o popup do <select> herdar tema dark do OS
    const selectStyle = 'height:36px;padding:0 32px 0 12px;font-size:14px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(20,20,25,1);color:rgba(255,255,255,0.9);cursor:pointer;appearance:none;-webkit-appearance:none;color-scheme:dark;background-image:url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(161,161,170)" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>\');background-repeat:no-repeat;background-position:right 10px center;';

    // Estagios/segmento
    const btnSeg = Array.from(document.querySelectorAll('#page-clientes button[role="combobox"]')).find(b => (b.textContent || '').includes('estágios') || (b.textContent || '').includes('estagios'));
    if (btnSeg) {
      const sel = document.createElement('select');
      sel.id = 'c360-seg-select';
      sel.setAttribute('style', selectStyle + 'width:' + Math.max(180, btnSeg.offsetWidth) + 'px;');
      sel.innerHTML = [
        '<option value="todos">Todos os estágios</option>',
        '<option value="VIP">VIP</option>',
        '<option value="Frequente">Frequente</option>',
        '<option value="Ocasional">Ocasional</option>',
        '<option value="Em Risco">Em Risco</option>',
        '<option value="Inativo">Inativo</option>',
        '<option value="Novo">Novo</option>',
        '<option value="Sem histórico">Sem histórico</option>',
      ].join('');
      sel.value = state.segmentFilter;
      sel.addEventListener('change', (e) => {
        state.segmentFilter = e.target.value;
        applyFilters();
      });
      btnSeg.parentElement.replaceChild(sel, btnSeg);
    }

    // Estados/UF
    const btnUf = Array.from(document.querySelectorAll('#page-clientes button[role="combobox"]')).find(b => (b.textContent || '').includes('estados'));
    if (btnUf) {
      const sel = document.createElement('select');
      sel.id = 'c360-uf-select';
      sel.setAttribute('style', selectStyle + 'width:' + Math.max(160, btnUf.offsetWidth) + 'px;');
      sel.innerHTML = '<option value="todos">Todos os estados</option>';
      sel.value = state.ufFilter;
      sel.addEventListener('change', (e) => {
        state.ufFilter = e.target.value;
        applyFilters();
      });
      btnUf.parentElement.replaceChild(sel, btnUf);
    }
  }

  // (Filtro agora é gerenciado dentro do Cliente 360 via toggle sidebar - ver c360SetEmpresa)

  // ─── Mapeamentos Bling ───
  const LOJA_NOMES = {
    0: 'Site (e-commerce)', null: 'Site (e-commerce)',
    203536978: 'Loja/WhatsApp (Piçarras)',
    203550865: 'Loja Física BC',
    205337834: 'Mercado Livre',
    205430008: 'TikTok Shop',
    205522474: 'Shopee',
  };
  function lojaNome(lojaId) {
    if (lojaId === null || lojaId === 0 || lojaId === undefined) return 'Site (e-commerce)';
    return LOJA_NOMES[lojaId] || 'Magalu';
  }

  // Situacoes Bling
  const SITUACAO_LABELS = {
    1: 'Em aberto', 2: 'Atendido', 3: 'Cancelado', 6: 'Em aberto',
    9: 'Atendido', 12: 'Cancelado', 15: 'Em andamento',
  };
  const SITUACAO_COLORS = {
    Atendido: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    'Em aberto': { bg: 'rgba(251,191,36,0.15)', fg: '#fbbf24' },
    Cancelado: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    'Em andamento': { bg: 'rgba(96,165,250,0.15)', fg: '#60a5fa' },
  };

  // RFM 0-5 baseado nos dados
  function computeRFM(c) {
    const dias = c.dias_sem_compra || 9999;
    const pedidos = c.total_pedidos || 0;
    const gasto = Number(c.total_gasto) || 0;
    const r = dias < 30 ? 5 : dias < 60 ? 4 : dias < 120 ? 3 : dias < 240 ? 2 : dias < 365 ? 1 : 0;
    const f = pedidos >= 15 ? 5 : pedidos >= 8 ? 4 : pedidos >= 4 ? 3 : pedidos >= 2 ? 2 : pedidos >= 1 ? 1 : 0;
    const m = gasto >= 20000 ? 5 : gasto >= 10000 ? 4 : gasto >= 5000 ? 3 : gasto >= 2000 ? 2 : gasto >= 500 ? 1 : 0;
    return { r, f, m };
  }

  // Probabilidade de recompra 0-100 (heuristica)
  function probRecompra(c) {
    let p = c.score || 0;
    const dias = c.dias_sem_compra || 9999;
    if (dias < 60) p = Math.min(100, p + 10);
    else if (dias > 365) p = Math.max(0, p - 25);
    else if (dias > 180) p = Math.max(0, p - 10);
    return Math.round(p);
  }

  // ─── Busca pedidos + itens do cliente ───
  async function fetchPedidosCliente(contatoNome, empresa) {
    const { data: pedidos, error } = await state.sb
      .from('pedidos')
      .select('id, numero, data, data_saida, total, total_produtos, situacao_id, loja_id, vendedor_nome, numero_loja')
      .eq('empresa', empresa)
      .eq('contato_nome', contatoNome)
      .order('data', { ascending: false })
      .limit(100);
    if (error) { console.error('[c360] erro pedidos:', error); return []; }
    if (!pedidos || pedidos.length === 0) return [];

    // Busca itens dos pedidos em 1 query
    const pedidoIds = pedidos.map(p => p.id);
    const { data: itens } = await state.sb
      .from('pedidos_itens')
      .select('pedido_id, descricao, codigo, quantidade, valor_unitario, valor_total')
      .in('pedido_id', pedidoIds);

    const itensByPedido = {};
    (itens || []).forEach(i => {
      if (!itensByPedido[i.pedido_id]) itensByPedido[i.pedido_id] = [];
      itensByPedido[i.pedido_id].push(i);
    });

    return pedidos.map(p => ({ ...p, itens: itensByPedido[p.id] || [] }));
  }

  // Categoria e canal preferidos
  function computeFavoritos(pedidos) {
    const lojaCount = {};
    const catCount = {};
    for (const p of pedidos) {
      const lnome = lojaNome(p.loja_id);
      lojaCount[lnome] = (lojaCount[lnome] || 0) + 1;
      for (const it of p.itens || []) {
        // Categoria heuristica por palavras-chave na descricao
        const desc = String(it.descricao || '').toLowerCase();
        let cat = 'Outros';
        if (desc.includes('jaleco')) cat = 'Jalecos';
        else if (desc.includes('scrub')) cat = 'Scrubs';
        else if (desc.includes('kit')) cat = 'Kits';
        else if (desc.includes('conjunto')) cat = 'Conjuntos';
        else if (desc.includes('camisa') || desc.includes('blusa')) cat = 'Camisas';
        else if (desc.includes('calca') || desc.includes('calça')) cat = 'Calças';
        else if (desc.includes('avental')) cat = 'Aventais';
        else if (desc.includes('gorro') || desc.includes('touca')) cat = 'Acessórios';
        catCount[cat] = (catCount[cat] || 0) + (Number(it.quantidade) || 1);
      }
    }
    const topLoja = Object.entries(lojaCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
    const topCat  = Object.entries(catCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
    return { canalPreferido: topLoja, categoriaPreferida: topCat };
  }

  // ─── Detalhe do cliente (Fase 2 · Commit 2) ───
  window.showClientDetail = async function(clienteId) {
    const nome = decodeURIComponent(clienteId);
    state.currentContatoNome = nome;
    window._c360TimelineLoaded = false; // reseta cache da Timeline (Onda #2)
    const page = document.getElementById('page-cliente-1');
    if (!page) { console.error('[c360] page-cliente-1 nao encontrada'); return; }

    // Loading state
    page.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">⏳ Carregando dados de ' + escapeHtml(nome) + '...</div>';
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    page.classList.add('active');
    window.scrollTo(0,0);

    try {
      // Cliente completo + pedidos
      const c = state.clientes.find(x => x.contato_nome === nome);
      const [pedidos] = await Promise.all([ fetchPedidosCliente(nome, state.empresa) ]);
      const fav = computeFavoritos(pedidos);
      renderClientDetail(c, nome, pedidos, fav);
      // Injeta painel de metadata (status/tel_alt/observacao) logo abaixo do header
      if (c?.contato_id) {
        await injectMetadataPanel(c.contato_id, state.empresa, nome);
      }
    } catch (e) {
      console.error('[c360] erro detalhe:', e);
      page.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">Erro ao carregar: ' + escapeHtml(String(e.message||e)) + '</div>';
    }
  };

  // ══════════════════════════════════
  // METADATA do cliente Bling (status, tel alt, obs rapida)
  // ══════════════════════════════════
  const METADATA_STATUS = [
    { v: 'novo', l: '🆕 Novo contato', cor: '#94a3b8' },
    { v: 'contatado', l: '💬 Contatado', cor: '#60a5fa' },
    { v: 'negociando', l: '🤝 Em negociação', cor: '#fbbf24' },
    { v: 'comprou', l: '✅ Comprou', cor: '#22c55e' },
    { v: 'perdido', l: '❌ Perdido', cor: '#ef4444' },
    { v: 'sem_interesse', l: '😐 Sem interesse', cor: '#94a3b8' },
  ];

  async function injectMetadataPanel(contatoId, empresa, nome) {
    const page = document.getElementById('page-cliente-1');
    if (!page) return;
    // Busca metadata existente
    const { data: meta } = await state.sb.from('cliente_metadata')
      .select('*').eq('contato_id', contatoId).eq('empresa', empresa).maybeSingle();
    const status = meta?.status_relacionamento || 'novo';
    const tel = meta?.telefone_alternativo || '';
    const obs = meta?.observacao_rapida || '';

    // Cria card da metadata e injeta no topo do detalhe (depois do breadcrumb "Voltar")
    const existente = document.getElementById('c360-meta-panel');
    if (existente) existente.remove();
    const panel = document.createElement('div');
    panel.id = 'c360-meta-panel';
    panel.style.cssText = 'margin:20px auto 20px;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;max-width:1200px;width:calc(100% - 40px)';
    const statusCor = METADATA_STATUS.find(s => s.v === status)?.cor || '#94a3b8';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap">
        <div style="font-family:'Playfair Display',serif;font-size:14px;font-weight:600;color:#f1f5f9">📝 Acompanhamento comercial</div>
        ${meta?.atualizado_em ? `<div style="font-size:10.5px;color:#64748b">${escapeHtml(meta.atualizado_por_nome || '—')} · ${new Date(meta.atualizado_em).toLocaleString('pt-BR')}</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div>
          <label style="display:block;font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">Status do relacionamento</label>
          <select id="c360-meta-status" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
            ${METADATA_STATUS.map(s => `<option value="${s.v}" ${status===s.v?'selected':''}>${s.l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">Telefone alternativo</label>
          <input id="c360-meta-tel" type="tel" value="${escapeHtml(tel)}" placeholder="(47) 99999-0000" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
        </div>
        <div style="grid-column:span 2;min-width:0">
          <label style="display:block;font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">Observação rápida</label>
          <input id="c360-meta-obs" value="${escapeHtml(obs)}" placeholder="Ex: marcar ligação pra terça / cliente pediu catálogo..." style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
        </div>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:10.5px;color:#64748b">💡 Esses campos são locais do DMS — não mexem no Bling.</div>
        <button id="c360-meta-save" onclick="c360SaveMetadata(${contatoId}, '${escapeHtml(empresa)}')" style="padding:7px 16px;border-radius:6px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.15);color:#c4b5fd;cursor:pointer;font-size:12px;font-weight:600">💾 Salvar</button>
      </div>
    `;

    // Insere DEPOIS do botao "Voltar" (primeiro botao do page)
    const voltarBtn = page.querySelector('button');
    if (voltarBtn && voltarBtn.parentNode) {
      voltarBtn.parentNode.insertBefore(panel, voltarBtn.nextSibling);
    } else {
      page.insertBefore(panel, page.firstChild);
    }
  }

  window.c360SaveMetadata = async function(contatoId, empresa) {
    const btn = document.getElementById('c360-meta-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const statusEl = document.getElementById('c360-meta-status');
      const telEl = document.getElementById('c360-meta-tel');
      const obsEl = document.getElementById('c360-meta-obs');
      const { data: { user } } = await state.sb.auth.getUser();
      const { data: profile } = await state.sb.from('profiles').select('nome').eq('id', user.id).maybeSingle();
      const payload = {
        contato_id: contatoId,
        empresa,
        status_relacionamento: statusEl?.value || 'novo',
        telefone_alternativo: (telEl?.value || '').trim() || null,
        observacao_rapida: (obsEl?.value || '').trim() || null,
        atualizado_por: user.id,
        atualizado_por_nome: profile?.nome,
        atualizado_em: new Date().toISOString(),
      };
      const { error } = await state.sb.from('cliente_metadata').upsert(payload, { onConflict: 'contato_id,empresa' });
      if (error) throw error;
      if (typeof showToast === 'function') showToast('✓ Acompanhamento salvo');
      if (btn) { btn.disabled = false; btn.textContent = '✓ Salvo'; setTimeout(() => { if (btn) btn.textContent = '💾 Salvar'; }, 1500); }
    } catch (e) {
      console.error('[c360] salvar metadata', e);
      if (typeof showToast === 'function') showToast('Erro: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar'; }
    }
  };

  function renderClientDetail(c, nome, pedidos, fav) {
    const page = document.getElementById('page-cliente-1');
    if (!page) return;
    if (!c) {
      page.innerHTML = '<div style="padding:40px;text-align:center"><button onclick="showPage(\'clientes\')" style="color:#94a3b8;background:none;border:none;cursor:pointer;margin-bottom:20px">← Voltar</button><div style="color:rgba(255,255,255,0.5)">Cliente "'+escapeHtml(nome)+'" nao encontrado na empresa atual.</div></div>';
      return;
    }

    const seg = c.segmento || 'Sem histórico';
    const segStyle = SEGMENT_STYLES[seg] || SEGMENT_STYLES['Sem histórico'];
    const risco = riscoBadge(c);
    const score = Number(c.score) || 0;
    const rfm = computeRFM(c);
    const pRec = probRecompra(c);
    const initial = (nome.trim()[0] || '?').toUpperCase();
    const tipo = c.tipo_pessoa === 'J' ? 'Pessoa Jurídica' : c.tipo_pessoa === 'F' ? 'Pessoa Física' : (c.tipo_pessoa || '');
    const doc = c.numero_documento ? (tipo === 'Pessoa Jurídica' ? 'CNPJ: ' : tipo === 'Pessoa Física' ? 'CPF: ' : 'Doc: ') + c.numero_documento : '';
    const fone = c.celular || c.telefone || '';

    // Ciclo medio: dias entre pedidos consecutivos
    let cicloMedio = '—';
    if (pedidos.length >= 2) {
      const datas = pedidos.map(p => new Date(p.data)).sort((a,b) => a-b);
      let soma = 0, n = 0;
      for (let i = 1; i < datas.length; i++) { soma += (datas[i] - datas[i-1]) / 86400000; n++; }
      cicloMedio = n > 0 ? Math.round(soma/n) + ' dias' : '—';
    }
    // Proxima estimada: ultima_compra + ciclo
    let proximaEstimada = '—';
    let diasProxima = '';
    if (c.ultima_compra && pedidos.length >= 2) {
      const cmDias = parseInt(cicloMedio, 10);
      if (!isNaN(cmDias)) {
        const dt = new Date(c.ultima_compra + 'T00:00:00');
        dt.setDate(dt.getDate() + cmDias);
        proximaEstimada = dt.toLocaleDateString('pt-BR');
        const hoje = new Date();
        const dif = Math.round((dt - hoje) / 86400000);
        diasProxima = dif > 0 ? 'Em ' + dif + ' dias' : dif < 0 ? 'Atrasado ' + (-dif) + ' dias' : 'Hoje';
      }
    }

    const barColor = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : score >= 40 ? '#f97316' : '#ef4444';
    const barRecColor = pRec >= 70 ? '#22c55e' : pRec >= 40 ? '#eab308' : '#ef4444';
    const recLabel = pRec >= 70 ? 'Alta chance de recompra' : pRec >= 40 ? 'Média chance de recompra' : 'Baixa chance — reativar';

    const fmtStatus = (sitId) => {
      const lbl = SITUACAO_LABELS[sitId] || 'Situação ' + sitId;
      const col = SITUACAO_COLORS[lbl] || SITUACAO_COLORS['Em aberto'];
      return { lbl, bg: col.bg, fg: col.fg };
    };

    const pedidosHtml = pedidos.length === 0
      ? '<div style="padding:24px;text-align:center;color:#64748b;font-size:13px">Sem pedidos cadastrados.</div>'
      : pedidos.map(p => {
          const st = fmtStatus(p.situacao_id);
          const valor = Number(p.total) || Number(p.total_produtos) || 0;
          const itensHtml = (p.itens || []).slice(0, 8).map(it => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.05)">
              <span>${fmtNum(it.quantidade)}x ${escapeHtml(it.descricao||'(sem descricao)')}</span>
              <span>${fmtBRL(it.valor_total || (Number(it.quantidade)||0)*(Number(it.valor_unitario)||0))}</span>
            </div>
          `).join('');
          const mais = (p.itens || []).length > 8 ? `<div style="padding:6px 0;font-size:12px;color:#64748b">+ ${(p.itens||[]).length-8} item(s)...</div>` : '';
          return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px;margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div>
                  <span style="font-weight:600;font-size:14px;color:#e2e8f0">Pedido #${escapeHtml(String(p.numero||p.id))}</span>
                  <span style="font-size:12px;color:#64748b;margin-left:10px">${fmtDate(p.data)} · ${escapeHtml(lojaNome(p.loja_id))}${p.vendedor_nome?' · Vend: '+escapeHtml(p.vendedor_nome):''}</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="font-weight:700;font-size:15px;color:#22c55e">${fmtBRL(valor)}</span>
                  <span style="background:${st.bg};color:${st.fg};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600">${st.lbl}</span>
                </div>
              </div>
              ${itensHtml}${mais}
            </div>`;
        }).join('');

    page.innerHTML = `
<div style="padding:24px;max-width:1200px;margin:0 auto">
  <button onclick="showPage('clientes')" style="display:flex;align-items:center;gap:8px;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;margin-bottom:20px;padding:0;font-family:Inter,sans-serif">
    <svg fill="none" height="16" stroke="currentColor" stroke-width="2" viewbox="0 0 24 24" width="16"><polyline points="15 18 9 12 15 6"></polyline></svg>
    Voltar para Clientes
  </button>

  <!-- Header -->
  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:20px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:56px;height:56px;border-radius:50%;background:rgba(167,139,250,0.2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#a78bfa;flex-shrink:0">${escapeHtml(initial)}</div>
        <div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
            <h2 style="margin:0;font-size:22px;font-weight:700;color:#f1f5f9">${escapeHtml(nome)}</h2>
            <span class="inline-flex items-center rounded-full font-medium text-xs px-2.5 py-1 ${segStyle.bg} ${segStyle.fg} border ${segStyle.border}">${seg}</span>
            <span class="inline-flex items-center rounded-full font-medium text-xs px-2.5 py-1 ${risco.cls} border">Risco: ${risco.label}</span>
          </div>
          <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">${fone ? escapeHtml(fone) : '<span style="color:#475569">sem telefone</span>'}${c.uf ? ' · '+c.uf : ''}${doc ? ' · '+escapeHtml(doc) : ''}</div>
          <div style="font-size:12px;color:#64748b">${EMPRESA_LABELS[c.empresa] || c.empresa}${tipo ? ' · '+tipo : ''}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-shrink:0">
        <button onclick="c360Recalcular()" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px;font-weight:500">Recalcular</button>
        <button onclick="c360InsightIA()" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(251,191,36,0.4);background:rgba(251,191,36,0.1);color:#fbbf24;cursor:pointer;font-size:13px;font-weight:500">◆ Insight IA</button>
      </div>
    </div>
  </div>

  <!-- KPI cards -->
  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:20px">
    ${kpiCard('🛒 Total de Pedidos', fmtNum(c.total_pedidos), '')}
    ${kpiCard('$ Total Gasto', fmtBRL(c.total_gasto), '', 18)}
    ${kpiCard('↗ Ticket Médio', fmtBRL(c.ticket_medio), '', 18)}
    ${kpiCard('⏰ Ciclo Médio', cicloMedio, '', 18)}
    ${kpiCard('⏰ Última Compra', fmtDate(c.ultima_compra), 'Há '+fmtNum(c.dias_sem_compra)+' dias', 16)}
    ${kpiCard('↗ Próxima Estimada', proximaEstimada, diasProxima, 16)}
  </div>

  <!-- Scores -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px">
      <h3 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#f1f5f9">Score RFM</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;color:#94a3b8">Score Geral</span>
        <span style="font-size:14px;font-weight:700;color:#f1f5f9">${score}</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;margin-bottom:20px">
        <div style="height:100%;width:${score}%;background:${barColor};border-radius:3px;transition:width 0.5s"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
        <div><div style="font-size:28px;font-weight:700;color:#f1f5f9">${rfm.r}</div><div style="font-size:12px;color:#64748b">Recência</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#f1f5f9">${rfm.f}</div><div style="font-size:12px;color:#64748b">Frequência</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#f1f5f9">${rfm.m}</div><div style="font-size:12px;color:#64748b">Monetário</div></div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px">
      <h3 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#f1f5f9">Score de Recompra</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;color:#94a3b8">Probabilidade de Recompra</span>
        <span style="font-size:14px;font-weight:700;color:#f1f5f9">${pRec}</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;margin-bottom:20px">
        <div style="height:100%;width:${pRec}%;background:${barRecColor};border-radius:3px;transition:width 0.5s"></div>
      </div>
      <div style="margin-bottom:12px"><span style="color:${barRecColor};font-size:14px;font-weight:600">◆ ${recLabel}</span></div>
      <div style="font-size:13px;color:#94a3b8">
        Categoria preferida: <strong style="color:#e2e8f0">${escapeHtml(fav.categoriaPreferida)}</strong><br/>
        Canal preferido: <strong style="color:#e2e8f0">${escapeHtml(fav.canalPreferido)}</strong>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden">
    <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.08)">
      <button id="c360-tab-pedidos" onclick="c360SwitchTab('pedidos')" style="padding:14px 20px;background:transparent;border:none;color:oklch(88% 0.018 80);cursor:pointer;font-size:14px;font-weight:600;border-bottom:2px solid oklch(88% 0.018 80);display:flex;align-items:center;gap:6px">
        🛒 Pedidos <span style="background:rgba(255,255,255,0.1);color:oklch(88% 0.018 80);padding:2px 8px;border-radius:20px;font-size:11px">${fmtNum(pedidos.length)}</span>
      </button>
      <button id="c360-tab-timeline" onclick="c360SwitchTab('timeline')" style="padding:14px 20px;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;font-weight:500;border-bottom:2px solid transparent;display:flex;align-items:center;gap:6px">📜 Timeline</button>
      <button id="c360-tab-insights" onclick="c360SwitchTab('insights')" style="padding:14px 20px;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;font-weight:500;border-bottom:2px solid transparent;display:flex;align-items:center;gap:6px">◆ Insights IA</button>
      <button id="c360-tab-notas" onclick="c360SwitchTab('notas')" style="padding:14px 20px;background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;font-weight:500;border-bottom:2px solid transparent;display:flex;align-items:center;gap:6px">💬 Notas</button>
    </div>
    <div id="c360-tabpanel-pedidos" style="padding:16px">${pedidosHtml}</div>
    <div id="c360-tabpanel-timeline" style="padding:20px;display:none">
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4)">⏳ Carregando timeline...</div>
    </div>
    <div id="c360-tabpanel-insights" style="padding:20px;display:none;color:#64748b">
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4)">⏳ Carregando insights...</div>
    </div>
    <div id="c360-tabpanel-notas" style="padding:20px;display:none;color:#64748b">
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4)">⏳ Carregando notas...</div>
    </div>
  </div>
</div>`;
  }

  function kpiCard(label, valor, sub, fontSize) {
    const fs = fontSize || 24;
    return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px">
      <div style="font-size:11px;color:#64748b;margin-bottom:8px">${escapeHtml(label)}</div>
      <div style="font-size:${fs}px;font-weight:700;color:#f1f5f9">${escapeHtml(valor)}</div>
      ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${escapeHtml(sub)}</div>` : ''}
    </div>`;
  }

  // Tabs internos
  window.c360SwitchTab = function(tab) {
    const tabs = ['pedidos','timeline','insights','notas'];
    for (const t of tabs) {
      const btn = document.getElementById('c360-tab-'+t);
      const panel = document.getElementById('c360-tabpanel-'+t);
      const ativo = t === tab;
      if (btn) {
        btn.style.color = ativo ? 'oklch(88% 0.018 80)' : '#94a3b8';
        btn.style.fontWeight = ativo ? '600' : '500';
        btn.style.borderBottomColor = ativo ? 'oklch(88% 0.018 80)' : 'transparent';
      }
      if (panel) panel.style.display = ativo ? '' : 'none';
    }
    // Lazy load por aba
    if (tab === 'timeline' && typeof loadTimeline === 'function' && !window._c360TimelineLoaded) {
      loadTimeline();
    }
  };

  window.c360Recalcular = function() {
    if (typeof showToast === 'function') showToast('Os scores serão recalculados na próxima sincronização com o Bling', 'info');
  };

  // ─── Insight IA (Fase 3) ───
  // Parser das 4 secoes fixas (ANALISE / RISCO / ACAO / MENSAGEM WHATSAPP)
  // A 4a secao foi adicionada na v13 do cliente360-insight pra alimentar
  // o botao verde de envio direto pelo WhatsApp Web. Insights antigos nao
  // tem essa secao — fallback gracioso (nao mostra o botao).
  // Retorna objeto { analise, risco, acao, mensagem_whatsapp }
  function parseInsightSecoes(md) {
    if (!md) return { analise: '', risco: '', acao: '', mensagem_whatsapp: '' };
    const secs = { analise: '', risco: '', acao: '', mensagem_whatsapp: '' };
    // Aceita variacoes dos labels (caps ou nao, com/sem dois pontos)
    // Inclui "mensagem whatsapp" como 4o label valido
    const re = /(an[aá]lise[^:\n]*comportamento[^:\n]*|risco[^:\n]*oportunidade[^:\n]*|a[cç][aã]o[^:\n]*comercial[^:\n]*|mensagem[^:\n]*whats?a?pp?[^:\n]*)\s*:\s*\n?([\s\S]*?)(?=\n\s*(?:an[aá]lise[^:\n]*comportamento|risco[^:\n]*oportunidade|a[cç][aã]o[^:\n]*comercial|mensagem[^:\n]*whats?a?pp?)[^:\n]*:|$)/gi;
    let m;
    while ((m = re.exec(md))) {
      const label = m[1].toLowerCase();
      const texto = m[2].trim();
      if (label.includes('compor')) secs.analise = texto;
      else if (label.includes('risc')) secs.risco = texto;
      else if (label.includes('mensagem') && label.includes('whats')) secs.mensagem_whatsapp = texto;
      else if (label.includes('a') && label.includes('o')) secs.acao = texto;
    }
    // Se nao parsear nada, coloca tudo em analise
    if (!secs.analise && !secs.risco && !secs.acao) secs.analise = md;
    return secs;
  }

  // ─── Timeline unificada (Onda #2) ───
  // Lê da view cliente_eventos_timeline (UNION de pedidos + contas_receber +
  // cliente_notas + cliente_insights). Lazy-load: só busca quando user abre a aba.
  // Cache via window._c360TimelineLoaded — invalida quando troca de cliente.
  const _TIMELINE_TIPOS = {
    pedido:    { icon: '🛒', cor: '#3b82f6', label: 'Pedido' },
    pagamento: { icon: '💰', cor: '#22c55e', label: 'Pagamento' },
    cobranca:  { icon: '⏰', cor: '#f59e0b', label: 'Cobrança' },
    nota:      { icon: '💬', cor: '#a855f7', label: 'Nota' },
    insight:   { icon: '🤖', cor: '#ec4899', label: 'Insight IA' },
  };

  function _timelineFmtData(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return 'Hoje · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Ontem';
    if (diffDays < 7) return diffDays + ' dias atrás';
    if (diffDays < 30) return Math.floor(diffDays / 7) + ' sem atrás';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function _timelineFiltrosHtml() {
    const tipos = ['todos', 'pedido', 'pagamento', 'cobranca', 'nota', 'insight'];
    const atual = window._c360TimelineFiltro || 'todos';
    return tipos.map(t => {
      const cfg = _TIMELINE_TIPOS[t] || { icon: '📍', cor: '#94a3b8', label: 'Tudo' };
      const ativo = atual === t;
      const cor = ativo ? cfg.cor : 'rgba(255,255,255,0.4)';
      return `<button onclick="c360TimelineFiltro('${t}')" style="padding:6px 12px;background:${ativo ? 'rgba(255,255,255,0.06)' : 'transparent'};border:1px solid ${ativo ? cfg.cor : 'rgba(255,255,255,0.1)'};border-radius:6px;color:${cor};font-size:12px;cursor:pointer;font-weight:${ativo?'600':'400'}">${cfg.icon} ${cfg.label}</button>`;
    }).join('');
  }

  window.c360TimelineFiltro = function(tipo) {
    window._c360TimelineFiltro = tipo;
    window._c360TimelinePage = 1; // reset paginacao ao trocar filtro
    _renderTimeline(window._c360TimelineCache || []);
  };

  window.c360TimelinePage = function(p) {
    window._c360TimelinePage = p;
    _renderTimeline(window._c360TimelineCache || []);
    // Scroll suave pro topo da timeline
    const panel = document.getElementById('c360-tabpanel-timeline');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function _renderTimelinePagBar(totalItens, page, perPage) {
    const totalPages = Math.max(1, Math.ceil(totalItens / perPage));
    if (totalPages <= 1) return '';
    page = Math.min(Math.max(1, page), totalPages);
    // Janela de páginas: mostra 1 ... N-1 N N+1 ... LAST
    const pages = new Set([1, totalPages, page, page-1, page+1]);
    const arr = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a,b) => a-b);
    let html = '';
    let last = 0;
    for (const p of arr) {
      if (p - last > 1) html += `<span style="padding:6px 4px;color:rgba(255,255,255,0.3);font-size:12px">…</span>`;
      const ativo = p === page;
      html += `<button onclick="c360TimelinePage(${p})" style="min-width:32px;padding:6px 10px;background:${ativo?'rgba(255,255,255,0.08)':'transparent'};border:1px solid ${ativo?'rgba(255,255,255,0.25)':'rgba(255,255,255,0.1)'};border-radius:6px;color:${ativo?'#e2e8f0':'rgba(255,255,255,0.6)'};font-size:12px;cursor:pointer;font-weight:${ativo?'700':'400'}">${p}</button>`;
      last = p;
    }
    const fromIdx = (page-1)*perPage + 1;
    const toIdx = Math.min(page*perPage, totalItens);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);flex-wrap:wrap;gap:10px">
        <div style="font-size:11.5px;color:rgba(255,255,255,0.5)">Exibindo ${fromIdx}–${toIdx} de ${totalItens}</div>
        <div style="display:flex;gap:4px;align-items:center">
          <button onclick="c360TimelinePage(${Math.max(1, page-1)})" ${page===1?'disabled':''} style="padding:6px 10px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:${page===1?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.6)'};font-size:12px;cursor:${page===1?'not-allowed':'pointer'}">← Ant</button>
          ${html}
          <button onclick="c360TimelinePage(${Math.min(totalPages, page+1)})" ${page===totalPages?'disabled':''} style="padding:6px 10px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:${page===totalPages?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.6)'};font-size:12px;cursor:${page===totalPages?'not-allowed':'pointer'}">Próx →</button>
        </div>
      </div>`;
  }

  function _renderTimeline(eventos) {
    const panel = document.getElementById('c360-tabpanel-timeline');
    if (!panel) return;
    const filtro = window._c360TimelineFiltro || 'todos';
    const visiveis = filtro === 'todos' ? eventos : eventos.filter(e => e.tipo === filtro);

    const filtrosHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${_timelineFiltrosHtml()}</div>`;

    if (!eventos.length) {
      panel.innerHTML = filtrosHtml + `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.4);font-size:13px">📭 Nenhum evento registrado pra esse cliente ainda</div>`;
      return;
    }
    if (!visiveis.length) {
      panel.innerHTML = filtrosHtml + `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.4);font-size:13px">Nenhum evento desse tipo</div>`;
      return;
    }

    // Paginacao: 20/pag
    const PER_PAGE = 20;
    const page = Math.max(1, window._c360TimelinePage || 1);
    const totalPages = Math.max(1, Math.ceil(visiveis.length / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    if (safePage !== page) window._c360TimelinePage = safePage;
    const startIdx = (safePage - 1) * PER_PAGE;
    const pageSlice = visiveis.slice(startIdx, startIdx + PER_PAGE);

    // Agrupa por data (yyyy-mm-dd) — apenas a página atual
    const grupos = {};
    for (const e of pageSlice) {
      const data = (e.data_evento || '').slice(0, 10);
      if (!grupos[data]) grupos[data] = [];
      grupos[data].push(e);
    }
    const datasOrdenadas = Object.keys(grupos).sort().reverse();

    const corpo = datasOrdenadas.map(data => {
      const dataLabel = _timelineFmtData(data + 'T12:00:00');
      const eventosDia = grupos[data];
      return `
        <div style="margin-bottom:18px">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);font-weight:600;text-transform:uppercase;margin-bottom:8px;padding-left:30px">${dataLabel}</div>
          ${eventosDia.map(e => {
            const cfg = _TIMELINE_TIPOS[e.tipo] || { icon: '📍', cor: '#94a3b8', label: e.tipo };
            const desc = e.descricao ? escapeHtml(e.descricao) : '';
            return `
              <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:6px;border-left:3px solid ${cfg.cor}">
                <div style="font-size:18px;flex-shrink:0">${cfg.icon}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;color:#e2e8f0;font-weight:600;margin-bottom:2px">${escapeHtml(e.titulo || cfg.label)}</div>
                  ${desc ? `<div style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.4;word-break:break-word">${desc}</div>` : ''}
                </div>
                <div style="font-size:10.5px;color:rgba(255,255,255,0.35);flex-shrink:0;white-space:nowrap">${new Date(e.data_evento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }).join('');

    const totalLabel = visiveis.length < eventos.length
      ? `<span style="color:rgba(255,255,255,0.4);font-size:11px;margin-left:6px">${visiveis.length} de ${eventos.length}</span>`
      : `<span style="color:rgba(255,255,255,0.4);font-size:11px;margin-left:6px">${eventos.length} eventos</span>`;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:14px;font-weight:600;color:#e2e8f0">📜 Histórico do cliente${totalLabel}</div>
        <button onclick="loadTimeline(true)" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#94a3b8;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer">🔄 Atualizar</button>
      </div>
      ${filtrosHtml}
      ${corpo}
      ${_renderTimelinePagBar(visiveis.length, safePage, PER_PAGE)}
    `;
  }

  window.loadTimeline = async function(force) {
    const panel = document.getElementById('c360-tabpanel-timeline');
    if (!panel) return;
    const nome = state.currentContatoNome;
    if (!nome) {
      panel.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);font-size:13px">Sem cliente selecionado</div>';
      return;
    }
    if (window._c360TimelineLoaded && !force) return;
    panel.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4)">⏳ Carregando timeline...</div>';
    try {
      const { data, error } = await state.sb
        .from('cliente_eventos_timeline')
        .select('contato_nome, data_evento, tipo, titulo, descricao, dados, empresa')
        .eq('contato_nome', nome)
        .order('data_evento', { ascending: false })
        .limit(500);
      if (error) throw error;
      window._c360TimelineCache = data || [];
      window._c360TimelineLoaded = true;
      window._c360TimelinePage = 1; // reset paginacao
      _renderTimeline(data || []);
    } catch (e) {
      console.error('[c360 timeline] erro:', e);
      panel.innerHTML = `<div style="color:#ef4444;padding:20px;font-size:12px">Erro ao carregar: ${escapeHtml(String(e.message||e))}</div>`;
    }
  };

  // Abre WhatsApp Web pre-formatado pra mensagem do insight
  // Padrao igual ao usado em Prospeccao: strip nao-digitos + prefixo 55 se length 10/11
  function c360OpenWhatsApp(contatoNome, msgEncoded) {
    try {
      const msg = decodeURIComponent(msgEncoded || '');
      const c = (state.clientes || []).find(x => x.contato_nome === contatoNome);
      const fone = (c && (c.celular || c.telefone)) || '';
      const digits = String(fone).replace(/\D/g, '');
      if (!digits) {
        if (typeof toast === 'function') toast('Cliente sem telefone cadastrado.', 'error');
        else alert('Cliente sem telefone cadastrado.');
        return;
      }
      const numFmt = (digits.length === 10 || digits.length === 11) ? ('55' + digits) : digits;
      const url = `https://wa.me/${numFmt}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.warn('[c360] WhatsApp link erro:', e);
    }
  }
  // Expoe pro onclick inline funcionar
  window.c360OpenWhatsApp = c360OpenWhatsApp;

  function formatTextoInsight(t) {
    if (!t) return '';
    let h = escapeHtml(t);
    // Negrito **texto** → realce em cor champanhe
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:oklch(88% 0.018 80)">$1</strong>');
    // Remove headers markdown (# / ## / ###)
    h = h.replace(/^#{1,6}\s*/gm, '');
    // Topicos com emoji no inicio de linha (ex: "📋 Perfil", "📊 Padrão de Compra", "⚠️ Riscos")
    // Viram sub-headers destacados
    h = h.replace(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}][\uFE0F]?\s+[A-ZÁÉÍÓÚÂÊÎÔÛÀÃÕÇ][\wÀ-ÿ\s]{2,60})\s*$/gmu,
      '<div style="margin:12px 0 4px;font-size:13px;font-weight:700;color:oklch(88% 0.018 80)">$1</div>');
    // Linhas que sao so um rotulo tipo "Perfil:" ou "Risco:" viram sub-headers
    h = h.replace(/^([A-ZÁÉÍÓÚÂÊÎÔÛÀÃÕÇ][\wÀ-ÿ\s]{2,40}):\s*$/gm,
      '<div style="margin:12px 0 4px;font-size:13px;font-weight:700;color:oklch(88% 0.018 80)">$1:</div>');
    // Listas com hifen → bullets estilizados
    h = h.replace(/(?:^|\n)((?:- [^\n]+\n?)+)/g, (m) => {
      const items = m.trim().split(/\n/).map(l => l.replace(/^-\s+/, '').trim()).filter(Boolean);
      return '\n<ul style="margin:6px 0 10px 18px;padding:0;list-style:disc;color:#cbd5e1;font-size:13.5px">' + items.map(i => `<li style="margin-bottom:4px;line-height:1.55">${i}</li>`).join('') + '</ul>\n';
    });
    // Quebras duplas viram paragrafos
    const blocks = h.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    return blocks.map(p => {
      // Se ja é bloco HTML (div/ul), nao embrulha em <p>
      if (p.startsWith('<div') || p.startsWith('<ul') || p.startsWith('<p')) return p;
      return `<p style="margin:0 0 8px;line-height:1.65;color:#cbd5e1;font-size:13.5px">${p.replace(/\n/g,' ')}</p>`;
    }).join('');
  }

  async function c360GenerateInsight(contatoNome) {
    const { data: { session } } = await state.sb.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Relogue.');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/cliente360-insight`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contato_nome: contatoNome, empresa: state.empresa }),
    });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || ('Erro ' + resp.status));
    return j;
  }

  async function c360LoadInsightsHistory(contatoNome) {
    const { data } = await state.sb
      .from('cliente_insights')
      .select('*')
      .eq('empresa', state.empresa)
      .eq('contato_nome', contatoNome)
      .order('created_at', { ascending: false })
      .limit(10);
    return data || [];
  }

  function insightCard(ins, isNewest, contatoNome) {
    const s = parseInsightSecoes(ins.insight || '');
    const data = new Date(ins.created_at);
    const dataStr = data.toLocaleDateString('pt-BR');
    const dataFull = data.toLocaleString('pt-BR');
    const secBlock = (label, conteudo) => conteudo ? `
      <div style="margin-top:16px">
        <div style="font-size:10.5px;font-weight:700;color:oklch(88% 0.018 80);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">${label}:</div>
        ${formatTextoInsight(conteudo)}
      </div>` : '';
    // Bloco WhatsApp: so renderiza se a IA gerou a 4a secao E o cliente tem fone
    const c = (state.clientes || []).find(x => x.contato_nome === contatoNome);
    const temFone = !!(c && (c.celular || c.telefone));
    const msgWa = (s.mensagem_whatsapp || '').trim();
    const waBlock = (msgWa && temFone) ? `
      <div style="margin-top:16px;padding:14px;border-radius:10px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.25)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
          <div style="font-size:10.5px;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:0.8px">Mensagem WhatsApp pronta:</div>
          <button onclick="c360OpenWhatsApp('${escapeHtml(contatoNome).replace(/'/g, "&#39;")}', '${encodeURIComponent(msgWa)}')" title="Abrir WhatsApp Web" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;border:none;background:#22c55e;color:#fff;font-size:12px;font-weight:700;cursor:pointer" onmouseover="this.style.background='#16a34a'" onmouseout="this.style.background='#22c55e'"><span style="font-size:14px">📱</span> Enviar pelo WhatsApp</button>
        </div>
        <div style="font-size:13px;color:#cbd5e1;line-height:1.6;background:rgba(0,0,0,0.2);padding:10px 12px;border-radius:6px;white-space:pre-wrap">${escapeHtml(msgWa)}</div>
        <div style="font-size:10.5px;color:#64748b;margin-top:6px">Você pode editar a mensagem direto no WhatsApp Web antes de enviar.</div>
      </div>` : (msgWa && !temFone) ? `
      <div style="margin-top:16px;padding:10px 12px;border-radius:8px;background:rgba(148,163,184,0.06);border:1px dashed rgba(148,163,184,0.25);font-size:12px;color:#94a3b8">
        💬 IA sugeriu uma mensagem WhatsApp, mas o cliente está sem telefone cadastrado.
      </div>` : '';
    return `
      <div style="background:rgba(255,255,255,0.02);border:1px solid oklch(88% 0.018 80 / 0.3);border-radius:12px;padding:20px;margin-bottom:14px;position:relative">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <div style="width:32px;height:32px;border-radius:8px;background:oklch(88% 0.018 80 / 0.15);display:flex;align-items:center;justify-content:center;color:oklch(88% 0.018 80);font-size:16px;flex-shrink:0">◉</div>
            <div style="min-width:0">
              <div style="font-size:15px;font-weight:700;color:oklch(88% 0.018 80);text-align:left">Análise de Comportamento</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;text-align:left">${ins.modelo || 'IA'} · por ${escapeHtml(ins.user_nome || '—')}${isNewest ? ' · <span style="color:#22c55e;font-weight:600">◉ mais recente</span>' : ''}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span style="font-size:11px;color:#64748b" title="${dataFull}">${dataStr}</span>
            <button onclick="c360DeleteInsight(${ins.id}, this)" title="Apagar insight" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:transparent;color:#ef4444;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='transparent'">🗑</button>
          </div>
        </div>
        ${secBlock('Análise do Comportamento Atual', s.analise)}
        ${secBlock('Risco ou Oportunidade Principal', s.risco)}
        ${secBlock('Ação Comercial Recomendada', s.acao)}
        ${waBlock}
      </div>`;
  }

  async function c360LoadInsightQuota() {
    try {
      const { data: { user } } = await state.sb.auth.getUser();
      if (!user) return null;
      const { data: profile } = await state.sb.from('profiles').select('cargo').eq('id', user.id).single();
      const cargo = profile?.cargo || 'vendedor';
      if (cargo === 'admin') return { cargo, ilimitado: true };
      const { data: cfg } = await state.sb.from('cliente_insights_config').select('*').eq('id', 1).single();
      if (!cfg || !cfg.ativo) return { cargo, desativado: true };
      if (cfg.pausado_por_limite) return { cargo, pausado: true };
      const limite = ['gerente_comercial','gerente_marketing'].includes(cargo)
        ? (cfg.limite_diario_gerente || 20)
        : (cfg.limite_diario_vendedor || 5);
      const { data: usados } = await state.sb.rpc('cliente_insights_count_hoje', { uid: user.id });
      return { cargo, usados: Number(usados) || 0, limite, restante: Math.max(0, limite - (Number(usados) || 0)) };
    } catch (e) { console.warn('[insight] quota:', e); return null; }
  }

  function renderInsightsTab(contatoNome, insights, gerando) {
    const panel = document.getElementById('c360-tabpanel-insights');
    if (!panel) return;
    const cards = (insights || []).map((ins, idx) => insightCard(ins, idx === 0, contatoNome)).join('');

    // Quota badge
    const q = state.c360InsightQuota;
    let quotaBadge = '';
    let podeGerar = true;
    if (q) {
      if (q.ilimitado) {
        quotaBadge = '<span style="font-size:11px;padding:3px 10px;background:rgba(168,85,247,0.12);color:#a855f7;border:1px solid rgba(168,85,247,0.3);border-radius:999px;font-weight:700">∞ ADMIN</span>';
      } else if (q.desativado) {
        quotaBadge = '<span style="font-size:11px;padding:3px 10px;background:rgba(100,116,139,0.15);color:#64748b;border-radius:999px">⏸ Desativado</span>';
        podeGerar = false;
      } else if (q.pausado) {
        quotaBadge = '<span style="font-size:11px;padding:3px 10px;background:rgba(239,68,68,0.15);color:#ef4444;border-radius:999px">🚫 Limite mensal</span>';
        podeGerar = false;
      } else {
        const cor = q.restante === 0 ? '#ef4444' : q.restante <= 1 ? '#fbbf24' : '#22c55e';
        quotaBadge = `<span style="font-size:11px;padding:3px 10px;background:${cor}20;color:${cor};border:1px solid ${cor}50;border-radius:999px;font-weight:700">${q.usados}/${q.limite} hoje</span>`;
        if (q.restante === 0) podeGerar = false;
      }
    }

    const desabilitado = gerando || !podeGerar;

    panel.innerHTML = `
      <div style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
          <div style="font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:10px">
            <span>Análises geradas por IA (Groq Llama 3.3 · fallback Gemini 2.5)</span>
            ${quotaBadge}
          </div>
          <button onclick="c360InsightIA()" ${desabilitado?'disabled':''} style="padding:8px 16px;border-radius:8px;border:1px solid oklch(88% 0.018 80 / 0.5);background:oklch(88% 0.018 80 / 0.12);color:oklch(88% 0.018 80);cursor:${desabilitado?'not-allowed':'pointer'};font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;opacity:${desabilitado?0.4:1}">
            ${gerando ? '⏳ Gerando...' : !podeGerar ? '🚫 Indisponível' : '◆ Gerar novo Insight'}
          </button>
        </div>
        ${insights.length === 0
          ? '<div style="padding:40px;text-align:center;color:#64748b"><div style="font-size:32px;margin-bottom:8px;color:oklch(88% 0.018 80)">◉</div><div style="font-size:14px;margin-bottom:4px;color:#e2e8f0">Nenhum insight gerado ainda</div><div style="font-size:12px">Clique em "Gerar novo Insight" pra criar o primeiro.</div></div>'
          : cards}
      </div>`;
  }

  // ─── Notas por cliente (Fase 4) ───
  // Cache de users mencionáveis (carregado on-demand)
  state.mencionaveis = null; // array de { id, nome, cargo }

  async function loadMencionaveis() {
    if (state.mencionaveis) return state.mencionaveis;
    // Busca cargos que têm permissão cliente360=true
    const { data: perms } = await state.sb
      .from('cargo_permissoes')
      .select('cargo')
      .eq('secao', 'cliente360')
      .eq('permitido', true);
    const cargosAutorizados = new Set((perms || []).map(p => p.cargo));
    cargosAutorizados.add('admin'); // admin sempre pode
    // Busca profiles com esses cargos
    const { data: profiles } = await state.sb
      .from('profiles')
      .select('id, nome, cargo')
      .order('nome');
    state.mencionaveis = (profiles || []).filter(p => cargosAutorizados.has(p.cargo));
    return state.mencionaveis;
  }

  async function loadNotasCliente(contatoNome) {
    const { data, error } = await state.sb
      .from('cliente_notas')
      .select('*')
      .eq('empresa', state.empresa)
      .eq('contato_nome', contatoNome)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.warn('[c360] notas erro:', error); return []; }
    return data || [];
  }

  // Parse texto da nota: marca @Nome substituindo por link estilizado
  function renderTextoNota(texto, mentionsIds) {
    if (!texto) return '';
    let h = escapeHtml(texto);
    // Destaca @Nome (qualquer combinacao de palavras nos mencionaveis)
    const lista = (state.mencionaveis || []);
    for (const m of lista) {
      const nomeEsc = escapeHtml(m.nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('@' + nomeEsc, 'g');
      h = h.replace(re, `<span style="color:oklch(88% 0.018 80);font-weight:600;background:oklch(88% 0.018 80 / 0.1);padding:1px 4px;border-radius:4px">@${escapeHtml(m.nome)}</span>`);
    }
    // Quebras de linha simples
    return h.replace(/\n/g, '<br>');
  }

  function notaCard(n, currentUserId) {
    const autor = n.user_nome || '—';
    const inicial = (autor.trim()[0] || '?').toUpperCase();
    const quando = new Date(n.created_at);
    const diff = Date.now() - quando.getTime();
    let quandoStr;
    if (diff < 60_000) quandoStr = 'agora';
    else if (diff < 3600_000) quandoStr = Math.floor(diff/60000) + 'min atrás';
    else if (diff < 86400_000) quandoStr = Math.floor(diff/3600000) + 'h atrás';
    else quandoStr = quando.toLocaleString('pt-BR');
    const isOwn = String(n.user_id) === String(currentUserId);
    const isAdmin = state.currentCargo === 'admin';
    const canDelete = isOwn || isAdmin;
    return `
      <div id="nota-${n.id}" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(167,139,250,0.2);color:#a78bfa;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${escapeHtml(inicial)}</div>
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:600;color:#e2e8f0">${escapeHtml(autor)}</div>
              <div style="font-size:11px;color:#64748b">${quandoStr}${n.updated_at ? ' · editada' : ''}</div>
            </div>
          </div>
          ${(isOwn || isAdmin) ? `
          <div style="display:flex;gap:4px">
            ${isOwn ? `<button onclick="c360EditNota(${n.id})" title="Editar" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#94a3b8;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center">✏</button>` : ''}
            <button onclick="c360DeleteNota(${n.id})" title="Apagar" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:transparent;color:#ef4444;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center">🗑</button>
          </div>` : ''}
        </div>
        <div id="nota-texto-${n.id}" style="font-size:13.5px;line-height:1.6;color:#cbd5e1;white-space:pre-wrap;word-break:break-word">${renderTextoNota(n.texto, n.mentions_ids)}</div>
      </div>`;
  }

  // Editar nota
  window.c360EditNota = function(id) {
    const card = document.getElementById('nota-' + id);
    if (!card) return;
    const textoEl = document.getElementById('nota-texto-' + id);
    if (!textoEl) return;
    // Busca o texto original na lista em memória (armazenamos via data-attr)
    // Como não temos cache local, buscamos do DB
    state.sb.from('cliente_notas').select('texto').eq('id', id).single().then(({ data }) => {
      if (!data) return;
      const textoOrig = data.texto || '';
      textoEl.innerHTML = `
        <textarea id="nota-edit-${id}" rows="3" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:13.5px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box">${escapeHtml(textoOrig)}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button onclick="c360SaveEditNota(${id})" style="padding:6px 14px;border-radius:6px;border:1px solid oklch(88% 0.018 80 / 0.5);background:oklch(88% 0.018 80 / 0.12);color:oklch(88% 0.018 80);cursor:pointer;font-size:12.5px;font-weight:600">Salvar</button>
          <button onclick="c360CancelEditNota(${id})" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#94a3b8;cursor:pointer;font-size:12.5px">Cancelar</button>
        </div>`;
      const ta = document.getElementById('nota-edit-' + id);
      if (ta) ta.focus();
    });
  };

  window.c360CancelEditNota = async function(id) {
    // Re-renderiza a aba toda — simples e seguro
    const page = document.getElementById('page-cliente-1');
    const nome = page?.querySelector('h2')?.textContent?.trim();
    if (nome) await renderNotasTab(nome);
  };

  window.c360SaveEditNota = async function(id) {
    const ta = document.getElementById('nota-edit-' + id);
    if (!ta) return;
    const novoTexto = (ta.value || '').trim();
    if (!novoTexto) return;
    const mentions = extractMentions(novoTexto);
    const { error } = await state.sb.from('cliente_notas').update({
      texto: novoTexto,
      mentions_ids: mentions,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) {
      if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error');
      return;
    }
    if (typeof showToast === 'function') showToast('Nota atualizada', 'success');
    // Realtime vai atualizar, mas forçamos aqui também (sem delay)
    const page = document.getElementById('page-cliente-1');
    const nome = page?.querySelector('h2')?.textContent?.trim();
    if (nome) await renderNotasTab(nome);
  };

  async function renderNotasTab(contatoNome) {
    const panel = document.getElementById('c360-tabpanel-notas');
    if (!panel) return;
    const [{ data: { user } }, notas, mencionaveis] = await Promise.all([
      state.sb.auth.getUser(),
      loadNotasCliente(contatoNome),
      loadMencionaveis(),
    ]);
    // Guarda cargo do usuario atual pra controle de delete
    if (user) {
      const { data: p } = await state.sb.from('profiles').select('cargo').eq('id', user.id).maybeSingle();
      state.currentCargo = p?.cargo;
    }
    const currentUserId = user?.id;

    const cards = notas.length === 0
      ? '<div style="padding:30px;text-align:center;color:#64748b"><div style="font-size:28px;margin-bottom:6px">💬</div><div style="font-size:13px;color:#e2e8f0">Nenhuma nota ainda</div><div style="font-size:11.5px;margin-top:2px">Adicione observações, lembretes ou histórico de contato deste cliente.</div></div>'
      : notas.map(n => notaCard(n, currentUserId)).join('');

    panel.innerHTML = `
      <div style="padding:20px">
        <!-- Form de nova nota -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:18px;position:relative">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);margin-bottom:8px">Nova nota</div>
          <textarea id="c360-nota-input" placeholder="Escreva uma nota sobre ${escapeHtml(contatoNome)}... Use @nome pra mencionar um colega" rows="3"
            style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:13.5px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box"></textarea>
          <!-- Dropdown de menção (absoluto, aparece ao digitar @) -->
          <div id="c360-mention-dropdown" style="display:none;position:absolute;background:rgb(20,20,25);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px;z-index:100;max-height:180px;overflow-y:auto;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,0.3)"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:10px">
            <div style="font-size:11px;color:#64748b">Mencionáveis: ${mencionaveis.length} pessoa(s) com acesso ao Cliente 360</div>
            <button onclick="c360SaveNota()" id="c360-btn-nota" style="padding:8px 16px;border-radius:8px;border:1px solid oklch(88% 0.018 80 / 0.5);background:oklch(88% 0.018 80 / 0.12);color:oklch(88% 0.018 80);cursor:pointer;font-size:13px;font-weight:600">💬 Adicionar nota</button>
          </div>
        </div>
        <!-- Lista de notas -->
        <div id="c360-notas-lista">${cards}</div>
      </div>`;

    // Autocomplete @
    wireMentionAutocomplete();
  }

  function wireMentionAutocomplete() {
    const input = document.getElementById('c360-nota-input');
    const drop = document.getElementById('c360-mention-dropdown');
    if (!input || !drop) return;
    let aIdx = -1; // posicao do @ atual

    const close = () => { drop.style.display = 'none'; aIdx = -1; };

    input.addEventListener('input', (e) => {
      const val = input.value;
      const caret = input.selectionStart;
      const before = val.slice(0, caret);
      const atMatch = /(?:^|\s)@([^\s]{0,30})$/.exec(before);
      if (!atMatch) { close(); return; }
      aIdx = caret - atMatch[1].length - 1; // posicao do @
      const query = atMatch[1].toLowerCase();
      const matches = (state.mencionaveis || [])
        .filter(m => m.nome && m.nome.toLowerCase().includes(query))
        .slice(0, 6);
      if (matches.length === 0) { close(); return; }
      drop.innerHTML = matches.map((m, i) => `
        <div class="c360-mention-opt" data-id="${m.id}" data-nome="${escapeHtml(m.nome)}" data-idx="${i}"
          style="padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;color:#e2e8f0;display:flex;align-items:center;gap:8px"
          onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background=''">
          <div style="width:20px;height:20px;border-radius:50%;background:rgba(167,139,250,0.2);color:#a78bfa;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${escapeHtml((m.nome.trim()[0]||'?').toUpperCase())}</div>
          <div><div>${escapeHtml(m.nome)}</div><div style="font-size:10.5px;color:#64748b">${escapeHtml(m.cargo || '')}</div></div>
        </div>
      `).join('');
      drop.style.display = 'block';
      drop.style.left = '14px';
      drop.style.top = (input.offsetTop + input.offsetHeight + 4) + 'px';
    });

    drop.addEventListener('click', (e) => {
      const opt = e.target.closest('.c360-mention-opt');
      if (!opt) return;
      const nome = opt.getAttribute('data-nome');
      const id = opt.getAttribute('data-id');
      if (aIdx < 0) return;
      // Insere @Nome no lugar
      const val = input.value;
      const caret = input.selectionStart;
      const novo = val.slice(0, aIdx) + '@' + nome + ' ' + val.slice(caret);
      input.value = novo;
      input.focus();
      const newCaret = aIdx + nome.length + 2;
      input.setSelectionRange(newCaret, newCaret);
      close();
    });

    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // Detecta @mencoes no texto e retorna array de user ids
  function extractMentions(texto) {
    const ids = [];
    const lista = state.mencionaveis || [];
    for (const m of lista) {
      const nomeEsc = m.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('@' + nomeEsc + '(?:\\s|$|[^\\w])');
      if (re.test(texto)) ids.push(m.id);
    }
    return ids;
  }

  window.c360SaveNota = async function() {
    const page = document.getElementById('page-cliente-1');
    const nomeEl = page?.querySelector('h2');
    const contatoNome = nomeEl?.textContent?.trim();
    if (!contatoNome) return;
    const input = document.getElementById('c360-nota-input');
    const btn = document.getElementById('c360-btn-nota');
    const texto = (input?.value || '').trim();
    if (!texto) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const { data: { user } } = await state.sb.auth.getUser();
      const { data: profile } = await state.sb.from('profiles').select('nome, cargo').eq('id', user.id).single();
      const mentions = extractMentions(texto);
      const { data: novaNota, error } = await state.sb.from('cliente_notas').insert({
        empresa: state.empresa,
        contato_nome: contatoNome,
        texto,
        mentions_ids: mentions,
        user_id: user.id,
        user_nome: profile?.nome || user.email,
        user_cargo: profile?.cargo,
      }).select().single();
      if (error) throw error;

      // Cria alertas pra cada menção
      if (mentions.length > 0) {
        const alertas = mentions.map(uid => {
          const mUser = (state.mencionaveis || []).find(m => m.id === uid);
          return {
            tipo: 'mencao_nota_cliente',
            nivel: 'info',
            titulo: `${profile?.nome || 'Alguém'} mencionou você`,
            mensagem: `Em nota sobre ${contatoNome}: "${texto.slice(0, 120)}${texto.length > 120 ? '...' : ''}"`,
            destinatario_id: uid,
            destinatario_nome: mUser?.nome || null,
            link_ref: 'cliente360',
            link_label: 'Ver nota',
            audiencia: 'pessoal',
            dados: {
              empresa: state.empresa,
              contato_nome: contatoNome,
              tab: 'notas',
              nota_id: novaNota?.id,
            },
          };
        });
        const { error: alErr } = await state.sb.from('alertas').insert(alertas);
        if (alErr) console.warn('[c360] erro criar alertas:', alErr);
      }

      if (input) input.value = '';
      await renderNotasTab(contatoNome);
      if (typeof showToast === 'function') showToast('Nota adicionada' + (mentions.length ? ` · ${mentions.length} notificação(ões)` : ''), 'success');
    } catch (e) {
      console.error('[c360] erro salvar nota:', e);
      if (typeof showToast === 'function') showToast('Erro: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💬 Adicionar nota'; }
    }
  };

  window.c360DeleteNota = async function(id) {
    const ok = await c360Confirm('Apagar esta nota?', { danger: true, okLabel: 'Apagar nota' });
    if (!ok) return;
    const { error } = await state.sb.from('cliente_notas').delete().eq('id', id);
    if (error) {
      if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error');
      return;
    }
    const el = document.getElementById('nota-' + id);
    if (el) el.remove();
    if (typeof showToast === 'function') showToast('Nota apagada', 'success');
  };

  // Abre cliente especifico + aba baseado num spec {empresa, contato_nome, tab, nota_id}
  async function openClienteFromSpec(spec) {
    try {
      if (!spec || !spec.contato_nome) return;
      if (spec.empresa && spec.empresa !== state.empresa && (spec.empresa === 'matriz' || spec.empresa === 'bc')) {
        await window.c360SetEmpresa(spec.empresa);
      }
      await window.showClientDetail(encodeURIComponent(spec.contato_nome));
      if (spec.tab) {
        setTimeout(() => window.c360SwitchTab(spec.tab), 300);
        if (spec.nota_id) {
          setTimeout(() => {
            const el = document.getElementById('nota-' + spec.nota_id);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.style.transition = 'background .3s';
              el.style.background = 'oklch(88% 0.018 80 / 0.12)';
              setTimeout(() => { el.style.background = ''; }, 2000);
            }
          }, 900);
        }
      }
    } catch(e) { console.warn('[c360] openClienteFromSpec:', e); }
  }

  // Deep-link vindo do DMS: sessionStorage (fallback) + postMessage (online)
  async function checkDeepLink() {
    try {
      const raw = sessionStorage.getItem('c360_open_cliente');
      if (raw) {
        sessionStorage.removeItem('c360_open_cliente');
        await openClienteFromSpec(JSON.parse(raw));
      }
    } catch(e) { console.warn('[c360] deep-link session:', e); }
    // Abre aba especifica (ex: vindo do calendario → Campanhas)
    try {
      const tab = sessionStorage.getItem('c360_open_tab');
      if (tab) {
        sessionStorage.removeItem('c360_open_tab');
        setTimeout(() => {
          if (typeof window.showPage === 'function') window.showPage(tab);
        }, 200);
      }
    } catch(e) { console.warn('[c360] deep-link tab:', e); }
  }

  // postMessage do DMS pai - funciona mesmo com iframe ja montado
  window.addEventListener('message', async (e) => {
    if (!e || !e.data) return;
    if (e.data.type === 'c360_open_cliente') {
      console.log('[c360] postMessage deep-link cliente:', e.data.spec);
      await openClienteFromSpec(e.data.spec);
    } else if (e.data.type === 'c360_open_tab') {
      console.log('[c360] postMessage deep-link tab:', e.data.tab);
      if (typeof window.showPage === 'function') window.showPage(e.data.tab);
    }
  });

  // ─── Realtime: sincroniza notas entre usuarios ───
  function subscribeRealtimeNotas() {
    if (state.notasChannel) return; // ja subscribed
    state.notasChannel = state.sb
      .channel('realtime-cliente-notas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cliente_notas' }, async (payload) => {
        console.log('[c360] realtime notas:', payload.eventType, payload);
        // Se o cliente atual está aberto e a mudanca eh dele, refresca a aba
        const page = document.getElementById('page-cliente-1');
        const nomeEl = page?.querySelector('h2');
        const nomeAtual = nomeEl?.textContent?.trim();
        if (!nomeAtual) return;
        const row = payload.new || payload.old;
        if (!row) return;
        if (row.empresa !== state.empresa || row.contato_nome !== nomeAtual) return;
        // Reset data-loaded-for pra forcar re-render
        const panel = document.getElementById('c360-tabpanel-notas');
        if (panel) panel.removeAttribute('data-loaded-for');
        // Se a aba Notas esta visivel, re-renderiza na hora
        const tabBtn = document.getElementById('c360-tab-notas');
        const ativa = tabBtn?.style.borderBottomColor && tabBtn.style.borderBottomColor !== 'transparent';
        if (ativa || (panel && panel.style.display !== 'none')) {
          await renderNotasTab(nomeAtual);
        }
      })
      .subscribe();
  }

  // Apagar insight
  window.c360DeleteInsight = async function(id, btn) {
    const ok = await c360Confirm('Apagar esta análise?', { danger: true, okLabel: 'Apagar análise' });
    if (!ok) return;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const { error } = await state.sb.from('cliente_insights').delete().eq('id', id);
    if (error) {
      if (typeof showToast === 'function') showToast('Erro ao apagar: ' + error.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🗑'; }
      return;
    }
    // Remove o card do DOM
    const card = btn?.closest('div[style*="border-radius:12px"]');
    if (card) card.remove();
    if (typeof showToast === 'function') showToast('Análise apagada', 'success');
  };

  // Botão do header (◆ Insight IA) + aba Insights IA compartilham lógica
  window.c360InsightIA = async function() {
    const page = document.getElementById('page-cliente-1');
    const nomeEl = page?.querySelector('h2');
    const nome = nomeEl?.textContent?.trim();
    if (!nome) return;

    // Muda pra aba insights
    c360SwitchTab('insights');
    state.c360InsightQuota = await c360LoadInsightQuota();
    const history = await c360LoadInsightsHistory(nome);
    renderInsightsTab(nome, history, true);

    try {
      const result = await c360GenerateInsight(nome);
      if (result.quota) state.c360InsightQuota = { cargo: state.c360InsightQuota?.cargo, ...result.quota };
      if (typeof showToast === 'function') {
        const msg = result.quota ? `Insight gerado! (${result.quota.usados}/${result.quota.limite} hoje)` : 'Insight gerado!';
        showToast(msg, 'success');
      }
      // Reload com o novo insight no topo
      const newHistory = await c360LoadInsightsHistory(nome);
      renderInsightsTab(nome, newHistory, false);
    } catch (e) {
      console.error('[c360] erro insight:', e);
      // Se erro 429 (quota), recarrega quota pra UI refletir
      if (String(e.message).includes('quota') || String(e.message).includes('Quota')) {
        state.c360InsightQuota = await c360LoadInsightQuota();
      }
      if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
      renderInsightsTab(nome, history, false);
    }
  };

  // Ao trocar pra aba insights/notas, carrega conteúdo on-demand
  const origSwitchTab = window.c360SwitchTab;
  window.c360SwitchTab = async function(tab) {
    origSwitchTab(tab);
    const page = document.getElementById('page-cliente-1');
    const nomeEl = page?.querySelector('h2');
    const nome = nomeEl?.textContent?.trim();
    if (!nome) return;

    if (tab === 'insights') {
      const panel = document.getElementById('c360-tabpanel-insights');
      if (panel && panel.getAttribute('data-loaded-for') !== nome) {
        panel.setAttribute('data-loaded-for', nome);
        state.c360InsightQuota = await c360LoadInsightQuota();
        const history = await c360LoadInsightsHistory(nome);
        renderInsightsTab(nome, history, false);
      }
    } else if (tab === 'notas') {
      const panel = document.getElementById('c360-tabpanel-notas');
      if (panel && panel.getAttribute('data-loaded-for') !== nome) {
        panel.setAttribute('data-loaded-for', nome);
        await renderNotasTab(nome);
      }
    }
  };

  // ─── Dashboard principal (Commit 3) ───
  const dashCache = { matriz: null, bc: null };

  async function loadDashboardResumo() {
    try {
      // Cache 5min
      const cached = dashCache[state.empresa];
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        renderDashboard(cached.data);
        return;
      }
      const { data, error } = await state.sb
        .from('cliente_scoring_resumo')
        .select('*')
        .eq('empresa', state.empresa)
        .maybeSingle();
      if (error) {
        console.warn('[c360] dash resumo erro:', error?.message || error);
        renderDashboardErro(error?.message || 'Erro ao carregar resumo');
        return;
      }
      if (!data) {
        console.warn('[c360] dash resumo SEM DADOS (empresa=' + state.empresa + ')');
        renderDashboardErro('Sem dados pra empresa "' + state.empresa + '" na view cliente_scoring_resumo. A view existe mas nao retornou linhas — pode ser RLS ou empresa errada.');
        return;
      }
      console.log('[c360] dash resumo OK:', data);
      dashCache[state.empresa] = { data, ts: Date.now() };
      renderDashboard(data);
    } catch (e) {
      console.error('[c360] dash exception:', e);
      renderDashboardErro('Exception: ' + (e?.message || e));
    }
  }

  // Renderiza um placeholder claro quando o resumo falha — substitui a tela
  // demo "antiga" que vinha do cliente-360.html base e ficava travada em
  // "Carregando..." quando renderDashboard nao era chamado.
  function renderDashboardErro(msg) {
    const page = document.getElementById('page-dashboard');
    if (!page) return;
    page.innerHTML = `
      <div style="padding:32px;max-width:900px;margin:0 auto">
        <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Dashboard</h1>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:24px">Visao executiva do relacionamento com clientes — ${EMPRESA_LABELS[state.empresa] || state.empresa}</div>
        <div style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.25);border-radius:12px;padding:20px;color:#fca5a5">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">Nao foi possivel carregar o dashboard</div>
          <div style="font-size:12.5px;color:#fecaca;line-height:1.5">${escapeHtml(String(msg || ''))}</div>
          <button onclick="window.c360ReloadDashboard && window.c360ReloadDashboard()" style="margin-top:12px;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px">Tentar de novo</button>
        </div>
      </div>`;
  }

  function renderDashboard(r) {
    const page = document.getElementById('page-dashboard');
    if (!page) return;

    // 4 alertas inteligentes
    const alertCard = (icon, label, sub, n, color, filterFn) => `
      <button type="button" onclick="${filterFn}" style="background:rgba(255,255,255,0.03);border:1px solid ${color};border-radius:12px;padding:16px;text-align:left;cursor:pointer;transition:transform 0.15s;font-family:inherit" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="color:${color.replace('0.4','1').replace('rgba','rgb').replace(/,\d\.?\d*\)/,')')};font-size:16px">${icon}</div>
          <div>
            <div style="font-size:22px;font-weight:700;color:#f1f5f9">${fmtNum(n)}</div>
            <div style="font-size:13px;color:#f1f5f9;font-weight:500">${label}</div>
          </div>
        </div>
        <div style="font-size:11px;color:#64748b">${sub}</div>
      </button>`;

    // 5 métricas principais
    const metricCard = (icon, label, valor, sub, iconColor, fontSize) => {
      const fs = fontSize || 22;
      return `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px;min-width:0">
        <div style="font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <span style="color:${iconColor}">${icon}</span> ${label}
        </div>
        <div style="font-size:${fs}px;font-weight:700;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums" title="${escapeHtml(String(valor))}">${valor}</div>
        ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${sub}</div>` : ''}
      </div>`;
    };

    page.innerHTML = `
<div style="padding:24px;max-width:1400px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
    <div>
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Dashboard</h1>
      <div style="font-size:13px;color:#94a3b8">Visão executiva do relacionamento com clientes — ${EMPRESA_LABELS[state.empresa] || state.empresa}</div>
    </div>
    <button onclick="window.c360ReloadDashboard()" class="c360-reload-btn" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px">🔄 Atualizar</button>
  </div>

  <!-- ALERTAS INTELIGENTES -->
  <div style="margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);margin-bottom:12px">◉ Alertas Inteligentes</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      ${alertCard('↗', 'prontos para recompra', 'Score acima de 80 e sem comprar há 30+ dias', r.prontos_recompra, 'rgba(251,191,36,0.4)', "window.c360FilterAndGo('prontos_recompra')")}
      ${alertCard('◆', 'VIPs sem comprar', 'Clientes VIP há mais de 120 dias', r.vips_sem_comprar, 'rgba(167,139,250,0.4)', "window.c360FilterAndGo('vips_sem_comprar')")}
      ${alertCard('👥', 'novos sem 2ª compra', 'Primeira compra há mais de 30 dias', r.novos_sem_2a, 'rgba(96,165,250,0.4)', "window.c360FilterAndGo('novos_sem_2a')")}
      ${alertCard('🎯', 'com alto potencial', '2+ compras e score acima de 70', r.alto_potencial, 'rgba(34,197,94,0.4)', "window.c360FilterAndGo('alto_potencial')")}
    </div>
  </div>

  <!-- MÉTRICAS PRINCIPAIS -->
  <div style="margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);margin-bottom:12px">📈 Métricas Principais</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
      ${metricCard('👥', 'Total de Clientes', fmtNum(r.total_clientes), '', '#94a3b8')}
      ${metricCard('✓', 'Clientes Ativos', fmtNum(r.clientes_ativos), 'Excluindo perdidos', '#22c55e')}
      ${metricCard('♔', 'Clientes VIP', fmtNum(r.vip_count), 'Alto valor e recorrência', '#fbbf24')}
      ${metricCard('⚠', 'Em Risco', fmtNum(r.em_risco), 'Passaram do ciclo médio', '#f97316')}
      ${metricCard('✕', 'Perdidos', fmtNum(r.perdidos), 'Sem comprar há muito tempo', '#ef4444')}
    </div>
  </div>

  <!-- MÉTRICAS SECUNDÁRIAS -->
  <div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
      ${metricCard('$', 'Faturamento Total', fmtBRL(r.faturamento_total), 'Soma geral da base', '#22c55e', 16)}
      ${metricCard('↗', 'Ticket Médio', fmtBRL(r.ticket_medio_global), 'Média por pedido', '#60a5fa', 18)}
      ${metricCard('⏰', 'Ciclo Médio', Math.round(Number(r.ciclo_medio_aprox)) + ' dias', 'Entre compras (recorrentes)', '#a78bfa', 20)}
      ${metricCard('↻', 'Taxa de Recompra', Number(r.taxa_recompra).toFixed(1) + '%', 'Clientes com 2+ pedidos', '#fbbf24', 20)}
      ${metricCard('★', 'Clientes Fiéis', fmtNum(r.fieis), '5+ pedidos', '#f472b6', 22)}
    </div>
  </div>
</div>`;
  }

  // Clicar num alerta → filtra lista e muda de aba
  window.c360FilterAndGo = function(tipo) {
    // Reset filtros
    state.segmentFilter = 'todos';
    state.ufFilter = 'todos';
    state.searchQuery = '';
    const selSeg = document.getElementById('c360-seg-select');
    const selUf = document.getElementById('c360-uf-select');
    if (selSeg) selSeg.value = 'todos';
    if (selUf) selUf.value = 'todos';
    const searchInp = document.querySelector('#page-clientes input[placeholder*="Buscar"]');
    if (searchInp) searchInp.value = '';

    // Filtra client-side baseado no tipo do alerta
    const filters = {
      prontos_recompra: c => (c.score||0) >= 80 && (c.dias_sem_compra||0) >= 30,
      vips_sem_comprar: c => c.segmento === 'VIP' && (c.dias_sem_compra||0) > 120,
      novos_sem_2a: c => (c.total_pedidos||0) === 1 && (c.dias_sem_compra||0) > 30,
      alto_potencial: c => (c.total_pedidos||0) >= 2 && (c.score||0) >= 70 && (c.dias_sem_compra||0) < 90,
    };
    const filtro = filters[tipo];
    if (!filtro) return;
    state.filtered = state.clientes.filter(filtro);
    state.page = 0;
    if (typeof showPage === 'function') showPage('clientes');
    renderList();
  };

  window.c360ReloadDashboard = async function() {
    dashCache[state.empresa] = null;
    await loadDashboardResumo();
    if (typeof showToast === 'function') showToast('Métricas atualizadas', 'success');
  };

  // ═══════════════════════════════════════════════════════════
  // FASE 5 — SEGMENTAÇÃO (predefinidos + customizados)
  // ═══════════════════════════════════════════════════════════

  // Filtros suportados: tipo_pessoa, ufs[], segmentos[], score_min/max,
  // min/max_pedidos, min/max_gasto, dias_sem_compra_min/max
  function aplicarFiltrosSegmento(clientes, filtros) {
    return clientes.filter(c => {
      if (filtros.tipo_pessoa && filtros.tipo_pessoa !== 'todos' && c.tipo_pessoa !== filtros.tipo_pessoa) return false;
      if (filtros.ufs && filtros.ufs.length > 0) {
        if (!c.uf || !filtros.ufs.includes(c.uf)) return false;
      }
      if (filtros.segmentos && filtros.segmentos.length > 0) {
        if (!filtros.segmentos.includes(c.segmento)) return false;
      }
      const p = Number(c.total_pedidos) || 0;
      const g = Number(c.total_gasto) || 0;
      const d = Number(c.dias_sem_compra) || 0;
      const s = Number(c.score) || 0;
      if (filtros.min_pedidos != null && p < filtros.min_pedidos) return false;
      if (filtros.max_pedidos != null && p > filtros.max_pedidos) return false;
      if (filtros.min_gasto != null && g < filtros.min_gasto) return false;
      if (filtros.max_gasto != null && g > filtros.max_gasto) return false;
      if (filtros.dias_sem_compra_min != null && d < filtros.dias_sem_compra_min) return false;
      if (filtros.dias_sem_compra_max != null && d > filtros.dias_sem_compra_max) return false;
      if (filtros.score_min != null && s < filtros.score_min) return false;
      if (filtros.score_max != null && s > filtros.score_max) return false;
      return true;
    });
  }

  function resumoFiltros(filtros) {
    const partes = [];
    if (filtros.tipo_pessoa === 'J') partes.push('PJ');
    if (filtros.tipo_pessoa === 'F') partes.push('PF');
    if (filtros.ufs && filtros.ufs.length) partes.push('UF: ' + filtros.ufs.join(','));
    if (filtros.segmentos && filtros.segmentos.length) partes.push(filtros.segmentos.join('/'));
    if (filtros.min_pedidos != null) partes.push(filtros.min_pedidos + '+ pedidos');
    if (filtros.max_pedidos != null) partes.push('até ' + filtros.max_pedidos + ' pedidos');
    if (filtros.min_gasto != null) partes.push('gasto ≥ ' + fmtBRL(filtros.min_gasto));
    if (filtros.max_gasto != null) partes.push('gasto ≤ ' + fmtBRL(filtros.max_gasto));
    if (filtros.dias_sem_compra_min != null || filtros.dias_sem_compra_max != null) {
      const lo = filtros.dias_sem_compra_min ?? 0;
      const hi = filtros.dias_sem_compra_max ?? '∞';
      partes.push(lo + '-' + hi + 'd sem comprar');
    }
    if (filtros.score_min != null || filtros.score_max != null) {
      const lo = filtros.score_min ?? 0;
      const hi = filtros.score_max ?? 100;
      partes.push('score ' + lo + '-' + hi);
    }
    return partes.join(' · ') || 'Sem filtros';
  }

  async function loadSegmentosCustom() {
    const { data, error } = await state.sb
      .from('cliente_segmentos_custom')
      .select('*')
      .in('empresa', [state.empresa, 'ambas'])
      .order('created_at', { ascending: false });
    if (error) { console.warn('[c360] segmentos:', error); return []; }
    return data || [];
  }

  async function renderSegmentosPage() {
    const page = document.getElementById('page-segmentos');
    if (!page) return;
    page.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">⏳ Carregando segmentos...</div>';

    const segmentosBase = [
      { key: 'VIP', label: 'VIP', cor: '#fbbf24', desc: 'Alto valor e recorrência' },
      { key: 'Frequente', label: 'Frequente', cor: '#a78bfa', desc: 'Compra com regularidade' },
      { key: 'Ocasional', label: 'Ocasional', cor: '#60a5fa', desc: 'Compra esporádica' },
      { key: 'Em Risco', label: 'Em Risco', cor: '#f97316', desc: 'Passou do ciclo médio' },
      { key: 'Inativo', label: 'Inativo', cor: '#ef4444', desc: 'Sem comprar há muito tempo' },
    ];
    // Conta por segmento na empresa atual
    const contagens = {};
    for (const c of state.clientes) {
      contagens[c.segmento] = (contagens[c.segmento] || 0) + 1;
    }
    const customs = await loadSegmentosCustom();

    const cardBase = (s) => `
      <button type="button" onclick="c360FilterAndGo('segmento:${s.key}')" style="background:rgba(255,255,255,0.03);border:1px solid ${s.cor}44;border-radius:12px;padding:18px;text-align:left;cursor:pointer;transition:transform 0.15s;font-family:inherit" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${s.cor}22;color:${s.cor}">${s.label}</span>
          <span style="font-size:24px;font-weight:700;color:#f1f5f9">${fmtNum(contagens[s.key] || 0)}</span>
        </div>
        <div style="font-size:12px;color:#94a3b8">${s.desc}</div>
      </button>`;

    const cardCustom = (s) => {
      const matches = aplicarFiltrosSegmento(state.clientes, s.filtros || {});
      return `
      <div style="background:rgba(255,255,255,0.03);border:1px solid ${s.cor}44;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0;flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.cor}"></span>
              <span style="font-size:14px;font-weight:700;color:#f1f5f9">${escapeHtml(s.nome)}</span>
            </div>
            ${s.descricao ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:4px">${escapeHtml(s.descricao)}</div>` : ''}
            <div style="font-size:10.5px;color:#64748b;margin-top:4px">${escapeHtml(resumoFiltros(s.filtros || {}))}</div>
          </div>
          <div style="font-size:22px;font-weight:700;color:#f1f5f9;text-align:right">${fmtNum(matches.length)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="c360ApplySegmentoCustom(${s.id})" style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:12px">Ver clientes</button>
          <button onclick="c360ExportCsv(${s.id})" title="Exportar CSV" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:12px">⬇ CSV</button>
          <button onclick="c360EditSegmento(${s.id})" title="Editar" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:12px">✏</button>
          <button onclick="c360DeleteSegmento(${s.id})" title="Apagar" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:transparent;color:#ef4444;cursor:pointer;font-size:12px">🗑</button>
        </div>
      </div>`;
    };

    page.innerHTML = `
<div style="padding:24px;max-width:1400px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Segmentação</h1>
      <div style="font-size:13px;color:#94a3b8">Segmentos automáticos + filtros customizados — ${EMPRESA_LABELS[state.empresa] || state.empresa}</div>
    </div>
    <button onclick="c360NewSegmento()" style="padding:10px 18px;border-radius:8px;border:1px solid oklch(88% 0.018 80 / 0.5);background:oklch(88% 0.018 80 / 0.12);color:oklch(88% 0.018 80);cursor:pointer;font-size:13px;font-weight:600">+ Novo Segmento</button>
  </div>

  <div style="margin-bottom:32px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);margin-bottom:12px">Segmentos Automáticos (RFM)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      ${segmentosBase.map(cardBase).join('')}
    </div>
  </div>

  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5)">Meus Segmentos Customizados (${customs.length})</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      ${customs.length === 0
        ? '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#64748b;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:12px"><div style="font-size:24px;margin-bottom:8px">🎯</div><div style="font-size:13px;color:#e2e8f0">Nenhum segmento customizado</div><div style="font-size:11.5px;margin-top:4px">Clique em "+ Novo Segmento" pra criar filtros personalizados.</div></div>'
        : customs.map(cardCustom).join('')}
    </div>
  </div>
</div>`;

    // Armazena no state pra acesso por c360ApplySegmentoCustom/Export
    state.segmentosCustom = customs;
  }

  // Filtra a lista por segmento (predefinido ou customizado)
  window.c360ApplySegmentoCustom = function(id) {
    const s = (state.segmentosCustom || []).find(x => x.id === id);
    if (!s) return;
    // Reset filtros da lista
    state.segmentFilter = 'todos';
    state.ufFilter = 'todos';
    state.searchQuery = '';
    const selSeg = document.getElementById('c360-seg-select');
    const selUf = document.getElementById('c360-uf-select');
    if (selSeg) selSeg.value = 'todos';
    if (selUf) selUf.value = 'todos';
    const searchInp = document.querySelector('#page-clientes input[placeholder*="Buscar"]');
    if (searchInp) searchInp.value = '';
    // Aplica filtro manual
    state.filtered = aplicarFiltrosSegmento(state.clientes, s.filtros || {});
    state.page = 0;
    if (typeof showPage === 'function') showPage('clientes');
    renderList();
    if (typeof showToast === 'function') showToast(`Filtro '${s.nome}' aplicado: ${state.filtered.length} cliente(s)`, 'info');
  };

  // Estende o c360FilterAndGo pra aceitar 'segmento:VIP' etc
  const origFilterAndGo = window.c360FilterAndGo;
  window.c360FilterAndGo = function(tipo) {
    if (typeof tipo === 'string' && tipo.startsWith('segmento:')) {
      const seg = tipo.split(':')[1];
      state.segmentFilter = seg;
      state.ufFilter = 'todos';
      state.searchQuery = '';
      const selSeg = document.getElementById('c360-seg-select');
      if (selSeg) selSeg.value = seg;
      const selUf = document.getElementById('c360-uf-select');
      if (selUf) selUf.value = 'todos';
      const searchInp = document.querySelector('#page-clientes input[placeholder*="Buscar"]');
      if (searchInp) searchInp.value = '';
      applyFilters();
      if (typeof showPage === 'function') showPage('clientes');
      return;
    }
    return origFilterAndGo(tipo);
  };

  // Exportar CSV
  window.c360ExportCsv = function(id) {
    let clientes, nomeArq;
    if (id === '_all') { clientes = state.filtered; nomeArq = 'clientes_filtrados.csv'; }
    else {
      const s = (state.segmentosCustom || []).find(x => x.id === id);
      if (!s) return;
      clientes = aplicarFiltrosSegmento(state.clientes, s.filtros || {});
      nomeArq = 'segmento_' + s.nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.csv';
    }
    const header = ['Nome','Empresa','Tipo','Documento','Telefone','Celular','UF','Segmento','Score','Pedidos','Total Gasto','Ticket Medio','Ultima Compra','Dias Sem Compra'];
    const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const linhas = [header.join(';')];
    for (const c of clientes) {
      linhas.push([
        esc(c.contato_nome), esc(c.empresa), esc(c.tipo_pessoa), esc(c.numero_documento),
        esc(c.telefone), esc(c.celular), esc(c.uf), esc(c.segmento), esc(c.score),
        esc(c.total_pedidos), esc(Number(c.total_gasto).toFixed(2).replace('.',',')),
        esc(Number(c.ticket_medio).toFixed(2).replace('.',',')),
        esc(c.ultima_compra), esc(c.dias_sem_compra)
      ].join(';'));
    }
    // BOM pra Excel reconhecer UTF-8
    const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArq; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof showToast === 'function') showToast(`CSV com ${clientes.length} cliente(s) baixado`, 'success');
  };

  // ─── Modal: criar/editar segmento ───
  window.c360NewSegmento = function() { abrirModalSegmento(null); };
  window.c360EditSegmento = function(id) {
    const s = (state.segmentosCustom || []).find(x => x.id === id);
    if (s) abrirModalSegmento(s);
  };

  function abrirModalSegmento(segExistente) {
    // Remove modal anterior se houver
    const old = document.getElementById('c360-seg-modal'); if (old) old.remove();
    const f = (segExistente?.filtros) || {};
    const ufs = [...new Set(state.clientes.map(c => c.uf).filter(Boolean))].sort();
    const wrap = document.createElement('div');
    wrap.id = 'c360-seg-modal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;overflow-y:auto';
    wrap.innerHTML = `
      <div style="background:rgb(18,18,23);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto;color:#e2e8f0;font-family:Inter,sans-serif">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:18px;font-weight:700">${segExistente ? 'Editar' : 'Novo'} Segmento</h2>
          <button onclick="document.getElementById('c360-seg-modal').remove()" style="width:30px;height:30px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:#94a3b8;cursor:pointer;font-size:16px">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">Nome *</label>
            <input id="seg-nome" value="${escapeHtml(segExistente?.nome || '')}" placeholder="Ex: PJ de SC com 3+ pedidos"
              style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:13px;margin-top:4px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">Descrição (opcional)</label>
            <input id="seg-desc" value="${escapeHtml(segExistente?.descricao || '')}" placeholder="Ex: Clinicas fieis"
              style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:13px;margin-top:4px;box-sizing:border-box">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">Empresa</label>
              <select id="seg-empresa" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgb(20,20,25);color:#e2e8f0;font-size:13px;margin-top:4px;color-scheme:dark;box-sizing:border-box">
                <option value="ambas" ${(segExistente?.empresa||'ambas')==='ambas'?'selected':''}>Matriz + BC</option>
                <option value="matriz" ${segExistente?.empresa==='matriz'?'selected':''}>Apenas Matriz</option>
                <option value="bc" ${segExistente?.empresa==='bc'?'selected':''}>Apenas BC</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">Cor</label>
              <input type="color" id="seg-cor" value="${segExistente?.cor || '#60a5fa'}" style="width:100%;height:38px;padding:2px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);margin-top:4px;box-sizing:border-box;cursor:pointer">
            </div>
          </div>

          <div style="padding:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px">
            <div style="font-size:11px;font-weight:700;color:oklch(88% 0.018 80);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Filtros</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:11px;color:#94a3b8">Tipo de Pessoa</label>
                <select id="f-tipo" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgb(20,20,25);color:#e2e8f0;font-size:12.5px;margin-top:2px;color-scheme:dark;box-sizing:border-box">
                  <option value="todos" ${!f.tipo_pessoa||f.tipo_pessoa==='todos'?'selected':''}>Todos</option>
                  <option value="J" ${f.tipo_pessoa==='J'?'selected':''}>Pessoa Jurídica</option>
                  <option value="F" ${f.tipo_pessoa==='F'?'selected':''}>Pessoa Física</option>
                </select>
              </div>
              <div style="grid-column:1/-1">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <label style="font-size:11px;color:#94a3b8">Estados (UF)</label>
                  <div style="display:flex;gap:6px">
                    <button type="button" onclick="c360UfToggleAll(true)" style="padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#94a3b8;cursor:pointer;font-size:10.5px">Todos</button>
                    <button type="button" onclick="c360UfToggleAll(false)" style="padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#94a3b8;cursor:pointer;font-size:10.5px">Limpar</button>
                  </div>
                </div>
                <div id="f-ufs-chips" style="display:flex;flex-wrap:wrap;gap:5px;max-height:120px;overflow-y:auto;padding:6px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.02)">
                  ${ufs.map(u => {
                    const count = state.clientes.filter(c => c.uf === u).length;
                    const sel = (f.ufs||[]).includes(u);
                    return `<button type="button" data-uf="${u}" data-sel="${sel?'1':'0'}" onclick="c360UfToggle('${u}', this)" style="padding:4px 9px;border-radius:6px;border:1px solid ${sel?'oklch(88% 0.018 80 / 0.6)':'rgba(255,255,255,0.1)'};background:${sel?'oklch(88% 0.018 80 / 0.15)':'rgba(255,255,255,0.03)'};color:${sel?'oklch(88% 0.018 80)':'#cbd5e1'};cursor:pointer;font-size:11.5px;font-weight:${sel?'600':'500'};transition:all 0.15s">${u} <span style="opacity:0.6;font-size:10px">${count}</span></button>`;
                  }).join('')}
                  ${ufs.length === 0 ? '<div style="padding:10px;color:#64748b;font-size:11.5px">Nenhum UF detectado nesta empresa.</div>' : ''}
                </div>
                <div id="f-ufs-count" style="font-size:10.5px;color:#64748b;margin-top:4px">${(f.ufs||[]).length > 0 ? (f.ufs||[]).length + ' UF(s) selecionado(s)' : 'Todos os estados'}</div>
              </div>
              <div style="grid-column:1/-1">
                <label style="font-size:11px;color:#94a3b8">Segmentos RFM (múltiplo)</label>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px" id="f-segs">
                  ${['VIP','Frequente','Ocasional','Em Risco','Inativo','Novo'].map(s => `
                    <label style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px">
                      <input type="checkbox" value="${s}" ${(f.segmentos||[]).includes(s)?'checked':''} style="margin:0;cursor:pointer">${s}
                    </label>`).join('')}
                </div>
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Pedidos mínimo</label>
                <input type="number" id="f-min-ped" value="${f.min_pedidos ?? ''}" placeholder="ex: 3" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Pedidos máximo</label>
                <input type="number" id="f-max-ped" value="${f.max_pedidos ?? ''}" placeholder="sem limite" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Gasto mínimo (R$)</label>
                <input type="number" id="f-min-gasto" value="${f.min_gasto ?? ''}" placeholder="ex: 1000" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Gasto máximo (R$)</label>
                <input type="number" id="f-max-gasto" value="${f.max_gasto ?? ''}" placeholder="sem limite" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Dias sem comprar — mín</label>
                <input type="number" id="f-d-min" value="${f.dias_sem_compra_min ?? ''}" placeholder="ex: 60" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Dias sem comprar — máx</label>
                <input type="number" id="f-d-max" value="${f.dias_sem_compra_max ?? ''}" placeholder="ex: 120" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Score mínimo (0-100)</label>
                <input type="number" id="f-score-min" min="0" max="100" value="${f.score_min ?? ''}" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8">Score máximo (0-100)</label>
                <input type="number" id="f-score-max" min="0" max="100" value="${f.score_max ?? ''}" style="width:100%;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);color:#e2e8f0;font-size:12.5px;margin-top:2px;box-sizing:border-box">
              </div>
            </div>
            <div style="margin-top:12px;padding:10px;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.18);border-radius:6px;font-size:12px;color:#cbd5e1">
              <strong style="color:oklch(88% 0.018 80)">Preview:</strong> <span id="seg-preview-count">-</span> cliente(s) correspondem a esses filtros
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
            <button onclick="document.getElementById('c360-seg-modal').remove()" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#94a3b8;cursor:pointer;font-size:13px">Cancelar</button>
            <button onclick="c360SaveSegmento(${segExistente?.id || 'null'})" style="padding:9px 18px;border-radius:8px;border:1px solid oklch(88% 0.018 80 / 0.5);background:oklch(88% 0.018 80 / 0.12);color:oklch(88% 0.018 80);cursor:pointer;font-size:13px;font-weight:600">${segExistente?'Salvar alterações':'Criar segmento'}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    // Preview de contagem (atualiza ao alterar qualquer campo)
    const fields = ['f-tipo','f-min-ped','f-max-ped','f-min-gasto','f-max-gasto','f-d-min','f-d-max','f-score-min','f-score-max','f-ufs'];
    const updatePreview = () => {
      const filtros = coletarFiltrosModal();
      const n = aplicarFiltrosSegmento(state.clientes, filtros).length;
      const el = document.getElementById('seg-preview-count');
      if (el) el.textContent = fmtNum(n);
    };
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', updatePreview);
      if (el) el.addEventListener('input', updatePreview);
    });
    document.querySelectorAll('#f-segs input').forEach(i => i.addEventListener('change', updatePreview));
    setTimeout(updatePreview, 30);
  }

  // Toggle individual de UF via chip
  window.c360UfToggle = function(uf, btn) {
    const selecionado = btn.getAttribute('data-sel') === '1';
    const novoEstado = !selecionado;
    btn.setAttribute('data-sel', novoEstado ? '1' : '0');
    btn.style.border = '1px solid ' + (novoEstado ? 'oklch(88% 0.018 80 / 0.6)' : 'rgba(255,255,255,0.1)');
    btn.style.background = novoEstado ? 'oklch(88% 0.018 80 / 0.15)' : 'rgba(255,255,255,0.03)';
    btn.style.color = novoEstado ? 'oklch(88% 0.018 80)' : '#cbd5e1';
    btn.style.fontWeight = novoEstado ? '600' : '500';
    c360UpdateUfPreview();
  };

  // Toggle todos os UFs
  window.c360UfToggleAll = function(valor) {
    document.querySelectorAll('#f-ufs-chips button[data-uf]').forEach(btn => {
      btn.setAttribute('data-sel', valor ? '1' : '0');
      btn.style.border = '1px solid ' + (valor ? 'oklch(88% 0.018 80 / 0.6)' : 'rgba(255,255,255,0.1)');
      btn.style.background = valor ? 'oklch(88% 0.018 80 / 0.15)' : 'rgba(255,255,255,0.03)';
      btn.style.color = valor ? 'oklch(88% 0.018 80)' : '#cbd5e1';
      btn.style.fontWeight = valor ? '600' : '500';
    });
    c360UpdateUfPreview();
  };

  function c360UpdateUfPreview() {
    const sel = [...document.querySelectorAll('#f-ufs-chips button[data-sel="1"]')].length;
    const total = [...document.querySelectorAll('#f-ufs-chips button[data-uf]')].length;
    const el = document.getElementById('f-ufs-count');
    if (el) el.textContent = sel === 0 ? 'Todos os estados' : `${sel} de ${total} UF(s) selecionado(s)`;
    // Dispara preview de count do segmento
    const modal = document.getElementById('c360-seg-modal');
    if (modal) {
      const filtros = coletarFiltrosModal();
      const n = aplicarFiltrosSegmento(state.clientes, filtros).length;
      const prev = document.getElementById('seg-preview-count');
      if (prev) prev.textContent = fmtNum(n);
    }
  }

  function coletarFiltrosModal() {
    const tp = document.getElementById('f-tipo')?.value;
    // UFs: coleta dos chips selecionados (data-sel="1")
    const ufs = [...document.querySelectorAll('#f-ufs-chips button[data-sel="1"]')]
      .map(b => b.getAttribute('data-uf'));
    const segs = [...document.querySelectorAll('#f-segs input:checked')].map(i => i.value);
    const num = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : Number(v);
    };
    return {
      tipo_pessoa: tp === 'todos' ? null : tp,
      ufs: ufs.length ? ufs : null,
      segmentos: segs.length ? segs : null,
      min_pedidos: num('f-min-ped'),
      max_pedidos: num('f-max-ped'),
      min_gasto: num('f-min-gasto'),
      max_gasto: num('f-max-gasto'),
      dias_sem_compra_min: num('f-d-min'),
      dias_sem_compra_max: num('f-d-max'),
      score_min: num('f-score-min'),
      score_max: num('f-score-max'),
    };
  }

  window.c360SaveSegmento = async function(idStr) {
    const id = idStr === 'null' ? null : Number(idStr);
    const nome = (document.getElementById('seg-nome')?.value || '').trim();
    if (!nome) { if (typeof showToast === 'function') showToast('Nome é obrigatório', 'error'); return; }
    const descricao = (document.getElementById('seg-desc')?.value || '').trim();
    const empresa = document.getElementById('seg-empresa')?.value || 'ambas';
    const cor = document.getElementById('seg-cor')?.value || '#60a5fa';
    const filtros = coletarFiltrosModal();
    try {
      if (id) {
        const { error } = await state.sb.from('cliente_segmentos_custom').update({
          nome, descricao, empresa, cor, filtros, updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;
      } else {
        const { data: { user } } = await state.sb.auth.getUser();
        const { data: profile } = await state.sb.from('profiles').select('nome').eq('id', user.id).single();
        const { error } = await state.sb.from('cliente_segmentos_custom').insert({
          nome, descricao, empresa, cor, filtros,
          user_id: user.id, user_nome: profile?.nome || user.email,
        });
        if (error) throw error;
      }
      document.getElementById('c360-seg-modal')?.remove();
      if (typeof showToast === 'function') showToast('Segmento ' + (id ? 'atualizado' : 'criado'), 'success');
      await renderSegmentosPage();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
    }
  };

  window.c360DeleteSegmento = async function(id) {
    const ok = await c360Confirm('Apagar este segmento?', { danger: true, okLabel: 'Apagar segmento' });
    if (!ok) return;
    const { error } = await state.sb.from('cliente_segmentos_custom').delete().eq('id', id);
    if (error) {
      if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error');
      return;
    }
    if (typeof showToast === 'function') showToast('Segmento apagado', 'success');
    await renderSegmentosPage();
  };

  // Realtime pra segmentos (sincroniza criacao/edicao entre users)
  function subscribeRealtimeSegmentos() {
    if (state.segmentosChannel) return;
    state.segmentosChannel = state.sb
      .channel('realtime-cliente-segmentos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cliente_segmentos_custom' }, async () => {
        // So re-renderiza se a aba atual é segmentos
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-segmentos') await renderSegmentosPage();
      })
      .subscribe();
  }

  // Hook: quando showPage('segmentos') for chamado, renderiza dados reais
  const origShowPage = window.showPage;
  if (typeof origShowPage === 'function') {
    window.showPage = function(id) {
      origShowPage(id);
      if (id === 'segmentos') renderSegmentosPage();
      if (id === 'campanhas') renderCampanhasPage();
      if (id === 'sincronizacao') renderSincronizacaoPage();
      if (id === 'configuracoes') renderConfiguracoesPage();
      if (id === 'logs') renderLogsPage();
      if (id === 'meus-clientes') renderMeusClientesPage();
    };
  }

  // Expoe helper pra c360SetEmpresa poder chamar
  window.c360ReRenderSegmentosIfActive = async function() {
    const active = document.querySelector('.page-section.active');
    if (active?.id === 'page-segmentos') await renderSegmentosPage();
  };

  // ══════════════════════════════════════════════════════════
  // CAMPANHAS (Fase 6) · listagem, modal, envios, PDF/CSV
  // ══════════════════════════════════════════════════════════

  // CSS-fix pra options do <select> no Chrome/Windows
  // (sem isso, o dropdown nativo abre com fundo branco)
  function ensureCampanhasCSS() {
    if (document.getElementById('c360-campanhas-css')) return;
    const s = document.createElement('style');
    s.id = 'c360-campanhas-css';
    s.textContent = `
      #c360-camp-modal select option,
      #c360-envios-modal select option,
      #c360-camp-modal select optgroup,
      #c360-envios-modal select optgroup {
        background: #0b0f17 !important;
        color: #f1f5f9 !important;
      }
      #c360-camp-modal select optgroup,
      #c360-envios-modal select optgroup {
        color: #94a3b8 !important;
        font-weight: 700 !important;
        font-style: normal !important;
      }
    `;
    document.head.appendChild(s);
  }

  // Confirm/alert customizado em tema dark (substitui confirm() nativo feio)
  function c360Confirm(message, opts) {
    opts = opts || {};
    const danger = opts.danger === true;
    const btnOk = opts.okLabel || (danger ? 'Apagar' : 'Confirmar');
    const btnCancel = opts.cancelLabel || 'Cancelar';
    return new Promise(resolve => {
      document.getElementById('c360-confirm-modal')?.remove();
      const html = `
      <div id="c360-confirm-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif">
        <div style="background:#0b0f17;border:1px solid rgba(255,255,255,0.12);border-radius:12px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
          <div style="padding:22px 24px 18px">
            <div style="font-size:14px;color:#e2e8f0;line-height:1.55;white-space:pre-wrap">${escapeHtml(message)}</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02)">
            <button id="c360-conf-no" style="padding:8px 18px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px;font-family:inherit">${escapeHtml(btnCancel)}</button>
            <button id="c360-conf-yes" style="padding:8px 22px;border-radius:6px;border:none;background:${danger ? '#ef4444' : 'oklch(88% 0.018 80)'};color:${danger ? '#fff' : 'oklch(9% 0.008 260)'};cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">${escapeHtml(btnOk)}</button>
          </div>
        </div>
      </div>`;
      const div = document.createElement('div');
      div.innerHTML = html;
      document.body.appendChild(div.firstElementChild);
      const cleanup = (v) => {
        window.removeEventListener('keydown', escHandler);
        document.getElementById('c360-confirm-modal')?.remove();
        resolve(v);
      };
      const escHandler = (e) => {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') cleanup(true);
      };
      window.addEventListener('keydown', escHandler);
      document.getElementById('c360-conf-yes').onclick = () => cleanup(true);
      document.getElementById('c360-conf-no').onclick = () => cleanup(false);
      // Foco no botao confirmar pra Enter funcionar
      setTimeout(() => document.getElementById('c360-conf-yes')?.focus(), 50);
    });
  }

  const CANAL_LABELS = { whatsapp:'WhatsApp', email:'Email', sms:'SMS', outro:'Outro' };
  const STATUS_CAMP_LABELS = { rascunho:'Rascunho', agendada:'Agendada', enviada:'Enviada', concluida:'Concluída', cancelada:'Cancelada' };
  const STATUS_CAMP_CORES = { rascunho:'#94a3b8', agendada:'#60a5fa', enviada:'#a78bfa', concluida:'#10b981', cancelada:'#ef4444' };
  const STATUS_ENVIO_LABELS = { pendente:'Pendente', enviado:'Enviado', entregue:'Entregue', lido:'Lido', respondido:'Respondido', falhou:'Falhou' };
  const STATUS_ENVIO_CORES = { pendente:'#94a3b8', enviado:'#60a5fa', entregue:'#a78bfa', lido:'#c084fc', respondido:'#10b981', falhou:'#ef4444' };

  state.campanhas = [];
  state.canaisAquisicao = [];
  state.campanhasChannel = null;

  async function loadCanaisAquisicao() {
    const { data, error } = await state.sb
      .from('canais_aquisicao').select('id,nome,tipo,status')
      .eq('status','ativo').order('nome');
    if (error) { console.warn('[c360 camp] canais:', error); return []; }
    state.canaisAquisicao = data || [];
    return state.canaisAquisicao;
  }

  async function loadCampanhas() {
    const { data, error } = await state.sb
      .from('cliente_campanhas').select('*')
      .in('empresa', [state.empresa, 'ambas'])
      .order('created_at', { ascending: false });
    if (error) { console.warn('[c360 camp] load:', error); return []; }
    state.campanhas = data || [];
    return state.campanhas;
  }

  function renderMensagemComPlaceholders(template, cliente, campanha) {
    const nome = String(cliente?.contato_nome || '').trim();
    const primeiro = nome.split(/\s+/)[0] || nome;
    const cupom = String(campanha?.cupom_codigo || '').trim();
    const link  = String(campanha?.link_cta || '').trim();
    const cidade = String(cliente?.cidade || '').trim();
    const uf = String(cliente?.uf || '').trim();
    return String(template || '')
      .replace(/\{\{\s*nome\s*\}\}/gi, nome)
      .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiro)
      .replace(/\{\{\s*cupom\s*\}\}/gi, cupom)
      .replace(/\{\{\s*link\s*\}\}/gi, link)
      .replace(/\{\{\s*cidade\s*\}\}/gi, cidade)
      .replace(/\{\{\s*uf\s*\}\}/gi, uf);
  }

  // Sincroniza a campanha com um evento no calendario DMS.
  // Recebe o row COMPLETO (do select apos save).
  // - Com data_envio + sem evento → cria evento, salva FK
  // - Com data_envio + com evento → atualiza evento
  // - Sem data_envio + com evento → deleta evento, clear FK
  // - Sem data_envio + sem evento → no-op
  async function syncCampanhaToCalendario(camp) {
    if (!camp || !camp.id) return;
    const hasDate = !!camp.data_envio;
    const hasEvent = !!camp.calendario_evento_id;
    if (!hasDate && !hasEvent) return;

    try {
      const dateStr = hasDate ? String(camp.data_envio).slice(0, 10) : null;
      const titulo = `${camp.nome} · Cliente 360`;
      const totalInfo = camp.total_alvo > 0 ? `${camp.total_alvo} clientes alvo · ` : '';
      const descricao = `${totalInfo}${CANAL_LABELS[camp.canal] || camp.canal} · Segmento: ${camp.segmento_nome_cache || '—'}${camp.mensagem ? '\n\n' + camp.mensagem : ''}`;

      if (hasDate && hasEvent) {
        // cor:null pra usar a cor do tipo (tiposCor['campanha_c360'] = laranja)
        // em vez do default #0a0a0a (preto) da tabela
        const { error } = await state.sb.from('calendario')
          .update({ titulo, data_inicio: dateStr, descricao, tipo: 'campanha_c360', cor: null })
          .eq('id', camp.calendario_evento_id);
        if (error) throw error;
      } else if (hasDate && !hasEvent) {
        const { data: newEvt, error } = await state.sb.from('calendario')
          .insert({ titulo, tipo: 'campanha_c360', data_inicio: dateStr, descricao, cor: null })
          .select('id').single();
        if (error) throw error;
        await state.sb.from('cliente_campanhas')
          .update({ calendario_evento_id: newEvt.id })
          .eq('id', camp.id);
      } else if (!hasDate && hasEvent) {
        await state.sb.from('calendario').delete().eq('id', camp.calendario_evento_id);
        await state.sb.from('cliente_campanhas')
          .update({ calendario_evento_id: null })
          .eq('id', camp.id);
      }
    } catch (e) {
      console.warn('[c360 camp] sync calendario falhou:', e);
      if (typeof showToast === 'function') showToast('Campanha salva, mas nao integrou com calendario: ' + e.message, 'warn');
    }
  }

  function getClientesAlvoCampanha(campanha) {
    if (!campanha) return [];
    if (campanha.segmento_tipo === 'custom' && campanha.segmento_id) {
      const seg = (state.segmentosCustom || []).find(s => String(s.id) === String(campanha.segmento_id));
      if (!seg) return [];
      return aplicarFiltrosSegmento(state.clientes, seg.filtros || {});
    }
    const alvo = String(campanha.segmento_nome_cache || '').trim();
    if (!alvo || alvo === 'todos') return state.clientes.slice();
    return state.clientes.filter(c => c.segmento === alvo);
  }

  async function renderCampanhasPage() {
    const page = document.getElementById('page-campanhas');
    if (!page) return;
    page.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">⏳ Carregando campanhas...</div>';

    await Promise.all([
      loadCampanhas(),
      loadSegmentosCustom().then(r => { state.segmentosCustom = r; }),
      loadCanaisAquisicao(),
    ]);

    const canalEmoji = { whatsapp:'💬', email:'✉️', sms:'📱', outro:'📤' };

    const cardCampanha = (c) => {
      const corStatus = STATUS_CAMP_CORES[c.status] || '#94a3b8';
      const pct = c.total_alvo > 0 ? Math.round((c.total_enviados / c.total_alvo) * 100) : 0;
      const dataStr = c.data_envio ? new Date(c.data_envio).toLocaleDateString('pt-BR') : '—';
      return `
      <div style="background:rgba(255,255,255,0.03);border:1px solid ${corStatus}44;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px;font-family:inherit">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0;flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:14px">${canalEmoji[c.canal] || '📤'}</span>
              <span style="font-size:15px;font-weight:700;color:#f1f5f9">${escapeHtml(c.nome)}</span>
            </div>
            ${c.descricao ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:4px">${escapeHtml(c.descricao)}</div>` : ''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              <span style="font-size:10.5px;padding:2px 8px;border-radius:10px;background:${corStatus}22;color:${corStatus};font-weight:600">${STATUS_CAMP_LABELS[c.status] || c.status}</span>
              <span style="font-size:10.5px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.06);color:#cbd5e1">${CANAL_LABELS[c.canal] || c.canal}</span>
              <span style="font-size:10.5px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.06);color:#cbd5e1">${escapeHtml(c.segmento_nome_cache || 'Sem segmento')}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:700;color:#f1f5f9;line-height:1">${fmtNum(c.total_alvo || 0)}</div>
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">alvo</div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8;margin-bottom:4px">
            <span>${c.total_enviados || 0} enviados · ${c.total_respondidos || 0} resp · ${c.total_falhados || 0} falhas</span>
            <span>${pct}%</span>
          </div>
          <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${corStatus};border-radius:2px;transition:width 0.3s"></div>
          </div>
        </div>
        <div style="font-size:10px;color:#64748b;display:flex;justify-content:space-between;gap:6px">
          <span>${escapeHtml(c.criado_por_nome || '—')}</span>
          <span>${c.data_envio ? 'Envio: ' + dataStr : 'Criada em ' + new Date(c.created_at).toLocaleDateString('pt-BR')}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">
          <button onclick="c360VerEnvios('${c.id}')" title="Ver envios" style="flex:1;min-width:100px;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:11.5px">👁 Envios</button>
          <button onclick="c360GerarEnvios('${c.id}')" title="Gerar/atualizar lista" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(167,139,250,0.3);background:rgba(167,139,250,0.1);color:#a78bfa;cursor:pointer;font-size:11.5px">📋 Gerar</button>
          <button onclick="c360ExportPdfCampanha('${c.id}')" title="PDF" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:11.5px">📄 PDF</button>
          <button onclick="c360ExportCsvCampanha('${c.id}')" title="CSV" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:11.5px">⬇ CSV</button>
          <button onclick="c360CopiarMensagens('${c.id}')" title="Copiar mensagens" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:11.5px">📋 Copiar</button>
          <button onclick="c360EditCampanha('${c.id}')" title="Editar" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#e2e8f0;cursor:pointer;font-size:11.5px">✏</button>
          <button onclick="c360DeleteCampanha('${c.id}')" title="Apagar" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:transparent;color:#ef4444;cursor:pointer;font-size:11.5px">🗑</button>
        </div>
      </div>`;
    };

    page.innerHTML = `
<div style="padding:24px;max-width:1400px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Campanhas</h1>
      <div style="font-size:13px;color:#94a3b8">Dispare mensagens segmentadas · ${EMPRESA_LABELS[state.empresa] || state.empresa}</div>
    </div>
    <button onclick="c360NovaCampanha()" style="padding:10px 18px;border-radius:8px;border:1px solid oklch(88% 0.018 80 / 0.5);background:oklch(88% 0.018 80 / 0.12);color:oklch(88% 0.018 80);cursor:pointer;font-size:13px;font-weight:600">+ Nova Campanha</button>
  </div>
  <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:flex-start;gap:10px;font-size:12px;color:#cbd5e1">
    <div style="font-size:18px">ℹ️</div>
    <div><strong style="color:#f1f5f9">Disparo manual.</strong> Esta versão registra campanhas e rastreia envios manualmente. Pra disparo automático via WhatsApp Business ou SendGrid, é necessário contratar API paga e configurar depois. Por enquanto: <strong>gere a lista</strong>, exporte PDF/CSV ou copie as mensagens personalizadas, envie manualmente e marque como enviado aqui.</div>
  </div>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5)">Campanhas (${state.campanhas.length})</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px">
      ${state.campanhas.length === 0
        ? '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#64748b;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:12px"><div style="font-size:24px;margin-bottom:8px">📣</div><div style="font-size:13px;color:#e2e8f0">Nenhuma campanha</div><div style="font-size:11.5px;margin-top:4px">Clique em "+ Nova Campanha" pra começar.</div></div>'
        : state.campanhas.map(cardCampanha).join('')}
    </div>
  </div>
</div>`;
  }

  window.c360ReRenderCampanhasIfActive = async function() {
    const active = document.querySelector('.page-section.active');
    if (active?.id === 'page-campanhas') await renderCampanhasPage();
  };

  // ─── Modal Nova/Editar Campanha ───
  window.c360NovaCampanha = async function() { openCampanhaModal(null); };
  window.c360EditCampanha = async function(id) {
    const c = state.campanhas.find(x => x.id === id);
    if (c) openCampanhaModal(c);
  };

  async function openCampanhaModal(camp) {
    ensureCampanhasCSS();
    if (!state.segmentosCustom) state.segmentosCustom = await loadSegmentosCustom();
    if (!state.canaisAquisicao || state.canaisAquisicao.length === 0) await loadCanaisAquisicao();

    document.getElementById('c360-camp-modal')?.remove();

    const isEdit = !!camp;
    const c = camp || {
      nome: '', descricao: '', empresa: state.empresa,
      segmento_tipo: 'auto', segmento_id: null, segmento_nome_cache: 'VIP',
      canal: 'whatsapp', canal_aquisicao_id: null,
      mensagem: '', cupom_codigo: '', link_cta: '',
      data_envio: null, status: 'rascunho', observacoes: '',
    };

    const segAutos = ['VIP','Frequente','Ocasional','Em Risco','Inativo','todos'];
    const segAutoOpts = segAutos.map(s => `<option value="auto::${s}" ${c.segmento_tipo==='auto' && c.segmento_nome_cache===s ? 'selected':''}>Auto · ${s === 'todos' ? 'Todos os clientes' : s}</option>`).join('');
    const segCustomOpts = (state.segmentosCustom || [])
      .filter(s => s.empresa === state.empresa || s.empresa === 'ambas')
      .map(s => `<option value="custom::${s.id}" ${c.segmento_tipo==='custom' && String(c.segmento_id)===String(s.id) ? 'selected':''}>Custom · ${escapeHtml(s.nome)}</option>`).join('');

    const canalOpts = ['<option value="">— Sem canal vinculado —</option>']
      .concat((state.canaisAquisicao || []).map(ca => `<option value="${ca.id}" ${c.canal_aquisicao_id===ca.id ? 'selected':''}>${escapeHtml(ca.nome)} (${ca.tipo})</option>`)).join('');

    const dataEnvioStr = c.data_envio ? String(c.data_envio).substring(0,16) : '';

    const html = `
    <div id="c360-camp-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif">
      <div style="background:#0b0f17;border:1px solid rgba(255,255,255,0.12);border-radius:14px;width:100%;max-width:720px;max-height:90vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;background:#0b0f17;z-index:2">
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#f1f5f9">${isEdit ? 'Editar' : 'Nova'} Campanha</h3>
          <button onclick="document.getElementById('c360-camp-modal').remove()" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:22px;line-height:1">&times;</button>
        </div>
        <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Nome *</label>
            <input id="camp-nome" type="text" value="${escapeHtml(c.nome)}" placeholder="Ex: Reengajamento VIPs inativos" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Descrição</label>
            <input id="camp-desc" type="text" value="${escapeHtml(c.descricao || '')}" placeholder="Objetivo (opcional)" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Segmento-alvo *</label>
              <select id="camp-segmento" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
                <optgroup label="Automáticos (RFM)">${segAutoOpts}</optgroup>
                ${segCustomOpts ? `<optgroup label="Customizados">${segCustomOpts}</optgroup>` : ''}
              </select>
              <div id="camp-seg-preview" style="font-size:11px;color:#64748b;margin-top:4px"></div>
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Canal de Envio</label>
              <select id="camp-canal" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
                <option value="whatsapp" ${c.canal==='whatsapp'?'selected':''}>💬 WhatsApp</option>
                <option value="email" ${c.canal==='email'?'selected':''}>✉️ Email</option>
                <option value="sms" ${c.canal==='sms'?'selected':''}>📱 SMS</option>
                <option value="outro" ${c.canal==='outro'?'selected':''}>📤 Outro</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Canal de Aquisição (opcional)</label>
              <select id="camp-canalaq" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">${canalOpts}</select>
              <div style="font-size:10.5px;color:#64748b;margin-top:4px">Vincula ao canal do DMS pra análise de ROI</div>
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Data prevista</label>
              <input id="camp-data" type="datetime-local" value="${dataEnvioStr}" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Cupom <span style="color:#64748b;font-size:10px;text-transform:none">(substitui {{cupom}})</span></label>
              <input id="camp-cupom" type="text" value="${escapeHtml(c.cupom_codigo || '')}" placeholder="Ex: VIP20" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Link CTA <span style="color:#64748b;font-size:10px;text-transform:none">(substitui {{link}})</span></label>
              <input id="camp-link" type="url" value="${escapeHtml(c.link_cta || '')}" placeholder="https://..." style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Mensagem (template)</label>
            <textarea id="camp-msg" rows="5" placeholder="Olá {{primeiro_nome}}! ..." style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit;resize:vertical">${escapeHtml(c.mensagem || '')}</textarea>
            <div style="font-size:10.5px;color:#64748b;margin-top:4px">Placeholders: <code>{{nome}}</code> <code>{{primeiro_nome}}</code> <code>{{cupom}}</code> <code>{{link}}</code> <code>{{cidade}}</code> <code>{{uf}}</code></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Status</label>
              <select id="camp-status" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
                <option value="rascunho" ${c.status==='rascunho'?'selected':''}>Rascunho</option>
                <option value="agendada" ${c.status==='agendada'?'selected':''}>Agendada</option>
                <option value="enviada" ${c.status==='enviada'?'selected':''}>Enviada</option>
                <option value="concluida" ${c.status==='concluida'?'selected':''}>Concluída</option>
                <option value="cancelada" ${c.status==='cancelada'?'selected':''}>Cancelada</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Empresa</label>
              <select id="camp-empresa" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit">
                <option value="matriz" ${c.empresa==='matriz'?'selected':''}>Matriz</option>
                <option value="bc" ${c.empresa==='bc'?'selected':''}>BC</option>
                <option value="ambas" ${c.empresa==='ambas'?'selected':''}>Ambas</option>
              </select>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Observações</label>
            <textarea id="camp-obs" rows="2" placeholder="Notas internas" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#f1f5f9;font-size:13px;font-family:inherit;resize:vertical">${escapeHtml(c.observacoes || '')}</textarea>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid rgba(255,255,255,0.08);position:sticky;bottom:0;background:#0b0f17">
          <button onclick="document.getElementById('c360-camp-modal').remove()" style="padding:9px 18px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px;font-family:inherit">Cancelar</button>
          <button onclick="c360SaveCampanha('${isEdit ? c.id : 'null'}')" style="padding:9px 22px;border-radius:6px;border:none;background:oklch(88% 0.018 80);color:oklch(9% 0.008 260);cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">${isEdit ? 'Atualizar' : 'Criar'}</button>
        </div>
      </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);

    const updateSegPreview = () => {
      const val = document.getElementById('camp-segmento')?.value || '';
      const [tipo, ident] = val.split('::');
      let count = 0;
      if (tipo === 'auto') {
        if (ident === 'todos') count = state.clientes.length;
        else count = state.clientes.filter(c => c.segmento === ident).length;
      } else if (tipo === 'custom') {
        const seg = (state.segmentosCustom || []).find(s => String(s.id) === ident);
        if (seg) count = aplicarFiltrosSegmento(state.clientes, seg.filtros || {}).length;
      }
      const el = document.getElementById('camp-seg-preview');
      if (el) el.textContent = `≈ ${fmtNum(count)} clientes (empresa atual)`;
    };
    document.getElementById('camp-segmento')?.addEventListener('change', updateSegPreview);
    updateSegPreview();
  }

  window.c360SaveCampanha = async function(idStr) {
    // Previne double-submit (click duplo ou evento disparado 2x)
    if (state.savingCampanha) return;
    state.savingCampanha = true;

    const id = idStr === 'null' ? null : idStr;
    const nome = (document.getElementById('camp-nome')?.value || '').trim();
    if (!nome) {
      state.savingCampanha = false;
      if (typeof showToast === 'function') showToast('Nome é obrigatório', 'error');
      return;
    }

    // Desabilita botao visualmente (fallback visual do guard)
    const saveBtn = document.querySelector(`#c360-camp-modal button[onclick^="c360SaveCampanha"]`);
    const origLabel = saveBtn?.textContent || '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; saveBtn.textContent = 'Salvando...'; }
    const segVal = document.getElementById('camp-segmento')?.value || 'auto::VIP';
    const [segTipo, segIdent] = segVal.split('::');
    let segmento_id = null; let segmento_nome_cache = '';
    if (segTipo === 'auto') {
      segmento_nome_cache = segIdent;
    } else if (segTipo === 'custom') {
      const seg = (state.segmentosCustom || []).find(s => String(s.id) === segIdent);
      if (seg) { segmento_id = seg.id; segmento_nome_cache = seg.nome; }
    }
    const canalAqVal = document.getElementById('camp-canalaq')?.value || '';
    const dataVal = document.getElementById('camp-data')?.value || '';
    const payload = {
      empresa: document.getElementById('camp-empresa')?.value || state.empresa,
      nome,
      descricao: (document.getElementById('camp-desc')?.value || '').trim() || null,
      segmento_tipo: segTipo, segmento_id, segmento_nome_cache,
      canal: document.getElementById('camp-canal')?.value || 'whatsapp',
      canal_aquisicao_id: canalAqVal || null,
      mensagem: (document.getElementById('camp-msg')?.value || '').trim() || null,
      cupom_codigo: (document.getElementById('camp-cupom')?.value || '').trim() || null,
      link_cta: (document.getElementById('camp-link')?.value || '').trim() || null,
      data_envio: dataVal ? new Date(dataVal).toISOString() : null,
      status: document.getElementById('camp-status')?.value || 'rascunho',
      observacoes: (document.getElementById('camp-obs')?.value || '').trim() || null,
    };
    try {
      let campRow;
      if (id) {
        const { data, error } = await state.sb.from('cliente_campanhas')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', id).select('*').single();
        if (error) throw error;
        campRow = data;
      } else {
        const { data: { user } } = await state.sb.auth.getUser();
        const { data: profile } = await state.sb.from('profiles').select('nome').eq('id', user.id).single();
        const { data, error } = await state.sb.from('cliente_campanhas').insert({
          ...payload, criado_por: user.id, criado_por_nome: profile?.nome || user.email,
        }).select('*').single();
        if (error) throw error;
        campRow = data;
      }
      // Integra com calendario DMS (cria/atualiza/deleta evento conforme data_envio)
      await syncCampanhaToCalendario(campRow);

      document.getElementById('c360-camp-modal')?.remove();
      if (typeof showToast === 'function') showToast('Campanha ' + (id ? 'atualizada' : 'criada'), 'success');
      await renderCampanhasPage();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
      // Restaura botao pra permitir retry
      if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ''; saveBtn.textContent = origLabel; }
    } finally {
      state.savingCampanha = false;
    }
  };

  window.c360DeleteCampanha = async function(id) {
    const c = state.campanhas.find(x => x.id === id);
    if (!c) return;
    const ok = await c360Confirm(`Apagar a campanha "${c.nome}"?\n\nIsso remove também todos os envios vinculados${c.calendario_evento_id ? ' e o evento no calendário' : ''}.`, { danger: true, okLabel: 'Apagar campanha' });
    if (!ok) return;

    // Apaga evento de calendario primeiro (se existir)
    if (c.calendario_evento_id) {
      try {
        await state.sb.from('calendario').delete().eq('id', c.calendario_evento_id);
      } catch (e) {
        console.warn('[c360 camp] falha ao apagar evento calendario:', e);
      }
    }

    const { error } = await state.sb.from('cliente_campanhas').delete().eq('id', id);
    if (error) { if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error'); return; }
    if (typeof showToast === 'function') showToast('Campanha apagada', 'success');
    await renderCampanhasPage();
  };

  // ─── Gerar lista de envios a partir do segmento ───
  window.c360GerarEnvios = async function(id) {
    const c = state.campanhas.find(x => x.id === id);
    if (!c) return;
    if (!state.segmentosCustom) state.segmentosCustom = await loadSegmentosCustom();

    const alvos = getClientesAlvoCampanha(c);
    if (alvos.length === 0) {
      if (typeof showToast === 'function') showToast('Segmento vazio — nenhum cliente corresponde', 'warn');
      return;
    }

    const { data: existentes, error: e1 } = await state.sb
      .from('cliente_campanha_envios').select('contato_id')
      .eq('campanha_id', id);
    if (e1) { if (typeof showToast === 'function') showToast('Erro: ' + e1.message, 'error'); return; }

    const jaIn = new Set((existentes || []).filter(r => r.contato_id).map(r => String(r.contato_id)));
    const novos = alvos.filter(a => a.contato_id && !jaIn.has(String(a.contato_id)));
    const semContato = alvos.filter(a => !a.contato_id).length;

    if (novos.length === 0) {
      const msg = `Todos os ${alvos.length - semContato} clientes com contato_id ja estao na lista.${semContato > 0 ? ' (' + semContato + ' sem contato_id ignorados)' : ''}`;
      if (typeof showToast === 'function') showToast(msg, 'warn');
      return;
    }
    const msgConfirm = `Adicionar ${novos.length} novos clientes à lista de envios?${jaIn.size > 0 ? '\n\n(' + jaIn.size + ' já existem e não serão duplicados)' : ''}${semContato > 0 ? '\n\n' + semContato + ' sem contato_id serão ignorados' : ''}`;
    const okGerar = await c360Confirm(msgConfirm, { okLabel: 'Adicionar à lista' });
    if (!okGerar) return;

    const rowsInserir = novos.map(cliente => ({
      campanha_id: id,
      empresa: c.empresa === 'ambas' ? state.empresa : c.empresa,
      contato_id: cliente.contato_id || null,
      contato_nome: cliente.contato_nome || 'Sem nome',
      contato_telefone: cliente.telefone || null,
      contato_celular: cliente.celular || null,
      contato_email: null,
      contato_cidade: null,
      contato_uf: cliente.uf || null,
      status: 'pendente',
      mensagem_renderizada: renderMensagemComPlaceholders(c.mensagem || '', cliente, c),
    }));

    const CHUNK = 500;
    for (let i = 0; i < rowsInserir.length; i += CHUNK) {
      const chunk = rowsInserir.slice(i, i + CHUNK);
      const { error } = await state.sb.from('cliente_campanha_envios').insert(chunk);
      if (error) {
        if (typeof showToast === 'function') showToast('Erro no chunk: ' + error.message, 'error');
        return;
      }
    }

    if (typeof showToast === 'function') showToast(`${rowsInserir.length} envios adicionados`, 'success');
    await renderCampanhasPage();
  };

  // ─── Modal ver envios ───
  window.c360VerEnvios = async function(id) {
    ensureCampanhasCSS();
    const c = state.campanhas.find(x => x.id === id);
    if (!c) return;
    const { data: envios, error } = await state.sb
      .from('cliente_campanha_envios').select('*')
      .eq('campanha_id', id)
      .order('status').order('contato_nome').limit(5000);
    if (error) { if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error'); return; }

    document.getElementById('c360-envios-modal')?.remove();
    const porStatus = {};
    for (const e of (envios || [])) porStatus[e.status] = (porStatus[e.status] || 0) + 1;

    const fmtFone = (f) => {
      if (!f) return '—';
      const d = String(f).replace(/\D/g,'');
      if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
      if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
      return f;
    };

    const row = (e) => `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
        <td style="padding:8px 10px;font-size:12px;color:#e2e8f0">${escapeHtml(e.contato_nome)}</td>
        <td style="padding:8px 10px;font-size:12px;color:#94a3b8;white-space:nowrap">${escapeHtml(fmtFone(e.contato_celular || e.contato_telefone))}</td>
        <td style="padding:8px 10px"><span style="font-size:10.5px;padding:2px 8px;border-radius:10px;background:${STATUS_ENVIO_CORES[e.status]}22;color:${STATUS_ENVIO_CORES[e.status]};font-weight:600">${STATUS_ENVIO_LABELS[e.status] || e.status}</span></td>
        <td style="padding:8px 10px;text-align:right;white-space:nowrap">
          <select onchange="c360MarkEnvio('${e.id}', this.value)" style="padding:4px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e2e8f0;font-size:11px;cursor:pointer">
            <option value="pendente" ${e.status==='pendente'?'selected':''}>Pendente</option>
            <option value="enviado" ${e.status==='enviado'?'selected':''}>Enviado</option>
            <option value="entregue" ${e.status==='entregue'?'selected':''}>Entregue</option>
            <option value="lido" ${e.status==='lido'?'selected':''}>Lido</option>
            <option value="respondido" ${e.status==='respondido'?'selected':''}>Respondido</option>
            <option value="falhou" ${e.status==='falhou'?'selected':''}>Falhou</option>
          </select>
        </td>
      </tr>`;

    const html = `
    <div id="c360-envios-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif">
      <div style="background:#0b0f17;border:1px solid rgba(255,255,255,0.12);border-radius:14px;width:100%;max-width:860px;max-height:90vh;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);gap:12px">
          <div style="min-width:0">
            <h3 style="margin:0 0 4px;font-size:16px;font-weight:700;color:#f1f5f9">Envios · ${escapeHtml(c.nome)}</h3>
            <div style="font-size:11.5px;color:#94a3b8">Total: ${envios.length} · Pendentes: ${porStatus.pendente || 0} · Enviados: ${(porStatus.enviado||0)+(porStatus.entregue||0)+(porStatus.lido||0)+(porStatus.respondido||0)} · Respondidos: ${porStatus.respondido || 0} · Falhas: ${porStatus.falhou || 0}</div>
          </div>
          <button onclick="document.getElementById('c360-envios-modal').remove()" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:22px;line-height:1">&times;</button>
        </div>
        <div style="padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="c360MarcarTodosEnviados('${id}')" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(96,165,250,0.3);background:rgba(96,165,250,0.1);color:#60a5fa;cursor:pointer;font-size:12px">📤 Marcar pendentes como enviados</button>
          <button onclick="c360LimparEnvios('${id}')" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);background:transparent;color:#ef4444;cursor:pointer;font-size:12px">🗑 Limpar pendentes</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:0 4px">
          ${envios.length === 0
            ? '<div style="padding:40px;text-align:center;color:#64748b"><div style="font-size:24px;margin-bottom:8px">📭</div>Nenhum envio ainda. Clique em "Gerar" na campanha pra popular a lista.</div>'
            : `<table style="width:100%;border-collapse:collapse">
                <thead style="position:sticky;top:0;background:#0b0f17;z-index:1"><tr>
                  <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Cliente</th>
                  <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Telefone</th>
                  <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Status</th>
                  <th style="padding:10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Mudar</th>
                </tr></thead>
                <tbody>${envios.map(row).join('')}</tbody>
              </table>`}
        </div>
      </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
  };

  window.c360MarkEnvio = async function(envioId, newStatus) {
    const patch = { status: newStatus, updated_at: new Date().toISOString() };
    if (['enviado','entregue','lido'].includes(newStatus)) patch.enviado_em = new Date().toISOString();
    if (newStatus === 'respondido') patch.respondido_em = new Date().toISOString();
    const { error } = await state.sb.from('cliente_campanha_envios').update(patch).eq('id', envioId);
    if (error) { if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error'); return; }
    if (typeof showToast === 'function') showToast('Status atualizado', 'success');
    await renderCampanhasPage();
  };

  window.c360MarcarTodosEnviados = async function(campanhaId) {
    const ok = await c360Confirm('Marcar TODOS os envios pendentes como "enviados"?', { okLabel: 'Marcar enviados' });
    if (!ok) return;
    const { error } = await state.sb.from('cliente_campanha_envios')
      .update({ status: 'enviado', enviado_em: new Date().toISOString() })
      .eq('campanha_id', campanhaId).eq('status', 'pendente');
    if (error) { if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error'); return; }
    if (typeof showToast === 'function') showToast('Marcados como enviados', 'success');
    document.getElementById('c360-envios-modal')?.remove();
    await renderCampanhasPage();
  };

  window.c360LimparEnvios = async function(campanhaId) {
    const ok = await c360Confirm('Remover todos os envios PENDENTES?\n\n(Os já enviados permanecem.)', { danger: true, okLabel: 'Remover pendentes' });
    if (!ok) return;
    const { error } = await state.sb.from('cliente_campanha_envios')
      .delete().eq('campanha_id', campanhaId).eq('status', 'pendente');
    if (error) { if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error'); return; }
    if (typeof showToast === 'function') showToast('Pendentes removidos', 'success');
    document.getElementById('c360-envios-modal')?.remove();
    await renderCampanhasPage();
  };

  // ─── Copiar mensagens personalizadas pro clipboard ───
  window.c360CopiarMensagens = async function(campanhaId) {
    const c = state.campanhas.find(x => x.id === campanhaId);
    if (!c) return;
    if (!c.mensagem) { if (typeof showToast === 'function') showToast('Campanha sem mensagem', 'warn'); return; }

    const { data: envios } = await state.sb
      .from('cliente_campanha_envios')
      .select('contato_nome,contato_telefone,contato_celular,contato_uf')
      .eq('campanha_id', campanhaId).order('contato_nome').limit(2000);

    const lista = envios || [];
    if (lista.length === 0) {
      if (typeof showToast === 'function') showToast('Lista vazia — clique em 📋 Gerar primeiro', 'warn');
      return;
    }

    const linhas = lista.map(cli => renderMensagemComPlaceholders(c.mensagem, { contato_nome: cli.contato_nome, uf: cli.contato_uf }, c));
    const texto = linhas.join('\n\n═══════════════════\n\n');
    try {
      await navigator.clipboard.writeText(texto);
      if (typeof showToast === 'function') showToast(`${linhas.length} mensagens copiadas`, 'success');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.cssText = 'position:fixed;top:10%;left:50%;transform:translateX(-50%);width:80vw;height:70vh;z-index:9999';
      document.body.appendChild(ta); ta.select();
      if (typeof showToast === 'function') showToast('Selecione e copie manualmente (Ctrl+C)', 'warn');
      setTimeout(() => ta.remove(), 20000);
    }
  };

  // ─── Export CSV ───
  window.c360ExportCsvCampanha = async function(campanhaId) {
    const c = state.campanhas.find(x => x.id === campanhaId);
    if (!c) return;
    const { data: envios } = await state.sb
      .from('cliente_campanha_envios').select('*')
      .eq('campanha_id', campanhaId).order('contato_nome').limit(5000);

    const lista = envios || [];
    if (lista.length === 0) {
      if (typeof showToast === 'function') showToast('Lista vazia — clique em 📋 Gerar primeiro', 'warn');
      return;
    }

    const BOM = '\ufeff';
    const headers = ['Nome','Telefone','Celular','Email','UF','Status','Mensagem'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g,'""').replace(/\r?\n/g,' ')}"`;
    const csv = BOM + headers.map(esc).join(';') + '\r\n'
      + lista.map(e => [e.contato_nome, e.contato_telefone, e.contato_celular, e.contato_email, e.contato_uf, e.status, e.mensagem_renderizada].map(esc).join(';')).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campanha_${c.nome.replace(/[^a-z0-9]+/gi,'_')}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    if (typeof showToast === 'function') showToast(`CSV com ${lista.length} linhas exportado`, 'success');
  };

  // ─── Export PDF (janela print-friendly) ───
  window.c360ExportPdfCampanha = async function(campanhaId) {
    const c = state.campanhas.find(x => x.id === campanhaId);
    if (!c) return;
    const { data: envios } = await state.sb
      .from('cliente_campanha_envios').select('*')
      .eq('campanha_id', campanhaId).order('contato_nome').limit(3000);

    const lista = envios || [];
    if (lista.length === 0) {
      if (typeof showToast === 'function') showToast('Lista vazia — clique em 📋 Gerar primeiro', 'warn');
      return;
    }

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) { if (typeof showToast === 'function') showToast('Permita popups pra exportar', 'error'); return; }

    const hoje = new Date().toLocaleDateString('pt-BR');
    const fmtFone = (f) => {
      if (!f) return '—';
      const d = String(f).replace(/\D/g,'');
      if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
      if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
      return f;
    };
    const msgExemplo = c.mensagem
      ? renderMensagemComPlaceholders(c.mensagem, lista[0] ? { contato_nome: lista[0].contato_nome, uf: lista[0].contato_uf } : {}, c)
      : '';

    const rows = lista.map((e, i) => `
      <tr>
        <td style="width:28px;text-align:center;color:#999">${i+1}</td>
        <td><strong>${escapeHtml(e.contato_nome || '')}</strong>${e.segmento ? ` <span class="chip">${escapeHtml(e.segmento)}</span>` : ''}</td>
        <td>${escapeHtml(fmtFone(e.contato_celular))}</td>
        <td>${escapeHtml(fmtFone(e.contato_telefone))}</td>
        <td>${escapeHtml(e.contato_email || '—')}</td>
        <td>${escapeHtml(e.contato_uf || '—')}</td>
        <td class="status-${e.status}">${STATUS_ENVIO_LABELS[e.status] || e.status}</td>
        <td style="width:20px;text-align:center"><span class="check"></span></td>
      </tr>`).join('');

    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Campanha: ${escapeHtml(c.nome)} · Dana Jalecos · ${hoje}</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --border:#e6e6e6; --muted:#666; }
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  body { font-family:'DM Sans',sans-serif; color:#0a0a0a; max-width:900px; margin:0 auto; padding:26px 32px; line-height:1.5; font-size:12px; background:#fff; }
  .pdf-header { background:#0a0a0a; color:#fff; border-radius:12px; padding:20px 24px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
  .pdf-title { font-family:'Syne',sans-serif; font-weight:800; font-size:19px; }
  .pdf-sub { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:rgba(255,255,255,0.55); font-weight:700; }
  .meta { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
  .meta-cell { background:#fafafa; border:1px solid var(--border); border-radius:8px; padding:8px 10px; }
  .meta-label { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); font-weight:700; margin-bottom:2px; }
  .meta-val { font-family:'Syne',sans-serif; font-weight:700; font-size:13px; color:#0a0a0a; }
  .msg-box { background:#fafafa; border:1px dashed #ccc; border-radius:8px; padding:12px 14px; margin-bottom:16px; white-space:pre-wrap; font-size:12px; color:#333; }
  .msg-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--muted); margin-bottom:6px; }
  h2.sec { font-family:'Syne',sans-serif; font-weight:700; font-size:13px; text-transform:uppercase; letter-spacing:1.5px; margin:16px 0 10px; padding-bottom:6px; border-bottom:2px solid #0a0a0a; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { background:#0a0a0a; color:#fff; text-align:left; font-size:9.5px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; padding:7px 8px; }
  td { padding:6px 8px; border-bottom:1px solid #eee; }
  tr:nth-child(even) td { background:#fafafa; }
  .chip { display:inline-block; padding:1px 6px; border-radius:3px; background:#f0f0f0; font-size:9px; font-weight:700; color:#555; }
  .check { display:inline-block; width:12px; height:12px; border:1.5px solid #0a0a0a; border-radius:2px; }
  .status-pendente { color:#666; }
  .status-enviado, .status-entregue, .status-lido { color:#1a4fa0; font-weight:600; }
  .status-respondido { color:#1a7a3a; font-weight:700; }
  .status-falhou { color:#c0392b; font-weight:700; }
  .pdf-footer { margin-top:24px; padding-top:12px; border-top:1px solid var(--border); text-align:center; font-size:10px; color:#999; }
  @media print {
    body { padding:18px; font-size:10.5px; }
    table { page-break-inside:auto; }
    tr { page-break-inside:avoid; page-break-after:auto; }
    thead { display:table-header-group; }
  }
</style></head><body>
<div class="pdf-header">
  <div><div class="pdf-sub">Campanha de Marketing</div><div class="pdf-title">${escapeHtml(c.nome)}</div></div>
  <div class="pdf-sub">${hoje}</div>
</div>
<div class="meta">
  <div class="meta-cell"><div class="meta-label">Segmento</div><div class="meta-val">${escapeHtml(c.segmento_nome_cache || '—')}</div></div>
  <div class="meta-cell"><div class="meta-label">Canal</div><div class="meta-val">${CANAL_LABELS[c.canal] || c.canal}</div></div>
  <div class="meta-cell"><div class="meta-label">Status</div><div class="meta-val">${STATUS_CAMP_LABELS[c.status] || c.status}</div></div>
  <div class="meta-cell"><div class="meta-label">Total Clientes</div><div class="meta-val">${fmtNum(lista.length)}</div></div>
</div>
${msgExemplo ? `<div class="msg-box"><div class="msg-title">💬 Mensagem modelo (exemplo com primeiro cliente)</div>${escapeHtml(msgExemplo)}</div>` : ''}
<h2 class="sec">Lista de Contatos</h2>
<table>
  <thead><tr>
    <th style="width:28px">#</th><th>Nome</th><th>WhatsApp</th><th>Telefone</th><th>Email</th><th>UF</th><th>Status</th><th style="width:20px">✓</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="pdf-footer">
  Dana Jalecos Exclusivos · Cliente 360 · Gerado em ${hoje} por ${escapeHtml(c.criado_por_nome || '—')}<br>
  Empresa: ${EMPRESA_LABELS[c.empresa] || c.empresa} · Total de contatos: ${fmtNum(lista.length)}
</div>
<script>setTimeout(() => { window.print(); }, 400);<\/script>
</body></html>`);
  };

  // ─── Realtime ───
  function subscribeRealtimeCampanhas() {
    if (state.campanhasChannel) return;
    state.campanhasChannel = state.sb
      .channel('realtime-cliente-campanhas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cliente_campanhas' }, async () => {
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-campanhas') await renderCampanhasPage();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cliente_campanha_envios' }, async () => {
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-campanhas') {
          setTimeout(async () => { await renderCampanhasPage(); }, 300);
        }
      })
      .subscribe();
  }

  // ══════════════════════════════════════════════════════════
  // SINCRONIZAÇÃO (Fase 7.1) · status dos crons Bling
  // ══════════════════════════════════════════════════════════

  const SYNC_TABELA_META = {
    pedidos:         { icon: '🛒', label: 'Pedidos' },
    pedidos_itens:   { icon: '📦', label: 'Itens' },
    contatos:        { icon: '👥', label: 'Contatos' },
    produtos:        { icon: '🏷️', label: 'Produtos' },
    contas_receber:  { icon: '💰', label: 'Contas a Receber' },
    contas_pagar:    { icon: '💳', label: 'Contas a Pagar' },
  };
  const SYNC_STATUS_CORES = {
    ok: '#10b981', parcial: '#f59e0b', erro: '#ef4444',
  };
  state.syncLog = [];
  state.syncEmpresaFilter = 'todas';
  state.syncChannel = null;
  state.syncReRenderTimer = null;

  // Deriva empresa pelo campo 'tipo' do sync_log
  // tipo='sync_bc' → bc; tudo mais → matriz
  function empresaFromSyncTipo(tipo) {
    return tipo === 'sync_bc' ? 'bc' : 'matriz';
  }

  function tempoAtras(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'agora';
    if (secs < 3600) return `${Math.floor(secs/60)} min atrás`;
    if (secs < 86400) return `${Math.floor(secs/3600)} h atrás`;
    if (secs < 604800) return `${Math.floor(secs/86400)} d atrás`;
    return d.toLocaleDateString('pt-BR');
  }

  async function loadSyncLog() {
    const { data, error } = await state.sb
      .from('sync_log').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) { console.warn('[c360 sync] load:', error); return []; }
    state.syncLog = data || [];
    return state.syncLog;
  }

  async function renderSincronizacaoPage() {
    const page = document.getElementById('page-sincronizacao');
    if (!page) return;
    page.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">⏳ Carregando status de sincronização...</div>';

    await loadSyncLog();

    // Última sync por (tabela, empresa) — o primeiro que aparece é o mais recente
    const ultimas = {};
    for (const row of state.syncLog) {
      const emp = empresaFromSyncTipo(row.tipo);
      const key = `${row.tabela}::${emp}`;
      if (!ultimas[key]) ultimas[key] = row;
    }

    const kpiTabs = ['pedidos', 'contatos', 'produtos', 'contas_receber'];
    const kpiCards = kpiTabs.map(tab => {
      const meta = SYNC_TABELA_META[tab] || { icon: '📄', label: tab };
      const m = ultimas[`${tab}::matriz`];
      const b = ultimas[`${tab}::bc`];
      const cell = (row, emp) => {
        if (!row) return '<div style="font-size:11px;color:#64748b;margin-top:2px">—</div>';
        const corS = SYNC_STATUS_CORES[row.status] || '#94a3b8';
        return `
          <div style="font-size:12.5px;color:#e2e8f0;margin-top:2px">${tempoAtras(row.created_at)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
            <span style="width:6px;height:6px;border-radius:50%;background:${corS};display:inline-block"></span>
            <span style="font-size:10.5px;color:#94a3b8">${fmtNum(row.registros || 0)} registros</span>
          </div>`;
      };
      return `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-size:18px">${meta.icon}</span>
            <span style="font-size:13px;font-weight:700;color:#f1f5f9">${meta.label}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Matriz</div>
              ${cell(m, 'matriz')}
            </div>
            <div>
              <div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">BC</div>
              ${cell(b, 'bc')}
            </div>
          </div>
        </div>`;
    }).join('');

    // Tabela detalhada com filtro
    const filtro = state.syncEmpresaFilter;
    const filtered = state.syncLog.filter(r => {
      if (filtro === 'todas') return true;
      return empresaFromSyncTipo(r.tipo) === filtro;
    }).slice(0, 50);

    const tableRow = (r) => {
      const meta = SYNC_TABELA_META[r.tabela] || { icon: '📄', label: r.tabela };
      const emp = empresaFromSyncTipo(r.tipo);
      const empLabel = emp === 'matriz' ? 'Matriz' : 'BC';
      const corStatus = SYNC_STATUS_CORES[r.status] || '#94a3b8';
      const detalhes = r.detalhes || r.erro || '—';
      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <td style="padding:8px 10px;font-size:12px;color:#e2e8f0"><span style="font-size:14px;margin-right:6px">${meta.icon}</span>${meta.label}</td>
          <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${empLabel}</td>
          <td style="padding:8px 10px"><span style="font-size:10.5px;padding:2px 8px;border-radius:10px;background:${corStatus}22;color:${corStatus};font-weight:600;text-transform:uppercase">${escapeHtml(r.status || '?')}</span></td>
          <td style="padding:8px 10px;font-size:12px;color:#e2e8f0;text-align:right">${fmtNum(r.registros || 0)}</td>
          <td style="padding:8px 10px;font-size:11px;color:#64748b;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(detalhes)}">${escapeHtml(detalhes)}</td>
          <td style="padding:8px 10px;font-size:11px;color:#94a3b8;white-space:nowrap;text-align:right">${tempoAtras(r.created_at)}</td>
        </tr>`;
    };

    page.innerHTML = `
<div style="padding:24px;max-width:1400px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Sincronização</h1>
      <div style="font-size:13px;color:#94a3b8">Status dos crons Bling que alimentam o Cliente 360 · atualiza em tempo real</div>
    </div>
    <button onclick="c360ReloadSync()" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#e2e8f0;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">🔄 Atualizar</button>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:24px">
    ${kpiCards}
  </div>

  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);gap:10px;flex-wrap:wrap">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5)">Últimas Execuções (${filtered.length})</div>
      <select id="sync-emp-filter" onchange="c360FilterSync(this.value)" style="padding:6px 26px 6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(20,20,25,1);color:#f1f5f9;font-size:11.5px;font-family:inherit;cursor:pointer;appearance:none;-webkit-appearance:none;color-scheme:dark;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22rgb(161,161,170)%22 stroke-width=%222%22><polyline points=%226 9 12 15 18 9%22/></svg>');background-repeat:no-repeat;background-position:right 6px center">
        <option value="todas" ${filtro==='todas'?'selected':''}>Todas as empresas</option>
        <option value="matriz" ${filtro==='matriz'?'selected':''}>Matriz</option>
        <option value="bc" ${filtro==='bc'?'selected':''}>Balneário (BC)</option>
      </select>
    </div>
    <div style="max-height:600px;overflow-y:auto">
      ${filtered.length === 0
        ? '<div style="padding:40px;text-align:center;color:#64748b"><div style="font-size:24px;margin-bottom:8px">📭</div>Nenhuma execução encontrada pra este filtro</div>'
        : `<table style="width:100%;border-collapse:collapse">
            <thead style="position:sticky;top:0;background:#0b0f17;z-index:1"><tr>
              <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Tabela</th>
              <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Empresa</th>
              <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Status</th>
              <th style="padding:10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Registros</th>
              <th style="padding:10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Detalhes</th>
              <th style="padding:10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.08)">Quando</th>
            </tr></thead>
            <tbody>${filtered.map(tableRow).join('')}</tbody>
          </table>`}
    </div>
  </div>
</div>`;
  }

  window.c360ReloadSync = async function() {
    await renderSincronizacaoPage();
    if (typeof showToast === 'function') showToast('Atualizado', 'success');
  };

  window.c360FilterSync = async function(emp) {
    state.syncEmpresaFilter = emp;
    await renderSincronizacaoPage();
  };

  window.c360ReRenderSincronizacaoIfActive = async function() {
    const active = document.querySelector('.page-section.active');
    if (active?.id === 'page-sincronizacao') await renderSincronizacaoPage();
  };

  function subscribeRealtimeSync() {
    if (state.syncChannel) return;
    state.syncChannel = state.sb
      .channel('realtime-sync-log')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sync_log' }, () => {
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-sincronizacao') {
          // debounce pra nao rerender varias vezes se chegar burst
          clearTimeout(state.syncReRenderTimer);
          state.syncReRenderTimer = setTimeout(() => renderSincronizacaoPage(), 800);
        }
      })
      .subscribe();
  }

  // ══════════════════════════════════════════════════════════
  // CONFIGURAÇÕES (Fase 7.2) · info, preferencias, manutencao
  // ══════════════════════════════════════════════════════════

  const C360_PREFS_KEY = 'c360_prefs_v1';
  state.c360ConfigStats = null;

  function loadC360Prefs() {
    try {
      const raw = localStorage.getItem(C360_PREFS_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { paginaTamanho: 50, empresaPadrao: 'matriz' };
  }
  function saveC360Prefs(prefs) {
    try { localStorage.setItem(C360_PREFS_KEY, JSON.stringify(prefs)); } catch(e) {}
  }

  async function loadConfigStats() {
    try {
      const [clientes, notas, insights, segs, camps, envios] = await Promise.all([
        state.sb.from('cliente_scoring_full').select('*', { count: 'exact', head: true }),
        state.sb.from('cliente_notas').select('*', { count: 'exact', head: true }),
        state.sb.from('cliente_insights').select('*', { count: 'exact', head: true }),
        state.sb.from('cliente_segmentos_custom').select('*', { count: 'exact', head: true }),
        state.sb.from('cliente_campanhas').select('*', { count: 'exact', head: true }),
        state.sb.from('cliente_campanha_envios').select('*', { count: 'exact', head: true }),
      ]);
      const sixtyDays = new Date(Date.now() - 60*24*60*60*1000).toISOString();
      const { count: insightsAntigos } = await state.sb.from('cliente_insights')
        .select('*', { count: 'exact', head: true }).lt('created_at', sixtyDays);
      return {
        clientes: clientes.count || 0, notas: notas.count || 0,
        insights: insights.count || 0, insightsAntigos: insightsAntigos || 0,
        segmentos: segs.count || 0, campanhas: camps.count || 0, envios: envios.count || 0,
      };
    } catch(e) { console.warn('[c360 config] stats:', e); return null; }
  }

  async function renderConfiguracoesPage() {
    const page = document.getElementById('page-configuracoes');
    if (!page) return;
    page.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">⏳ Carregando...</div>';

    const [stats, profile] = await Promise.all([
      loadConfigStats(),
      (async () => {
        try {
          const { data: { user } } = await state.sb.auth.getUser();
          if (!user) return null;
          const { data } = await state.sb.from('profiles').select('nome, cargo').eq('id', user.id).single();
          return data;
        } catch(e) { return null; }
      })(),
    ]);
    const isAdmin = profile?.cargo === 'admin';
    const prefs = loadC360Prefs();

    const infoCard = (icon, label, value, sub) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:18px">${icon}</span>
          <span style="font-size:10.5px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px">${label}</span>
        </div>
        <div style="font-size:22px;font-weight:700;color:#f1f5f9">${value}</div>
        ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${sub}</div>` : ''}
      </div>`;

    page.innerHTML = `
<div style="padding:24px;max-width:1400px;margin:0 auto">
  <div style="margin-bottom:24px">
    <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Configurações</h1>
    <div style="font-size:13px;color:#94a3b8">Preferências, manutenção e info de uso do Cliente 360</div>
  </div>

  <div style="margin-bottom:28px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);margin-bottom:12px">📊 Info de Uso</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px">
      ${stats ? `
        ${infoCard('👥', 'Clientes scorados', fmtNum(stats.clientes), 'Em todas empresas')}
        ${infoCard('📝', 'Notas', fmtNum(stats.notas), null)}
        ${infoCard('◆', 'Insights IA', fmtNum(stats.insights), stats.insightsAntigos ? fmtNum(stats.insightsAntigos) + ' com +60 dias' : 'todos recentes')}
        ${infoCard('🎯', 'Segmentos customizados', fmtNum(stats.segmentos), null)}
        ${infoCard('📣', 'Campanhas', fmtNum(stats.campanhas), fmtNum(stats.envios) + ' envios registrados')}
      ` : '<div style="padding:20px;color:#94a3b8">Não foi possível carregar estatísticas</div>'}
    </div>
  </div>

  <div style="margin-bottom:28px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);margin-bottom:12px">⚙️ Preferências pessoais</div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Itens por página (lista de clientes)</label>
          <select id="cfg-pagesize" onchange="c360SavePrefs()" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(20,20,25,1);color:#f1f5f9;font-size:13px;font-family:inherit">
            <option value="25" ${prefs.paginaTamanho==25?'selected':''}>25</option>
            <option value="50" ${prefs.paginaTamanho==50?'selected':''}>50 (padrão)</option>
            <option value="100" ${prefs.paginaTamanho==100?'selected':''}>100</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px">Empresa padrão ao abrir</label>
          <select id="cfg-empresa-padrao" onchange="c360SavePrefs()" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(20,20,25,1);color:#f1f5f9;font-size:13px;font-family:inherit">
            <option value="matriz" ${prefs.empresaPadrao==='matriz'?'selected':''}>Matriz</option>
            <option value="bc" ${prefs.empresaPadrao==='bc'?'selected':''}>BC</option>
          </select>
        </div>
      </div>
      <div style="font-size:10.5px;color:#64748b;margin-top:10px">Preferências salvas localmente no navegador (localStorage). Não afeta outros usuários.</div>
    </div>
  </div>

  <div style="margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.5);margin-bottom:12px">🧹 Manutenção${isAdmin ? '' : ' <span style="color:#f59e0b;font-size:10px;margin-left:6px;font-weight:600">(só admin)</span>'}</div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <button onclick="c360LimparInsightsAntigos()" ${!isAdmin?'disabled':''} style="padding:10px 16px;border-radius:6px;border:1px solid rgba(245,158,11,${isAdmin?'0.3':'0.12'});background:${isAdmin?'rgba(245,158,11,0.1)':'rgba(255,255,255,0.02)'};color:${isAdmin?'#f59e0b':'#64748b'};cursor:${isAdmin?'pointer':'not-allowed'};font-size:13px;font-family:inherit;text-align:left">🗑 Apagar insights IA com mais de 60 dias${stats?.insightsAntigos ? ` (${stats.insightsAntigos} eligíveis)` : ''}</button>
      <button onclick="c360ClearLocalCache()" style="padding:10px 16px;border-radius:6px;border:1px solid rgba(96,165,250,0.3);background:rgba(96,165,250,0.1);color:#60a5fa;cursor:pointer;font-size:13px;font-family:inherit;text-align:left">🔄 Invalidar cache local e recarregar</button>
    </div>
  </div>
</div>`;
  }

  window.c360SavePrefs = function() {
    const pageSize = parseInt(document.getElementById('cfg-pagesize')?.value || '50', 10);
    const empresa = document.getElementById('cfg-empresa-padrao')?.value || 'matriz';
    saveC360Prefs({ paginaTamanho: pageSize, empresaPadrao: empresa });
    if (typeof showToast === 'function') showToast('Preferências salvas', 'success');
  };

  window.c360LimparInsightsAntigos = async function() {
    const ok = await c360Confirm('Apagar TODOS os insights IA com mais de 60 dias?\n\nEsta ação é permanente e não pode ser desfeita.', { danger: true, okLabel: 'Apagar insights antigos' });
    if (!ok) return;
    const sixtyDays = new Date(Date.now() - 60*24*60*60*1000).toISOString();
    const { error, count } = await state.sb.from('cliente_insights')
      .delete({ count: 'exact' }).lt('created_at', sixtyDays);
    if (error) {
      if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error');
      return;
    }
    if (typeof showToast === 'function') showToast(`${count || 0} insights apagados`, 'success');
    await renderConfiguracoesPage();
  };

  window.c360ClearLocalCache = function() {
    // Invalida caches em memoria antes do reload
    try {
      cache.matriz = null; cache.bc = null;
      state.campanhas = []; state.canaisAquisicao = [];
      state.segmentosCustom = null; state.syncLog = [];
      state.logsCache = null; state.c360ConfigStats = null;
    } catch(e) {}
    if (typeof showToast === 'function') showToast('Cache limpo. Recarregando...', 'success');
    setTimeout(() => window.location.reload(), 400);
  };

  window.c360ReRenderConfiguracoesIfActive = async function() {
    const active = document.querySelector('.page-section.active');
    if (active?.id === 'page-configuracoes') await renderConfiguracoesPage();
  };

  // ══════════════════════════════════════════════════════════
  // LOGS (Fase 7.3) · timeline unificada de eventos do C360
  // ══════════════════════════════════════════════════════════

  state.logsCache = null;
  state.logsFiltroTipo = 'todos';
  state.logsFiltroPeriodo = 30;
  state.logsPage = 0;

  async function loadLogsC360() {
    const desde = new Date(Date.now() - state.logsFiltroPeriodo * 24*60*60*1000).toISOString();
    try {
      const [notas, insights, segs, camps] = await Promise.all([
        state.sb.from('cliente_notas')
          .select('id, contato_nome, empresa, user_nome, created_at')
          .gte('created_at', desde).order('created_at', { ascending: false }).limit(200),
        state.sb.from('cliente_insights')
          .select('id, contato_nome, empresa, user_nome, created_at')
          .gte('created_at', desde).order('created_at', { ascending: false }).limit(200),
        state.sb.from('cliente_segmentos_custom')
          .select('id, nome, empresa, user_nome, created_at')
          .gte('created_at', desde).order('created_at', { ascending: false }).limit(200),
        state.sb.from('cliente_campanhas')
          .select('id, nome, empresa, criado_por_nome, created_at')
          .gte('created_at', desde).order('created_at', { ascending: false }).limit(200),
      ]);

      const eventos = [];
      (notas.data || []).forEach(n => eventos.push({
        tipo: 'nota', icon: '📝', label: 'escreveu nota em',
        alvo: n.contato_nome, empresa: n.empresa,
        autor: n.user_nome || '—', data: n.created_at,
      }));
      (insights.data || []).forEach(i => eventos.push({
        tipo: 'insight', icon: '◆', label: 'gerou insight IA para',
        alvo: i.contato_nome, empresa: i.empresa,
        autor: i.user_nome || '—', data: i.created_at,
      }));
      (segs.data || []).forEach(s => eventos.push({
        tipo: 'segmento', icon: '🎯', label: 'criou segmento:',
        alvo: s.nome, empresa: s.empresa,
        autor: s.user_nome || '—', data: s.created_at,
      }));
      (camps.data || []).forEach(c => eventos.push({
        tipo: 'campanha', icon: '📣', label: 'criou campanha:',
        alvo: c.nome, empresa: c.empresa,
        autor: c.criado_por_nome || '—', data: c.created_at,
      }));

      eventos.sort((a, b) => new Date(b.data) - new Date(a.data));
      state.logsCache = eventos;
      return eventos;
    } catch(e) {
      console.warn('[c360 logs] load:', e);
      state.logsCache = [];
      return [];
    }
  }

  async function renderLogsPage() {
    const page = document.getElementById('page-logs');
    if (!page) return;
    page.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">⏳ Carregando logs...</div>';

    const eventos = await loadLogsC360();
    const filtrados = eventos.filter(e => state.logsFiltroTipo === 'todos' || e.tipo === state.logsFiltroTipo);

    const PAGE = 50;
    const start = state.logsPage * PAGE;
    const end = Math.min(start + PAGE, filtrados.length);
    const slice = filtrados.slice(start, end);

    const fmt = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const empLabel = (e) => e === 'matriz' ? 'Matriz' : e === 'bc' ? 'BC' : e === 'ambas' ? 'Ambas' : (e || '—');
    const TIPO_CORES = { nota: '#60a5fa', insight: '#a78bfa', segmento: '#10b981', campanha: '#f59e0b' };

    const row = (ev) => `
      <div style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);align-items:flex-start">
        <div style="font-size:16px;margin-top:2px;flex-shrink:0">${ev.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:#e2e8f0;line-height:1.4">
            <strong style="color:${TIPO_CORES[ev.tipo] || '#94a3b8'}">${escapeHtml(ev.autor)}</strong>
            <span style="color:#94a3b8"> ${ev.label} </span>
            <strong style="color:#f1f5f9">${escapeHtml(ev.alvo || '—')}</strong>
          </div>
          <div style="font-size:10.5px;color:#64748b;margin-top:3px">${empLabel(ev.empresa)} · ${fmt(ev.data)}</div>
        </div>
      </div>`;

    const contagens = {
      todos: eventos.length,
      nota: eventos.filter(e => e.tipo === 'nota').length,
      insight: eventos.filter(e => e.tipo === 'insight').length,
      segmento: eventos.filter(e => e.tipo === 'segmento').length,
      campanha: eventos.filter(e => e.tipo === 'campanha').length,
    };

    page.innerHTML = `
<div style="padding:24px;max-width:1400px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Logs</h1>
      <div style="font-size:13px;color:#94a3b8">Timeline de eventos do Cliente 360 · últimos ${state.logsFiltroPeriodo} dias</div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="c360ExportLogsCsv()" style="padding:10px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#e2e8f0;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">⬇ CSV</button>
      <button onclick="c360ReloadLogs()" style="padding:10px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#e2e8f0;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">🔄 Atualizar</button>
    </div>
  </div>

  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
    <select onchange="c360FiltraLogsTipo(this.value)" style="padding:8px 26px 8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(20,20,25,1);color:#f1f5f9;font-size:12px;font-family:inherit;cursor:pointer">
      <option value="todos" ${state.logsFiltroTipo==='todos'?'selected':''}>Todos os tipos (${contagens.todos})</option>
      <option value="nota" ${state.logsFiltroTipo==='nota'?'selected':''}>📝 Notas (${contagens.nota})</option>
      <option value="insight" ${state.logsFiltroTipo==='insight'?'selected':''}>◆ Insights IA (${contagens.insight})</option>
      <option value="segmento" ${state.logsFiltroTipo==='segmento'?'selected':''}>🎯 Segmentos (${contagens.segmento})</option>
      <option value="campanha" ${state.logsFiltroTipo==='campanha'?'selected':''}>📣 Campanhas (${contagens.campanha})</option>
    </select>
    <select onchange="c360FiltraLogsPeriodo(this.value)" style="padding:8px 26px 8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(20,20,25,1);color:#f1f5f9;font-size:12px;font-family:inherit;cursor:pointer">
      <option value="7" ${state.logsFiltroPeriodo==7?'selected':''}>Últimos 7 dias</option>
      <option value="30" ${state.logsFiltroPeriodo==30?'selected':''}>Últimos 30 dias</option>
      <option value="90" ${state.logsFiltroPeriodo==90?'selected':''}>Últimos 90 dias</option>
    </select>
    <span style="font-size:11px;color:#94a3b8;margin-left:auto">${filtrados.length} eventos${filtrados.length ? ` · mostrando ${start+1}-${end}` : ''}</span>
  </div>

  <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden">
    ${slice.length === 0
      ? '<div style="padding:40px;text-align:center;color:#64748b"><div style="font-size:24px;margin-bottom:8px">📭</div>Nenhum evento no período filtrado</div>'
      : slice.map(row).join('')}
  </div>

  ${filtrados.length > PAGE ? `
    <div style="display:flex;justify-content:center;gap:8px;margin-top:16px;align-items:center">
      <button onclick="c360LogsPage(-1)" ${state.logsPage===0?'disabled':''} style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:${state.logsPage===0?'#64748b':'#e2e8f0'};cursor:${state.logsPage===0?'not-allowed':'pointer'};font-size:12px;font-family:inherit">← Anterior</button>
      <span style="padding:6px 14px;font-size:12px;color:#94a3b8">Página ${state.logsPage+1} de ${Math.ceil(filtrados.length / PAGE)}</span>
      <button onclick="c360LogsPage(1)" ${end>=filtrados.length?'disabled':''} style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:${end>=filtrados.length?'#64748b':'#e2e8f0'};cursor:${end>=filtrados.length?'not-allowed':'pointer'};font-size:12px;font-family:inherit">Próxima →</button>
    </div>
  ` : ''}
</div>`;
  }

  window.c360FiltraLogsTipo = async function(v) { state.logsFiltroTipo = v; state.logsPage = 0; await renderLogsPage(); };
  window.c360FiltraLogsPeriodo = async function(v) { state.logsFiltroPeriodo = +v; state.logsPage = 0; state.logsCache = null; await renderLogsPage(); };
  window.c360LogsPage = async function(dir) { state.logsPage = Math.max(0, state.logsPage + dir); await renderLogsPage(); };
  window.c360ReloadLogs = async function() {
    state.logsCache = null;
    await renderLogsPage();
    if (typeof showToast === 'function') showToast('Atualizado', 'success');
  };

  window.c360ExportLogsCsv = function() {
    const eventos = state.logsCache || [];
    if (eventos.length === 0) {
      if (typeof showToast === 'function') showToast('Nada pra exportar', 'warn');
      return;
    }
    const BOM = '\ufeff';
    const headers = ['Tipo', 'Autor', 'Acao', 'Alvo', 'Empresa', 'Data'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g,'""').replace(/\r?\n/g,' ')}"`;
    const csv = BOM + headers.map(esc).join(';') + '\r\n'
      + eventos.map(e => [e.tipo, e.autor, e.label, e.alvo, e.empresa, e.data].map(esc).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_cliente360_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    if (typeof showToast === 'function') showToast(`${eventos.length} eventos exportados`, 'success');
  };

  window.c360ReRenderLogsIfActive = async function() {
    const active = document.querySelector('.page-section.active');
    if (active?.id === 'page-logs') await renderLogsPage();
  };

  // ══════════════════════════════════════════════════════════
  // MEUS CLIENTES (Fase 8) — carteira por vendedor
  // ══════════════════════════════════════════════════════════

  // Caches simples
  state.mcPerms = null;           // { meus_clientes: bool, cargo: str, profileId: uuid, nome: str }
  state.mcProfiles = null;        // lista de profiles (pra ranking/reatribuir)
  state.mcScoringCache = null;    // { empresa, data, ts }

  async function mcLoadPerms() {
    if (state.mcPerms) return state.mcPerms;
    // Nao cacheia resultado degradado (retry na proxima chamada)
    const { data: { user } } = await state.sb.auth.getUser();
    if (!user) { console.warn('[mc] mcLoadPerms: sem user (nao cacheia)'); return { meus_clientes: false, c360Tabs: {}, _degradado: true }; }
    const { data: profile } = await state.sb.from('profiles').select('id, nome, cargo').eq('id', user.id).maybeSingle();
    if (!profile) { console.warn('[mc] mcLoadPerms: sem profile (nao cacheia)'); return { meus_clientes: false, c360Tabs: {}, _degradado: true }; }
    // Busca TODAS permissoes relevantes do cargo de uma vez
    const { data: perms } = await state.sb.from('cargo_permissoes')
      .select('secao, permitido').eq('cargo', profile.cargo)
      .in('secao', ['meus_clientes','c360_dashboard','c360_clientes','c360_segmentacao','c360_campanhas','c360_sincronizacao','c360_configuracoes','c360_logs']);
    const permMap = {};
    (perms || []).forEach(p => { permMap[p.secao] = !!p.permitido; });
    // Mapping entre secao de permissao e id de pagina do C360
    const c360Tabs = {
      'dashboard': permMap.c360_dashboard !== false,
      'clientes': permMap.c360_clientes !== false,
      'segmentos': permMap.c360_segmentacao !== false,
      'campanhas': permMap.c360_campanhas !== false,
      'sincronizacao': permMap.c360_sincronizacao !== false,
      'configuracoes': permMap.c360_configuracoes !== false,
      'logs': permMap.c360_logs !== false,
      'meus-clientes': permMap.meus_clientes !== false,
    };
    state.mcPerms = {
      meus_clientes: !!permMap.meus_clientes,
      cargo: profile.cargo,
      profileId: profile.id,
      nome: profile.nome,
      podeReatribuir: (profile.cargo === 'admin' || profile.cargo === 'gerente_comercial'),
      eVendedor: (profile.cargo === 'vendedor'),
      eAdminOuGerente: ['admin','gerente_comercial','gerente_marketing'].includes(profile.cargo),
      c360Tabs,
      permMap,
    };
    return state.mcPerms;
  }

  async function mcLoadProfiles() {
    if (state.mcProfiles) return state.mcProfiles;
    const { data } = await state.sb.from('profiles').select('id, nome, cargo').order('nome');
    state.mcProfiles = data || [];
    return state.mcProfiles;
  }

  // Totais agregados (1 row por empresa) - evita limite 1000
  async function mcLoadTotais(empresa) {
    const { data, error } = await state.sb.from('meus_clientes_totais').select('*').eq('empresa', empresa).maybeSingle();
    if (error) { console.error('[mc] totais error', error); return null; }
    return data;
  }

  // Ranking por vendedor (agregado server-side)
  async function mcLoadRanking(empresa) {
    const { data, error } = await state.sb.from('vendedor_performance').select('*').eq('empresa', empresa).order('faturamento', { ascending: false });
    if (error) { console.error('[mc] ranking error', error); return []; }
    return data || [];
  }

  // Carrega clientes MANUAIS (cadastrados no DMS, fora do Bling)
  async function mcLoadClientesManuais(empresa, vendedorId) {
    let q = state.sb.from('clientes_manuais').select('*').eq('empresa', empresa);
    if (vendedorId === '__none__') q = q.is('profile_id_vendedor', null);
    else if (vendedorId) q = q.eq('profile_id_vendedor', vendedorId);
    q = q.order('created_at', { ascending: false }).limit(500);
    const { data, error } = await q;
    if (error) { console.error('[mc] manuais error', error); return []; }
    return data || [];
  }

  // Normaliza cliente manual pro formato da tabela (compat com clientes Bling)
  function mcNormalizarManual(m) {
    return {
      contato_nome: m.nome,
      contato_id: null, // manual nao tem contato_id Bling
      manual_id: m.id, // flag pra identificar
      telefone: m.telefone || '',
      celular: '',
      empresa: m.empresa,
      segmento: 'Novo',
      score: 0,
      total_pedidos: 0,
      total_gasto: 0,
      ticket_medio: 0,
      ultima_compra: null,
      dias_sem_compra: null,
      vendedor_profile_id: m.profile_id_vendedor,
      vendedor_nome: '', // preenchido pelo backend se quiser
      vendedor_fonte: 'manual_dms',
      status_relacionamento: m.status_relacionamento,
      observacao: m.observacao,
      documento: m.documento,
      cidade: m.cidade,
      uf: m.uf,
      email: m.email,
    };
  }

  // Lista de clientes - filtrada server-side
  async function mcLoadClientes(empresa, vendedorId, busca, limit, filtros) {
    let q = state.sb.from('cliente_scoring_vendedor').select('*').eq('empresa', empresa);
    if (vendedorId === '__none__') q = q.is('vendedor_profile_id', null);
    else if (vendedorId) q = q.eq('vendedor_profile_id', vendedorId);
    if (busca) q = q.ilike('contato_nome', '%' + busca.replace(/%/g,'') + '%');
    // Filtros opcionais
    const f = filtros || {};
    if (f.segmento) q = q.eq('segmento', f.segmento);
    if (f.pedidosMin != null) q = q.gte('total_pedidos', f.pedidosMin);
    if (f.pedidosMax != null) q = q.lte('total_pedidos', f.pedidosMax);
    if (f.gastoMin != null) q = q.gte('total_gasto', f.gastoMin);
    if (f.gastoMax != null) q = q.lte('total_gasto', f.gastoMax);
    q = q.order('score', { ascending: false }).limit(limit || 500);
    const { data, error } = await q;
    if (error) { console.error('[mc] clientes error', error); return []; }
    return data || [];
  }

  function mcInvalidateCache() {
    state.mcScoringCache = null;
    state.mcProfiles = null;
    state.mcAdminRanking = null;
    state.mcAdminVendedores = null;
  }

  // Realtime: escuta mudancas em vendedor_mapping, profiles, cliente_vendedor_manual
  // e cargo_permissoes (pra reaplicar hide de abas na hora).
  function mcSubscribeRealtime() {
    if (state.mcRealtimeChannel) return;
    state.mcRealtimeChannel = state.sb
      .channel('realtime-meus-clientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendedor_mapping' }, async () => {
        mcInvalidateCache();
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-meus-clientes') await renderMeusClientesPage();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => {
        state.mcProfiles = null;
        state.mcPerms = null; // pode ter mudado cargo
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-meus-clientes') await renderMeusClientesPage();
        await mcApplyTabPermissions();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cliente_vendedor_manual' }, async () => {
        mcInvalidateCache();
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-meus-clientes') await renderMeusClientesPage();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cargo_permissoes' }, async () => {
        state.mcPerms = null; // invalida cache de perms
        await mcApplyTabPermissions();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes_manuais' }, async () => {
        const active = document.querySelector('.page-section.active');
        if (active?.id === 'page-meus-clientes') await renderMeusClientesPage();
      })
      // Pedido novo/editado -> faturamento, ranking, carteira de cada vendedor mudam.
      // Debounce 8s porque sync do Bling pode gerar rajada de eventos.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        clearTimeout(state.mcPedidosDebounce);
        state.mcPedidosDebounce = setTimeout(async () => {
          mcInvalidateCache();
          const active = document.querySelector('.page-section.active');
          if (active?.id === 'page-meus-clientes') await renderMeusClientesPage();
          if (active?.id === 'page-dashboard' && typeof window.c360ReloadDashboard === 'function') {
            window.c360ReloadDashboard();
          }
        }, 8000);
      })
      .subscribe();
  }

  // Esconde as abas do C360 que o usuario NAO tem permissao (configuravel no Admin).
  // Tambem intercepta showPage pra impedir navegacao direta.
  async function mcApplyTabPermissions() {
    const perms = await mcLoadPerms();
    // Se resultado degradado (auth nao pronto), tenta novamente
    if (perms._degradado) {
      setTimeout(() => mcApplyTabPermissions(), 500);
      return;
    }
    const tabs = perms.c360Tabs || {};
    // Determina primeira aba permitida (pra redirect se usuario cair numa bloqueada)
    const ordem = ['dashboard','clientes','meus-clientes','segmentos','campanhas','sincronizacao','configuracoes','logs'];
    const primeiraPermitida = ordem.find(id => tabs[id]) || 'dashboard';
    state.mcPrimeiraAbaPermitida = primeiraPermitida;

    // Esconde CSS-only (retry pra casos onde sidebar renderiza tardiamente)
    const aplicarHide = () => {
      const navs = document.querySelectorAll('[data-nav-page]');
      let changed = 0;
      navs.forEach(btn => {
        const pageId = btn.getAttribute('data-nav-page');
        const li = btn.closest('li') || btn.parentElement;
        if (!li) return;
        const deveEsconder = tabs[pageId] === false;
        const novoDisplay = deveEsconder ? 'none' : '';
        if (li.style.display !== novoDisplay) { li.style.display = novoDisplay; changed++; }
      });
      return changed;
    };
    // Tenta varias vezes
    for (let i = 0; i < 15; i++) {
      aplicarHide();
      if (document.querySelector('[data-nav-page]')) break;
      await new Promise(r => setTimeout(r, 200));
    }
    // Loop periodico (caso algo re-renderize a sidebar)
    if (state.mcHideNavInterval) { clearInterval(state.mcHideNavInterval); }
    state.mcHideNavInterval = setInterval(aplicarHide, 1500);

    // Intercepta showPage pra bloquear abas sem permissao
    if (!state.mcShowPageWrapped) {
      state.mcShowPageWrapped = true;
      const orig = window.showPage;
      if (typeof orig === 'function') {
        window.showPage = function(id) {
          const t = state.mcPerms?.c360Tabs || {};
          if (id in t && t[id] === false) {
            id = state.mcPrimeiraAbaPermitida || 'dashboard';
          }
          return orig(id);
        };
      }
    }
    // Se ativo atual eh uma aba bloqueada, redireciona
    const active = document.querySelector('.page-section.active');
    if (active) {
      const aid = active.id.replace(/^page-/, '');
      if (tabs[aid] === false && typeof window.showPage === 'function') {
        window.showPage(primeiraPermitida);
      }
    }
  }

  // Injeta nav "Meus Clientes" no sidebar + cria div da pagina
  // Sempre injeta — mcApplyTabPermissions decide se fica visivel ou nao.
  async function mcSetupNav() {
    const perms = await mcLoadPerms();
    // Se resultado degradado (auth nao pronto), tenta novamente em 500ms
    if (perms._degradado) {
      setTimeout(() => mcSetupNav(), 500);
      return;
    }

    // 1) Cria page container se ainda nao existe
    // Importante: precisa do wrapper sidebar-inset pra ocupar o espaço flex depois da sidebar
    if (!document.getElementById('page-meus-clientes')) {
      // Tenta clonar o wrapper externo de uma pagina que ja funciona (page-sincronizacao)
      const ref = document.getElementById('page-sincronizacao') || document.getElementById('page-dashboard') || document.getElementById('page-clientes');
      if (ref) {
        const clone = ref.cloneNode(false);
        clone.id = 'page-meus-clientes';
        clone.className = 'page-section';
        // Monta a mesma estrutura (2 mains aninhados + div interno) usando clone da referência
        const refInner = ref.cloneNode(true);
        clone.innerHTML = '';
        // Copia só a estrutura do outer <main> — mas sem o conteudo
        const outerMain = refInner.querySelector('main[data-slot="sidebar-inset"]');
        if (outerMain) {
          const innerMain = outerMain.querySelector('main.flex-1') || outerMain.querySelector('main');
          if (innerMain) innerMain.innerHTML = '<div id="mc-content" style="padding:40px;color:#94a3b8;text-align:center">⏳ Carregando...</div>';
          else outerMain.innerHTML = '<main class="flex-1 p-6 md:p-8"><div id="mc-content" style="padding:40px;color:#94a3b8;text-align:center">⏳ Carregando...</div></main>';
          clone.appendChild(outerMain);
        } else {
          clone.innerHTML = '<main class="bg-background relative flex w-full flex-1 flex-col" data-slot="sidebar-inset"><main class="flex-1 p-6 md:p-8"><div id="mc-content" style="padding:40px;color:#94a3b8;text-align:center">⏳ Carregando...</div></main></main>';
        }
        ref.parentNode.appendChild(clone);
      } else {
        // Fallback: append direto em #root (menos confiavel)
        const root = document.getElementById('root') || document.body;
        const page = document.createElement('div');
        page.id = 'page-meus-clientes';
        page.className = 'page-section';
        page.innerHTML = '<main class="bg-background relative flex w-full flex-1 flex-col" data-slot="sidebar-inset"><main class="flex-1 p-6 md:p-8"><div id="mc-content" style="padding:40px;color:#94a3b8;text-align:center">⏳ Carregando...</div></main></main>';
        root.appendChild(page);
      }
    }

    // 2) Injeta nav button (clona o botao de "logs" e adapta)
    // Retry ate 10x com 200ms entre tentativas — sidebar pode nao estar no DOM ainda apos cache clear
    if (document.querySelector('[data-nav-page="meus-clientes"]')) return; // ja injetado
    let logsBtn = null;
    for (let tries = 0; tries < 15; tries++) {
      logsBtn = document.querySelector('[data-nav-page="logs"]');
      if (logsBtn) break;
      await new Promise(r => setTimeout(r, 200));
      if (document.querySelector('[data-nav-page="meus-clientes"]')) return; // injetado em paralelo
    }
    if (!logsBtn) { console.warn('[mc] logs nav nao achada apos retries — nav nao injetada'); return; }
    const parentLi = logsBtn.closest('li') || logsBtn.parentElement;
    if (!parentLi) return;

    const newLi = parentLi.cloneNode(true);
    const newBtn = newLi.querySelector('[data-nav-page]');
    if (!newBtn) return;
    newBtn.setAttribute('data-nav-page', 'meus-clientes');
    newBtn.setAttribute('onclick', "showPage('meus-clientes')");
    // Troca icone + texto
    const svg = newBtn.querySelector('svg');
    if (svg) {
      svg.outerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>';
    }
    const label = newBtn.querySelector('span');
    if (label) label.textContent = 'Meus Clientes';
    // Tira estado ativo herdado
    newBtn.setAttribute('data-active', 'false');
    newBtn.setAttribute('data-state', 'closed');

    // Insere depois de Clientes (ou antes de Segmentacao). Prefere depois da nav "clientes".
    const clientesBtn = document.querySelector('[data-nav-page="clientes"]');
    const targetLi = clientesBtn ? (clientesBtn.closest('li') || clientesBtn.parentElement) : parentLi;
    if (targetLi && targetLi.parentNode) {
      targetLi.parentNode.insertBefore(newLi, targetLi.nextSibling);
    }
  }

  // ─── Render principal ───
  // Sempre escreve em #mc-content (div interno), preservando o wrapper sidebar-inset
  function mcGetContent() {
    return document.querySelector('#page-meus-clientes #mc-content');
  }
  async function renderMeusClientesPage() {
    const page = document.getElementById('page-meus-clientes');
    const content = mcGetContent();
    if (!page || !content) return;
    const perms = await mcLoadPerms();
    if (!perms.meus_clientes) {
      content.innerHTML = '<div style="padding:40px;color:#94a3b8;text-align:center">Sem permissão.</div>';
      return;
    }
    content.innerHTML = '<div style="padding:30px;color:#94a3b8;text-align:center">⏳ Carregando...</div>';

    if (perms.eAdminOuGerente) {
      await renderMcAdminView(content, perms);
    } else {
      await renderMcVendedorView(content, perms);
    }
  }

  // ─── View VENDEDOR (só clientes dele) ───
  async function renderMcVendedorView(content, perms) {
    const filtros = state.mcVendedorFiltros || {};
    const [meusBling, manuaisRaw] = await Promise.all([
      mcLoadClientes(state.empresa, perms.profileId, filtros.busca || null, 1000, filtros),
      mcLoadClientesManuais(state.empresa, perms.profileId),
    ]);
    // Aplica filtros em manuais localmente (PostgREST nao tem score/segmento)
    let manuais = manuaisRaw.map(mcNormalizarManual);
    if (filtros.busca) manuais = manuais.filter(c => (c.contato_nome||'').toLowerCase().includes(filtros.busca.toLowerCase()));
    if (filtros.segmento) manuais = manuais.filter(c => c.segmento === filtros.segmento);
    if (filtros.pedidosMin != null) manuais = manuais.filter(c => (c.total_pedidos||0) >= filtros.pedidosMin);
    if (filtros.pedidosMax != null) manuais = manuais.filter(c => (c.total_pedidos||0) <= filtros.pedidosMax);
    if (filtros.gastoMin != null) manuais = manuais.filter(c => Number(c.total_gasto||0) >= filtros.gastoMin);
    if (filtros.gastoMax != null) manuais = manuais.filter(c => Number(c.total_gasto||0) <= filtros.gastoMax);
    const meus = [...manuais, ...meusBling];
    // KPIs gerais (da carteira inteira, nao filtrada) — chamada separada sem filtros
    const todos = (filtros.busca || filtros.segmento || filtros.pedidosMin != null || filtros.pedidosMax != null || filtros.gastoMin != null || filtros.gastoMax != null)
      ? await mcLoadClientes(state.empresa, perms.profileId, null, 1000, null)
      : meus;
    const totalFat = todos.reduce((s, c) => s + Number(c.total_gasto || 0), 0);
    const totalPedidos = todos.reduce((s, c) => s + Number(c.total_pedidos || 0), 0);
    const vips = todos.filter(c => c.segmento === 'VIP').length;
    const ativos = todos.filter(c => (c.dias_sem_compra || 999) <= 180 && c.segmento !== 'Inativo' && c.segmento !== 'Perdido' && c.segmento !== 'Sem histórico').length;
    const emRisco = todos.filter(c => c.segmento === 'Em Risco').length;
    const ticket = totalPedidos > 0 ? totalFat / totalPedidos : 0;
    const temFiltroAtivo = !!(filtros.busca || filtros.segmento || filtros.pedidosMin != null || filtros.pedidosMax != null || filtros.gastoMin != null || filtros.gastoMax != null);

    content.innerHTML = `
      <div style="padding:24px;max-width:1400px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Meus Clientes</h1>
            <div style="font-size:13px;color:#94a3b8">Olá ${escapeHtml(perms.nome)} — sua carteira · ${EMPRESA_LABELS[state.empresa]}</div>
          </div>
          <button onclick="window.c360McReload()" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#e2e8f0;cursor:pointer;font-size:13px;font-weight:600">🔄 Atualizar</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
          ${mcKpiCard('Clientes', fmtNum(todos.length), '#94a3b8')}
          ${mcKpiCard('VIPs', fmtNum(vips), '#fbbf24')}
          ${mcKpiCard('Ativos', fmtNum(ativos), '#22c55e')}
          ${mcKpiCard('Em Risco', fmtNum(emRisco), '#fb923c')}
          ${mcKpiCard('Faturamento', fmtBRL(totalFat), '#a78bfa')}
          ${mcKpiCard('Ticket médio', fmtBRL(ticket), '#60a5fa')}
        </div>

        ${mcRenderFiltrosBar(filtros, true)}

        <div id="mc-tabela-wrap" style="margin-top:14px">
          ${meus.length === 0 && !temFiltroAtivo ? mcEmptyCarteira(perms) : (meus.length === 0 ? mcSemResultados() : mcTabelaClientes(meus, perms))}
        </div>
      </div>
    `;
    mcWireTable(content);
  }

  // ─── View ADMIN / GERENTE (ranking + global) ───
  async function renderMcAdminView(content, perms) {
    const filtros = state.mcAdminFiltros || {};
    // Aggregates server-side (nao limitados a 1000)
    const [totais, ranking, clientesBling, manuaisRaw] = await Promise.all([
      mcLoadTotais(state.empresa),
      mcLoadRanking(state.empresa),
      mcLoadClientes(state.empresa, filtros.vendedor || null, filtros.busca || null, 500, filtros),
      mcLoadClientesManuais(state.empresa, filtros.vendedor || null),
    ]);
    let manuais = manuaisRaw.map(mcNormalizarManual);
    if (filtros.busca) manuais = manuais.filter(c => (c.contato_nome||'').toLowerCase().includes(filtros.busca.toLowerCase()));
    if (filtros.segmento) manuais = manuais.filter(c => c.segmento === filtros.segmento);
    const clientesPreview = [...manuais, ...clientesBling];

    const t = totais || { total_clientes: 0, com_vendedor: 0, sem_vendedor: 0, vendedores_ativos: 0, faturamento_total: 0 };
    const pctAtribuido = t.total_clientes > 0 ? (t.com_vendedor / t.total_clientes * 100).toFixed(1) : '0.0';
    const totalFat = Number(t.faturamento_total || 0);

    // state pro filtro
    state.mcAdminRanking = ranking;
    state.mcAdminVendedores = ranking.filter(r => r.vendedor_profile_id);

    content.innerHTML = `
      <div style="padding:24px;max-width:1400px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 6px;font-size:28px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">Meus Clientes</h1>
            <div style="font-size:13px;color:#94a3b8">Performance por vendedor · ${EMPRESA_LABELS[state.empresa]}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="window.c360McOpenMapear()" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.12);color:#c4b5fd;cursor:pointer;font-size:13px;font-weight:600">⚙ Mapear vendedores Bling</button>
            <button onclick="window.c360McReload()" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#e2e8f0;cursor:pointer;font-size:13px;font-weight:600">🔄 Atualizar</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px">
          ${mcKpiCard('Clientes total', fmtNum(t.total_clientes), '#94a3b8')}
          ${mcKpiCard('Com vendedor', fmtNum(t.com_vendedor) + ' <span style="font-size:11px;color:#64748b">(' + pctAtribuido + '%)</span>', '#22c55e')}
          ${mcKpiCard('Sem vendedor', fmtNum(t.sem_vendedor), t.sem_vendedor > 0 ? '#fb923c' : '#94a3b8')}
          ${mcKpiCard('Faturamento total', fmtBRL(totalFat), '#a78bfa')}
          ${mcKpiCard('Vendedores ativos', fmtNum(t.vendedores_ativos), '#60a5fa')}
        </div>

        ${state.mcAdminVendedores.length === 0 ? mcEmptyMapping() : ''}

        <div style="margin-bottom:24px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="margin:0;font-size:16px;font-weight:600;color:#e2e8f0">🏆 Ranking por vendedor</h2>
            <button type="button" onclick="window.mcExportarRankingPDF()" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.04);color:#e2e8f0;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.04)'">
              🖨 Exportar PDF
            </button>
          </div>
          ${mcRankingTable(ranking, totalFat)}
        </div>

        <div>
          <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#e2e8f0">Clientes</h2>
          ${mcRenderFiltrosBar(state.mcAdminFiltros || {}, false, state.mcAdminVendedores)}
          <div id="mc-tabela-wrap" style="margin-top:14px">${clientesPreview.length === 0 ? mcSemResultados() : mcTabelaClientes(clientesPreview, perms)}</div>
        </div>
      </div>
    `;
    mcWireTable(content);
  }

  // ─── Helpers de UI ───
  function mcKpiCard(label, valor, cor) {
    return `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:4px">${escapeHtml(label)}</div>
        <div style="font-size:22px;font-weight:700;color:${cor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${valor}</div>
      </div>
    `;
  }

  function mcEmptyCarteira(perms) {
    return `
      <div style="background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:12px;padding:40px;text-align:center">
        <div style="font-size:28px;margin-bottom:10px">👥</div>
        <div style="color:#e2e8f0;font-size:15px;font-weight:600;margin-bottom:4px">Sua carteira está vazia</div>
        <div style="color:#94a3b8;font-size:13px;max-width:480px;margin:0 auto">Ainda não há clientes atribuídos a você no ${EMPRESA_LABELS[state.empresa]}. Fale com um gerente pra atribuir clientes ou mapear o seu ID de vendedor do Bling.</div>
      </div>
    `;
  }

  function mcSemResultados() {
    return `
      <div style="background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:12px;padding:30px;text-align:center">
        <div style="font-size:24px;margin-bottom:6px">🔍</div>
        <div style="color:#94a3b8;font-size:13px">Nenhum cliente bate com os filtros aplicados</div>
      </div>
    `;
  }

  // Barra de filtros (compartilhada entre vendedor e admin)
  // ehVendedor=true → usa c360McVendedorFilter; false → c360McAdminFilter
  function mcRenderFiltrosBar(f, ehVendedor, vendedoresList) {
    const fnFilter = ehVendedor ? 'c360McVendedorFilter' : 'c360McAdminFilter';
    const fnClear = ehVendedor ? 'c360McVendedorLimparFiltros' : 'c360McAdminLimparFiltros';
    const temFiltro = !!(f.busca || f.segmento || f.pedidosMin != null || f.pedidosMax != null || f.gastoMin != null || f.gastoMax != null || f.vendedor);
    const vendedorSelect = (!ehVendedor && vendedoresList) ? `
      <div style="display:flex;flex-direction:column;gap:3px;min-width:160px">
        <label style="color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:0.3px">Vendedor</label>
        <select onchange="window.${fnFilter}()" id="mc-filtro-vendedor" style="padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
          <option value="">Todos</option>
          <option value="__none__" ${f.vendedor==='__none__'?'selected':''}>Sem vendedor</option>
          ${vendedoresList.map(r => `<option value="${r.vendedor_profile_id}" ${f.vendedor===r.vendedor_profile_id?'selected':''}>${escapeHtml(r.vendedor_nome || '(sem nome)')}</option>`).join('')}
        </select>
      </div>` : '';
    return `
      <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:240px">
          <label style="color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:0.3px">Buscar nome</label>
          <input type="text" id="mc-filtro-busca" value="${escapeHtml(f.busca || '')}" placeholder="Ex: Natália, Clínica..." oninput="window.${fnFilter}Debounced()" style="padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
        </div>
        ${vendedorSelect}
        <div style="display:flex;flex-direction:column;gap:3px;min-width:140px">
          <label style="color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:0.3px">Segmento</label>
          <select id="mc-filtro-segmento" onchange="window.${fnFilter}()" style="padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
            <option value="">Todos</option>
            <option value="VIP" ${f.segmento==='VIP'?'selected':''}>VIP</option>
            <option value="Frequente" ${f.segmento==='Frequente'?'selected':''}>Frequente</option>
            <option value="Ocasional" ${f.segmento==='Ocasional'?'selected':''}>Ocasional</option>
            <option value="Em Risco" ${f.segmento==='Em Risco'?'selected':''}>Em Risco</option>
            <option value="Inativo" ${f.segmento==='Inativo'?'selected':''}>Inativo</option>
            <option value="Novo" ${f.segmento==='Novo'?'selected':''}>Novo</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;min-width:170px">
          <label style="color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:0.3px">Pedidos (min — max)</label>
          <div style="display:flex;gap:4px">
            <input type="number" min="0" id="mc-filtro-ped-min" value="${f.pedidosMin != null ? f.pedidosMin : ''}" placeholder="min" oninput="window.${fnFilter}Debounced()" style="width:70px;padding:7px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
            <input type="number" min="0" id="mc-filtro-ped-max" value="${f.pedidosMax != null ? f.pedidosMax : ''}" placeholder="max" oninput="window.${fnFilter}Debounced()" style="width:70px;padding:7px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;min-width:200px">
          <label style="color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:0.3px">Total gasto R$ (min — max)</label>
          <div style="display:flex;gap:4px">
            <input type="number" min="0" step="100" id="mc-filtro-gasto-min" value="${f.gastoMin != null ? f.gastoMin : ''}" placeholder="min" oninput="window.${fnFilter}Debounced()" style="width:90px;padding:7px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
            <input type="number" min="0" step="100" id="mc-filtro-gasto-max" value="${f.gastoMax != null ? f.gastoMax : ''}" placeholder="max" oninput="window.${fnFilter}Debounced()" style="width:90px;padding:7px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12.5px">
          </div>
        </div>
        ${temFiltro ? `<button onclick="window.${fnClear}()" style="padding:7px 14px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;font-size:12px">Limpar filtros</button>` : ''}
        <button onclick="window.c360McNovoCliente()" style="padding:7px 14px;border-radius:6px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.12);color:#c4b5fd;cursor:pointer;font-size:12px;font-weight:600">+ Novo cliente</button>
      </div>
    `;
  }

  // Le filtros do DOM
  function mcLerFiltrosDOM() {
    const toNum = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
    return {
      busca: (document.getElementById('mc-filtro-busca')?.value || '').trim() || null,
      segmento: document.getElementById('mc-filtro-segmento')?.value || null,
      pedidosMin: toNum(document.getElementById('mc-filtro-ped-min')?.value),
      pedidosMax: toNum(document.getElementById('mc-filtro-ped-max')?.value),
      gastoMin: toNum(document.getElementById('mc-filtro-gasto-min')?.value),
      gastoMax: toNum(document.getElementById('mc-filtro-gasto-max')?.value),
      vendedor: document.getElementById('mc-filtro-vendedor')?.value || null,
    };
  }

  // Handlers vendedor
  window.c360McVendedorFilter = async function() {
    state.mcVendedorFiltros = mcLerFiltrosDOM();
    await renderMeusClientesPage();
  };
  window.c360McVendedorFilterDebounced = function() {
    clearTimeout(state.mcVendedorFilterTimer);
    state.mcVendedorFilterTimer = setTimeout(window.c360McVendedorFilter, 400);
  };
  window.c360McVendedorLimparFiltros = async function() {
    state.mcVendedorFiltros = {};
    await renderMeusClientesPage();
  };

  // Handlers admin
  window.c360McAdminFilter = async function() {
    state.mcAdminFiltros = mcLerFiltrosDOM();
    await renderMeusClientesPage();
  };
  window.c360McAdminFilterDebounced = function() {
    clearTimeout(state.mcAdminFilterTimer);
    state.mcAdminFilterTimer = setTimeout(window.c360McAdminFilter, 400);
  };
  window.c360McAdminLimparFiltros = async function() {
    state.mcAdminFiltros = {};
    await renderMeusClientesPage();
  };

  function mcEmptyMapping() {
    return `
      <div style="background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.25);border-radius:10px;padding:14px;display:flex;gap:12px;align-items:flex-start">
        <div style="font-size:20px">⚠️</div>
        <div style="flex:1">
          <div style="color:#fdba74;font-weight:600;font-size:13.5px;margin-bottom:3px">Nenhum vendedor mapeado ainda</div>
          <div style="color:#94a3b8;font-size:12.5px">O Bling não expõe o nome dos vendedores, só o ID. Use o botão <strong>⚙ Mapear vendedores Bling</strong> pra relacionar cada ID aos profiles do DMS.</div>
        </div>
      </div>
    `;
  }

  function mcRankingTable(ranking, totalFat) {
    const rows = ranking.map((r, idx) => {
      const fat = Number(r.faturamento || r.fat || 0);
      const pct = totalFat ? (fat / totalFat * 100).toFixed(1) : '0.0';
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`;
      const profileId = r.vendedor_profile_id || r.profile_id;
      const nome = profileId ? escapeHtml(r.vendedor_nome || r.nome || '(sem nome)') : '<span style="color:#fb923c">⚠ Sem vendedor</span>';
      const fonte = r.vendedor_fonte || r.fonte;
      const fonteBadge = fonte === 'manual' ? '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.3);margin-left:6px">Manual</span>' : (fonte === 'bling' ? '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(96,165,250,0.15);color:#60a5fa;border:1px solid rgba(96,165,250,0.3);margin-left:6px">Bling</span>' : '');
      return `
        <tr style="border-top:1px solid rgba(255,255,255,0.06)">
          <td style="padding:10px 14px;color:#94a3b8;font-variant-numeric:tabular-nums">${medal}</td>
          <td style="padding:10px 14px;color:#e2e8f0;font-weight:500">${nome}${fonteBadge}</td>
          <td style="padding:10px 14px;color:#e2e8f0;text-align:right;font-variant-numeric:tabular-nums">${fmtNum(r.clientes || 0)}</td>
          <td style="padding:10px 14px;color:#fbbf24;text-align:right;font-variant-numeric:tabular-nums">${fmtNum(r.vips || 0)}</td>
          <td style="padding:10px 14px;color:#22c55e;text-align:right;font-variant-numeric:tabular-nums">${fmtNum(r.ativos || 0)}</td>
          <td style="padding:10px 14px;color:#fb923c;text-align:right;font-variant-numeric:tabular-nums">${fmtNum(r.em_risco || r.risco || 0)}</td>
          <td style="padding:10px 14px;color:#a78bfa;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${fmtBRL(fat)}</td>
          <td style="padding:10px 14px;color:#64748b;text-align:right;font-variant-numeric:tabular-nums;font-size:12px">${pct}%</td>
        </tr>
      `;
    }).join('');
    return `
      <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:720px">
          <thead>
            <tr style="background:rgba(255,255,255,0.03)">
              <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">#</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Vendedor</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Clientes</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">VIPs</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Ativos</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Risco</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Faturamento</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">Share</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" style="padding:30px;text-align:center;color:#64748b">Nenhum dado ainda</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  function mcTabelaClientes(lista, perms) {
    const rows = lista.slice(0, 500).map(c => {
      const s = SEGMENT_STYLES[c.segmento] || SEGMENT_STYLES['Sem histórico'];
      const diasTxt = c.dias_sem_compra == null ? '-' : (c.dias_sem_compra + 'd');
      const vendedor = c.vendedor_nome
        ? escapeHtml(c.vendedor_nome) + (c.vendedor_fonte === 'manual' ? ' <span style="font-size:10px;color:#4ade80">●</span>' : '')
        : '<span style="color:#fb923c">—</span>';
      const ehManual = !!c.manual_id;
      const reatribuirBtn = (perms.podeReatribuir && !ehManual)
        ? `<button onclick="event.stopPropagation();window.c360McReatribuir(${c.contato_id || 0}, '${escapeHtml(c.empresa)}', '${escapeHtml(c.contato_nome).replace(/'/g,'&#39;')}', '${c.vendedor_profile_id || ''}')" style="padding:4px 8px;border-radius:6px;border:1px solid rgba(167,139,250,0.35);background:rgba(167,139,250,0.08);color:#c4b5fd;cursor:pointer;font-size:11px">🔀</button>`
        : '';
      const badgeDMS = ehManual ? ' <span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(168,85,247,0.2);color:#c4b5fd;border:1px solid rgba(168,85,247,0.35);margin-left:4px;vertical-align:middle">DMS</span>' : '';
      const dataAttr = ehManual ? `data-manual="${c.manual_id}"` : `data-cliente="${escapeHtml(c.contato_nome)}"`;
      return `
        <tr ${dataAttr} style="border-top:1px solid rgba(255,255,255,0.06);cursor:pointer">
          <td style="padding:10px 14px;color:#e2e8f0;font-weight:500">${escapeHtml(c.contato_nome)}${badgeDMS}</td>
          <td style="padding:10px 14px"><span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${s.bg.replace('bg-','').replace('/15','')};color:#e2e8f0;border:1px solid rgba(255,255,255,0.1)" class="${s.bg} ${s.fg} ${s.border}">${escapeHtml(c.segmento || '-')}</span></td>
          <td style="padding:10px 14px;color:#e2e8f0;text-align:right;font-variant-numeric:tabular-nums">${c.score || 0}</td>
          <td style="padding:10px 14px;color:#e2e8f0;text-align:right;font-variant-numeric:tabular-nums">${fmtNum(c.total_pedidos || 0)}</td>
          <td style="padding:10px 14px;color:#a78bfa;text-align:right;font-variant-numeric:tabular-nums">${fmtBRL(c.total_gasto || 0)}</td>
          <td style="padding:10px 14px;color:#94a3b8;text-align:right;font-variant-numeric:tabular-nums">${diasTxt}</td>
          <td style="padding:10px 14px;color:#e2e8f0">${vendedor}</td>
          <td style="padding:10px 14px;text-align:right">${reatribuirBtn}</td>
        </tr>
      `;
    }).join('');
    const maisDe500 = lista.length > 500 ? `<div style="padding:10px 14px;color:#64748b;font-size:12px;text-align:center">Mostrando os 500 primeiros de ${fmtNum(lista.length)}. Use o filtro pra refinar.</div>` : '';
    return `
      <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:900px">
          <thead>
            <tr style="background:rgba(255,255,255,0.03)">
              <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b">Nome</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b">Segmento</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Score</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Pedidos</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Gasto</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b">Dias</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b">Vendedor</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b"></th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" style="padding:30px;text-align:center;color:#64748b">Nenhum cliente</td></tr>'}</tbody>
        </table>
        ${maisDe500}
      </div>
    `;
  }

  function mcWireTable(content) {
    const rows = content.querySelectorAll('tbody tr[data-cliente], tbody tr[data-manual]');
    rows.forEach(tr => {
      tr.addEventListener('click', () => {
        const manualId = tr.getAttribute('data-manual');
        if (manualId) {
          window.c360McEditarManual(manualId);
          return;
        }
        const nome = tr.getAttribute('data-cliente');
        if (nome) mcOpenClienteDetalhe(nome);
      });
    });
  }

  // Abre o detalhe do cliente dentro do C360 (page-cliente-1) mas remembra
  // que o usuario veio de "Meus Clientes" pra poder voltar pra ca.
  async function mcOpenClienteDetalhe(nome) {
    if (!nome) return;
    // Garante que o cliente esta em state.clientes (senao showClientDetail nao acha)
    if (!state.clientes || !state.clientes.find(c => c.contato_nome === nome)) {
      // Busca na cliente_scoring_full pra popular
      const { data } = await state.sb.from('cliente_scoring_full').select('*').eq('empresa', state.empresa).eq('contato_nome', nome).limit(1);
      if (data && data[0]) {
        state.clientes = state.clientes || [];
        state.clientes.push(data[0]);
      }
    }
    state.c360ReturnTo = 'meus-clientes';
    if (typeof window.showClientDetail === 'function') {
      await window.showClientDetail(encodeURIComponent(nome));
      // Troca o botao "Voltar" pra ir de volta pra Meus Clientes
      setTimeout(() => {
        try {
          const page = document.getElementById('page-cliente-1');
          if (!page) return;
          const buttons = page.querySelectorAll('button');
          buttons.forEach(btn => {
            const onc = btn.getAttribute('onclick') || '';
            if (onc.includes("showPage('clientes')")) {
              btn.setAttribute('onclick', "showPage('meus-clientes')");
              btn.innerHTML = btn.innerHTML.replace(/Voltar para Clientes/g, 'Voltar para Meus Clientes');
            }
          });
        } catch(e) { console.warn('[mc] fix voltar btn:', e); }
      }, 50);
    }
  }

  // (Filtros unificados: ver c360McVendedorFilter / c360McAdminFilter acima)

  window.c360McReload = async function() {
    mcInvalidateCache();
    await renderMeusClientesPage();
  };

  // ─── Modal: Reatribuir cliente ───
  window.c360McReatribuir = async function(contatoId, empresa, contatoNome, vendedorAtualId) {
    const perms = await mcLoadPerms();
    if (!perms.podeReatribuir) {
      if (typeof showToast === 'function') showToast('Sem permissão', 'error');
      return;
    }
    if (!contatoId || contatoId === 0) {
      if (typeof showToast === 'function') showToast('Cliente sem contato_id — não é possível reatribuir', 'error');
      return;
    }
    const profiles = await mcLoadProfiles();
    // Modal
    const existing = document.getElementById('mc-reatribuir-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'mc-reatribuir-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = `
      <div style="background:#0b0f17;border:1px solid rgba(255,255,255,0.1);border-radius:14px;max-width:480px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
          <div>
            <div style="font-size:18px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">🔀 Reatribuir cliente</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:2px">${escapeHtml(contatoNome)}</div>
          </div>
          <button onclick="document.getElementById('mc-reatribuir-modal').remove()" style="background:transparent;border:0;color:#94a3b8;cursor:pointer;font-size:22px;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:6px">Novo vendedor</label>
          <select id="mc-reatribuir-profile" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13.5px;outline:none">
            <option value="">— Selecione —</option>
            ${profiles.map(p => `<option value="${p.id}" ${p.id === vendedorAtualId ? 'selected' : ''}>${escapeHtml(p.nome)} · ${escapeHtml(p.cargo || '')}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:6px">Motivo (opcional)</label>
          <textarea id="mc-reatribuir-motivo" rows="2" placeholder="Ex: cliente passou a comprar pela BC..." style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;resize:vertical;outline:none;box-sizing:border-box"></textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('mc-reatribuir-modal').remove()" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px">Cancelar</button>
          <button id="mc-reatribuir-confirmar" onclick="window.c360McConfirmarReatribuir(${contatoId}, '${escapeHtml(empresa)}', '${escapeHtml(contatoNome).replace(/'/g,'&#39;')}', '${vendedorAtualId || ''}')" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.2);color:#c4b5fd;cursor:pointer;font-size:13px;font-weight:600">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  };

  window.c360McConfirmarReatribuir = async function(contatoId, empresa, contatoNome, vendedorAtualId) {
    const selectEl = document.getElementById('mc-reatribuir-profile');
    const motivoEl = document.getElementById('mc-reatribuir-motivo');
    const btn = document.getElementById('mc-reatribuir-confirmar');
    const novoProfileId = selectEl?.value;
    const motivo = (motivoEl?.value || '').trim() || null;
    if (!novoProfileId) {
      if (typeof showToast === 'function') showToast('Selecione um vendedor', 'error');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const perms = await mcLoadPerms();
      const profiles = await mcLoadProfiles();
      const novoProf = profiles.find(p => p.id === novoProfileId);
      const atualProf = vendedorAtualId ? profiles.find(p => p.id === vendedorAtualId) : null;

      // Upsert em cliente_vendedor_manual
      const { error: errUps } = await state.sb.from('cliente_vendedor_manual').upsert({
        contato_id: contatoId,
        empresa,
        profile_id: novoProfileId,
        atribuido_por: perms.profileId,
        atribuido_por_nome: perms.nome,
        motivo,
      }, { onConflict: 'contato_id,empresa' });
      if (errUps) throw errUps;

      // Insere no historico (nao bloqueia se falhar)
      await state.sb.from('cliente_vendedor_historico').insert({
        contato_id: contatoId,
        contato_nome: contatoNome,
        empresa,
        profile_id_anterior: vendedorAtualId || null,
        profile_id_novo: novoProfileId,
        profile_nome_anterior: atualProf?.nome || null,
        profile_nome_novo: novoProf?.nome || null,
        fonte_anterior: vendedorAtualId ? 'manual_ou_bling' : 'nao_atribuido',
        alterado_por: perms.profileId,
        alterado_por_nome: perms.nome,
        motivo,
      });

      if (typeof showToast === 'function') showToast('Cliente reatribuído a ' + (novoProf?.nome || ''), 'success');
      document.getElementById('mc-reatribuir-modal')?.remove();
      mcInvalidateCache();
      await renderMeusClientesPage();
    } catch (e) {
      console.error('[mc] reatribuir falhou', e);
      if (typeof showToast === 'function') showToast('Erro: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmar'; }
    }
  };

  // ─── Modal: Novo / Editar cliente manual ───
  const STATUS_RELACIONAMENTO_OPCOES = [
    { v: 'novo',        l: '🆕 Novo' },
    { v: 'contatado',   l: '💬 Contatado' },
    { v: 'negociando',  l: '🤝 Em negociação' },
    { v: 'comprou',     l: '✅ Comprou' },
    { v: 'perdido',     l: '❌ Perdido' },
    { v: 'sem_interesse', l: '😐 Sem interesse' },
  ];

  window.c360McNovoCliente = async function() {
    await mcAbrirModalCliente(null);
  };

  window.c360McEditarManual = async function(manualId) {
    const { data } = await state.sb.from('clientes_manuais').select('*').eq('id', manualId).maybeSingle();
    if (!data) { if (typeof showToast === 'function') showToast('Cliente não encontrado', 'error'); return; }
    await mcAbrirModalCliente(data);
  };

  async function mcAbrirModalCliente(cliente) {
    const perms = await mcLoadPerms();
    const editando = !!cliente;
    const profiles = await mcLoadProfiles();
    const podeAtribuirOutro = perms.eAdminOuGerente;
    const vendedorAtual = cliente?.profile_id_vendedor || perms.profileId;
    const existing = document.getElementById('mc-cliente-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'mc-cliente-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';

    const statusOpts = STATUS_RELACIONAMENTO_OPCOES.map(o =>
      `<option value="${o.v}" ${(cliente?.status_relacionamento || 'novo') === o.v ? 'selected' : ''}>${o.l}</option>`
    ).join('');
    const vendOpts = profiles.map(p =>
      `<option value="${p.id}" ${p.id === vendedorAtual ? 'selected' : ''}>${escapeHtml(p.nome)} · ${escapeHtml(p.cargo || '')}</option>`
    ).join('');
    const empOpts = `
      <option value="matriz" ${(cliente?.empresa || state.empresa) === 'matriz' ? 'selected' : ''}>Matriz (Piçarras)</option>
      <option value="bc" ${(cliente?.empresa || state.empresa) === 'bc' ? 'selected' : ''}>Balneário Camboriú</option>
    `;

    modal.innerHTML = `
      <div style="background:#0b0f17;border:1px solid rgba(255,255,255,0.1);border-radius:14px;max-width:640px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,0.5);max-height:90vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
          <div>
            <div style="font-size:18px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">${editando ? '✏️ Editar cliente' : '+ Novo cliente'}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px">Cliente DMS — não é sincronizado com o Bling</div>
          </div>
          <button onclick="document.getElementById('mc-cliente-modal').remove()" style="background:transparent;border:0;color:#94a3b8;cursor:pointer;font-size:22px;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1 / -1">
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Nome *</label>
            <input id="mc-novo-nome" value="${escapeHtml(cliente?.nome || '')}" placeholder="Nome completo / Razão social" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Telefone</label>
            <input id="mc-novo-fone" value="${escapeHtml(cliente?.telefone || '')}" placeholder="(47) 99999-0000" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Email</label>
            <input id="mc-novo-email" type="email" value="${escapeHtml(cliente?.email || '')}" placeholder="cliente@..." style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">CNPJ / CPF</label>
            <input id="mc-novo-doc" value="${escapeHtml(cliente?.documento || '')}" placeholder="00.000.000/0000-00" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Empresa</label>
            <select id="mc-novo-empresa" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">${empOpts}</select>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Cidade</label>
            <input id="mc-novo-cidade" value="${escapeHtml(cliente?.cidade || '')}" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">UF</label>
            <input id="mc-novo-uf" value="${escapeHtml(cliente?.uf || '')}" maxlength="2" placeholder="SC" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box;text-transform:uppercase">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Status</label>
            <select id="mc-novo-status" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">${statusOpts}</select>
          </div>
          ${podeAtribuirOutro ? `
          <div style="grid-column:1 / -1">
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Vendedor responsável</label>
            <select id="mc-novo-vendedor" style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box">${vendOpts}</select>
          </div>` : ''}
          <div style="grid-column:1 / -1">
            <label style="display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px">Observação</label>
            <textarea id="mc-novo-obs" rows="3" placeholder="Notas rápidas sobre este cliente..." style="width:100%;padding:9px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:13px;box-sizing:border-box;resize:vertical;font-family:inherit">${escapeHtml(cliente?.observacao || '')}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:space-between;margin-top:18px;flex-wrap:wrap">
          <div>
            ${editando ? `<button onclick="window.c360McApagarManual('${cliente.id}')" style="padding:9px 16px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;font-size:13px">🗑 Apagar</button>` : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="document.getElementById('mc-cliente-modal').remove()" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px">Cancelar</button>
            <button id="mc-novo-save" onclick="window.c360McSalvarCliente('${cliente?.id || ''}')" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.2);color:#c4b5fd;cursor:pointer;font-size:13px;font-weight:600">${editando ? 'Salvar' : 'Criar cliente'}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => document.getElementById('mc-novo-nome')?.focus(), 100);
  }

  window.c360McSalvarCliente = async function(id) {
    const btn = document.getElementById('mc-novo-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const nome = (document.getElementById('mc-novo-nome')?.value || '').trim();
      if (!nome) { if (typeof showToast === 'function') showToast('Nome é obrigatório', 'error'); if (btn) { btn.disabled = false; btn.textContent = id ? 'Salvar' : 'Criar cliente'; } return; }
      const perms = await mcLoadPerms();
      const vendedor = document.getElementById('mc-novo-vendedor')?.value || perms.profileId;
      const payload = {
        nome,
        telefone: (document.getElementById('mc-novo-fone')?.value || '').trim() || null,
        email: (document.getElementById('mc-novo-email')?.value || '').trim() || null,
        documento: (document.getElementById('mc-novo-doc')?.value || '').trim() || null,
        cidade: (document.getElementById('mc-novo-cidade')?.value || '').trim() || null,
        uf: (document.getElementById('mc-novo-uf')?.value || '').trim().toUpperCase().slice(0,2) || null,
        empresa: document.getElementById('mc-novo-empresa')?.value || state.empresa,
        status_relacionamento: document.getElementById('mc-novo-status')?.value || 'novo',
        observacao: (document.getElementById('mc-novo-obs')?.value || '').trim() || null,
        profile_id_vendedor: vendedor,
      };
      let res;
      if (id) {
        res = await state.sb.from('clientes_manuais').update(payload).eq('id', id);
      } else {
        payload.criado_por = perms.profileId;
        payload.criado_por_nome = perms.nome;
        res = await state.sb.from('clientes_manuais').insert(payload);
      }
      if (res.error) throw res.error;
      if (typeof showToast === 'function') showToast(id ? 'Cliente atualizado' : 'Cliente criado', 'success');
      document.getElementById('mc-cliente-modal')?.remove();
      await renderMeusClientesPage();
    } catch (e) {
      console.error('[mc] salvar cliente manual', e);
      if (typeof showToast === 'function') showToast('Erro: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = id ? 'Salvar' : 'Criar cliente'; }
    }
  };

  window.c360McApagarManual = async function(id) {
    if (typeof c360Confirm === 'function') {
      const ok = await c360Confirm('Apagar este cliente?', { danger: true, okLabel: 'Apagar' });
      if (!ok) return;
    } else if (!confirm('Apagar este cliente?')) return;
    const { error } = await state.sb.from('clientes_manuais').delete().eq('id', id);
    if (error) { if (typeof showToast === 'function') showToast('Erro: ' + error.message, 'error'); return; }
    if (typeof showToast === 'function') showToast('Cliente apagado', 'success');
    document.getElementById('mc-cliente-modal')?.remove();
    await renderMeusClientesPage();
  };

  // ─── Modal: Mapear vendedores Bling ───
  window.c360McOpenMapear = async function() {
    const perms = await mcLoadPerms();
    if (!(perms.cargo === 'admin' || perms.cargo === 'gerente_comercial')) {
      if (typeof showToast === 'function') showToast('Sem permissão', 'error');
      return;
    }
    // Lista todos bling_vendedor_ids distintos com contagem (via view agregada no banco)
    const { data: blingRows, error: errAgr } = await state.sb.from('bling_vendedor_counts')
      .select('*').eq('empresa', state.empresa).order('pedidos_count', { ascending: false }).limit(50);
    if (errAgr) {
      console.error('[mc] erro ao listar vendedores do bling', errAgr);
      if (typeof showToast === 'function') showToast('Erro: ' + errAgr.message, 'error');
      return;
    }
    const bling = (blingRows || []).map(r => ({ id: r.bling_vendedor_id, count: r.pedidos_count, ultimo: r.ultimo_pedido }));

    const { data: mappings } = await state.sb.from('vendedor_mapping').select('*').eq('empresa', state.empresa);
    const mapByBling = new Map((mappings || []).map(m => [String(m.bling_vendedor_id), m]));
    const profiles = await mcLoadProfiles();

    const existing = document.getElementById('mc-mapear-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'mc-mapear-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';

    const rows = bling.map(b => {
      const m = mapByBling.get(String(b.id));
      const selected = m?.profile_id || '';
      return `
        <tr style="border-top:1px solid rgba(255,255,255,0.06)">
          <td style="padding:8px 12px;color:#94a3b8;font-variant-numeric:tabular-nums;font-family:monospace;font-size:12px">${b.id}</td>
          <td style="padding:8px 12px;color:#e2e8f0;text-align:right;font-variant-numeric:tabular-nums">${fmtNum(b.count)}</td>
          <td style="padding:6px 12px">
            <select data-bling="${b.id}" class="mc-map-profile" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12px">
              <option value="">— Não mapeado —</option>
              ${profiles.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}
            </select>
          </td>
          <td style="padding:6px 12px">
            <input data-bling="${b.id}" class="mc-map-name" value="${escapeHtml(m?.display_name || '')}" placeholder="apelido (opcional)" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#0b0f17;color:#e2e8f0;font-size:12px"/>
          </td>
        </tr>
      `;
    }).join('');

    modal.innerHTML = `
      <div style="background:#0b0f17;border:1px solid rgba(255,255,255,0.1);border-radius:14px;max-width:780px;width:100%;max-height:90vh;display:flex;flex-direction:column;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:18px;font-weight:700;color:#f1f5f9;font-family:'Playfair Display',serif">⚙ Mapear vendedores Bling</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px">${EMPRESA_LABELS[state.empresa]} · top 50 por pedidos</div>
          </div>
          <button onclick="document.getElementById('mc-mapear-modal').remove()" style="background:transparent;border:0;color:#94a3b8;cursor:pointer;font-size:22px;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="flex:1;overflow-y:auto;border:1px solid rgba(255,255,255,0.06);border-radius:8px">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:rgba(255,255,255,0.03);position:sticky;top:0">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Bling ID</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase">Pedidos</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Profile DMS</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Apelido</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="4" style="padding:30px;text-align:center;color:#64748b">Nenhum vendedor nos pedidos</td></tr>'}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button onclick="document.getElementById('mc-mapear-modal').remove()" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e2e8f0;cursor:pointer;font-size:13px">Cancelar</button>
          <button id="mc-mapear-salvar" onclick="window.c360McSalvarMapeamento()" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(167,139,250,0.4);background:rgba(167,139,250,0.2);color:#c4b5fd;cursor:pointer;font-size:13px;font-weight:600">Salvar mudanças</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  };

  window.c360McSalvarMapeamento = async function() {
    const btn = document.getElementById('mc-mapear-salvar');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const rows = document.querySelectorAll('#mc-mapear-modal tbody tr');
      const upserts = [];
      const deletes = [];
      rows.forEach(tr => {
        const sel = tr.querySelector('.mc-map-profile');
        const inp = tr.querySelector('.mc-map-name');
        if (!sel) return;
        const blingId = Number(sel.getAttribute('data-bling'));
        const pid = sel.value || null;
        const nm = (inp?.value || '').trim();
        if (pid) {
          upserts.push({
            bling_vendedor_id: blingId,
            empresa: state.empresa,
            profile_id: pid,
            display_name: nm || null,
            ativo: true,
          });
        } else {
          deletes.push({ bling_vendedor_id: blingId });
        }
      });
      if (upserts.length) {
        const { error } = await state.sb.from('vendedor_mapping').upsert(upserts, { onConflict: 'bling_vendedor_id,empresa' });
        if (error) throw error;
      }
      if (deletes.length) {
        for (const d of deletes) {
          await state.sb.from('vendedor_mapping').delete().eq('bling_vendedor_id', d.bling_vendedor_id).eq('empresa', state.empresa);
        }
      }
      if (typeof showToast === 'function') showToast(`Mapeamento salvo (${upserts.length} ativos)`, 'success');
      document.getElementById('mc-mapear-modal')?.remove();
      mcInvalidateCache();
      await renderMeusClientesPage();
    } catch (e) {
      console.error('[mc] mapeamento falhou', e);
      if (typeof showToast === 'function') showToast('Erro: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar mudanças'; }
    }
  };

  // Helper: abre cliente no detalhe (integrado com existente)
  function openClienteByName(nome) {
    // Busca no cache existente de clientes (state.clientes) — senao, apenas alterna aba
    const cli = state.clientes?.find(c => c.contato_nome === nome);
    if (cli && typeof renderList === 'function') {
      // Fallback: alterna pra aba Clientes com filtro
      state.searchQuery = nome;
      state.page = 0;
      renderList();
      if (typeof window.showPage === 'function') window.showPage('clientes');
    }
  }

  // Re-render ao trocar empresa
  window.c360McReRenderIfActive = async function() {
    const active = document.querySelector('.page-section.active');
    if (active?.id === 'page-meus-clientes') {
      mcInvalidateCache();
      await renderMeusClientesPage();
    }
  };

  // ─── Export PDF do Ranking (admin/gerente) ───
  window.mcExportarRankingPDF = async function() {
    const ranking = state.mcAdminVendedores || [];
    if (!ranking.length) { alert('Ranking vazio — nada a exportar'); return; }

    const empresa = EMPRESA_LABELS[state.empresa] || state.empresa;
    const totalFat = ranking.reduce((s, r) => s + (+r.faturamento || 0), 0);
    const totalClientes = ranking.reduce((s, r) => s + (+r.clientes || 0), 0);
    const hoje = new Date().toLocaleDateString('pt-BR');
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const medalha = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + 'º';
    const rowsHtml = ranking.map((r, i) => {
      const pct = totalFat > 0 ? ((+r.faturamento / totalFat) * 100).toFixed(1) : '0.0';
      const ticketMedio = r.pedidos_total > 0 ? (+r.faturamento / +r.pedidos_total) : 0;
      return `<tr>
        <td style="text-align:center;font-weight:700">${medalha(i)}</td>
        <td style="font-weight:600">${escapeHtml(r.vendedor_nome || '(sem nome)')}</td>
        <td style="text-align:right">${fmtNum(r.clientes || 0)}</td>
        <td style="text-align:right">${fmtNum(r.vips || 0)}</td>
        <td style="text-align:right">${fmtNum(r.ativos || 0)}</td>
        <td style="text-align:right">${fmtNum(r.em_risco || 0)}</td>
        <td style="text-align:right">${fmtNum(r.pedidos_total || 0)}</td>
        <td style="text-align:right">${fmtBRL(+r.faturamento || 0)}</td>
        <td style="text-align:right">${fmtBRL(ticketMedio)}</td>
        <td style="text-align:right;color:#a855f7;font-weight:600">${pct}%</td>
      </tr>`;
    }).join('');

    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { alert('Permita popups para exportar PDF'); return; }

    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Ranking Meus Clientes — ${empresa} — ${hoje}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding: 32px 40px; color: #111; background: #fff; }
  .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; display:flex; justify-content:space-between; align-items:flex-end; }
  .header h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
  .header .sub { font-size: 11px; color: #666; margin-top: 2px; }
  .meta { font-size: 11px; color: #666; text-align: right; }
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { padding: 12px 14px; border: 1px solid #ddd; border-radius: 8px; }
  .kpi .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 4px; font-weight: 600; }
  .kpi .value { font-size: 18px; font-weight: 700; color: #111; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { background: #111; color: #fff; padding: 8px 10px; text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; }
  th:not(:nth-child(2)):not(:first-child) { text-align: right; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) td { background: #f8f9fa; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10px; color: #999; text-align: center; }
  @media print { body { padding: 20px; } .no-print { display: none; } @page { size: A4 landscape; margin: 15mm; } }
  .btn-print { position: fixed; top: 20px; right: 20px; padding: 10px 18px; background: #111; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .btn-print:hover { background: #333; }
</style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
  <div class="header">
    <div>
      <h1>Ranking — Meus Clientes</h1>
      <div class="sub">Performance de vendedores · ${empresa}</div>
    </div>
    <div class="meta">
      Gerado em ${hoje} às ${hora}<br>
      Dana Marketing System
    </div>
  </div>
  <div class="kpi-row">
    <div class="kpi"><div class="label">Vendedores no ranking</div><div class="value">${ranking.length}</div></div>
    <div class="kpi"><div class="label">Clientes somados</div><div class="value">${fmtNum(totalClientes)}</div></div>
    <div class="kpi"><div class="label">Faturamento total</div><div class="value">${fmtBRL(totalFat)}</div></div>
    <div class="kpi"><div class="label">Ticket médio geral</div><div class="value">${fmtBRL(totalClientes > 0 ? totalFat / ranking.reduce((s,r) => s + (+r.pedidos_total||0), 0) : 0)}</div></div>
  </div>
  <table>
    <thead><tr>
      <th style="width:40px">#</th>
      <th>Vendedor</th>
      <th>Clientes</th>
      <th>VIPs</th>
      <th>Ativos</th>
      <th>Em Risco</th>
      <th>Pedidos</th>
      <th>Faturamento</th>
      <th>Ticket Médio</th>
      <th>% Share</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">
    Relatório gerado automaticamente pelo DMS · Dados: Bling + mapeamento manual interno
  </div>
  <script>setTimeout(() => window.print(), 500);</script>
</body></html>`);
    win.document.close();
  };

  // ─── Boot ───
  async function boot() {
    try {
      console.log('[c360] Boot iniciado · empresa=' + state.empresa);
      updateEmpresaToggleUI();
      const authOK = await initSupabase();
      if (!authOK) return;

      // PRIMEIRO: permissoes (injeta Meus Clientes + esconde abas bloqueadas).
      // Critico porque se qualquer loadClientes/loadDashboard falhar (ex: RLS
      // bloqueando cargo=vendedor), o sidebar precisa ja estar configurado.
      // Em paralelo pra ser rapido.
      await Promise.allSettled([
        mcSetupNav(),
        mcApplyTabPermissions(),
      ]);
      mcSubscribeRealtime();

      wireSearchAndFilters();

      // Dados do dashboard/lista (podem falhar pra vendedor sem quebrar o UI)
      await Promise.allSettled([
        loadClientes().catch(e => console.warn('[c360] loadClientes:', e?.message || e)),
        loadDashboardResumo().catch(e => console.warn('[c360] loadDashboardResumo:', e?.message || e)),
        loadMencionaveis().catch(e => console.warn('[c360] loadMencionaveis:', e?.message || e)),
      ]);

      // Subscribe realtime pra notas, segmentos e campanhas (tbm resiliente)
      try { subscribeRealtimeNotas(); } catch(e) { console.warn('subscribeRealtimeNotas:', e?.message); }
      try { subscribeRealtimeSegmentos(); } catch(e) { console.warn('subscribeRealtimeSegmentos:', e?.message); }
      try { subscribeRealtimeCampanhas(); } catch(e) { console.warn('subscribeRealtimeCampanhas:', e?.message); }
      try { subscribeRealtimeSync(); } catch(e) { console.warn('subscribeRealtimeSync:', e?.message); }

      // Reaplica permissoes (pode ter corrida com renderDashboard substituindo HTML)
      await mcApplyTabPermissions();

      // Se veio deep-link via sessionStorage, abre o cliente/aba certa
      await checkDeepLink();
    } catch (e) {
      console.error('[c360] Boot falhou:', e);
    } finally {
      // Remove o hide do #root (CSS inline do HTML) + overlay em QUALQUER caso
      document.body.classList.add('c360-ready');
      hideBootOverlay();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
