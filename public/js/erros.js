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
  const TELAS_POR_PAPEL = { gestor: ['exec', 'causas', 'resp', 'casos'], colaborador: ['causas', 'casos'] };
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
  // Opções do campo único "Setor do problema" (absorve o antigo "Culpa de", por isso inclui "Cliente").
  const SETOR_OPCOES = ['Vendas', 'Fábrica', 'Dupla (Vendedor e Designer)', 'Escritório', 'Cliente'];
  const TIPOS_PRODUTO_PADRAO = ['Boné', 'Trucker', 'Americano', '5Port', 'New York', 'Dad Hat', 'Viseira', 'Bucket', 'Camisa', 'Neoprene'];
  const QUE_FIM_PADRAO = ['Entregue', 'Em estoque', 'Refabricado e entregue', 'Cancelado'];

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
    };
    document.getElementById('erPageTitle').textContent = TITLES[erState.screen][0];
    document.getElementById('erPageSub').textContent = TITLES[erState.screen][1];

    const main = document.getElementById('erMain');
    main.innerHTML = '';

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
      <div class="kc-top"><span class="kc-id">#${erEsc(r.idVenda)}</span>${!r.auditado ? ageBadge(r) : ''}</div>
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

    const podeSel = podeAuditar();
    const layout = erState.casosLayout === 'kanban' ? 'kanban' : 'lista';

    const listCard = `
      <div class="er-card">
        <div class="er-card-head"><div><h3>Casos registrados</h3><div class="er-card-sub">Clique em uma linha pra abrir o caso; clique no cabeçalho pra ordenar.${podeSel ? '' : ' <b>Somente leitura</b> — você pode ver os casos, mas não auditar.'}</div></div></div>
        <div class="er-tbl-wrap"><table>
          <thead><tr>${th('id', 'ID')}${th('nome', 'Cliente / Card')}${th('data', 'Data')}${th('idade', 'Idade')}${th('setor', 'Setor')}${th('resp', 'Responsável')}${th('custo', 'Custo', true)}${th('status', 'Status')}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="er-clickable" data-id="${r.id}">
              <td><span class="er-idchip" data-copy="${erEsc(r.idVenda)}">#${erEsc(r.idVenda)}</span></td>
              <td style="font-weight:600">${erEsc(r.nomeCard)}</td>
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
        <button class="er-chip ${erState.casosView === 'todos' ? 'on' : ''}" data-view="todos">Todos</button>
        <button class="er-chip ${erState.casosView === 'pendentes' ? 'on' : ''}" data-view="pendentes">Pendentes</button>
        <button class="er-chip ${erState.casosView === 'parados7' ? 'on' : ''}" data-view="parados7">Parados +7d</button>
        <button class="er-chip ${erState.casosView === 'altoCusto' ? 'on' : ''}" data-view="altoCusto">Alto custo</button>
        <span style="flex:1"></span>
        <input class="er-searchbar" id="erBuscaCaso" placeholder="Buscar ID, cliente ou consultor…" value="${erEsc(erState.buscaCaso)}">
        <div class="er-seg-toggle">
          <button class="seg ${layout === 'lista' ? 'on' : ''}" data-layout="lista">☰ Lista</button>
          <button class="seg ${layout === 'kanban' ? 'on' : ''}" data-layout="kanban">▦ Kanban</button>
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
    document.querySelectorAll('.er-seg-toggle .seg').forEach((b) => b.addEventListener('click', () => { erState.casosLayout = b.dataset.layout; erRender(); }));

    if (layout === 'kanban') { wireKanban(); return; }

    document.querySelectorAll('th.er-sortable').forEach((thEl) => { thEl.addEventListener('click', () => { toggleSort(thEl.dataset.sort); erRender(); }); });
    document.querySelectorAll('.er-idchip').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard?.writeText(el.dataset.copy); el.textContent = 'Copiado!'; setTimeout(() => { el.textContent = '#' + el.dataset.copy; }, 900); });
    });
    document.querySelectorAll('tr.er-clickable').forEach((tr) => { tr.addEventListener('click', () => { openCaso(Number(tr.dataset.id)); }); });
    if (CASO_ATUAL !== null) highlightRow(CASO_ATUAL);
  }

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

  /* ===== Lightbox de fotos (Esc fecha, ← → navegam) ===== */
  let LB = { urls: [], idx: 0, prevFocus: null };
  function openLightbox(urls, i) {
    if (!urls || !urls.length) return;
    LB.urls = urls; LB.idx = Math.max(0, Math.min(urls.length - 1, i || 0)); LB.prevFocus = document.activeElement;
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
        <img class="er-lb-img" src="${LB.urls[LB.idx]}" alt="Foto ampliada ${LB.idx + 1} de ${LB.urls.length}">
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
            <div class="er-field"><label>Responsável</label>${editable ? `<input name="responsavel" value="${erEsc(r.responsavel)}" placeholder="Nome do consultor ou 'Produção (Fábrica)'">` : `<div class="er-readonly-block">${erEsc(r.responsavel) || '—'}</div>`}</div>
          </div>
          <div class="er-field-grid" style="margin-bottom:14px">
            <div class="er-field"><label>Empresa</label>${editable ? `<select name="empresa"><option value="">—</option><option value="ACM" ${r.empresa === 'ACM' ? 'selected' : ''}>ACM</option><option value="ITC" ${r.empresa === 'ITC' ? 'selected' : ''}>ITC</option></select>` : `<div class="er-readonly-block">${erEsc(r.empresa) || '—'}</div>`}</div>
            <div class="er-field"><label>Tipo de produto</label>${editable ? `<input name="tipoProduto" list="erProdList" value="${erEsc(r.tipoProduto)}">` : `<div class="er-readonly-block">${erEsc(r.tipoProduto) || '—'}</div>`}</div>
          </div>
          <div class="er-field-grid" style="margin-bottom:14px">
            <div class="er-field"><label>Tipo de problema (causa)</label>${editable ? `<input name="tipoProblema" list="erSubList" value="${erEsc(r.subproblema)}" placeholder="Ex: Folha errada, Tonalidade do Silk...">` : `<div class="er-readonly-block">${erEsc(r.subproblema) || '—'}</div>`}</div>
            <div class="er-field"><label>Quantidade de produtos errados</label>${editable ? `<input type="number" name="qtd" value="${r.qtd ?? ''}" min="0">` : `<div class="er-readonly-block">${r.qtd ?? '—'}</div>`}</div>
            <datalist id="erSubList">${causasConhecidas.map((s) => `<option value="${erEsc(s)}">`).join('')}</datalist>
            <datalist id="erProdList">${TIPOS_PRODUTO.map((s) => `<option value="${erEsc(s)}">`).join('')}</datalist>
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
          qtd: qtdNum, custo: custoNum, queFim: fd.get('queFim'), tipoResolucao,
        };
        const btn = $('erBtnSalvar');
        btn.disabled = true; msg.textContent = 'Gravando…';
        try {
          const res = await fetch('/erros/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, fields }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
          Object.assign(r, { setor: fields.setor, responsavel: fields.responsavel, empresa: fields.empresa,
            tipoProduto: fields.tipoProduto, subproblema: fields.tipoProblema, qtd: fields.qtd, custo: fields.custo,
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
    const cadastradores = Array.from(new Set(RECORDS.map((r) => r.quemCadastrou).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const responsaveis = Array.from(new Set(RECORDS.map((r) => r.responsavel).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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
                <div class="er-field"><label>Link do pedido (opcional)</label><input type="url" name="linkPedido" placeholder="https://..."></div>
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

  /* ================= NAVEGAÇÃO / FILTROS (wiring, uma vez só) ================= */
  document.querySelectorAll('#er-nav button').forEach((btn) => {
    if (!podeVerTela(btn.dataset.view)) { btn.style.display = 'none'; return; }
    btn.addEventListener('click', () => { closeDrawer(false); erState.screen = btn.dataset.view; erRender(); });
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

  // Re-renderiza os gráficos (cores lidas dos tokens) quando o tema global do hub muda.
  new MutationObserver(() => { if (document.getElementById('erMain').style.display !== 'none') erRender(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  /* ================= INÍCIO ================= */
  erBoot().then(syncFromHash);
})();
