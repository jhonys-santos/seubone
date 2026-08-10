// ── PAINEL DE ERROS — Fase 1 ────────────────────────────────────────────
// Portado de um HTML standalone (SPA de ~3000 linhas) pro hub. Mesma receita
// da Auditoria de Qualidade: uma rota só, "telas" trocadas por JS, sem login
// próprio (usa window.USUARIO_SESSAO da sessão do hub) e sem tema próprio
// (usa a classe html.light global, ver /js/ui.js).
//
// Fase 1 = Visão Executiva, Ranking de Causas, Ranking por Consultor,
// Casos/Auditoria (lista + kanban) + drawer de detalhe/auditoria + lightbox
// de fotos + modal "Novo caso" com upload comprimido. NÃO inclui: Reunião de
// Vendas/Fábrica, relatório PDF, command palette (Ctrl+K), visões salvas,
// exportação CSV/seleção em massa, tela "Dados incompletos", login/tema
// próprios — tudo isso fica pra uma fase futura (ver PR/tarefa original).
//
// Diferença estrutural importante vs. o original: lá o backend (Apps Script)
// só aceitava POST com mode:'no-cors' (não deixava ler a resposta), por isso
// o app fazia updates "otimistas" e depois relia a planilha pra confirmar
// (verificarGravacao). Aqui as rotas do hub são same-origin e devolvem JSON
// de verdade — então cada POST já confirma sucesso na hora, sem precisar do
// hack de reler depois.

(function () {
  'use strict';

  /* ================= ESCAPE HTML ================= */
  // Função própria (em vez do `esc()` global de /js/ui.js) pra não depender
  // de um utilitário de outra página e não arriscar colisão de comportamento.
  function erEsc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ================= PAPÉIS (substitui a matriz PAPEIS original) ================= */
  const SESSAO = window.USUARIO_SESSAO || null;
  const papel = (SESSAO && SESSAO.role === 'gestor') ? 'gestor' : 'colaborador';
  const TELAS_POR_PAPEL = { gestor: ['exec', 'causas', 'resp', 'casos', 'refab', 'incompletos', 'reuniao', 'reuniaoFab'], colaborador: ['causas', 'casos', 'refab'] };
  function podeVerTela(scr) { return TELAS_POR_PAPEL[papel].includes(scr); }
  function podeAuditar() { return papel === 'gestor'; }
  function podeRegistrar() { return true; } // igual nos dois papéis, como no original
  function telaInicialPapel() { return TELAS_POR_PAPEL[papel][0]; }

  /* ================= CORES POR SETOR ================= */
  const SETOR_PALETTE = ['#2A6FDB', '#C63A32', '#E0A400', '#565C64', '#1E8A4D', '#7A5CFA', '#D0699A'];
  const SETOR_COLOR = { 'Vendas': '#2A6FDB', 'Fábrica': '#C63A32', 'Dupla (Vendedor e Designer)': '#E0A400', 'Escritório': '#565C64', 'Não informado': '#B9BEC6' };
  let setorColorCursor = 0;
  function colorForSetor(s) {
    if (!s) s = 'Não informado';
    if (!SETOR_COLOR[s]) { SETOR_COLOR[s] = SETOR_PALETTE[setorColorCursor % SETOR_PALETTE.length]; setorColorCursor++; }
    return SETOR_COLOR[s];
  }

  const SETORES_PADRAO = ['Vendas', 'Fábrica', 'Dupla (Vendedor e Designer)', 'Escritório'];
  // Setores que interessam para a Reunião de Vendas (vendedor envolvido).
  const SETORES_VENDAS = ['Vendas', 'Dupla (Vendedor e Designer)'];
  // Opções do campo único "Setor do problema" (absorve o antigo "Culpa de", por isso inclui "Cliente").
  const SETOR_OPCOES = ['Vendas', 'Fábrica', 'Dupla (Vendedor e Designer)', 'Escritório', 'Cliente'];
  const TIPOS_PRODUTO_PADRAO = ['Boné', 'Trucker', 'Americano', '5Port', 'New York', 'Dad Hat', 'Viseira', 'Bucket', 'Camisa', 'Neoprene'];
  const QUE_FIM_PADRAO = ['Entregue', 'Em estoque', 'Refabricado e entregue', 'Cancelado'];
  const LINHA_PRODUTO_OPCOES = ['Premium', 'Essencial', 'Econômico', 'SBP'];
  // Sugestões do campo "Quem está cadastrando" — time que registra erros no painel.
  const CADASTRADOR_SUGESTOES = [
    'Iasmin Cristina', 'Francis Medeiros', 'Nathalia Guedes', 'Gabrielle Batista',
    'Daniel Sheldon', 'Wallac Mauricio', 'Jhonys Santos',
  ];
  // Sugestões do campo "Responsável" — lista curada (pedida pelo usuário) em vez das
  // variações que o texto livre acumulou na planilha (ex: "Fabrica Caico"/"Fábrica Caicó"/
  // "Fabrica (Caicó)" todas juntas). Continua sendo um <input list="..."> comum, então
  // digitar qualquer outro nome que não esteja aqui também funciona.
  const RESPONSAVEL_SUGESTOES = [
    'Expectativa do Cliente', 'Estoque Caicó', 'Fabrica Cacinho', 'Fabrica CIA Bruto', 'Fabrica Eneas',
    'Fabrica Neidinha', 'Fabrica 88 Brindes', 'Fabrica SLC', 'Fabrica LaserTools', 'Fabrica (Outros)',
    'Amanda Alves', 'Ana Beatriz', 'Anderson Carlos', 'Anderson Gabriel', 'Arthur Felix', 'Caio Targino',
    'Camilla Marinho', 'Cleyton Andrade', 'Emanuel Pereira', 'Emily Dantas', 'Gabriel Vinicius',
    'Giovani Augusto', 'Guilherme Matias', 'Hadyja Saraiva', 'Igor Neves', 'Jailton Queiroz',
    'Jonathan Silva', 'Lucas Matheus', 'Lucas Santos', 'Luiz Cavalcante', 'Marcelo Moreira',
    'Pedro Maranhao', 'Paulo Sergio', 'Sabrina Silva', 'Stephanie Rayssa', 'Taynara Soares',
    'Victor Brito', 'Victor Clemerson', 'Victor Medeiros', 'Victor Varela', 'Vinicius Barros',
    'Walter Galdino', 'Yuri Pinheiro',
  ];

  // Configuração das reuniões semanais com apresentação (PDF). Cada uma filtra por setor e
  // tem sua própria semana selecionada. A tela e o relatório são os mesmos, só os rótulos mudam.
  // Copiado fielmente do original — é regra de negócio, não estética.
  const REUNIOES = {
    vendas: {
      screen: 'reuniao', stateKey: 'semanaReuniao', setores: SETORES_VENDAS,
      nome: 'Reunião de Vendas', short: 'Vendas',
      respLabel: 'Por vendedor / responsável',
      respSub: 'Quem concentra o custo da semana. Use como mapa, não como julgamento isolado.',
      foco: 'Cada caso é uma chance de ajustar o processo. Obrigado, time! 🧢',
    },
    fabrica: {
      screen: 'reuniaoFab', stateKey: 'semanaReuniaoFab', setores: ['Fábrica'],
      nome: 'Reunião de Fábrica', short: 'Fábrica',
      respLabel: 'Por responsável na fábrica',
      respSub: 'Quem concentra o custo da semana na produção. Use como mapa pra melhorar o processo.',
      foco: 'Cada erro aqui é uma melhoria possível no processo de fabricação. Obrigado, produção! 🧢',
    },
  };

  const RESOLUCAO_TABLE = [
    { tipo: 'Sem custo', logica: 'Só comunicação/alinhamento', caixa: 'sem_impacto', cor: '#B9BEC6' },
    { tipo: 'Envio rápido', logica: 'Custo logístico controlado', caixa: 'operacional', cor: '#2A6FDB' },
    { tipo: 'Ajuste do produto', logica: 'Correção pontual, baixo custo', caixa: 'operacional', cor: '#1E8A4D' },
    { tipo: 'Brinde até 12 und.', logica: 'Custo de material, sem refação', caixa: 'operacional', cor: '#7FC79A' },
    { tipo: 'Desconto <=20%', logica: 'Impacto direto na margem', caixa: 'margem', cor: '#E0A400' },
    { tipo: 'Desconto >20%', logica: 'Alto impacto na margem', caixa: 'margem', cor: '#B98900' },
    { tipo: 'Refabricação', logica: 'Alto custo operacional', caixa: 'operacional', cor: '#FFC400' },
    { tipo: 'Reembolso parcial', logica: 'Perda financeira direta — saída de caixa', caixa: 'caixa', cor: '#8A3B36' },
    { tipo: 'Reembolso total', logica: 'Perda total + custo operacional — saída de caixa', caixa: 'caixa', cor: '#C63A32' },
    { tipo: 'Outros', logica: 'Resolução fora do padrão — vale revisar o caso', caixa: 'operacional', cor: '#8A9099' },
  ];
  const RES_MAP = Object.fromEntries(RESOLUCAO_TABLE.map((r) => [r.tipo, r]));
  const RES_FALLBACK = { tipo: 'Não classificado', logica: 'Ainda sem tipo de resolução definido', caixa: 'desconhecido', cor: '#D8DBE0' };
  function getRes(tipo) { return RES_MAP[tipo] || RES_FALLBACK; }

  /* ================= FOTOS (Drive / URL direta / data URL) ================= */
  function parseFotos(v) {
    return String(v || '')
      .split(/\n+/)
      .flatMap((line) => (/^\s*data:/.test(line) ? [line.trim()] : line.split(',').map((s) => s.trim())))
      .filter(Boolean);
  }
  function fotoSrc(u) {
    u = String(u || '');
    if (/^data:|^blob:/.test(u)) return u;
    if (/drive\.google|docs\.google|googleusercontent/.test(u)) {
      const m = u.match(/[-\w]{25,}/);
      if (m) return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w1600';
    }
    return u;
  }
  /* Selo de "tem foto anexada" reaproveitado nos cards de Casos/Auditoria e de Refabricação. */
  function photoBadge(r) {
    const n = parseFotos(r.foto).length;
    return n ? `<span class="er-photo-badge" title="${n} foto(s) anexada(s)">📷 ${n}</span>` : '';
  }
  /** Lê um File de imagem, redimensiona (máx ~1280px) e devolve um JPEG data URL leve. */
  function comprimirImagem(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Arquivo não é imagem'));
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img;
          if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Não consegui ler a imagem'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
      reader.readAsDataURL(file);
    });
  }
  const MAX_FOTOS = 6;

  /* ================= STATUS (modelo de workflow) ================= */
  const STATUS_DEF = [
    { key: 'novo', label: 'Novo', cor: '#3B82F6' },
    { key: 'em_auditoria', label: 'Em auditoria', cor: '#8B5CF6' },
    { key: 'aguardando', label: 'Aguardando', cor: '#E0A400' },
    { key: 'resolvido', label: 'Resolvido', cor: '#15A15A' },
    { key: 'reincidente', label: 'Reincidente', cor: '#C63A32' },
  ];
  const STATUS_MAP = Object.fromEntries(STATUS_DEF.map((s, i) => [s.key, { ...s, ordem: i }]));
  function effectiveStatus(r) { return (r.status && STATUS_MAP[r.status]) ? r.status : (r.auditado ? 'resolvido' : 'novo'); }
  function statusBadge(r) { const s = STATUS_MAP[effectiveStatus(r)]; return `<span class="er-badge er-stbadge" style="background:${s.cor}1A;color:${s.cor}">${s.label}</span>`; }
  async function setCaseStatus(r, key) {
    if (!podeAuditar()) return;
    if (!STATUS_MAP[key] || effectiveStatus(r) === key) return;
    try {
      const res = await fetch('/erros/api/set-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, status: key }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
      r.status = key;
      r.auditado = (key === 'resolvido'); // mantém as análises coerentes: só "Resolvido" conta como auditado
      derivarListasDinamicas(); erInitFilterOptions();
      erRender(); if (CASO_ATUAL === r.id) renderDrawer(r.id);
      toast('Status: ' + STATUS_MAP[key].label, true);
    } catch (err) {
      toast('Não consegui atualizar o status: ' + err.message, false);
    }
  }

  /* ================= ESTADO / DADOS ================= */
  let RECORDS = [];
  let SETORES = SETORES_PADRAO.slice(), TIPOS_PRODUTO = TIPOS_PRODUTO_PADRAO.slice(), QUE_FIM_LIST = QUE_FIM_PADRAO.slice();
  let LAST_SYNC = null;
  let CASO_ATUAL = null; // id (rowIndex) do caso aberto no drawer lateral (null = fechado)
  let erCharts = {};

  const erState = {
    screen: telaInicialPapel(),
    periodoTipo: 'relativo', periodo: 'Últimos 12 meses', mes: '', semana: '',
    setor: '', empresa: '', granularidade: 'Mensal',
    buscaCaso: '', casosSort: { key: '', dir: 'desc' }, casosView: 'todos', causaFiltro: '', casosLayout: 'lista',
    semanaReuniao: null, semanaReuniaoFab: null,
  };

  function parseBRDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    let [, d, mo, y] = m;
    y = y.length === 2 ? '20' + y : y;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  async function erLoadRealData() {
    // Timeout generoso: dá margem pro backend "acordar" sem estourar rápido demais.
    const buscar = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 35000);
      try {
        const res = await fetch('/erros/api/casos', { method: 'GET', signal: ctrl.signal });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erro desconhecido do servidor');
        return json;
      } finally { clearTimeout(timer); }
    };
    let json;
    try { json = await buscar(); }
    catch (e) { await new Promise((r) => setTimeout(r, 1500)); json = await buscar(); } // 1 retry
    return json.rows.map((row) => ({
      id: row.rowIndex,
      idVenda: row.idVenda,
      nomeCard: row.nomeCard || '(sem nome)',
      date: parseBRDate(row.data) || new Date(),
      quemCadastrou: row.quemCadastrou || '—',
      descricao: row.descricao || '',
      linkPedido: row.linkPedido || '',
      auditado: !!row.auditoria,
      setor: row.setor || null,
      culpaDe: row.culpaDe || null,
      responsavel: row.responsavel || null,
      empresa: row.empresa || null,
      tipoProduto: row.tipoProduto || null,
      subproblema: row.tipoProblema || null, // "Tipo de problema" na planilha = causa granular
      detalhe: row.subproblema || '',
      qtd: row.qtd,
      custo: row.custo,
      tipoResolucao: row.tipoResolucao || null,
      queFim: row.queFim || null,
      status: row.status || null,
      foto: row.foto || '',
      aprovacaoRefab: row.aprovacaoRefab || '',
      comentarioAprovacao: row.comentarioAprovacao || '',
      registradoPorSlug: row.registradoPorSlug || '',
      linha: row.linha || null,
    }));
  }

  function derivarListasDinamicas() {
    const setoresSet = new Set(SETORES_PADRAO);
    const produtosSet = new Set(TIPOS_PRODUTO_PADRAO);
    const fimSet = new Set(QUE_FIM_PADRAO);
    RECORDS.forEach((r) => {
      if (r.setor) setoresSet.add(r.setor);
      if (r.tipoProduto) produtosSet.add(r.tipoProduto);
      if (r.queFim) fimSet.add(r.queFim);
    });
    SETORES = Array.from(setoresSet);
    TIPOS_PRODUTO = Array.from(produtosSet);
    QUE_FIM_LIST = Array.from(fimSet);
    SETORES.forEach(colorForSetor);
  }

  function mostrarErroConexao(err) {
    const bs = document.getElementById('erBoot');
    if (!bs) return;
    bs.style.display = 'flex';
    bs.innerHTML = `<div class="er-boot-err">
        <div class="e-ic">📡</div>
        <div class="e-title">Não consegui carregar os dados</div>
        <div class="e-sub">O servidor demorou demais ou está indisponível. Aguarde alguns segundos e tente de novo. <b>Não registre casos por enquanto</b> (não seriam salvos).</div>
        <button class="er-btn er-btn-primary" id="erBtnRetryBoot" style="margin-top:6px">Tentar de novo</button>
        <div class="e-detail">${erEsc(String((err && err.message) || err))}</div>
      </div>`;
    document.getElementById('erBtnRetryBoot').addEventListener('click', () => {
      bs.innerHTML = '<div class="er-spinner"></div><div id="erBootMsg">Carregando dados…</div>';
      erBoot();
    });
  }

  async function erBoot() {
    const bootEl = document.getElementById('erBoot');
    const mainEl = document.getElementById('erMain');
    bootEl.style.display = 'flex'; mainEl.style.display = 'none';
    try {
      RECORDS = await erLoadRealData();
    } catch (err) {
      console.error(err);
      mostrarErroConexao(err);
      return;
    }
    LAST_SYNC = Date.now();
    derivarListasDinamicas();
    erInitFilterOptions();
    bootEl.style.display = 'none'; mainEl.style.display = '';
    erRender();
    updateLastSync();
  }

  async function erRefreshData(silent) {
    const btn = document.getElementById('erBtnRefresh');
    if (!silent) { btn.disabled = true; btn.textContent = '…'; }
    try {
      RECORDS = await erLoadRealData();
      LAST_SYNC = Date.now();
      derivarListasDinamicas();
      erInitFilterOptions();
      erRender();
      updateLastSync();
      if (!silent) toast('Dados atualizados', true);
    } catch (err) {
      if (!silent) toast('Não consegui atualizar: ' + err.message, false);
      else console.error('Atualização em segundo plano falhou:', err);
    } finally {
      if (!silent) { btn.disabled = false; btn.textContent = '⟳'; }
    }
  }

  function fmtAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'agora mesmo';
    const m = Math.round(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    const h = Math.floor(m / 60);
    return 'há ' + h + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
  }
  function updateLastSync() {
    const el = document.getElementById('erLastSync');
    if (!el) return;
    el.innerHTML = LAST_SYNC ? ('· atualizado <b>' + fmtAgo(LAST_SYNC) + '</b>') : '';
  }
  setInterval(updateLastSync, 30000);

  /* ---------- Visões salvas (client-side, localStorage — sem chamada ao servidor) ---------- */
  const LS_VIEWS = 'seubone_erros_views_v1';
  function getViews() { try { return JSON.parse(localStorage.getItem(LS_VIEWS) || '[]'); } catch (e) { return []; } }
  function setViews(v) { try { localStorage.setItem(LS_VIEWS, JSON.stringify(v)); } catch (e) {} }
  function salvarVisaoAtual() {
    const nome = prompt('Nome da visão (ex: Fábrica pendentes):'); if (!nome || !nome.trim()) return;
    const views = getViews(); views.push({ nome: nome.trim(), setor: erState.setor || '', empresa: erState.empresa || '', casosView: erState.casosView || 'todos' });
    setViews(views); toast('Visão salva', true); erRender();
  }
  function aplicarVisao(v) {
    erState.setor = v.setor || ''; erState.empresa = v.empresa || ''; erState.casosView = v.casosView || 'todos';
    const fs = document.getElementById('erSetor'), fe = document.getElementById('erEmpresa');
    if (fs) fs.value = erState.setor; if (fe) fe.value = erState.empresa;
    erRender();
  }
  function removerVisao(i) { const views = getViews(); views.splice(i, 1); setViews(views); erRender(); }

  /* ---------- Toast (feedback de ações) ---------- */
  function toast(msg, ok) {
    let wrap = document.getElementById('erToastWrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'erToastWrap'; wrap.className = 'er-toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div'); t.className = 'er-toast';
    t.innerHTML = (ok === true ? '<span class="tok">✓</span> ' : ok === false ? '<span class="terr">!</span> ' : '') + msg;
    wrap.appendChild(t); void t.offsetWidth; t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3200);
  }

  /* ---------- Erros inline em formulários ---------- */
  function clearFieldErrs(form) { if (!form) return; form.querySelectorAll('.er-field.err').forEach((f) => { f.classList.remove('err'); const m = f.querySelector('.er-field-msg'); if (m) m.remove(); }); }
  function markFieldErr(inputEl, msg) { if (!inputEl) return; const field = inputEl.closest('.er-field'); if (!field) return; field.classList.add('err'); if (!field.querySelector('.er-field-msg')) { const d = document.createElement('div'); d.className = 'er-field-msg'; d.textContent = msg; field.appendChild(d); } }

  /* ---------- Seleção em massa (tela de casos) — disponível pros dois papéis: ---------- */
  /* exportar/copiar é leitura, não auditoria, então não passa por podeAuditar(). */
  let SEL = new Set(); // ids selecionados
  function limparSelecao() {
    SEL.clear();
    document.querySelectorAll('#erMain .er-rowchk').forEach((c) => { c.checked = false; });
    document.querySelectorAll('#erMain tr.er-sel-row').forEach((t) => t.classList.remove('er-sel-row'));
    const h = document.getElementById('erChkAll'); if (h) { h.checked = false; h.indeterminate = false; }
    selBar();
  }
  function selBar() {
    let bar = document.getElementById('erSelBar');
    if (SEL.size === 0) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'erSelBar'; bar.className = 'er-sel-bar'; document.body.appendChild(bar); }
    bar.innerHTML = `<span class="sel-n">${SEL.size} selecionado(s)</span>
      <button class="er-btn" id="erSelExport">Exportar CSV</button>
      <button class="er-btn" id="erSelCopy">Copiar IDs</button>
      <button class="er-btn" id="erSelClear">Limpar</button>`;
    document.getElementById('erSelExport').onclick = exportarSelecionados;
    document.getElementById('erSelCopy').onclick = copiarIdsSelecionados;
    document.getElementById('erSelClear').onclick = limparSelecao;
  }
  function exportarSelecionados() {
    const rows = RECORDS.filter((r) => SEL.has(r.id));
    if (!rows.length) return;
    const cols = [['ID', (r) => r.idVenda], ['Cliente/Card', (r) => r.nomeCard], ['Data', (r) => fmtDate(r.date)], ['Idade (dias)', (r) => diasDesde(r.date)],
      ['Setor', (r) => r.setor], ['Culpa de', (r) => r.culpaDe], ['Responsável', (r) => r.responsavel], ['Empresa', (r) => r.empresa],
      ['Tipo de problema', (r) => r.subproblema], ['Detalhe', (r) => r.detalhe], ['Qtd', (r) => r.qtd], ['Custo', (r) => (r.custo == null ? '' : r.custo)],
      ['Tipo de resolução', (r) => r.tipoResolucao], ['Que fim', (r) => r.queFim], ['Status', (r) => (r.auditado ? 'Auditado' : 'Pendente')], ['Descrição', (r) => r.descricao]];
    // Escapa p/ CSV E neutraliza injeção de fórmula: célula começando com = + - @ (ou tab/CR)
    // recebe um apóstrofo na frente, senão Excel/Sheets executa como fórmula ao abrir.
    const escCsv = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = '﻿' + cols.map((c) => escCsv(c[0])).join(';') + '\r\n' +
      rows.map((r) => cols.map((c) => escCsv(c[1](r))).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'casos_seubone_' + rows.length + '.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast(rows.length + ' caso(s) exportado(s)', true);
  }
  function copiarIdsSelecionados() {
    const ids = RECORDS.filter((r) => SEL.has(r.id)).map((r) => r.idVenda);
    navigator.clipboard?.writeText(ids.join('\n')); toast(ids.length + ' ID(s) copiado(s)', true);
  }

  /* ================= FILTROS DE PERÍODO ================= */
  function mondayOf(d) { const dt = new Date(d); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day); dt.setHours(0, 0, 0, 0); return dt; }
  function fmtDM(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }
  function sundayOf(monday) { const s = new Date(monday); s.setDate(s.getDate() + 6); return s; }

  function erInitFilterOptions() {
    const fSetorSel = document.getElementById('erSetor');
    const fEmpresaSel = document.getElementById('erEmpresa');
    const setorAtual = fSetorSel.value, empresaAtual = fEmpresaSel.value;
    fSetorSel.innerHTML = '<option value="">Todos os setores</option>' + SETORES.map((s) => `<option value="${erEsc(s)}">${erEsc(s)}</option>`).join('');
    const empresas = Array.from(new Set(RECORDS.map((r) => r.empresa).filter(Boolean)));
    fEmpresaSel.innerHTML = '<option value="">Todas as linhas</option>' + empresas.map((e) => `<option value="${erEsc(e)}">${erEsc(e)}</option>`).join('');
    fSetorSel.value = setorAtual; fEmpresaSel.value = empresaAtual;

    const mesesMap = {};
    RECORDS.forEach((r) => { const k = r.date.getFullYear() + '-' + String(r.date.getMonth() + 1).padStart(2, '0'); if (!mesesMap[k]) mesesMap[k] = r.date; });
    const mesesKeys = Object.keys(mesesMap).sort().reverse();
    const fMesSel = document.getElementById('erMes');
    fMesSel.innerHTML = mesesKeys.map((k) => {
      const label = mesesMap[k].toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return `<option value="${k}">${label.charAt(0).toUpperCase() + label.slice(1)}</option>`;
    }).join('');
    if (!erState.mes && mesesKeys.length) erState.mes = mesesKeys[0];

    const semanasSet = new Set();
    RECORDS.forEach((r) => semanasSet.add(mondayOf(r.date).getTime()));
    const semanasKeys = Array.from(semanasSet).sort((a, b) => b - a);
    const fSemanaSel = document.getElementById('erSemana');
    fSemanaSel.innerHTML = semanasKeys.map((ts) => {
      const seg = new Date(ts); const dom = sundayOf(seg);
      return `<option value="${ts}">${fmtDM(seg)} a ${fmtDM(dom)}</option>`;
    }).join('');
    if (!erState.semana && semanasKeys.length) erState.semana = String(semanasKeys[0]);

    // semana padrão pra Reunião de Vendas: a mais recente com erro de Vendas/Dupla auditado
    if (erState.semanaReuniao === null) {
      const semanasVendas = RECORDS.filter((r) => r.auditado && SETORES_VENDAS.includes(r.setor)).map((r) => mondayOf(r.date).getTime());
      erState.semanaReuniao = semanasVendas.length ? Math.max(...semanasVendas) : (semanasKeys[0] || mondayOf(new Date()).getTime());
    }
    // semana padrão pra Reunião de Fábrica: a mais recente com erro de Fábrica auditado
    if (erState.semanaReuniaoFab === null) {
      const semanasFab = RECORDS.filter((r) => r.auditado && r.setor === 'Fábrica').map((r) => mondayOf(r.date).getTime());
      erState.semanaReuniaoFab = semanasFab.length ? Math.max(...semanasFab) : (semanasKeys[0] || mondayOf(new Date()).getTime());
    }
  }

  function atualizarVisibilidadeFiltros() {
    document.getElementById('erPeriodo').style.display = erState.periodoTipo === 'relativo' ? '' : 'none';
    document.getElementById('erMes').style.display = erState.periodoTipo === 'mes' ? '' : 'none';
    document.getElementById('erSemana').style.display = erState.periodoTipo === 'semana' ? '' : 'none';
  }

  function cutoffFor(periodo) {
    const d = new Date();
    if (periodo === 'Últimos 30 dias') d.setDate(d.getDate() - 30);
    else if (periodo === 'Últimos 90 dias') d.setDate(d.getDate() - 90);
    else d.setDate(d.getDate() - 365);
    return d;
  }
  function dentroDoPeriodo(date) {
    if (erState.periodoTipo === 'mes') {
      if (!erState.mes) return true;
      const k = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
      return k === erState.mes;
    }
    if (erState.periodoTipo === 'semana') {
      if (!erState.semana) return true;
      return mondayOf(date).getTime() === Number(erState.semana);
    }
    const cutoff = cutoffFor(erState.periodo);
    const now = new Date();
    return date >= cutoff && date <= now;
  }
  function erFiltered() {
    return RECORDS.filter((r) => dentroDoPeriodo(r.date) &&
      (!erState.setor || r.setor === erState.setor) &&
      (!erState.empresa || r.empresa === erState.empresa)
    );
  }
  function auditadosOnly(list) { return list.filter((r) => r.auditado); }
  function brl(n) { return 'R$ ' + Number(Math.round(n || 0)).toLocaleString('pt-BR'); }
  function fmtDate(d) { return d.toLocaleDateString('pt-BR'); }
  function moda(list, key) {
    const rows = list.filter((x) => x[key]);
    if (!rows.length) return '—';
    const cnt = {}; rows.forEach((x) => { cnt[x[key]] = (cnt[x[key]] || 0) + 1; });
    return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  }

  /* ---------- Cores dos gráficos conforme o tema (lê os tokens do hub) ---------- */
  function erThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      gold: cs.getPropertyValue('--gold').trim() || '#F5B800',
      bad: cs.getPropertyValue('--bad').trim() || '#F0554F',
      ok: cs.getPropertyValue('--ok').trim() || '#34C77B',
      textMuted: cs.getPropertyValue('--text-muted').trim() || '#9A9994',
      text: cs.getPropertyValue('--text').trim() || '#EDEDEB',
      border: cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,.08)',
      surface: cs.getPropertyValue('--surface').trim() || '#1a1a1a',
    };
  }
  function safeChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (typeof Chart === 'undefined') {
      canvas.outerHTML = '<div style="color:var(--bad-text,var(--bad));font-size:12.5px;padding:24px 12px;text-align:center;line-height:1.5">Biblioteca de gráficos (Chart.js) não carregou. Verifique sua conexão.</div>';
      return null;
    }
    try { return new Chart(canvas, config); }
    catch (err) {
      console.error('Falha ao montar o gráfico "' + id + '":', err);
      canvas.outerHTML = '<div style="color:var(--bad-text,var(--bad));font-size:12.5px;padding:24px 12px;text-align:center">Não consegui montar este gráfico.</div>';
      return null;
    }
  }

  /* Série mensal (últimos até 8 meses presentes) a partir das linhas do recorte. */
  function monthlyBins(rows, valueFn) {
    const map = {};
    rows.forEach((r) => { if (!r.date || !(r.date instanceof Date) || isNaN(r.date)) return;
      const k = r.date.getFullYear() + '-' + String(r.date.getMonth() + 1).padStart(2, '0');
      map[k] = (map[k] || 0) + (valueFn ? valueFn(r) : 1);
    });
    return Object.keys(map).sort().slice(-8).map((k) => ({ key: k, v: map[k] }));
  }
  function sparklineSVG(vals, color) {
    if (!vals || vals.length < 2) return '';
    const w = 100, h = 26, max = Math.max(...vals), min = Math.min(...vals, 0), rng = (max - min) || 1;
    const pts = vals.map((v, i) => { const x = (i / (vals.length - 1)) * w; const y = h - ((v - min) / rng) * (h - 4) - 2; return x.toFixed(1) + ',' + y.toFixed(1); }).join(' ');
    return `<svg class="er-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  }
  function deltaPill(serie) {
    if (!serie || serie.length < 2) return '';
    const cur = serie[serie.length - 1].v, prev = serie[serie.length - 2].v;
    if (!prev) return '';
    const d = Math.round((cur - prev) / prev * 100);
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const ico = d > 0 ? '▲' : d < 0 ? '▼' : '≈';
    return `<span class="er-kpill ${cls}">${ico} ${Math.abs(d)}% vs mês anterior</span>`;
  }

  /* ================= RENDER ================= */
  function erRender() {
    if (!podeVerTela(erState.screen)) erState.screen = telaInicialPapel();
    document.querySelectorAll('#er-nav button').forEach((n) => n.classList.toggle('active', n.dataset.view === erState.screen));
    Object.values(erCharts).forEach((c) => { try { c.destroy(); } catch (e) {} });
    erCharts = {};

    const rotuloPeriodo = () => {
      if (erState.periodoTipo === 'mes') { const opt = document.querySelector('#erMes option[value="' + erState.mes + '"]'); return opt ? opt.textContent : 'mês selecionado'; }
      if (erState.periodoTipo === 'semana') { const opt = document.querySelector('#erSemana option[value="' + erState.semana + '"]'); return opt ? 'semana de ' + opt.textContent : 'semana selecionada'; }
      return erState.periodo;
    };
    const TITLES = {
      exec: ['Visão Executiva', 'Erros e custo · ' + rotuloPeriodo()],
      causas: ['Ranking de Causas', 'Pareto por custo, produto e volume · ' + rotuloPeriodo()],
      resp: ['Ranking por Consultor', 'Quem mais gera custo e como cada um resolve · ' + rotuloPeriodo()],
      casos: ['Casos / Auditoria', 'Fila de casos pendentes e já auditados · ' + rotuloPeriodo()],
      refab: ['Aprovação de Refabricação', papel === 'gestor' ? 'Todos os casos aguardando decisão, de todos os colaboradores' : 'Casos de Refabricação que você registrou'],
      incompletos: ['Dados incompletos', 'Casos sem setor preenchido — atribua para destravar as análises'],
      reuniao: ['Reunião de Vendas', 'Erros da semana para apresentar ao time — Vendas e Dupla · navegação de semana própria'],
      reuniaoFab: ['Reunião de Fábrica', 'Erros da semana para apresentar à produção — setor Fábrica · navegação de semana própria'],
    };
    document.getElementById('erPageTitle').textContent = TITLES[erState.screen][0];
    document.getElementById('erPageSub').textContent = TITLES[erState.screen][1];
    // Essas 3 telas têm navegação própria (semana / ação de setor) — a barra de
    // filtros de período/setor/empresa não se aplica a elas, igual ao original.
    const filtEl = document.getElementById('erFilters');
    if (filtEl) filtEl.style.display = (erState.screen === 'reuniao' || erState.screen === 'reuniaoFab' || erState.screen === 'incompletos' || erState.screen === 'refab') ? 'none' : '';

    const main = document.getElementById('erMain');
    main.innerHTML = '';

    if (erState.screen === 'reuniao') { renderReuniao(main, REUNIOES.vendas); return; }
    if (erState.screen === 'reuniaoFab') { renderReuniao(main, REUNIOES.fabrica); return; }
    if (erState.screen === 'incompletos') { renderIncompletos(main); return; }
    if (erState.screen === 'refab') { renderRefab(main); return; }

    const all = erFiltered();
    const data = auditadosOnly(all);

    if (erState.screen === 'casos') { renderCasos(main, all); return; }
    if (data.length === 0) {
      main.innerHTML = '<div class="er-card er-empty"><div class="e-title">Nenhum erro auditado neste recorte</div><div class="e-sub">Ajuste os filtros, ou audite os casos pendentes em "Casos / Auditoria".</div></div>';
      return;
    }
    if (erState.screen === 'exec') renderExec(main, data, all);
    else if (erState.screen === 'causas') renderCausas(main, data);
    else renderResp(main, data);
  }

  /* ================= VISÃO EXECUTIVA ================= */
  function renderExec(main, data, all) {
    const total = data.length;
    const serieN = monthlyBins(data);
    const serieC = monthlyBins(data, (r) => r.custo || 0);
    const spN = sparklineSVG(serieN.map((x) => x.v), erThemeColors().gold);
    const spC = sparklineSVG(serieC.map((x) => x.v), erThemeColors().gold);
    const pendentes = all.length - data.length;
    const custoTotal = data.reduce((a, r) => a + (r.custo || 0), 0);
    const custoMedio = total ? custoTotal / total : 0;

    const bySetor = {}; data.forEach((r) => { const s = r.setor || 'Não informado'; bySetor[s] = (bySetor[s] || 0) + 1; });
    const setoresPresentes = Object.keys(bySetor);

    const nome = ((SESSAO && SESSAO.nome) ? String(SESSAO.nome) : '').split(' ')[0] || 'time';
    const hora = new Date().getHours();
    const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const semSetorTotal = RECORDS.filter((r) => !r.setor).length;
    const subAcao = [];
    if (pendentes > 0) subAcao.push(`<b>${pendentes}</b> caso(s) pendente(s) de auditoria`);
    if (semSetorTotal > 0) subAcao.push(`<b>${semSetorTotal}</b> sem setor preenchido`);
    const setoresOrd = Object.entries(bySetor).sort((a, b) => b[1] - a[1]);
    const maxSetor = setoresOrd.length ? setoresOrd[0][1] : 1;

    main.innerHTML = `
      <div class="er-dash-hi">
        <h2>${saud}, ${erEsc(nome)} 👋</h2>
        <div class="sub">${subAcao.length ? subAcao.join(' e ') + '.' : 'Tudo em dia por aqui — sem pendências no recorte. 🎉'}</div>
      </div>

      <div class="er-metrics">
        <div class="er-metric hero">
          <div class="m-top"><span class="m-ic">▦</span><span class="m-label">Erros auditados</span></div>
          <div class="m-value">${total}</div>
          <div>${deltaPill(serieN) || `<span class="er-kpill">${pendentes} pendente(s)</span>`}</div>
          <div class="m-spark">${spN}</div>
        </div>
        <div class="er-metric">
          <div class="m-top"><span class="m-ic ic-amber">◈</span><span class="m-label">Custo total</span></div>
          <div class="m-value">${brl(custoTotal)}</div>
          <div>${deltaPill(serieC) || `<span class="er-kpill">${brl(custoMedio)} médio</span>`}</div>
          <div class="m-spark">${spC}</div>
        </div>
        <div class="er-metric">
          <div class="m-top"><span class="m-ic ic-red">▲</span><span class="m-label">Pendentes de auditoria</span></div>
          <div class="m-value">${pendentes}</div>
          <div><span class="er-kpill ${pendentes > 0 ? 'up' : 'down'}">${pendentes > 0 ? 'aguardando fechamento' : 'tudo auditado'}</span></div>
        </div>
        <div class="er-metric">
          <div class="m-top"><span class="m-ic ic-slate">◑</span><span class="m-label">Casos sem setor</span></div>
          <div class="m-value">${semSetorTotal}</div>
          <div>${semSetorTotal > 0 ? `<span class="er-kpill up">trava as análises</span>` : `<span class="er-kpill down">completo</span>`}</div>
        </div>
      </div>

      <div class="er-grid er-grid-2">
        <div class="er-card">
          <div class="er-card-head">
            <div><h3>Evolução · erros e custo</h3><div class="er-card-sub">Área = nº de erros auditados. Linha pontilhada = custo total (R$).</div></div>
            <div class="er-seg" id="erSegGran"><button data-g="Semanal">Semanal</button><button data-g="Mensal">Mensal</button></div>
          </div>
          <div class="er-chart-box" style="height:280px"><canvas id="erChTrend"></canvas></div>
        </div>
        <div class="er-card" style="display:flex;flex-direction:column">
          <div class="er-card-head"><div><h3>Top setores</h3><div class="er-card-sub">Onde o erro se origina (auditados no recorte).</div></div></div>
          <div style="margin-top:4px">
            ${setoresOrd.slice(0, 5).map(([s, n]) => `<div class="er-ts-row">
              <div class="er-ts-top"><span class="er-dot" style="background:${colorForSetor(s)}"></span><span class="er-ts-name">${erEsc(s)}</span><span class="er-ts-count">${n} · ${total ? Math.round(n / total * 100) : 0}%</span></div>
              <div class="er-ts-bar"><i style="width:${maxSetor ? Math.max(4, n / maxSetor * 100) : 0}%;background:${colorForSetor(s)}"></i></div>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="er-card">
        <h3>Custo x Volume por tipo de resolução</h3>
        <div class="er-card-sub">Vermelho = % do custo total. Amarelo = % dos casos. Onde o vermelho é bem maior que o amarelo, é raro mas caro.</div>
        <div class="er-chart-box" style="height:300px"><canvas id="erChResVsCusto"></canvas></div>
      </div>

      <div class="er-card">
        <h3>Diferença por linha do produto</h3>
        <div class="er-card-sub">Vermelho = % do custo total. Amarelo = % dos casos. Casos sem linha preenchida na auditoria caem em "Não informado".</div>
        <div class="er-chart-box" style="height:260px"><canvas id="erChLinha"></canvas></div>
      </div>

      <div class="er-grid er-grid-2col">
        <div class="er-card"><h3>Composição por setor do problema</h3><div class="er-card-sub">Onde o erro se origina.</div><div class="er-chart-box" style="height:224px"><canvas id="erChSetor"></canvas></div></div>
        <div class="er-card" style="display:flex;flex-direction:column"><h3>Leitura</h3><div class="er-card-sub">% de erros por setor no período auditado.</div>
          <div style="margin-top:auto">
            ${setoresPresentes.map((s) => `<div class="er-legend-row"><span class="er-dot" style="background:${colorForSetor(s)}"></span><span>${erEsc(s)}</span><b style="margin-left:auto">${Math.round(bySetor[s] / total * 100)}%</b></div>`).join('')}
            <div class="er-legend-row"><span>Total auditado</span><b style="margin-left:auto;font-size:22px">${total}</b></div>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('#erSegGran button').forEach((b) => {
      b.classList.toggle('active', b.dataset.g === erState.granularidade);
      b.addEventListener('click', () => { erState.granularidade = b.dataset.g; erRender(); });
    });

    const c = erThemeColors();
    let labels, seriesN, seriesCusto;
    if (erState.granularidade === 'Mensal') {
      const monthKey = (d) => d.getFullYear() + '-' + d.getMonth();
      const map = {};
      data.forEach((r) => { const k = monthKey(r.date); if (!map[k]) map[k] = { n: 0, custo: 0, ref: r.date }; map[k].n++; map[k].custo += (r.custo || 0); });
      const keys = Object.keys(map).sort((a, b) => map[a].ref - map[b].ref);
      labels = keys.map((k) => map[k].ref.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''));
      seriesN = keys.map((k) => map[k].n);
      seriesCusto = keys.map((k) => map[k].custo);
    } else {
      const weekMap = {};
      data.forEach((r) => { const mon = mondayOf(r.date).getTime(); if (!weekMap[mon]) weekMap[mon] = { n: 0, custo: 0 }; weekMap[mon].n++; weekMap[mon].custo += (r.custo || 0); });
      const weeks = Object.keys(weekMap).map(Number).sort((a, b) => a - b).slice(-12);
      labels = weeks.map((w) => fmtDM(new Date(w)));
      seriesN = weeks.map((w) => weekMap[w].n);
      seriesCusto = weeks.map((w) => weekMap[w].custo);
    }

    erCharts.trend = safeChart('erChTrend', {
      data: { labels, datasets: [
        { type: 'line', label: 'Nº de erros', data: seriesN, borderColor: c.gold, backgroundColor: c.gold + '29', fill: true, borderWidth: 2, tension: .35, pointRadius: 2, pointHoverRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Custo total (R$)', data: seriesCusto, borderColor: '#2A6FDB', backgroundColor: '#2A6FDB', borderDash: [6, 5], borderWidth: 2, tension: .35, pointRadius: 3, yAxisID: 'y1' },
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: c.textMuted } } },
        scales: { x: { grid: { display: false }, ticks: { color: c.textMuted } },
          y: { position: 'left', grid: { color: c.border }, beginAtZero: true },
          y1: { position: 'right', grid: { display: false }, beginAtZero: true, ticks: { callback: (v) => 'R$ ' + (v / 1000).toFixed(0) + 'k', color: c.textMuted } } },
      },
    });
    erCharts.setor = safeChart('erChSetor', {
      type: 'doughnut',
      data: { labels: setoresPresentes, datasets: [{ data: setoresPresentes.map((s) => bySetor[s]), backgroundColor: setoresPresentes.map(colorForSetor), borderColor: c.surface, borderWidth: 3 }] },
      options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } },
    });

    const tiposPresentes = Array.from(new Set(data.map((r) => r.tipoResolucao || 'Não classificado')));
    const resAgg = tiposPresentes.map((tipo) => {
      const rows = data.filter((r) => (r.tipoResolucao || 'Não classificado') === tipo);
      return { tipo, pctCasos: rows.length / total * 100, pctCusto: custoTotal ? rows.reduce((a, r) => a + (r.custo || 0), 0) / custoTotal * 100 : 0 };
    }).sort((a, b) => b.pctCusto - a.pctCusto);
    erCharts.resVsCusto = safeChart('erChResVsCusto', {
      type: 'bar',
      data: { labels: resAgg.map((r) => r.tipo), datasets: [
        { label: '% do custo total', data: resAgg.map((r) => r.pctCusto), backgroundColor: c.bad, borderRadius: 5, barPercentage: .75 },
        { label: '% dos casos', data: resAgg.map((r) => r.pctCasos), backgroundColor: c.gold, borderRadius: 5, barPercentage: .75 },
      ] },
      options: { maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: c.textMuted } } },
        scales: { x: { grid: { color: c.border }, min: 0, max: 100, ticks: { callback: (v) => v + '%', color: c.textMuted } }, y: { grid: { display: false }, ticks: { color: c.textMuted } } },
      },
    });

    const linhasPresentes = Array.from(new Set(data.map((r) => r.linha || 'Não informado')));
    const linhaAgg = linhasPresentes.map((linha) => {
      const rows = data.filter((r) => (r.linha || 'Não informado') === linha);
      return { linha, pctCasos: rows.length / total * 100, pctCusto: custoTotal ? rows.reduce((a, r) => a + (r.custo || 0), 0) / custoTotal * 100 : 0 };
    }).sort((a, b) => b.pctCusto - a.pctCusto);
    erCharts.linha = safeChart('erChLinha', {
      type: 'bar',
      data: { labels: linhaAgg.map((r) => r.linha), datasets: [
        { label: '% do custo total', data: linhaAgg.map((r) => r.pctCusto), backgroundColor: c.bad, borderRadius: 5, barPercentage: .75 },
        { label: '% dos casos', data: linhaAgg.map((r) => r.pctCasos), backgroundColor: c.gold, borderRadius: 5, barPercentage: .75 },
      ] },
      options: { maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: c.textMuted } } },
        scales: { x: { grid: { color: c.border }, min: 0, max: 100, ticks: { callback: (v) => v + '%', color: c.textMuted } }, y: { grid: { display: false }, ticks: { color: c.textMuted } } },
      },
    });
  }

  /* ================= RANKING DE CAUSAS / PARETO ================= */
  function renderCausas(main, data) {
    const totalCusto = data.reduce((a, r) => a + (r.custo || 0), 0);
    const map = {};
    data.forEach((r) => {
      const key = r.subproblema || 'Não classificado';
      if (!map[key]) map[key] = { nome: key, setor: r.setor || 'Não informado', n: 0, custo: 0, qtd: 0, rows: [] };
      const m = map[key]; m.n++; m.custo += (r.custo || 0); m.qtd += (r.qtd || 0); m.rows.push(r);
    });
    const list = Object.values(map).sort((a, b) => b.custo - a.custo);
    let acc = 0; list.forEach((it) => { it.pct = totalCusto ? it.custo / totalCusto * 100 : 0; acc += it.pct; it.acc = acc; it.solComum = moda(it.rows, 'tipoResolucao'); });
    const top = list.slice(0, 10);
    const paretoIdx = list.findIndex((it) => it.acc >= 80);
    const maxPct = list.length ? list[0].pct : 0;

    const prodMap = {};
    data.forEach((r) => { const k = r.tipoProduto || 'Não informado'; if (!prodMap[k]) prodMap[k] = { nome: k, custo: 0 }; prodMap[k].custo += (r.custo || 0); });
    const prodList = Object.values(prodMap).sort((a, b) => b.custo - a.custo).slice(0, 10);
    const qtdList = list.slice().sort((a, b) => b.qtd - a.qtd).slice(0, 8);

    main.innerHTML = `
      <div class="er-banner">
        <span class="b-ic">▽</span>
        <div><div class="b-title">Pareto por custo — 80/20 de verdade</div>
        <div class="b-text">${paretoIdx >= 0 ? (paretoIdx + 1) : list.length} causa(s) — de ${list.length} — respondem por 80% do custo total do período.</div></div>
      </div>

      <div class="er-card">
        <h3>Top causas · custo total e % acumulado</h3>
        <div class="er-card-sub">Barras = custo total da causa. Linha = % acumulado. <b>Clique numa barra</b> pra ver os casos daquela causa.</div>
        <div class="er-chart-box" style="height:340px"><canvas id="erChPareto"></canvas></div>
      </div>

      <div class="er-grid er-grid-2col">
        <div class="er-card"><h3>Custo por tipo de produto</h3><div class="er-card-sub">Onde o R$ do erro se concentra por produto.</div><div class="er-chart-box" style="height:260px"><canvas id="erChProduto"></canvas></div></div>
        <div class="er-card"><h3>Quantidade de produtos errados por causa</h3><div class="er-card-sub">Unidades físicas erradas — não é o mesmo que nº de casos.</div><div class="er-chart-box" style="height:260px"><canvas id="erChQtd"></canvas></div></div>
      </div>

      <div class="er-card">
        <h3>Detalhamento por causa</h3>
        <div class="er-tbl-wrap"><table>
          <thead><tr><th>#</th><th>Causa (Tipo de problema)</th><th>Setor predominante</th><th class="er-num">Custo total</th><th style="min-width:150px">% do custo</th><th class="er-num">% acumulado</th><th class="er-num">Ocorrências</th><th>Solução mais comum</th></tr></thead>
          <tbody>${list.map((it, i) => `<tr>
              <td><span class="er-rank ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
              <td style="font-weight:600">${erEsc(it.nome)}</td>
              <td><span class="er-dot" style="display:inline-block;background:${colorForSetor(it.setor)};margin-right:7px"></span>${erEsc(it.setor)}</td>
              <td class="er-num">${brl(it.custo)}</td>
              <td><div class="er-mbar"><div class="track"><div class="fill" style="width:${maxPct ? Math.max(2, it.pct / maxPct * 100) : 0}%;background:${colorForSetor(it.setor)}"></div></div><span class="val">${it.pct.toFixed(1)}%</span></div></td>
              <td class="er-num">${it.acc.toFixed(1)}%</td>
              <td class="er-num">${it.n}</td><td>${erEsc(it.solComum)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;

    const c = erThemeColors();
    erCharts.pareto = safeChart('erChPareto', {
      data: { labels: top.map((t) => t.nome), datasets: [
        { type: 'bar', label: 'Custo total (R$)', data: top.map((t) => t.custo), backgroundColor: top.map((t) => colorForSetor(t.setor)), borderRadius: 5, barPercentage: .7, yAxisID: 'y' },
        { type: 'line', label: '% acumulado', data: top.map((t) => t.acc), borderColor: c.text, backgroundColor: c.text, borderWidth: 2, tension: .3, pointRadius: 3, yAxisID: 'y1' },
      ] },
      options: { maintainAspectRatio: false,
        onClick: (evt, els) => { if (!els || !els.length) return; const cc = top[els[0].index]; if (cc && cc.nome) { erState.causaFiltro = cc.nome; erState.screen = 'casos'; erRender(); } },
        onHover: (evt, els) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: c.textMuted } } },
        scales: { x: { grid: { display: false }, ticks: { color: c.textMuted, maxRotation: 38, minRotation: 38 } },
          y: { position: 'left', grid: { color: c.border }, beginAtZero: true, ticks: { callback: (v) => 'R$ ' + (v / 1000).toFixed(1) + 'k', color: c.textMuted } },
          y1: { position: 'right', grid: { display: false }, min: 0, max: 100, ticks: { callback: (v) => v + '%', color: c.textMuted } } },
      },
    });
    erCharts.produto = safeChart('erChProduto', {
      type: 'bar', data: { labels: prodList.map((p) => p.nome), datasets: [{ data: prodList.map((p) => p.custo), backgroundColor: c.gold, borderRadius: 5, barPercentage: .7 }] },
      options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: { grid: { color: c.border }, ticks: { callback: (v) => 'R$ ' + (v / 1000).toFixed(1) + 'k', color: c.textMuted } }, y: { grid: { display: false }, ticks: { color: c.textMuted } } } },
    });
    erCharts.qtd = safeChart('erChQtd', {
      type: 'bar', data: { labels: qtdList.map((q) => q.nome), datasets: [{ data: qtdList.map((q) => q.qtd), backgroundColor: '#565C64', borderRadius: 5, barPercentage: .7 }] },
      options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: { grid: { color: c.border }, ticks: { color: c.textMuted } }, y: { grid: { display: false }, ticks: { color: c.textMuted } } } },
    });
  }

  /* ================= RANKING POR CONSULTOR ================= */
  function renderResp(main, data) {
    const map = {};
    data.forEach((r) => {
      const key = r.responsavel || 'Não informado';
      if (!map[key]) map[key] = { nome: key, setor: r.setor || 'Não informado', n: 0, custo: 0, rows: [] };
      const m = map[key]; m.n++; m.custo += (r.custo || 0); m.rows.push(r);
    });
    const list = Object.values(map).map((m) => ({ ...m, custoMedio: m.custo / m.n, solComum: moda(m.rows, 'tipoResolucao'), pctReembolso: m.rows.filter((r) => getRes(r.tipoResolucao).caixa === 'caixa').length / m.n * 100 })).sort((a, b) => b.custo - a.custo);
    const top8 = list.slice(0, 8);
    const maiorCusto = list[0] || { nome: '—', custo: 0, n: 0, setor: '—' };
    const semImpacto = data.filter((r) => ['Sem custo', 'Envio rápido', 'Ajuste do produto'].includes(r.tipoResolucao));
    const semImpactoMap = {}; semImpacto.forEach((r) => { const k = r.responsavel || 'Não informado'; semImpactoMap[k] = (semImpactoMap[k] || 0) + 1; });
    const melhorResolucao = Object.entries(semImpactoMap).sort((a, b) => b[1] - a[1])[0] || ['—', 0];

    const tiposUsados = Array.from(new Set(data.map((r) => r.tipoResolucao || 'Não classificado')));
    const stackedDatasets = tiposUsados.map((tipo) => ({
      label: tipo, backgroundColor: getRes(tipo === 'Não classificado' ? '' : tipo).cor, borderRadius: 3, barPercentage: .68,
      data: top8.map((m) => m.rows.filter((r) => (r.tipoResolucao || 'Não classificado') === tipo).length),
    }));

    main.innerHTML = `
      <div class="er-banner">
        <span class="b-ic">i</span>
        <div><div class="b-title">Leia com cuidado</div>
        <div class="b-text">Este ranking é por volume absoluto de custo — quem vende/produz mais tende a aparecer mais aqui. Use como mapa de onde está o R$, não como avaliação de desempenho isolada.</div></div>
      </div>

      <div class="er-grid er-grid-2col">
        <div class="er-stat"><div class="s-label">Maior custo gerado <span class="er-pill er-pill-bad">atenção</span></div><div class="s-value sm">${erEsc(maiorCusto.nome)}</div><div class="s-foot">${brl(maiorCusto.custo)} em ${maiorCusto.n} erro(s) · ${erEsc(maiorCusto.setor)}</div></div>
        <div class="er-stat"><div class="s-label">Mais casos sem impacto financeiro <span class="er-pill er-pill-ok">referência</span></div><div class="s-value sm">${erEsc(melhorResolucao[0])}</div><div class="s-foot">${melhorResolucao[1]} caso(s) fechados como sem custo / envio rápido / ajuste pontual</div></div>
      </div>

      <div class="er-card">
        <h3>Top 8 · composição por tipo de resolução</h3>
        <div class="er-card-sub">Cada barra é um consultor/área. As cores mostram como os erros dele costumam ser resolvidos.</div>
        <div class="er-chart-box" style="height:320px"><canvas id="erChResp"></canvas></div>
      </div>

      <div class="er-card">
        <h3>Ranking completo</h3>
        <div class="er-card-sub">% reembolso acima de 20% pede conversa 1:1 — é dinheiro saindo do caixa.</div>
        <div class="er-tbl-wrap"><table>
          <thead><tr><th>#</th><th>Consultor / Área</th><th>Setor</th><th class="er-num">Ocorrências</th><th style="min-width:160px">Custo total</th><th class="er-num">Custo médio</th><th>Solução mais comum</th><th>Situação</th></tr></thead>
          <tbody>${list.map((m, i) => {
              const sit = m.pctReembolso === 0 ? { c: 'er-pill-ok', t: 'Saudável' } : m.pctReembolso <= 20 ? { c: 'er-pill-warn', t: 'Atenção' } : { c: 'er-pill-bad', t: 'Crítico' };
              return `<tr><td><span class="er-rank ${i < 3 ? 'top' : ''}">${i + 1}</span></td><td style="font-weight:600">${erEsc(m.nome)}</td>
                <td><span class="er-dot" style="display:inline-block;background:${colorForSetor(m.setor)};margin-right:7px"></span>${erEsc(m.setor)}</td>
                <td class="er-num">${m.n}</td>
                <td><div class="er-mbar"><div class="track"><div class="fill" style="width:${maiorCusto.custo ? Math.max(2, m.custo / maiorCusto.custo * 100) : 0}%;background:${colorForSetor(m.setor)}"></div></div><span class="val">${brl(m.custo)}</span></div></td>
                <td class="er-num">${brl(m.custoMedio)}</td><td>${erEsc(m.solComum)}</td>
                <td><span class="er-pill ${sit.c}">${sit.t}</span></td></tr>`;
            }).join('')}</tbody>
        </table></div>
      </div>
    `;

    const c = erThemeColors();
    erCharts.resp = safeChart('erChResp', {
      type: 'bar', data: { labels: top8.map((t) => t.nome), datasets: stackedDatasets },
      options: { maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 10.5 }, color: c.textMuted } } },
        scales: { x: { stacked: true, grid: { color: c.border }, ticks: { color: c.textMuted } }, y: { stacked: true, grid: { display: false }, ticks: { color: c.textMuted } } },
      },
    });
  }

  /* ================= CASOS / AUDITORIA ================= */
  function diasDesde(date) { return date ? Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000)) : 0; }
  function ageBadge(r) {
    const d = diasDesde(r.date);
    const cls = r.auditado ? 'er-age-ok' : (d > 7 ? 'er-age-old' : d >= 3 ? 'er-age-mid' : 'er-age-ok');
    return `<span class="er-age ${cls}">${d}d</span>`;
  }
  function toggleSort(k) {
    const s = erState.casosSort;
    if (s.key === k) { s.dir = s.dir === 'asc' ? 'desc' : 'asc'; }
    else { s.key = k; s.dir = (k === 'nome' || k === 'setor' || k === 'resp') ? 'asc' : 'desc'; }
  }
  function sortCasos(rows) {
    const s = erState.casosSort;
    if (!s.key) return rows.sort((a, b) => a.auditado === b.auditado ? b.date - a.date : (a.auditado ? 1 : -1));
    const dir = s.dir === 'asc' ? 1 : -1;
    const val = (r) => { switch (s.key) {
      case 'id': return Number(r.idVenda) || 0;
      case 'nome': return (r.nomeCard || '').toLowerCase();
      case 'data': return r.date.getTime();
      case 'idade': return diasDesde(r.date);
      case 'setor': return (r.setor || '').toLowerCase();
      case 'resp': return (r.responsavel || '').toLowerCase();
      case 'custo': return (r.custo == null) ? -Infinity : r.custo;
      case 'status': return STATUS_MAP[effectiveStatus(r)].ordem;
      default: return 0;
    } };
    return rows.sort((a, b) => { const va = val(a), vb = val(b); if (va < vb) return -dir; if (va > vb) return dir; return b.date - a.date; });
  }

  /* ---------- Kanban ---------- */
  function kcard(r) {
    return `<div class="er-kcard" draggable="${podeAuditar()}" data-id="${r.id}">
      <div class="kc-top"><span class="kc-id">#${erEsc(r.idVenda)}</span><span style="display:flex;align-items:center;gap:6px">${photoBadge(r)}${!r.auditado ? ageBadge(r) : ''}</span></div>
      <div class="kc-name">${erEsc(r.nomeCard)}</div>
      <div class="kc-meta">
        ${r.setor ? `<span><span class="er-dot" style="display:inline-block;background:${colorForSetor(r.setor)};margin-right:4px"></span>${erEsc(r.setor)}</span>` : ''}
        ${r.empresa ? `<span>${erEsc(r.empresa)}</span>` : ''}
        ${r.responsavel ? `<span>${erEsc(r.responsavel)}</span>` : ''}
      </div>
    </div>`;
  }
  function kanbanHTML(rows) {
    return `<div class="er-kanban">` + STATUS_DEF.map((sd) => {
      const cards = rows.filter((r) => effectiveStatus(r) === sd.key);
      return `<div class="er-kcol" data-status="${sd.key}" style="--kc:${sd.cor}">
        <div class="er-kcol-head"><span class="er-dot" style="background:${sd.cor}"></span>${sd.label}<span class="kc-count">${cards.length}</span></div>
        <div class="er-kcol-body">${cards.map(kcard).join('') || '<div class="er-kcol-empty">Nenhum caso</div>'}</div>
      </div>`;
    }).join('') + `</div>`;
  }
  function wireKanban() {
    document.querySelectorAll('.er-kcard').forEach((card) => {
      card.addEventListener('click', () => openCaso(Number(card.dataset.id)));
      if (podeAuditar()) {
        card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
        card.addEventListener('dragend', () => { card.classList.remove('dragging'); document.querySelectorAll('.er-kcol.drag-over').forEach((c) => c.classList.remove('drag-over')); });
      }
    });
    if (!podeAuditar()) return; // colaborador vê o kanban, mas não arrasta (servidor recusaria a mudança de status)
    document.querySelectorAll('.er-kcol').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drag-over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drag-over');
        const id = Number(e.dataTransfer.getData('text/plain')); const st = col.dataset.status;
        const r = RECORDS.find((x) => x.id === id); if (r && st) setCaseStatus(r, st);
      });
    });
  }

  function renderCasos(main, all) {
    const q = erState.buscaCaso.trim().toLowerCase();
    let rows = all.slice();
    if (q) rows = rows.filter((r) => String(r.idVenda).includes(q) || r.nomeCard.toLowerCase().includes(q) || (r.responsavel || '').toLowerCase().includes(q));
    if (erState.causaFiltro) rows = rows.filter((r) => (r.subproblema || 'Não classificado') === erState.causaFiltro);
    if (erState.casosView === 'pendentes') rows = rows.filter((r) => !r.auditado);
    else if (erState.casosView === 'parados7') rows = rows.filter((r) => !r.auditado && diasDesde(r.date) > 7);
    else if (erState.casosView === 'altoCusto') rows = rows.filter((r) => (r.custo || 0) > 500);
    rows = sortCasos(rows);

    const pend = all.filter((r) => !r.auditado);
    const parados7 = pend.filter((r) => diasDesde(r.date) > 7).length;
    const idadeMedia = pend.length ? Math.round(pend.reduce((a, r) => a + diasDesde(r.date), 0) / pend.length) : 0;

    const s = erState.casosSort;
    const arrow = (k) => s.key === k ? (s.dir === 'asc' ? '▲' : '▼') : '↕';
    const th = (k, label, num) => `<th class="${s.key === k ? 'er-sortable er-sorted' : 'er-sortable'}${num ? ' er-num' : ''}" data-sort="${k}">${label} <span class="er-sarrow">${arrow(k)}</span></th>`;

    // Seleção em massa (checkboxes/CSV/copiar IDs) e Kanban são só p/ quem audita,
    // igual ao original ("seleção em massa e kanban só p/ quem audita") — colaborador
    // fica em modo somente-leitura na lista, sem opção de trocar de layout.
    const podeSel = podeAuditar();
    const layout = (podeSel && erState.casosLayout === 'kanban') ? 'kanban' : 'lista';
    const views = getViews();
    const vChip = (k, label) => `<button class="er-chip ${erState.casosView === k ? 'on' : ''}" data-view="${k}">${label}</button>`;

    const listCard = `
      <div class="er-card">
        <div class="er-card-head"><div><h3>Casos registrados</h3><div class="er-card-sub">Clique em uma linha pra abrir o caso; clique no cabeçalho pra ordenar.${podeSel ? '' : ' <b>Somente leitura</b> — você pode ver os casos, mas não auditar.'}</div></div></div>
        <div class="er-tbl-wrap"><table>
          <thead><tr>${podeSel ? '<th class="er-chkcell"><input type="checkbox" id="erChkAll"></th>' : ''}${th('id', 'ID')}${th('nome', 'Cliente / Card')}${th('data', 'Data')}${th('idade', 'Idade')}${th('setor', 'Setor')}${th('resp', 'Responsável')}${th('custo', 'Custo', true)}${th('status', 'Status')}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="er-clickable${SEL.has(r.id) ? ' er-sel-row' : ''}" data-id="${r.id}">
              ${podeSel ? `<td class="er-chkcell"><input type="checkbox" class="er-rowchk" data-id="${r.id}" ${SEL.has(r.id) ? 'checked' : ''}></td>` : ''}
              <td><span class="er-idchip" data-copy="${erEsc(r.idVenda)}">#${erEsc(r.idVenda)}</span></td>
              <td style="font-weight:600">${erEsc(r.nomeCard)} ${photoBadge(r)}</td>
              <td>${fmtDate(r.date)}</td>
              <td>${ageBadge(r)}</td>
              <td>${r.setor ? `<span class="er-dot" style="display:inline-block;background:${colorForSetor(r.setor)};margin-right:7px"></span>${erEsc(r.setor)}` : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${erEsc(r.responsavel) || '<span style="color:var(--text-hint)">—</span>'}</td>
              <td class="er-num">${r.custo !== null && r.custo !== undefined ? brl(r.custo) : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${statusBadge(r)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        ${rows.length === 0 ? '<div class="er-empty"><div class="e-title">Nenhum caso encontrado</div><div class="e-sub">Ajuste a busca ou os filtros do período.</div></div>' : ''}
      </div>`;

    main.innerHTML = `
      <div class="er-casos-kpis">
        <div class="er-ck"><div class="ck-l">Pendentes de auditoria</div><div class="ck-v">${pend.length}</div></div>
        <div class="er-ck ${parados7 > 0 ? 'warn' : ''}"><div class="ck-l">Parados há +7 dias</div><div class="ck-v">${parados7}</div></div>
        <div class="er-ck"><div class="ck-l">Idade média dos pendentes</div><div class="ck-v">${idadeMedia}<span style="font-size:13px;font-weight:600;color:var(--text-muted)"> dias</span></div></div>
      </div>
      <div class="er-chips-bar">
        ${erState.causaFiltro ? `<button class="er-chip on" id="erChipCausa" title="Filtrando por causa vinda do Pareto">Causa: ${erEsc(erState.causaFiltro)} <span class="x">✕</span></button><span class="er-chip-sep"></span>` : ''}
        ${vChip('todos', 'Todos')}${vChip('pendentes', 'Pendentes')}${vChip('parados7', 'Parados +7d')}${vChip('altoCusto', 'Alto custo')}
        ${views.length ? '<span class="er-chip-sep"></span>' : ''}
        ${views.map((v, i) => `<button class="er-chip" data-savedidx="${i}" title="setor: ${erEsc(v.setor) || 'todos'} · linha: ${erEsc(v.empresa) || 'todas'} · ${erEsc(v.casosView) || 'todos'}">${erEsc(v.nome)} <span class="x" data-delidx="${i}">✕</span></button>`).join('')}
        <button class="er-chip er-chip-add" id="erChipSalvar">+ Salvar visão atual</button>
        <span style="flex:1"></span>
        <input class="er-searchbar" id="erBuscaCaso" placeholder="Buscar ID, cliente ou consultor…" value="${erEsc(erState.buscaCaso)}">
        <div class="er-seg-toggle">
          <button class="seg ${layout === 'lista' ? 'on' : ''}" data-layout="lista">☰ Lista</button>
          ${podeSel ? `<button class="seg ${layout === 'kanban' ? 'on' : ''}" data-layout="kanban">▦ Kanban</button>` : ''}
        </div>
      </div>
      ${layout === 'kanban' ? kanbanHTML(rows) : listCard}
    `;

    document.getElementById('erBuscaCaso').addEventListener('input', (e) => {
      const v = e.target.value; erState.buscaCaso = v; erRender();
      const el = document.getElementById('erBuscaCaso'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
    });
    document.querySelectorAll('.er-chip[data-view]').forEach((c) => c.addEventListener('click', () => { erState.casosView = c.dataset.view; erRender(); }));
    const chipC = document.getElementById('erChipCausa'); if (chipC) chipC.addEventListener('click', () => { erState.causaFiltro = ''; erRender(); });
    document.querySelectorAll('.er-chip[data-savedidx]').forEach((c) => c.addEventListener('click', (e) => {
      if (e.target.dataset.delidx !== undefined) { e.stopPropagation(); removerVisao(Number(e.target.dataset.delidx)); return; }
      aplicarVisao(getViews()[Number(c.dataset.savedidx)]);
    }));
    const cs = document.getElementById('erChipSalvar'); if (cs) cs.addEventListener('click', salvarVisaoAtual);
    document.querySelectorAll('.er-seg-toggle .seg').forEach((b) => b.addEventListener('click', () => { erState.casosLayout = b.dataset.layout; erRender(); }));

    if (layout === 'kanban') { wireKanban(); return; }

    document.querySelectorAll('th.er-sortable').forEach((thEl) => { thEl.addEventListener('click', () => { toggleSort(thEl.dataset.sort); erRender(); }); });
    document.querySelectorAll('.er-idchip').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard?.writeText(el.dataset.copy); el.textContent = 'Copiado!'; setTimeout(() => { el.textContent = '#' + el.dataset.copy; }, 900); });
    });
    document.querySelectorAll('tr.er-clickable').forEach((tr) => { tr.addEventListener('click', (e) => { if (e.target.closest('.er-chkcell')) return; openCaso(Number(tr.dataset.id)); }); });

    // ---------- seleção em massa ----------
    const syncChkAll = () => {
      const chks = document.querySelectorAll('#erMain .er-rowchk'); const marc = document.querySelectorAll('#erMain .er-rowchk:checked').length;
      const h = document.getElementById('erChkAll'); if (h) { h.checked = chks.length > 0 && marc === chks.length; h.indeterminate = marc > 0 && marc < chks.length; }
    };
    document.querySelectorAll('#erMain .er-rowchk').forEach((chk) => {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id); const tr = chk.closest('tr');
        if (chk.checked) { SEL.add(id); tr.classList.add('er-sel-row'); } else { SEL.delete(id); tr.classList.remove('er-sel-row'); }
        syncChkAll(); selBar();
      });
    });
    const chkAll = document.getElementById('erChkAll');
    if (chkAll) {
      chkAll.addEventListener('click', (e) => e.stopPropagation());
      chkAll.addEventListener('change', () => {
        document.querySelectorAll('#erMain .er-rowchk').forEach((chk) => {
          chk.checked = chkAll.checked; const id = Number(chk.dataset.id); const tr = chk.closest('tr');
          if (chkAll.checked) { SEL.add(id); tr.classList.add('er-sel-row'); } else { SEL.delete(id); tr.classList.remove('er-sel-row'); }
        });
        chkAll.indeterminate = false; selBar();
      });
      syncChkAll();
    }
    selBar();
    if (CASO_ATUAL !== null) highlightRow(CASO_ATUAL);
  }

  /* ================= FILA DE APROVAÇÃO DE REFABRICAÇÃO ================= */
  // Kanban paralelo ao de status normal — entra automaticamente (no servidor)
  // quando Tipo de Resolução = "Refabricação", na criação ou numa auditoria
  // posterior. Gestor vê todos os casos de todo mundo; colaborador só os que
  // ele mesmo registrou (registradoPorSlug vem do Historico, resolvido no
  // Apps Script — nunca confiamos em nada vindo do cliente para essa trava).
  const REFAB_STATUS_DEF = [
    { key: 'Pendente', label: 'Aguardando aprovação', cor: '#E0A400' },
    { key: 'Aprovado', label: 'Aprovado', cor: '#1E8A4D' },
    { key: 'Reprovado', label: 'Reprovado', cor: '#C63A32' },
    { key: 'Finalizado', label: 'Finalizado', cor: '#565C64' },
  ];

  // "registradoPorSlug" vem do Historico e é o sinal confiável (imune a gente
  // digitando o nome diferente da conta). Mas casos de antes desta função
  // existir (ou qualquer entrada "Caso registrado" que não tenha ficado
  // gravada por algum motivo) não têm esse slug — sem esse fallback por nome,
  // o colaborador nunca veria o próprio caso na fila.
  function normNome_(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^@+/, '').replace(/\s+/g, ' ').trim();
  }
  function souEuQueRegistrei(r) {
    if (!SESSAO) return false;
    if (r.registradoPorSlug) return r.registradoPorSlug === SESSAO.slug;
    return !!r.quemCadastrou && normNome_(r.quemCadastrou) === normNome_(SESSAO.nome);
  }

  function refabRows() {
    let rows = RECORDS.filter((r) => r.aprovacaoRefab);
    if (papel !== 'gestor') rows = rows.filter(souEuQueRegistrei);
    return rows;
  }

  // Quem registrou (ou o gestor, que vê e pode mexer em qualquer caso da
  // fila) pode mover Aprovado → Finalizado — envio pra produção é manual,
  // em sistema externo, o hub só registra que já foi feito.
  function podeFinalizarRefab(r) { return r.aprovacaoRefab === 'Aprovado' && (papel === 'gestor' || souEuQueRegistrei(r)); }

  function refabCard(r) {
    const podeFin = podeFinalizarRefab(r);
    return `<div class="er-kcard" draggable="${podeFin}" data-id="${r.id}">
      <div class="kc-top"><span class="kc-id">#${erEsc(r.idVenda)}</span><span style="display:flex;align-items:center;gap:6px">${photoBadge(r)}${souEuQueRegistrei(r) ? '<span class="er-pill er-pill-ok" style="font-size:10.5px">registrado por você</span>' : ''}</span></div>
      <div class="kc-name">${erEsc(r.nomeCard)}</div>
      <div class="kc-meta">
        ${r.setor ? `<span><span class="er-dot" style="display:inline-block;background:${colorForSetor(r.setor)};margin-right:4px"></span>${erEsc(r.setor)}</span>` : ''}
        ${r.responsavel ? `<span>${erEsc(r.responsavel)}</span>` : ''}
      </div>
      ${podeFin ? `<button class="er-btn er-btn-accent er-refab-fin-btn" data-id="${r.id}">Marcar como Finalizado</button>` : ''}
    </div>`;
  }

  /** Chama a API e atualiza o card em tela — usado pelo botão do card, pelo
   *  drag-and-drop pra coluna Finalizado e pelo botão dentro do modal. */
  async function finalizarCasoRefab(r) {
    try {
      const res = await fetch('/erros/api/refab/finalizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido do servidor');
      r.aprovacaoRefab = 'Finalizado';
      toast('Caso marcado como enviado para produção.', true);
      erRender();
      return true;
    } catch (err) {
      toast('Falha ao finalizar: ' + err.message, false);
      return false;
    }
  }

  function renderRefab(main) {
    const rows = refabRows();
    main.innerHTML = `
      <div class="er-kanban er-kanban-refab">${REFAB_STATUS_DEF.map((sd) => {
        const cards = rows.filter((r) => r.aprovacaoRefab === sd.key);
        return `<div class="er-kcol" data-status="${sd.key}" style="--kc:${sd.cor}">
          <div class="er-kcol-head"><span class="er-dot" style="background:${sd.cor}"></span>${sd.label}<span class="kc-count">${cards.length}</span></div>
          <div class="er-kcol-body">${cards.map(refabCard).join('') || '<div class="er-kcol-empty">Nenhum caso</div>'}</div>
        </div>`;
      }).join('')}</div>
      ${rows.length === 0 ? `<div class="er-card er-empty" style="margin-top:16px"><div class="e-title">Nenhum caso na fila de Refabricação</div><div class="e-sub">${papel === 'gestor' ? 'Quando um caso for registrado ou auditado com Tipo de Resolução = Refabricação, ele aparece aqui.' : 'Os casos de Refabricação que você registrar aparecerão aqui.'}</div></div>` : ''}
    `;
    main.querySelectorAll('.er-kcard').forEach((card) => {
      card.addEventListener('click', (e) => { if (e.target.closest('.er-refab-fin-btn')) return; const r = RECORDS.find((x) => x.id === Number(card.dataset.id)); if (r) openRefabModal(r); });
      if (card.draggable) {
        card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
        card.addEventListener('dragend', () => { card.classList.remove('dragging'); main.querySelectorAll('.er-kcol.drag-over').forEach((c) => c.classList.remove('drag-over')); });
      }
    });
    main.querySelectorAll('.er-refab-fin-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); const r = RECORDS.find((x) => x.id === Number(btn.dataset.id)); if (r) { btn.disabled = true; finalizarCasoRefab(r).then((ok) => { if (!ok) btn.disabled = false; }); } });
    });
    const colFinalizado = main.querySelector('.er-kcol[data-status="Finalizado"]');
    if (colFinalizado) {
      colFinalizado.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; colFinalizado.classList.add('drag-over'); });
      colFinalizado.addEventListener('dragleave', (e) => { if (!colFinalizado.contains(e.relatedTarget)) colFinalizado.classList.remove('drag-over'); });
      colFinalizado.addEventListener('drop', (e) => {
        e.preventDefault(); colFinalizado.classList.remove('drag-over');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const r = RECORDS.find((x) => x.id === id);
        if (r && podeFinalizarRefab(r)) finalizarCasoRefab(r);
      });
    }
  }

  function openRefabModal(r) {
    const modalRoot = document.getElementById('erModalRoot');
    const status = r.aprovacaoRefab;
    const sd = REFAB_STATUS_DEF.find((s) => s.key === status) || REFAB_STATUS_DEF[0];
    const podeDecidir = status === 'Pendente' && podeAuditar();
    const podeFinalizar = podeFinalizarRefab(r);

    modalRoot.innerHTML = `
      <div class="er-overlay" id="erOverlayRefab">
        <div class="er-modal" role="dialog" aria-modal="true" aria-label="Aprovação de Refabricação">
          <div class="er-modal-head">
            <div style="flex:1;min-width:0">
              <div class="title">#${erEsc(r.idVenda)} — ${erEsc(r.nomeCard)}</div>
              <div class="sub"><span class="er-dot" style="display:inline-block;background:${sd.cor};margin-right:5px"></span>${sd.label}</div>
            </div>
            <button class="er-close-btn" id="erCloseModalRefab">✕</button>
          </div>
          <div class="er-modal-body">
            <div class="er-field-grid" style="margin-bottom:14px">
              <div class="er-field"><label>Setor</label><div class="er-readonly-block">${erEsc(r.setor) || '—'}</div></div>
              <div class="er-field"><label>Responsável</label><div class="er-readonly-block">${erEsc(r.responsavel) || '—'}</div></div>
            </div>
            <div class="er-field" style="margin-bottom:14px"><label>Descrição</label><div class="er-readonly-block" style="white-space:pre-wrap">${erEsc(r.descricao) || '—'}</div></div>
            ${(() => { const fs = parseFotos(r.foto); return fs.length ? `<div class="er-field" style="margin-bottom:14px"><label>Fotos do erro (${fs.length})</label><div style="display:flex;flex-wrap:wrap;gap:9px">${fs.map((u, i) => `<img class="er-thumb er-lb-thumb" data-idx="${i}" src="${erEsc(fotoSrc(u))}" alt="Foto do erro #${erEsc(r.idVenda)} — ${erEsc(r.nomeCard)}" title="Ampliar" loading="lazy">`).join('')}</div></div>` : ''; })()}
            ${podeDecidir
              ? `<div class="er-field" style="margin-bottom:6px"><label>Comentário *</label><textarea id="erRefabComentario" placeholder="Explique o motivo da decisão — obrigatório para aprovar ou reprovar."></textarea></div>`
              : `<div class="er-field"><label>Comentário do gestor</label><div class="er-readonly-block" style="white-space:pre-wrap">${erEsc(r.comentarioAprovacao) || '—'}</div></div>`}
          </div>
          <div class="er-modal-foot">
            <span class="er-save-msg" id="erSaveMsgRefab"></span>
            <button class="er-btn er-btn-ghost" id="erBtnFecharRefab">${podeDecidir ? 'Cancelar' : 'Fechar'}</button>
            ${podeDecidir ? `<button class="er-btn er-btn-bad" id="erBtnReprovar">Reprovar</button><button class="er-btn er-btn-accent" id="erBtnAprovar">Aprovar</button>` : ''}
            ${podeFinalizar ? `<button class="er-btn er-btn-accent" id="erBtnFinalizarRefab">Marcar como Finalizado</button>` : ''}
          </div>
        </div>
      </div>
    `;

    const _prevFocus = document.activeElement;
    const _untrap = trapFocus(modalRoot.querySelector('.er-modal'));
    const _onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const close = () => { if (_untrap) _untrap(); document.removeEventListener('keydown', _onKey, true); modalRoot.innerHTML = ''; if (_prevFocus && _prevFocus.focus) { try { _prevFocus.focus(); } catch (e) {} } };
    document.addEventListener('keydown', _onKey, true);
    document.getElementById('erCloseModalRefab').addEventListener('click', close);
    document.getElementById('erBtnFecharRefab').addEventListener('click', close);
    document.getElementById('erOverlayRefab').addEventListener('click', (e) => { if (e.target.id === 'erOverlayRefab') close(); });
    const _fotosRefab = parseFotos(r.foto);
    modalRoot.querySelectorAll('.er-lb-thumb').forEach((el) => el.addEventListener('click', () => openLightbox(_fotosRefab, Number(el.dataset.idx))));

    const decidir = async (decisao) => {
      const comentario = (document.getElementById('erRefabComentario').value || '').trim();
      if (!comentario) { markFieldErr(document.getElementById('erRefabComentario'), 'Obrigatório para aprovar ou reprovar.'); return; }
      const btns = modalRoot.querySelectorAll('.er-modal-foot button'); btns.forEach((b) => { b.disabled = true; });
      try {
        const res = await fetch('/erros/api/refab/decidir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, decisao, comentario }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erro desconhecido do servidor');
        r.aprovacaoRefab = decisao; r.comentarioAprovacao = comentario;
        toast('Refabricação ' + (decisao === 'Aprovado' ? 'aprovada' : 'reprovada') + '.', true);
        close(); erRender();
      } catch (err) {
        toast('Falha ao salvar decisão: ' + err.message, false);
        btns.forEach((b) => { b.disabled = false; });
      }
    };
    const btnAp = document.getElementById('erBtnAprovar'); if (btnAp) btnAp.addEventListener('click', () => decidir('Aprovado'));
    const btnRep = document.getElementById('erBtnReprovar'); if (btnRep) btnRep.addEventListener('click', () => decidir('Reprovado'));

    const btnFin = document.getElementById('erBtnFinalizarRefab');
    if (btnFin) btnFin.addEventListener('click', async () => {
      btnFin.disabled = true;
      const ok = await finalizarCasoRefab(r);
      if (ok) close(); else btnFin.disabled = false;
    });
  }

  /* ================= REUNIÃO SEMANAL · VENDAS/FÁBRICA ================= */
  /** Agrega os dados da reunião de uma semana (setores da cfg).
   *  Usado tanto pela tela quanto pelo relatório de impressão. */
  function reuniaoData(monday, setores) {
    setores = setores || SETORES_VENDAS;
    const daSemana = (mon) => RECORDS.filter((r) => setores.includes(r.setor) && mondayOf(r.date).getTime() === mon);
    const semanaAtual = daSemana(monday).filter((r) => r.auditado);
    const pendentesSemana = RECORDS.filter((r) => !r.auditado && setores.includes(r.setor) && mondayOf(r.date).getTime() === monday).length;
    const semanaAnterior = daSemana(monday - 7 * 86400000).filter((r) => r.auditado);

    const n = semanaAtual.length;
    const custoTotal = semanaAtual.reduce((a, r) => a + (r.custo || 0), 0);
    const nAnt = semanaAnterior.length;
    const custoAnt = semanaAnterior.reduce((a, r) => a + (r.custo || 0), 0);
    const deltaN = nAnt ? Math.round((n - nAnt) / nAnt * 100) : null;
    const deltaCusto = custoAnt ? Math.round((custoTotal - custoAnt) / custoAnt * 100) : null;

    const causaMap = {};
    semanaAtual.forEach((r) => { const k = r.subproblema || 'Não classificado'; if (!causaMap[k]) causaMap[k] = { nome: k, n: 0, custo: 0 }; causaMap[k].n++; causaMap[k].custo += (r.custo || 0); });
    const causasTop = Object.values(causaMap).sort((a, b) => b.custo - a.custo);

    const respMap = {};
    semanaAtual.forEach((r) => { const k = r.responsavel || 'Não informado'; if (!respMap[k]) respMap[k] = { nome: k, n: 0, custo: 0 }; respMap[k].n++; respMap[k].custo += (r.custo || 0); });
    const respTop = Object.values(respMap).sort((a, b) => b.custo - a.custo);

    const casosOrdenados = semanaAtual.slice().sort((a, b) => b.custo - a.custo);

    return { monday, sunday: sundayOf(monday), semanaAtual, pendentesSemana, n, custoTotal, deltaN, deltaCusto, causasTop, respTop, casosOrdenados };
  }

  /* ================= DADOS INCOMPLETOS (backfill de setor) ================= */
  function sugerirSetor(r) {
    const t = ((r.nomeCard || '') + ' ' + (r.descricao || '') + ' ' + (r.subproblema || '')).toLowerCase();
    if (/bordad|estamp|silk|costur|corte|refab|f[áa]bric|produ[çc]/.test(t)) return 'Fábrica';
    if (/layout|arte|design|vetor|mockup/.test(t)) return 'Dupla (Vendedor e Designer)';
    if (/vend|or[çc]ament|pedi|cliente pediu/.test(t)) return 'Vendas';
    return '';
  }
  async function salvarSetorBackfill(id, setor, rowEl, btn) {
    const r = RECORDS.find((x) => x.id === id); if (!r) return;
    try {
      const res = await fetch('/erros/api/set-setor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: id, setor }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
      r.setor = setor;
      derivarListasDinamicas(); erInitFilterOptions();
      toast('Setor de #' + r.idVenda + ' salvo: ' + setor, true);
      if (rowEl) {
        rowEl.style.transition = 'opacity .2s'; rowEl.style.opacity = '0';
        setTimeout(() => {
          rowEl.remove();
          const c = document.getElementById('erIncCount'); if (c) c.textContent = String(RECORDS.filter((x) => !x.setor).length);
          if (!RECORDS.filter((x) => !x.setor).length) { const m = document.getElementById('erMain'); if (m && erState.screen === 'incompletos') renderIncompletos(m); }
        }, 200);
      }
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
      toast('Não consegui salvar o setor: ' + e.message, false);
    }
  }
  function renderIncompletos(main) {
    if (!podeAuditar()) { main.innerHTML = '<div class="er-card er-empty"><div class="e-title">Sem permissão para editar setor</div></div>'; return; }
    const faltando = RECORDS.filter((r) => !r.setor).sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
    if (!faltando.length) { main.innerHTML = '<div class="er-card er-empty" style="padding:48px 20px"><div class="e-title">🎉 Tudo com setor preenchido!</div><div class="e-sub">Nenhum caso pendente de classificação de setor.</div></div>'; return; }
    main.innerHTML = `
      <div class="er-banner"><span class="b-ic">◑</span><div>
        <div class="b-title"><span id="erIncCount">${faltando.length}</span> caso(s) sem setor preenchido</div>
        <div class="b-text">O setor alimenta a Executiva, o Ranking e a Reunião de Vendas. Preencha aqui e o caso some da fila. A sugestão é só um palpite pelo texto — confira antes de salvar.</div>
      </div></div>
      <div class="er-card" style="padding:0">
        <div class="er-tbl-wrap"><table>
          <thead><tr><th>ID</th><th>Cliente / Card</th><th>Descrição</th><th style="width:230px">Setor</th><th style="width:98px"></th></tr></thead>
          <tbody>${faltando.map((r) => { const sug = sugerirSetor(r); return `<tr data-id="${r.id}">
            <td><span class="er-idchip">#${erEsc(r.idVenda)}</span></td>
            <td style="font-weight:600">${erEsc(r.nomeCard)}</td>
            <td style="max-width:340px;color:var(--text-muted);font-size:12.5px">${erEsc((r.descricao || '').slice(0, 120))}${(r.descricao || '').length > 120 ? '…' : ''}</td>
            <td><select class="inc-setor">${['<option value="">— selecione —</option>'].concat(SETOR_OPCOES.map((o) => `<option value="${erEsc(o)}" ${o === sug ? 'selected' : ''}>${erEsc(o)}</option>`)).join('')}</select>${sug ? `<div style="font-size:11px;color:var(--warn-text,var(--warn));margin-top:3px">💡 sugestão: <b>${erEsc(sug)}</b></div>` : ''}</td>
            <td><button class="er-btn er-btn-primary inc-save" style="padding:7px 12px">Salvar</button></td>
          </tr>`; }).join('')}</tbody>
        </table></div>
      </div>`;
    main.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = Number(tr.dataset.id), sel = tr.querySelector('.inc-setor'), btn = tr.querySelector('.inc-save');
      btn.addEventListener('click', () => { const v = sel.value; if (!v) { sel.focus(); sel.style.borderColor = 'var(--bad)'; return; } btn.disabled = true; btn.textContent = '…'; salvarSetorBackfill(id, v, tr, btn); });
    });
  }

  function renderReuniao(main, cfg) {
    cfg = cfg || REUNIOES.vendas;
    const d = reuniaoData(erState[cfg.stateKey], cfg.setores);
    const { monday, sunday, n, custoTotal, deltaN, deltaCusto, causasTop, respTop, casosOrdenados, pendentesSemana } = d;

    const nav = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:14px">
          <button class="er-iconbtn" id="erSemanaPrev" title="Semana anterior">←</button>
          <div style="text-align:center">
            <div style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Semana</div>
            <div style="font-size:18px;font-weight:800;color:var(--text)">${fmtDM(new Date(monday))} a ${fmtDM(sunday)}</div>
          </div>
          <button class="er-iconbtn" id="erSemanaNext" title="Próxima semana">→</button>
        </div>
        <button class="er-btn er-btn-primary" id="erBtnPdf" ${n === 0 ? 'disabled style="opacity:.5"' : ''}>⤓ Exportar PDF</button>
      </div>
    `;

    const bindNav = () => {
      document.getElementById('erSemanaPrev').addEventListener('click', () => { erState[cfg.stateKey] -= 7 * 86400000; erRender(); });
      document.getElementById('erSemanaNext').addEventListener('click', () => { erState[cfg.stateKey] += 7 * 86400000; erRender(); });
      const bap = document.getElementById('erBtnPdf'); if (bap && n > 0) bap.addEventListener('click', () => exportarPDF(erState[cfg.stateKey], cfg));
    };

    if (n === 0) {
      main.innerHTML = nav + `<div class="er-card er-empty"><div class="e-title">Nenhum erro de ${erEsc(cfg.short)} auditado nesta semana</div><div class="e-sub">${pendentesSemana > 0 ? pendentesSemana + ' caso(s) ainda pendente(s) de auditoria nesta semana.' : 'Use as setas pra navegar até uma semana com dado, ou é uma boa notícia mesmo.'}</div></div>`;
      bindNav();
      return;
    }

    const causaDestaque = causasTop[0];
    const comFoto = casosOrdenados.filter((r) => parseFotos(r.foto).length).length;
    const arrow = (delta) => delta === null ? '' : delta > 0 ? `<span style="color:var(--bad-text,var(--bad))">▲ ${delta}% vs semana anterior</span>` : delta < 0 ? `<span style="color:var(--ok-text,var(--ok))">▼ ${Math.abs(delta)}% vs semana anterior</span>` : `<span style="color:var(--text-muted)">igual à semana anterior</span>`;
    const maxCustoResp = respTop.length ? respTop[0].custo : 0;

    main.innerHTML = nav + `
      ${pendentesSemana > 0 ? `<div class="er-banner red"><span class="b-ic">!</span><div><div class="b-title">${pendentesSemana} caso(s) de ${erEsc(cfg.short)} ainda pendente(s) de auditoria nesta semana</div><div class="b-text">Não entram nos números abaixo. Vale fechar antes da reunião.</div></div></div>` : ''}

      <div class="er-metrics">
        <div class="er-metric hero"><div class="m-top"><span class="m-ic">▦</span><span class="m-label">Erros de ${erEsc(cfg.short)} na semana</span></div><div class="m-value">${n}</div><div class="m-foot">${arrow(deltaN)}</div></div>
        <div class="er-metric"><div class="m-top"><span class="m-ic ic-amber">◈</span><span class="m-label">Custo total da semana</span></div><div class="m-value">${brl(custoTotal)}</div><div class="m-foot">${arrow(deltaCusto)}</div></div>
        <div class="er-metric"><div class="m-top"><span class="m-ic ic-green">◆</span><span class="m-label">Causa em destaque</span></div><div class="m-value sm">${erEsc(causaDestaque.nome)}</div><div class="m-foot">${causaDestaque.n} caso(s) · ${brl(causaDestaque.custo)}</div></div>
        <div class="er-metric"><div class="m-top"><span class="m-ic ic-blue">◉</span><span class="m-label">Casos com foto</span></div><div class="m-value">${comFoto}<span style="font-size:16px;color:var(--text-muted);font-weight:600"> / ${n}</span></div><div class="m-foot">aparecem com imagem no PDF</div></div>
      </div>

      <div class="er-grid er-grid-2col">
        <div class="er-card">
          <h3>Top causas da semana</h3>
          <div class="er-card-sub">Ordenado por custo — onde uma ação de processo rende mais.</div>
          <div style="margin-top:10px">
            ${causasTop.slice(0, 5).map((c, i) => `<div class="er-legend-row"><span class="er-rank ${i === 0 ? 'top' : ''}">${i + 1}</span><span style="margin-left:10px">${erEsc(c.nome)}</span><b style="margin-left:auto">${brl(c.custo)}</b><span style="color:var(--text-muted);margin-left:12px;min-width:70px;text-align:right">${c.n} caso(s)</span></div>`).join('')}
          </div>
        </div>
        <div class="er-card">
          <h3>${erEsc(cfg.respLabel)}</h3>
          <div class="er-card-sub">${erEsc(cfg.respSub)}</div>
          <div style="margin-top:10px">
            ${respTop.slice(0, 6).map((c, i) => `<div class="er-legend-row"><span class="er-rank ${i === 0 ? 'top' : ''}">${i + 1}</span><span style="margin-left:10px;flex:1">${erEsc(c.nome)}</span><div class="er-mbar" style="max-width:150px;margin:0 10px"><div class="track"><div class="fill" style="width:${maxCustoResp ? Math.max(3, c.custo / maxCustoResp * 100) : 0}%;background:#2A6FDB"></div></div></div><b style="min-width:78px;text-align:right">${brl(c.custo)}</b></div>`).join('')}
          </div>
        </div>
      </div>

      <div class="er-card">
        <h3>Casos da semana — ${erEsc(cfg.short)}</h3>
        <div class="er-card-sub">Ordenado por custo. Clique numa linha pra ver o caso completo. A miniatura mostra se o caso tem foto.</div>
        <div class="er-tbl-wrap"><table>
          <thead><tr><th>Foto</th><th>ID</th><th>Responsável</th><th>Cliente / Card</th><th>Causa</th><th class="er-num">Custo</th><th>Tipo de resolução</th></tr></thead>
          <tbody>${casosOrdenados.map((r) => { const fs = parseFotos(r.foto); return `<tr class="er-clickable" data-id="${r.id}">
              <td>${fs.length ? `<img class="er-thumb-sm" src="${erEsc(fotoSrc(fs[0]))}" alt="" loading="lazy">` : `<span style="color:var(--text-hint);font-size:11px">sem foto</span>`}</td>
              <td><span class="er-idchip" data-copy="${erEsc(r.idVenda)}">#${erEsc(r.idVenda)}</span></td>
              <td style="font-weight:600">${erEsc(r.responsavel) || '—'}</td>
              <td>${erEsc(r.nomeCard)}</td>
              <td>${erEsc(r.subproblema) || '—'}</td>
              <td class="er-num">${brl(r.custo)}</td>
              <td>${erEsc(r.tipoResolucao) || '—'}</td>
            </tr>`; }).join('')}</tbody>
        </table></div>
      </div>
    `;

    bindNav();
    document.querySelectorAll('#erMain .er-idchip').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard?.writeText(el.dataset.copy); el.textContent = 'Copiado!'; setTimeout(() => { el.textContent = '#' + el.dataset.copy; }, 900); });
    });
    document.querySelectorAll('#erMain tr.er-clickable').forEach((tr) => { tr.addEventListener('click', () => openCaso(Number(tr.dataset.id))); });
    if (CASO_ATUAL !== null) highlightRow(CASO_ATUAL);
  }

  /* ================= RELATÓRIO PDF (Reunião) =================
     Monta um relatório imprimível em #erPrintRoot e dispara o print-to-PDF
     nativo do navegador (o usuário escolhe "Salvar como PDF" no diálogo de
     impressão). Fica sempre em paleta clara — ver @media print no erros.css. */
  function prArrow(delta) {
    if (delta === null) return '<span style="color:#8A9099">sem base da semana anterior</span>';
    if (delta > 0) return `<span style="color:#A62A23">▲ ${delta}% vs semana anterior</span>`;
    if (delta < 0) return `<span style="color:#15703D">▼ ${Math.abs(delta)}% vs semana anterior</span>`;
    return '<span style="color:#8A9099">igual à semana anterior</span>';
  }

  function buildPrintReport(d, cfg) {
    cfg = cfg || REUNIOES.vendas;
    const periodo = `${fmtDM(new Date(d.monday))} a ${fmtDM(d.sunday)}`;
    const comFoto = d.casosOrdenados.filter((r) => parseFotos(r.foto).length).length;
    const causa = d.causasTop[0] || { nome: '—', n: 0, custo: 0 };
    const maxResp = d.respTop.length ? (d.respTop[0].custo || 1) : 1;

    const kpis = `
      <div class="er-pr-kpis">
        <div class="er-pr-kpi accent"><div class="kl">Erros auditados</div><div class="kv">${d.n}</div><div class="kf">${prArrow(d.deltaN)}</div></div>
        <div class="er-pr-kpi accent"><div class="kl">Custo total</div><div class="kv">${brl(d.custoTotal)}</div><div class="kf">${prArrow(d.deltaCusto)}</div></div>
        <div class="er-pr-kpi"><div class="kl">Causa em destaque</div><div class="kv sm">${erEsc(causa.nome)}</div><div class="kf">${causa.n} caso(s) · ${brl(causa.custo)}</div></div>
        <div class="er-pr-kpi"><div class="kl">Casos com foto</div><div class="kv">${comFoto} / ${d.n}</div><div class="kf">imagens incluídas neste PDF</div></div>
      </div>`;

    const causas = `
      <div>
        <div class="er-pr-sec">Top causas da semana</div>
        <div class="er-pr-secsub">Ordenado por custo — onde uma ação de processo rende mais.</div>
        ${d.causasTop.slice(0, 6).map((c, i) => `<div class="er-pr-row"><span class="er-pr-rk ${i === 0 ? 'top' : ''}">${i + 1}</span><span class="er-pr-name">${erEsc(c.nome)}</span><span class="er-pr-cnt">${c.n} caso(s)</span><span class="er-pr-val">${brl(c.custo)}</span></div>`).join('')}
      </div>`;

    const ranking = `
      <div>
        <div class="er-pr-sec">${erEsc(cfg.respLabel)}</div>
        <div class="er-pr-secsub">Quem concentra o custo da semana. Mapa, não julgamento isolado.</div>
        ${d.respTop.slice(0, 7).map((c, i) => `<div class="er-pr-row"><span class="er-pr-rk ${i === 0 ? 'top' : ''}">${i + 1}</span><span class="er-pr-name">${erEsc(c.nome)}</span><span class="er-pr-bar"><i style="width:${Math.max(4, c.custo / maxResp * 100)}%;background:${i === 0 ? '#E0A400' : '#2A6FDB'}"></i></span><span class="er-pr-val">${brl(c.custo)}</span></div>`).join('')}
      </div>`;

    const cases = d.casosOrdenados.map((r, idx) => {
      const fs = parseFotos(r.foto);
      const photo = fs.length
        ? `<div class="er-pr-photo"><img src="${erEsc(fotoSrc(fs[0]))}" alt=""></div>`
        : `<div class="er-pr-photo"><span class="noimg">Sem foto</span></div>`;
      const desc = r.descricao ? `<div class="er-pr-cdesc">${erEsc(String(r.descricao).slice(0, 420))}</div>` : '';
      return `<div class="er-pr-case">
        ${photo}
        <div>
          <div class="er-pr-ckicker">Caso ${idx + 1} · ${erEsc(r.tipoResolucao) || 'Sem classificação'}</div>
          <div class="er-pr-ccause">${erEsc(r.subproblema) || 'Não classificado'}</div>
          <div class="er-pr-cclient">${erEsc(r.nomeCard)} · #${erEsc(r.idVenda)}</div>
          <div class="er-pr-ctags">
            <span class="er-pr-tag">Responsável <b>${erEsc(r.responsavel) || '—'}</b></span>
            <span class="er-pr-tag">Setor <b>${erEsc(r.setor) || '—'}</b></span>
            ${r.tipoProduto ? `<span class="er-pr-tag">Produto <b>${erEsc(r.tipoProduto)}</b></span>` : ''}
            ${r.empresa ? `<span class="er-pr-tag">Linha <b>${erEsc(r.empresa)}</b></span>` : ''}
          </div>
          <div class="er-pr-ccost">${brl(r.custo)} <small>de custo</small></div>
          ${desc}
        </div>
      </div>`;
    }).join('');

    return `
      <div class="er-pr-page">
        <div class="er-pr-brand">
          <span class="er-pr-badge">E</span>
          <span class="er-pr-bname">SeuBoné <span>· ${erEsc(cfg.nome)}</span></span>
          <span class="er-pr-period">${periodo}</span>
        </div>
        <h1 class="er-pr-title">Erros da Semana</h1>
        <div class="er-pr-sub">${d.n} caso(s) auditado(s) · ${brl(d.custoTotal)} em custo · foco em aprendizado, não em culpa.${d.pendentesSemana > 0 ? ` <b style="color:#A62A23">${d.pendentesSemana} caso(s) ainda pendente(s) — fora destes números.</b>` : ''}</div>
        ${kpis}
        <div class="er-pr-two">${causas}${ranking}</div>
        <div class="er-pr-cases-h">Casos da semana — ${erEsc(cfg.short)} (${d.casosOrdenados.length})</div>
        ${cases}
        <div class="er-pr-foot"><b>${d.n} erro(s) · ${brl(d.custoTotal)}</b> na semana ${periodo}.<br>${erEsc(cfg.foco)}</div>
      </div>`;
  }

  function exportarPDF(monday, cfg) {
    cfg = cfg || REUNIOES.vendas;
    const d = reuniaoData(monday, cfg.setores);
    if (d.n === 0) { toast('Sem casos de ' + cfg.short + ' auditados nesta semana para exportar.', false); return; }
    const root = document.getElementById('erPrintRoot');
    root.innerHTML = buildPrintReport(d, cfg);
    const btn = document.getElementById('erBtnPdf');
    const imgs = Array.from(root.querySelectorAll('img'));
    let pending = imgs.filter((im) => !im.complete).length;
    const go = () => { if (btn) { btn.textContent = '⤓ Exportar PDF'; btn.disabled = false; } setTimeout(() => window.print(), 50); };
    if (btn) { btn.textContent = 'Preparando…'; btn.disabled = true; }
    if (pending === 0) { go(); return; }
    let done = false; const finish = () => { if (done) return; done = true; go(); };
    imgs.forEach((im) => { if (im.complete) return;
      im.addEventListener('load', () => { if (--pending <= 0) finish(); });
      im.addEventListener('error', () => { if (--pending <= 0) finish(); });
    });
    setTimeout(finish, 3000); // não travar se o Drive demorar a responder
  }

  // limpa o relatório depois de imprimir/cancelar
  window.addEventListener('afterprint', () => { const r = document.getElementById('erPrintRoot'); if (r) r.innerHTML = ''; });

  /* ---------- Roteamento por hash (#/casos/:id) + drawer lateral ---------- */
  function parseCasoHash() { const m = (location.hash || '').match(/^#\/casos\/(-?\d+)/); return m ? Number(m[1]) : null; }
  function caseNavIds() { return Array.from(document.querySelectorAll('#erMain tr.er-clickable, #erMain .er-kcard')).map((t) => Number(t.dataset.id)); }
  function highlightRow(id) {
    document.querySelectorAll('tr.er-row-active').forEach((t) => t.classList.remove('er-row-active'));
    const tr = document.querySelector('#erMain tr.er-clickable[data-id="' + id + '"]');
    if (tr) { tr.classList.add('er-row-active'); tr.scrollIntoView({ block: 'nearest' }); }
  }

  let DRAWER_TRAP = null, DRAWER_PREVFOCUS = null;
  function openCaso(id) {
    if (parseCasoHash() === id) renderDrawer(id);
    else location.hash = '#/casos/' + id;
  }
  function closeDrawer(fromHash) {
    const root = document.getElementById('erModalRoot');
    const dr = root.querySelector('.er-drawer'), sc = root.querySelector('.er-drawer-scrim');
    CASO_ATUAL = null;
    if (DRAWER_TRAP) { DRAWER_TRAP(); DRAWER_TRAP = null; }
    if (DRAWER_PREVFOCUS && DRAWER_PREVFOCUS.focus) { try { DRAWER_PREVFOCUS.focus(); } catch (e) {} }
    DRAWER_PREVFOCUS = null;
    document.querySelectorAll('tr.er-row-active').forEach((t) => t.classList.remove('er-row-active'));
    if (dr) dr.classList.remove('show');
    if (sc) sc.classList.remove('show');
    setTimeout(() => { const el = document.getElementById('erModalRoot'); if (CASO_ATUAL === null && el && el.querySelector('.er-drawer')) el.innerHTML = ''; }, 240);
    if (!fromHash && parseCasoHash() !== null) history.pushState(null, '', '#/casos');
  }
  function syncFromHash() {
    const id = parseCasoHash();
    if (id !== null && RECORDS.find((x) => x.id === id)) renderDrawer(id);
    else closeDrawer(true);
  }
  window.addEventListener('hashchange', syncFromHash);
  document.addEventListener('keydown', (e) => { if (CASO_ATUAL !== null && e.key === 'Escape') closeDrawer(false); });

  /* Navegação por teclado enquanto o drawer está aberto: ↑/↓ (ou K/J) troca de caso pra anterior/próximo da lista atual. */
  document.addEventListener('keydown', (e) => {
    if (CASO_ATUAL === null) return;
    if (document.getElementById('erPalScrim')) return; // palette aberta tem prioridade
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // não conflitar com atalhos (ex: Ctrl+K)
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') { const n = document.getElementById('erDrwNext'); if (n && n.dataset.target) { e.preventDefault(); openCaso(Number(n.dataset.target)); } }
    else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') { const p = document.getElementById('erDrwPrev'); if (p && p.dataset.target) { e.preventDefault(); openCaso(Number(p.dataset.target)); } }
  });

  /* ===== Lightbox de fotos (Esc fecha, ← → navegam) ===== */
  let LB = { urls: [], idx: 0, prevFocus: null };
  function openLightbox(urls, i) {
    if (!urls || !urls.length) return;
    // Os links crus do Drive (.../view?usp=drivesdk) são página HTML, não
    // imagem — não dá pra colocar num <img src>. fotoSrc() já faz essa
    // conversão pra URL de thumbnail (é o que as miniaturas usam).
    LB.urls = urls.map(fotoSrc); LB.idx = Math.max(0, Math.min(urls.length - 1, i || 0)); LB.prevFocus = document.activeElement;
    let root = document.getElementById('erLbRoot');
    if (!root) { root = document.createElement('div'); root.id = 'erLbRoot'; document.body.appendChild(root); }
    lbRender();
  }
  function lbRender() {
    const root = document.getElementById('erLbRoot'); if (!root) return;
    const multi = LB.urls.length > 1;
    root.innerHTML = `<div class="er-lb-scrim" id="erLbScrim" role="dialog" aria-modal="true" aria-label="Visualizador de foto">
        <button class="er-lb-x" id="erLbClose" title="Fechar (Esc)" aria-label="Fechar">✕</button>
        ${multi ? `<button class="er-lb-nav er-lb-prev" id="erLbPrev" aria-label="Foto anterior">‹</button>` : ''}
        <img class="er-lb-img" src="${erEsc(LB.urls[LB.idx])}" alt="Foto ampliada ${LB.idx + 1} de ${LB.urls.length}">
        ${multi ? `<button class="er-lb-nav er-lb-next" id="erLbNext" aria-label="Próxima foto">›</button>` : ''}
        ${multi ? `<div class="er-lb-count">${LB.idx + 1} / ${LB.urls.length}</div>` : ''}
      </div>`;
    const sc = document.getElementById('erLbScrim');
    sc.addEventListener('click', (e) => { if (e.target === sc) closeLightbox(); });
    document.getElementById('erLbClose').addEventListener('click', closeLightbox);
    const p = document.getElementById('erLbPrev'), n = document.getElementById('erLbNext');
    if (p) p.addEventListener('click', () => lbGoto(LB.idx - 1));
    if (n) n.addEventListener('click', () => lbGoto(LB.idx + 1));
  }
  function lbGoto(i) { if (!LB.urls.length) return; LB.idx = (i + LB.urls.length) % LB.urls.length; lbRender(); }
  function closeLightbox() { const root = document.getElementById('erLbRoot'); if (root) root.innerHTML = ''; LB.urls = []; if (LB.prevFocus && LB.prevFocus.focus) { try { LB.prevFocus.focus(); } catch (e) {} } }
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('erLbScrim')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); lbGoto(LB.idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); lbGoto(LB.idx + 1); }
  }, true);

  /* ===== Focus trap p/ diálogos (drawer, modal) ===== */
  function trapFocus(container) {
    if (!container) return () => {};
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      const els = Array.from(container.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', handler);
    return () => { try { container.removeEventListener('keydown', handler); } catch (e) {} };
  }

  /** Monta o conteúdo interno do drawer (cabeçalho + corpo + rodapé). */
  function drawerInnerHTML(r) {
    const editable = !r.auditado && podeAuditar();
    const fieldOrSel = (opts, current) => opts.map((o) => `<option ${o === current ? 'selected' : ''}>${erEsc(o)}</option>`).join('');
    const resOptions = RESOLUCAO_TABLE.map((o) => `<option value="${erEsc(o.tipo)}" ${o.tipo === r.tipoResolucao ? 'selected' : ''}>${erEsc(o.tipo)}</option>`).join('');
    const causasConhecidas = Array.from(new Set(RECORDS.map((x) => x.subproblema).filter(Boolean)));

    const ids = caseNavIds(); const idx = ids.indexOf(r.id);
    const prevId = idx > 0 ? ids[idx - 1] : '';
    const nextId = (idx >= 0 && idx < ids.length - 1) ? ids[idx + 1] : '';
    const pos = idx >= 0 ? `${idx + 1} de ${ids.length}` : '';

    return `
      <div class="er-drawer-head">
        <div class="er-drawer-nav">
          <button class="er-navbtn" id="erDrwPrev" data-target="${prevId}" ${prevId === '' ? 'disabled' : ''} title="Caso anterior">↑</button>
          <button class="er-navbtn" id="erDrwNext" data-target="${nextId}" ${nextId === '' ? 'disabled' : ''} title="Próximo caso">↓</button>
          ${pos ? `<span style="font-size:11.5px;color:var(--text-muted);margin-left:4px;white-space:nowrap">${pos}</span>` : ''}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:800;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)">${erEsc(r.nomeCard)}</div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
            <span class="er-idchip" id="erIdCopy" data-copy="${erEsc(r.idVenda)}">#${erEsc(r.idVenda)}</span>
            ${statusBadge(r)}
            <span class="er-badge er-pill-muted">linha ${r.id} na planilha</span>
            ${r.linkPedido ? `<a href="${erEsc(r.linkPedido)}" target="_blank" rel="noopener" class="er-badge er-badge-link">Abrir pedido ↗</a>` : ''}
          </div>
        </div>
        <button class="er-close-btn" id="erDrwClose">✕</button>
      </div>
      <div class="er-drawer-body">
        <div class="er-sec-title">Status do caso</div>
        ${podeAuditar()
          ? `<div class="er-status-seg" style="margin-bottom:18px">${STATUS_DEF.map((sd) => `<button class="er-stbtn ${effectiveStatus(r) === sd.key ? 'on' : ''}" data-status="${sd.key}" style="--c:${sd.cor}">${sd.label}</button>`).join('')}</div>`
          : `<div style="margin-bottom:18px">${statusBadge(r)}</div>`}
        <div class="er-sec-title">Dados do registro</div>
        <div class="er-field-grid" style="margin-bottom:16px">
          <div class="er-field"><label>Data de registro</label><div class="er-readonly-block">${fmtDate(r.date)}</div></div>
          <div class="er-field"><label>Quem cadastrou o erro</label><div class="er-readonly-block">${erEsc(r.quemCadastrou)}</div></div>
        </div>
        <div class="er-field" style="margin-bottom:20px"><label>Descrição do erro</label><div class="er-readonly-block" style="font-style:italic">${erEsc(r.descricao) || '—'}</div></div>
        ${(() => { const fs = parseFotos(r.foto); return fs.length ? `<div class="er-field" style="margin-bottom:20px"><label>Fotos do erro (${fs.length})</label><div style="display:flex;flex-wrap:wrap;gap:9px">${fs.map((u, i) => `<img class="er-thumb er-lb-thumb" data-idx="${i}" src="${erEsc(fotoSrc(u))}" alt="Foto do erro #${erEsc(r.idVenda)} — ${erEsc(r.nomeCard)}" title="Ampliar" loading="lazy">`).join('')}</div></div>` : ''; })()}

        <div class="er-sec-title">Auditoria ${editable ? '<span class="er-badge er-pill-warn">preencher agora</span>' : (r.auditado ? '<span class="er-badge er-pill-muted">já registrada</span>' : '<span class="er-badge er-pill-muted">somente leitura</span>')}</div>
        <form id="erFormAuditoria">
          <div class="er-field-grid" style="margin-bottom:14px">
            <div class="er-field"><label>Setor do problema *</label>${editable ? `<select name="setor"><option value="" ${!r.setor ? 'selected' : ''}>— selecione —</option>${fieldOrSel(SETOR_OPCOES, r.setor)}</select>` : `<div class="er-readonly-block">${erEsc(r.setor) || '—'}</div>`}</div>
            <div class="er-field"><label>Responsável</label>${editable ? `<input name="responsavel" list="erRespList" value="${erEsc(r.responsavel)}" placeholder="Nome do consultor ou 'Produção (Fábrica)'">` : `<div class="er-readonly-block">${erEsc(r.responsavel) || '—'}</div>`}</div>
          </div>
          <div class="er-field-grid" style="margin-bottom:14px">
            <div class="er-field"><label>Empresa</label>${editable ? `<select name="empresa"><option value="">—</option><option value="SeuBoné Matriz" ${r.empresa === 'SeuBoné Matriz' ? 'selected' : ''}>SeuBoné Matriz</option><option value="SeuBoné Filial" ${r.empresa === 'SeuBoné Filial' ? 'selected' : ''}>SeuBoné Filial</option></select>` : `<div class="er-readonly-block">${erEsc(r.empresa) || '—'}</div>`}</div>
            <div class="er-field"><label>Tipo de produto</label>${editable ? `<input name="tipoProduto" list="erProdList" value="${erEsc(r.tipoProduto)}">` : `<div class="er-readonly-block">${erEsc(r.tipoProduto) || '—'}</div>`}</div>
            <div class="er-field"><label>Linha do produto</label>${editable ? `<select name="linha"><option value="">—</option>${fieldOrSel(LINHA_PRODUTO_OPCOES, r.linha)}</select>` : `<div class="er-readonly-block">${erEsc(r.linha) || '—'}</div>`}</div>
          </div>
          <div class="er-field-grid" style="margin-bottom:14px">
            <div class="er-field"><label>Tipo de problema (causa)</label>${editable ? `<input name="tipoProblema" list="erSubList" value="${erEsc(r.subproblema)}" placeholder="Ex: Folha errada, Tonalidade do Silk...">` : `<div class="er-readonly-block">${erEsc(r.subproblema) || '—'}</div>`}</div>
            <div class="er-field"><label>Quantidade de produtos errados</label>${editable ? `<input type="number" name="qtd" value="${r.qtd ?? ''}" min="0">` : `<div class="er-readonly-block">${r.qtd ?? '—'}</div>`}</div>
            <datalist id="erSubList">${causasConhecidas.map((s) => `<option value="${erEsc(s)}">`).join('')}</datalist>
            <datalist id="erProdList">${TIPOS_PRODUTO.map((s) => `<option value="${erEsc(s)}">`).join('')}</datalist>
            <datalist id="erRespList">${RESPONSAVEL_SUGESTOES.map((s) => `<option value="${erEsc(s)}">`).join('')}</datalist>
          </div>
          <div class="er-field" style="margin-bottom:14px">
            <label>Que fim teve o pedido?</label>${editable ? `<select name="queFim">${fieldOrSel(QUE_FIM_LIST, r.queFim)}</select>` : `<div class="er-readonly-block">${erEsc(r.queFim) || '—'}</div>`}
          </div>
          <div class="er-field-grid" style="margin-bottom:6px">
            <div class="er-field"><label>Tipo de resolução</label>${editable ? `<select name="tipoResolucao" id="erSelResolucao">${resOptions}</select>` : `<div class="er-readonly-block">${erEsc(r.tipoResolucao) || '—'}</div>`}</div>
            <div class="er-field"><label>Custo do erro (R$)</label>${editable ? `<input type="number" name="custo" id="erInpCusto" value="${r.custo ?? ''}" min="0">` : `<div class="er-readonly-block">${brl(r.custo)}</div>`}</div>
          </div>
          <div class="er-logica-box" id="erLogicaBox">${r.tipoResolucao ? getRes(r.tipoResolucao).logica : 'Selecione o tipo de resolução.'}</div>
        </form>

        <div class="er-sec-title" style="margin-top:24px">Histórico</div>
        <div id="erHistBox" class="er-hist-box">Carregando…</div>
      </div>
      <div class="er-drawer-foot">
        <span class="er-save-msg" id="erSaveMsg"></span>
        <button class="er-btn er-btn-ghost" id="erDrwFechar">Fechar</button>
        ${editable ? `<button class="er-btn er-btn-primary" id="erBtnSalvar">Salvar auditoria</button>` : ''}
      </div>
    `;
  }

  async function carregarHistorico(rowIndex) {
    const box = document.getElementById('erHistBox');
    if (!box) return;
    if (!rowIndex || rowIndex < 0) {
      box.innerHTML = '<div class="er-hist-empty">Sem histórico disponível para este caso.</div>';
      return;
    }
    try {
      const res = await fetch('/erros/api/historico?rowIndex=' + encodeURIComponent(rowIndex));
      const json = await res.json();
      if (CASO_ATUAL !== rowIndex) return;
      const evs = (json && json.ok && json.eventos) ? json.eventos : [];
      if (!evs.length) {
        box.innerHTML = '<div class="er-hist-empty">Nenhum evento ainda. Mudanças de status, auditoria e registro passam a aparecer aqui.</div>';
        return;
      }
      const groups = []; const idxByDay = {};
      evs.forEach((ev) => {
        const q = String(ev.quando || '').trim();
        const day = (q.split(/[ T]/)[0]) || 'Sem data';
        if (idxByDay[day] === undefined) { idxByDay[day] = groups.length; groups.push({ day, items: [] }); }
        groups[idxByDay[day]].items.push(ev);
      });
      const horaDe = (q) => { const p = String(q || '').split(/[ T]/); return (p[1] || '').replace(/:\d{2}$/, ''); };
      box.innerHTML = groups.map((g) => `<div class="er-hist-day">${erEsc(g.day)}</div>` + g.items.map((ev) => `<div class="er-hist-item">
        <div class="er-hist-dot"></div>
        <div class="er-hist-content">
          <div class="er-hist-line"><b>${erEsc(ev.acao)}</b>${ev.detalhe ? ' — ' + erEsc(ev.detalhe) : ''}</div>
          <div class="er-hist-meta">${erEsc(ev.usuario) || '—'}${horaDe(ev.quando) ? ' · ' + erEsc(horaDe(ev.quando)) : ''}</div>
        </div>
      </div>`).join('')).join('');
    } catch (e) {
      if (CASO_ATUAL === rowIndex) box.innerHTML = '<div class="er-hist-empty">Não consegui carregar o histórico agora.</div>';
    }
  }

  function renderDrawer(id) {
    const r = RECORDS.find((x) => x.id === id);
    if (!r) { closeDrawer(true); return; }
    CASO_ATUAL = id;
    const root = document.getElementById('erModalRoot');
    const existing = root.querySelector('.er-drawer');
    const html = drawerInnerHTML(r);
    if (existing) {
      existing.innerHTML = html;
    } else {
      DRAWER_PREVFOCUS = document.activeElement;
      root.innerHTML = `<div class="er-drawer-scrim" id="erDrawerScrim"></div><div class="er-drawer" id="erDrawer" role="dialog" aria-modal="true" aria-label="Detalhe do caso">${html}</div>`;
      const scrim = document.getElementById('erDrawerScrim');
      const dr = document.getElementById('erDrawer');
      scrim.addEventListener('click', () => closeDrawer(false));
      void dr.offsetWidth;
      scrim.classList.add('show'); dr.classList.add('show');
      DRAWER_TRAP = trapFocus(dr);
      setTimeout(() => { const f = dr.querySelector('.er-close-btn'); if (f) try { f.focus(); } catch (e) {} }, 60);
    }
    wireDrawer(r);
    highlightRow(id);
  }

  function wireDrawer(r) {
    const editable = !r.auditado && podeAuditar();
    const $ = (i) => document.getElementById(i);
    carregarHistorico(r.id);
    const _fotos = parseFotos(r.foto).map(fotoSrc);
    document.querySelectorAll('.er-drawer .er-lb-thumb').forEach((el) => el.addEventListener('click', () => openLightbox(_fotos, Number(el.dataset.idx))));
    $('erDrwClose').addEventListener('click', () => closeDrawer(false));
    const fechar = $('erDrwFechar'); if (fechar) fechar.addEventListener('click', () => closeDrawer(false));
    const idCopy = $('erIdCopy'); if (idCopy) idCopy.addEventListener('click', () => { navigator.clipboard?.writeText(String(r.idVenda)); idCopy.textContent = 'Copiado!'; setTimeout(() => { idCopy.textContent = '#' + r.idVenda; }, 900); });
    const prev = $('erDrwPrev'), next = $('erDrwNext');
    if (prev) prev.addEventListener('click', () => { if (prev.dataset.target) openCaso(Number(prev.dataset.target)); });
    if (next) next.addEventListener('click', () => { if (next.dataset.target) openCaso(Number(next.dataset.target)); });
    document.querySelectorAll('.er-drawer .er-stbtn').forEach((b) => b.addEventListener('click', () => setCaseStatus(r, b.dataset.status)));

    if (editable) {
      const selRes = $('erSelResolucao');
      selRes.addEventListener('change', () => { $('erLogicaBox').textContent = getRes(selRes.value).logica; });
      $('erBtnSalvar').addEventListener('click', async () => {
        const fd = new FormData($('erFormAuditoria'));
        const tipoResolucao = fd.get('tipoResolucao');
        clearFieldErrs($('erFormAuditoria'));
        const setorSel = $('erFormAuditoria').querySelector('[name="setor"]');
        if (!String(fd.get('setor') || '').trim()) { markFieldErr(setorSel, 'Informe o setor do problema'); if (setorSel) setorSel.focus(); return; }
        if (!tipoResolucao) { markFieldErr(selRes, 'Selecione o tipo de resolução'); selRes.focus(); return; }
        const custoNum = Number(fd.get('custo') || 0), qtdNum = Number(fd.get('qtd') || 0);
        const msg = $('erSaveMsg');
        if (isNaN(custoNum) || custoNum < 0) { markFieldErr($('erInpCusto'), 'Custo inválido'); msg.textContent = 'Custo inválido.'; return; }
        if (isNaN(qtdNum) || qtdNum < 0) { markFieldErr($('erFormAuditoria').querySelector('[name="qtd"]'), 'Quantidade inválida'); msg.textContent = 'Quantidade inválida.'; return; }
        const fields = {
          setor: fd.get('setor'), responsavel: fd.get('responsavel'),
          empresa: fd.get('empresa'), tipoProduto: fd.get('tipoProduto'), tipoProblema: fd.get('tipoProblema'),
          linha: fd.get('linha'),
          qtd: qtdNum, custo: custoNum, queFim: fd.get('queFim'), tipoResolucao,
        };
        const btn = $('erBtnSalvar');
        btn.disabled = true; msg.textContent = 'Gravando…';
        try {
          const res = await fetch('/erros/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, fields }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
          Object.assign(r, { setor: fields.setor, responsavel: fields.responsavel, empresa: fields.empresa,
            tipoProduto: fields.tipoProduto, subproblema: fields.tipoProblema, linha: fields.linha, qtd: fields.qtd, custo: fields.custo,
            queFim: fields.queFim, tipoResolucao: fields.tipoResolucao, auditado: true, status: 'resolvido' });
          derivarListasDinamicas(); erInitFilterOptions();
          closeDrawer(false); erRender();
          toast('Auditoria salva', true);
        } catch (err) {
          msg.textContent = 'Erro: ' + err.message + ' — confira a conexão e tente de novo.'; btn.disabled = false;
        }
      });
    }
  }

  /* ================= NOVO CASO ================= */
  function openNovoCaso() {
    if (!podeRegistrar()) return;
    const modalRoot = document.getElementById('erModalRoot');
    const cadastradores = CADASTRADOR_SUGESTOES;
    const responsaveis = RESPONSAVEL_SUGESTOES;
    const causas = Array.from(new Set(RECORDS.map((r) => r.subproblema).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const detalhes = Array.from(new Set(RECORDS.map((r) => r.detalhe).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const optVazia = '<option value="">—</option>';
    const selOptions = (arr) => optVazia + arr.map((o) => `<option value="${erEsc(o)}">${erEsc(o)}</option>`).join('');
    const resOptions = optVazia + RESOLUCAO_TABLE.map((o) => `<option value="${erEsc(o.tipo)}">${erEsc(o.tipo)}</option>`).join('');

    modalRoot.innerHTML = `
      <div class="er-overlay" id="erOverlayNovo">
        <div class="er-modal" role="dialog" aria-modal="true" aria-label="Registrar novo erro">
          <div class="er-modal-head">
            <div style="flex:1;min-width:0">
              <div class="title">Registrar novo erro</div>
              <div class="sub">Preencha o que souber. Se deixar a <b>classificação</b> em branco, o caso entra como <b>pendente de auditoria</b> e você completa depois em "Casos / Auditoria".</div>
            </div>
            <button class="er-close-btn" id="erCloseModalNovo">✕</button>
          </div>
          <div class="er-modal-body">
            <form id="erFormNovo">
              <div class="er-sec-title">Dados do erro <span class="er-badge er-pill-warn">obrigatório</span></div>
              <div class="er-field-grid" style="margin-bottom:14px">
                <div class="er-field"><label>ID da venda *</label><input type="text" name="idVenda" id="erNIdVenda" placeholder="Ex: 87518"></div>
                <div class="er-field"><label>Nome do card / cliente *</label><input type="text" name="nomeCard" placeholder="Ex: Caroline Gouveia Recompra 3"></div>
              </div>
              <div class="er-field" style="margin-bottom:14px">
                <label>Descrição e solução do erro *</label>
                <textarea name="descricao" placeholder="O que aconteceu... e como foi/será resolvido."></textarea>
              </div>
              <div class="er-field-grid" style="margin-bottom:14px">
                <div class="er-field"><label>Quem está cadastrando *</label><input type="text" name="quemCadastrou" list="erCadastradorList" placeholder="Seu nome"></div>
                <div class="er-field"><label>Link do pedido *</label><input type="url" name="linkPedido" placeholder="https://..."></div>
              </div>
              <div class="er-field" style="margin-bottom:14px">
                <label>Fotos do erro (opcional)</label>
                <div class="er-foto-drop" id="erFotoDrop"><b>Clique para adicionar fotos</b> ou arraste aqui</div>
                <input type="file" id="erFotoInput" accept="image/*" multiple style="display:none">
                <div class="er-foto-prev" id="erFotoPrev"></div>
              </div>

              <div class="er-sec-title" style="margin-top:20px">Classificação <span class="er-badge er-pill-warn">obrigatório</span></div>
              <div class="er-field er-setor-destaque" style="margin-bottom:14px">
                <label>Setor do problema *</label>
                <select name="setor">${selOptions(SETOR_OPCOES)}</select>
              </div>
              <div class="er-field-grid" style="margin-bottom:14px">
                <div class="er-field"><label>Responsável *</label><input name="responsavel" list="erRespList" placeholder="Nome do consultor ou 'Produção (Fábrica)'"></div>
                <div class="er-field"><label>Tipo de problema (causa) *</label><input name="tipoProblema" list="erCausaList" placeholder="Ex: Alinhamento, Qualidade do bordado..."></div>
              </div>
              <div class="er-field-grid" style="margin-bottom:14px">
                <div class="er-field"><label>Subproblema (detalhe)</label><input name="subproblema" list="erDetList" placeholder="Detalhe granular do problema"></div>
                <div class="er-field"><label>Quantidade de produtos errados</label><input type="number" name="qtd" min="0" placeholder="0"></div>
              </div>
              <div class="er-field" style="margin-bottom:6px">
                <label>Tipo de resolução</label><select name="tipoResolucao" id="erSelResolucaoNovo">${resOptions}</select>
              </div>
              <div class="er-logica-box" id="erLogicaBoxNovo">Empresa, tipo de produto, custo e "que fim teve o pedido" são preenchidos por quem faz a auditoria, em "Casos / Auditoria".</div>
            </form>
            <datalist id="erCadastradorList">${cadastradores.map((c) => `<option value="${erEsc(c)}">`).join('')}</datalist>
            <datalist id="erRespList">${responsaveis.map((c) => `<option value="${erEsc(c)}">`).join('')}</datalist>
            <datalist id="erCausaList">${causas.map((c) => `<option value="${erEsc(c)}">`).join('')}</datalist>
            <datalist id="erDetList">${detalhes.map((c) => `<option value="${erEsc(c)}">`).join('')}</datalist>
          </div>
          <div class="er-modal-foot">
            <span class="er-save-msg" id="erSaveMsgNovo"></span>
            <button class="er-btn er-btn-ghost" id="erBtnCancelarNovo">Cancelar</button>
            <button class="er-btn er-btn-accent" id="erBtnCriarCaso">Registrar erro</button>
          </div>
        </div>
      </div>
    `;

    const _prevFocus = document.activeElement;
    const _untrap = trapFocus(modalRoot.querySelector('.er-modal'));
    const _onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const close = () => { if (_untrap) _untrap(); document.removeEventListener('keydown', _onKey, true); modalRoot.innerHTML = ''; if (_prevFocus && _prevFocus.focus) { try { _prevFocus.focus(); } catch (e) {} } };
    document.addEventListener('keydown', _onKey, true);
    document.getElementById('erCloseModalNovo').addEventListener('click', close);
    document.getElementById('erBtnCancelarNovo').addEventListener('click', close);
    document.getElementById('erOverlayNovo').addEventListener('click', (e) => { if (e.target.id === 'erOverlayNovo') close(); });
    setTimeout(() => { const f = document.getElementById('erNIdVenda'); if (f) try { f.focus(); } catch (e) {} }, 60);

    const selResNovo = document.getElementById('erSelResolucaoNovo');
    selResNovo.addEventListener('change', () => { document.getElementById('erLogicaBoxNovo').textContent = selResNovo.value ? getRes(selResNovo.value).logica : 'Selecione o tipo de resolução para ver a lógica de custo.'; });

    // --- Fotos: seleção + compressão + preview ---
    const FOTOS = []; // data URLs (JPEG comprimido) prontas pra enviar
    const fotoDrop = document.getElementById('erFotoDrop');
    const fotoInput = document.getElementById('erFotoInput');
    const fotoPrev = document.getElementById('erFotoPrev');
    const renderPrev = () => {
      fotoPrev.innerHTML = FOTOS.map((u, i) => `<div class="fp"><img src="${u}" alt=""><button type="button" class="rm" data-i="${i}" title="Remover">✕</button></div>`).join('');
      fotoPrev.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { FOTOS.splice(Number(b.dataset.i), 1); renderPrev(); }));
      fotoDrop.innerHTML = FOTOS.length ? `<b>${FOTOS.length} foto(s) selecionada(s)</b> · clique para adicionar mais (até ${MAX_FOTOS})` : `<b>Clique para adicionar fotos</b> ou arraste aqui`;
    };
    const addFiles = async (files) => {
      for (const f of Array.from(files)) {
        if (FOTOS.length >= MAX_FOTOS) { toast('Máximo de ' + MAX_FOTOS + ' fotos', false); break; }
        try { FOTOS.push(await comprimirImagem(f)); } catch (err) { toast('Foto ignorada: ' + err.message, false); }
      }
      renderPrev();
    };
    fotoDrop.addEventListener('click', () => fotoInput.click());
    fotoInput.addEventListener('change', () => { addFiles(fotoInput.files); fotoInput.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => fotoDrop.addEventListener(ev, (e) => { e.preventDefault(); fotoDrop.style.borderColor = 'var(--gold)'; }));
    ['dragleave', 'drop'].forEach((ev) => fotoDrop.addEventListener(ev, (e) => { e.preventDefault(); fotoDrop.style.borderColor = ''; }));
    fotoDrop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

    document.getElementById('erBtnCriarCaso').addEventListener('click', async () => {
      const fd = new FormData(document.getElementById('erFormNovo'));
      const g = (k) => String(fd.get(k) || '').trim();
      const btnCriar = document.getElementById('erBtnCriarCaso');

      const idVenda = g('idVenda');
      const formNovo = document.getElementById('erFormNovo');
      const msg = document.getElementById('erSaveMsgNovo');
      clearFieldErrs(formNovo);
      const obrigatorios = [
        ['idVenda', 'Informe o ID da venda'], ['nomeCard', 'Informe o nome do card'],
        ['descricao', 'Descreva o erro'], ['quemCadastrou', 'Informe quem está cadastrando'],
        ['linkPedido', 'Informe o link do pedido'],
        ['setor', 'Escolha o setor do problema'], ['responsavel', 'Informe o responsável'],
        ['tipoProblema', 'Informe o tipo de problema'],
      ];
      let primeiroErro = null;
      obrigatorios.forEach(([n, txt]) => { const el = formNovo.querySelector('[name="' + n + '"]'); if (el && !el.value.trim()) { markFieldErr(el, txt); if (!primeiroErro) primeiroErro = el; } });
      if (primeiroErro) { primeiroErro.focus(); msg.textContent = 'Preencha os campos obrigatórios (*).'; return; }

      // Quantidade não pode ser negativa.
      const qtdNum = g('qtd') ? Number(g('qtd')) : '';
      if (qtdNum !== '' && (isNaN(qtdNum) || qtdNum < 0)) { markFieldErr(formNovo.querySelector('[name="qtd"]'), 'Quantidade inválida'); msg.textContent = 'Quantidade inválida.'; return; }

      // Aviso de ID duplicado — não bloqueia, mas confirma (clique de novo).
      const dups = RECORDS.filter((r) => String(r.idVenda) === idVenda).length;
      if (dups > 0 && btnCriar.dataset.dupok !== '1') {
        btnCriar.dataset.dupok = '1';
        msg.innerHTML = `<span style="color:var(--bad-text,var(--bad))">Já existe ${dups} caso(s) com o ID <b>#${erEsc(idVenda)}</b>. Se for outro erro do mesmo pedido, clique de novo para confirmar.</span>`;
        btnCriar.textContent = 'Registrar mesmo assim';
        return;
      }

      // Todo registro novo entra como "Novo" (pendente de auditoria) — NUNCA já auditado,
      // mesmo que setor/tipo de resolução venham preenchidos aqui (são só um rascunho;
      // quem audita confirma depois). Ver instrução da tarefa: auditado sempre nasce false.
      const fields = {
        idVenda, nomeCard: g('nomeCard'), descricao: g('descricao'), quemCadastrou: g('quemCadastrou'),
        linkPedido: g('linkPedido'), setor: g('setor'), responsavel: g('responsavel'),
        tipoProblema: g('tipoProblema'), subproblema: g('subproblema'),
        qtd: qtdNum, tipoResolucao: g('tipoResolucao'),
        auditoria: false, status: 'novo',
        fotos: FOTOS.slice(), // data URLs comprimidas; o servidor salva e grava o(s) link(s)
      };

      btnCriar.disabled = true; msg.textContent = 'Gravando…';
      try {
        const res = await fetch('/erros/api/criar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
        close();
        await erRefreshData(true);
        erState.screen = 'casos'; erState.casosView = 'pendentes';
        erRender();
        toast('Erro registrado como Novo — vai para a auditoria', true);
      } catch (err) {
        msg.textContent = 'Erro: ' + err.message + ' — confira a conexão e tente de novo.'; btnCriar.disabled = false;
      }
    });
  }

  /* ================= BUSCA GLOBAL (COMMAND PALETTE · Ctrl/Cmd+K) =================
     Disponível pros dois papéis — utilitário geral da tela Casos, não passa por podeAuditar(). */
  let PAL_SEL = 0, PAL_RESULTS = [];

  function palSearch(q) {
    q = q.trim().toLowerCase();
    let list = RECORDS.slice();
    if (q) {
      const terms = q.split(/\s+/);
      list = list.filter((r) => {
        const hay = (String(r.idVenda) + ' ' + (r.nomeCard || '') + ' ' + (r.empresa || '') + ' ' + (r.responsavel || '') + ' ' + (r.setor || '')).toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    } else {
      list = list.filter((r) => !r.auditado); // sem busca: mostra os pendentes primeiro
    }
    list.sort((a, b) => (a.auditado === b.auditado ? b.date - a.date : (a.auditado ? 1 : -1)));
    return list.slice(0, 30);
  }

  function renderPalette(q) {
    PAL_RESULTS = palSearch(q); PAL_SEL = 0;
    const listEl = document.getElementById('erPalList'); if (!listEl) return;
    if (!PAL_RESULTS.length) { listEl.innerHTML = `<div class="er-pal-empty">Nada encontrado${q ? ` para “${erEsc(q)}”` : ''}.</div>`; return; }
    listEl.innerHTML = PAL_RESULTS.map((r, i) => `<div class="er-pal-item ${i === 0 ? 'sel' : ''}" data-idx="${i}">
      <span class="pid">#${erEsc(r.idVenda)}</span>
      <span class="pname">${erEsc(r.nomeCard) || '(sem nome)'}</span>
      <span class="pmeta">${erEsc(r.empresa) || '—'} · ${erEsc(r.setor) || 's/ setor'}</span>
      ${statusBadge(r)}
    </div>`).join('');
    listEl.querySelectorAll('.er-pal-item').forEach((it) => {
      it.addEventListener('click', () => palOpen(Number(it.dataset.idx)));
      it.addEventListener('mousemove', () => palSelect(Number(it.dataset.idx)));
    });
  }

  function palSelect(i) { PAL_SEL = i; document.querySelectorAll('.er-pal-item').forEach((el, idx) => el.classList.toggle('sel', idx === i)); }
  function palOpen(i) { const r = PAL_RESULTS[i]; if (!r) return; closePalette(); erState.screen = 'casos'; erRender(); openCaso(r.id); }
  function ensurePalVisible() { const el = document.querySelectorAll('.er-pal-item')[PAL_SEL]; if (el) el.scrollIntoView({ block: 'nearest' }); }

  function openPalette() {
    if (document.getElementById('erPalScrim')) return;
    const el = document.createElement('div');
    el.className = 'er-pal-scrim'; el.id = 'erPalScrim';
    el.innerHTML = `<div class="er-palette" role="dialog" aria-label="Busca de casos">
        <input class="er-pal-input" id="erPalInput" placeholder="Buscar por ID, cliente, empresa ou responsável…" autocomplete="off" spellcheck="false">
        <div class="er-pal-list" id="erPalList"></div>
        <div class="er-pal-foot"><span>↑ ↓ navegar</span><span>↵ abrir</span><span>Esc fechar</span></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target.id === 'erPalScrim') closePalette(); });
    const input = document.getElementById('erPalInput');
    input.addEventListener('input', () => renderPalette(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (PAL_SEL < PAL_RESULTS.length - 1) { palSelect(PAL_SEL + 1); ensurePalVisible(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (PAL_SEL > 0) { palSelect(PAL_SEL - 1); ensurePalVisible(); } }
      else if (e.key === 'Enter') { e.preventDefault(); palOpen(PAL_SEL); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    });
    renderPalette('');
    input.focus();
  }
  function closePalette() { const el = document.getElementById('erPalScrim'); if (el) el.remove(); PAL_SEL = 0; }

  // Atalho global Ctrl/Cmd+K e botão "🔍 Buscar" da barra de filtros
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); document.getElementById('erPalScrim') ? closePalette() : openPalette(); }
  });

  /* ================= NAVEGAÇÃO / FILTROS (wiring, uma vez só) ================= */
  document.querySelectorAll('#er-nav button').forEach((btn) => {
    if (!podeVerTela(btn.dataset.view)) { btn.style.display = 'none'; return; }
    btn.addEventListener('click', () => { closeDrawer(false); SEL.clear(); selBar(); erState.screen = btn.dataset.view; erRender(); });
  });

  atualizarVisibilidadeFiltros();
  document.getElementById('erPeriodoTipo').addEventListener('change', (e) => { erState.periodoTipo = e.target.value; atualizarVisibilidadeFiltros(); erRender(); });
  document.getElementById('erPeriodo').addEventListener('change', (e) => { erState.periodo = e.target.value; erRender(); });
  document.getElementById('erMes').addEventListener('change', (e) => { erState.mes = e.target.value; erRender(); });
  document.getElementById('erSemana').addEventListener('change', (e) => { erState.semana = e.target.value; erRender(); });
  document.getElementById('erSetor').addEventListener('change', (e) => { erState.setor = e.target.value; erRender(); });
  document.getElementById('erEmpresa').addEventListener('change', (e) => { erState.empresa = e.target.value; erRender(); });
  document.getElementById('erBtnRefresh').addEventListener('click', () => erRefreshData(false));
  document.getElementById('erBtnNovoCaso').addEventListener('click', openNovoCaso);
  document.getElementById('erBtnBuscar').addEventListener('click', openPalette);

  // Re-renderiza os gráficos (cores lidas dos tokens) quando o tema global do hub muda.
  new MutationObserver(() => { if (document.getElementById('erMain').style.display !== 'none') erRender(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  /* ================= INÍCIO ================= */
  erBoot().then(syncFromHash);
})();
