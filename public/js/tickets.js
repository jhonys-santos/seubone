// Painel de Ticket — acompanhamento de tickets (pedido atrasado,
// refabricação, erro de envio) com tempo de abertura/fechamento e TMR
// (tempo médio de resolução). Mesma receita do Painel de Erros: uma rota
// só, "telas" trocadas por JS, Google Sheets + Apps Script por trás.

(function () {
  'use strict';

  function tkEsc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ================= ANEXOS (Drive / data URL) — mesma receita do Painel de Erros ================= */
  const MAX_FOTOS = 6;
  const MAX_ANEXOS_MB = 15;

  function tkParseFotos(v) {
    return String(v || '').split(/\n+/).flatMap((line) => line.split(',').map((s) => s.trim())).filter(Boolean);
  }
  function tkFotoSrc(u) {
    u = String(u || '');
    if (/^data:|^blob:/.test(u)) return u;
    if (/drive\.google|docs\.google|googleusercontent/.test(u)) {
      const m = u.match(/[-\w]{25,}/);
      if (m) return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w1600';
    }
    return u;
  }
  /** Lê um File de imagem, redimensiona (máx ~1280px) e devolve um JPEG data URL leve. */
  function tkComprimirImagem(file, maxDim = 1280, quality = 0.82) {
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
  function tkPhotoBadge(r) {
    const n = tkParseFotos(r.anexos).length;
    return n ? `<span class="tk-photo-badge" title="${n} anexo(s)">📎 ${n}</span>` : '';
  }

  /* ===== Lightbox de fotos (Esc fecha, ← → navegam) ===== */
  let TK_LB = { urls: [], idx: 0, prevFocus: null };
  function tkOpenLightbox(urls, i) {
    if (!urls || !urls.length) return;
    TK_LB.urls = urls.map(tkFotoSrc); TK_LB.idx = Math.max(0, Math.min(urls.length - 1, i || 0)); TK_LB.prevFocus = document.activeElement;
    let root = document.getElementById('tkLbRoot');
    if (!root) { root = document.createElement('div'); root.id = 'tkLbRoot'; document.body.appendChild(root); }
    tkLbRender();
  }
  function tkLbRender() {
    const root = document.getElementById('tkLbRoot'); if (!root) return;
    const multi = TK_LB.urls.length > 1;
    root.innerHTML = `<div class="tk-lb-scrim" id="tkLbScrim" role="dialog" aria-modal="true" aria-label="Visualizador de anexo">
        <button class="tk-lb-x" id="tkLbClose" title="Fechar (Esc)" aria-label="Fechar">✕</button>
        ${multi ? `<button class="tk-lb-nav tk-lb-prev" id="tkLbPrev" aria-label="Anterior">‹</button>` : ''}
        <img class="tk-lb-img" src="${tkEsc(TK_LB.urls[TK_LB.idx])}" alt="Anexo ${TK_LB.idx + 1} de ${TK_LB.urls.length}">
        ${multi ? `<button class="tk-lb-nav tk-lb-next" id="tkLbNext" aria-label="Próximo">›</button>` : ''}
        ${multi ? `<div class="tk-lb-count">${TK_LB.idx + 1} / ${TK_LB.urls.length}</div>` : ''}
      </div>`;
    const sc = document.getElementById('tkLbScrim');
    sc.addEventListener('click', (e) => { if (e.target === sc) tkCloseLightbox(); });
    document.getElementById('tkLbClose').addEventListener('click', tkCloseLightbox);
    const p = document.getElementById('tkLbPrev'), n = document.getElementById('tkLbNext');
    if (p) p.addEventListener('click', () => tkLbGoto(TK_LB.idx - 1));
    if (n) n.addEventListener('click', () => tkLbGoto(TK_LB.idx + 1));
  }
  function tkLbGoto(i) { if (!TK_LB.urls.length) return; TK_LB.idx = (i + TK_LB.urls.length) % TK_LB.urls.length; tkLbRender(); }
  function tkCloseLightbox() { const root = document.getElementById('tkLbRoot'); if (root) root.innerHTML = ''; TK_LB.urls = []; if (TK_LB.prevFocus && TK_LB.prevFocus.focus) { try { TK_LB.prevFocus.focus(); } catch (e) {} } }
  document.addEventListener('keydown', (e) => {
    if (!TK_LB.urls.length) return;
    if (e.key === 'Escape') tkCloseLightbox();
    else if (e.key === 'ArrowLeft') tkLbGoto(TK_LB.idx - 1);
    else if (e.key === 'ArrowRight') tkLbGoto(TK_LB.idx + 1);
  });

  const SESSAO = window.USUARIO_SESSAO || null;
  const papel = (SESSAO && SESSAO.role === 'gestor') ? 'gestor' : 'colaborador';
  const USUARIOS_HUB = window.USUARIOS_HUB || [];

  // "Resolvido" é o único status que fecha o ticket (grava data de
  // fechamento) — os outros 3 são todos considerados "aberto" pra fins de
  // TMR/prazo/filtro.
  const STATUS_RESOLVIDO = 'Resolvido';
  const STATUS_DEF = [
    { status: 'Aberto', cor: '#2A6FDB' },
    { status: 'Em acompanhamento', cor: '#E0A400' },
    { status: 'Urgência', cor: '#C63A32' },
    { status: STATUS_RESOLVIDO, cor: '#15A15A' },
  ];

  const IDENTIFICADOR_OPCOES = ['Pedido atrasado', 'Refabricação', 'Erro de Envio', 'NPS', 'Reclame Aqui'];
  // Sugestões do campo "Setor" — texto livre com datalist (igual o campo
  // "Responsável" do Painel de Erros), não uma lista fechada.
  const SETOR_OPCOES = ['Fábrica Cacinho', 'Fábrica Bonés Brasil', 'Fábrica CIA Bruto', '88 Brindes', 'Fábrica Neidinha', 'Fábrica LaserTools', 'Fábrica SLC', 'Fábrica (Outro)', 'Transportadora'];
  // Mesmo campo "Setor", mas com outra lista de sugestão — usada dentro do
  // Acompanhamento, pra quem está tratando o ticket indicar em que etapa de
  // produção ele está agora (diferente da lista de fábrica/transportadora
  // usada na criação do ticket).
  const SETOR_ACOMPANHAMENTO_OPCOES = ['Design', 'Separação', 'Bordado', 'Pintura', 'Sublimação', 'Revelação', 'Laser', 'Costura', 'Acabamento'];

  // SLA fixo por identificador (dias corridos a partir da abertura) — define
  // o prazo usado nos contadores de Vencidos/Vence hoje/Vence amanhã do
  // dashboard. Identificador sem SLA definido aqui simplesmente não entra
  // nesses contadores (não é "vencido", é "sem prazo").
  const SLA_DIAS = { 'Pedido atrasado': 1, 'Refabricação': 3, 'Erro de Envio': 1 };

  let dashEscopoChart = 'todos'; // 'todos' | 'meus' — só afeta o gráfico de fluxo
  let tkStatusChart = null; // instância Chart.js do donut de status (destruída/recriada a cada render do dashboard)

  const PRAZO_BUCKETS = [
    { key: 'atrasado', label: 'Atrasado', cor: '#C63A32' },
    { key: 'hoje', label: 'Vence hoje', cor: '#E0762A' },
    { key: '1_3', label: '1-3 dias', cor: '#E0A400' },
    { key: '4_7', label: '4-7 dias', cor: '#8FBF3F' },
    { key: '8_mais', label: '8+ dias', cor: '#1E8A4D' },
    { key: 'sem_prazo', label: 'Sem prazo', cor: '#6A7079' },
  ];

  let RECORDS = [];
  let LAST_SYNC = null;
  let CASO_ATUAL = null;
  const tkState = { screen: 'lista', fStatus: 'abertos', fResponsavel: '', fIdentificador: '', fSetor: '', busca: '' };
  // Seleção em massa da lista (só gestor) — atribuir responsável a vários
  // tickets de uma vez. Guarda rowIndex (== r.id); limpo sempre que o
  // recorte visível muda (filtro, busca, refresh) pra nunca reter seleção
  // de um ticket que saiu da tela.
  const tkSelecionados = new Set();

  /* ================= CARREGAMENTO ================= */

  async function tkLoadRealData() {
    const res = await fetch('/tickets/api/tickets');
    const json = await res.json();
    if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
    return json.tickets.map((t) => ({ id: t.rowIndex, ...t }));
  }

  async function tkBoot() {
    const bootEl = document.getElementById('tkBoot');
    const mainEl = document.getElementById('tkMain');
    bootEl.style.display = 'flex'; mainEl.style.display = 'none';
    try {
      RECORDS = await tkLoadRealData();
    } catch (err) {
      bootEl.innerHTML = `<div class="tk-boot-err">
        <div class="e-title">Não consegui carregar os dados</div>
        <div class="e-sub">O servidor demorou demais ou está indisponível. Aguarde alguns segundos e tente de novo.</div>
        <button class="tk-btn tk-btn-primary" id="tkBtnRetryBoot" style="margin-top:10px">Tentar de novo</button>
        <div style="font-size:11px;color:var(--text-hint);margin-top:12px">${tkEsc(String(err && err.message || err))}</div>
      </div>`;
      document.getElementById('tkBtnRetryBoot').addEventListener('click', tkBoot);
      return;
    }
    LAST_SYNC = Date.now();
    tkInitFilterOptions();
    bootEl.style.display = 'none'; mainEl.style.display = '';
    tkRender();
    tkUpdateLastSync();
    syncFromHash();
  }

  async function tkRefreshData(silent) {
    const btn = document.getElementById('tkBtnRefresh');
    if (!silent) { btn.disabled = true; btn.textContent = '…'; }
    try {
      RECORDS = await tkLoadRealData();
      LAST_SYNC = Date.now();
      tkSelecionados.clear();
      tkInitFilterOptions();
      tkRender();
      tkUpdateLastSync();
    } catch (err) {
      toast('Não consegui atualizar agora.', false);
    } finally {
      if (!silent) { btn.disabled = false; btn.textContent = '⟳'; }
    }
  }

  function tkUpdateLastSync() {
    const el = document.getElementById('tkLastSync');
    if (el && LAST_SYNC) el.textContent = 'atualizado há pouco';
  }

  // Valor especial (não é um nome de responsável de verdade) pra filtrar só
  // os tickets sem ninguém atribuído — junto com "Todos", fica no topo do
  // select de Responsável.
  const TK_FILTRO_SEM_RESPONSAVEL = '__sem_responsavel__';

  function tkInitFilterOptions() {
    const fillSelect = (id, values, placeholder, extraOptionsHtml) => {
      const el = document.getElementById(id);
      const current = el.value;
      el.innerHTML = `<option value="">${placeholder}</option>` + (extraOptionsHtml || '') + values.map((v) => `<option value="${tkEsc(v)}">${tkEsc(v)}</option>`).join('');
      el.value = current;
    };
    const responsaveis = Array.from(new Set(visibleRecords().map((r) => r.responsavel).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const identificadores = Array.from(new Set([...IDENTIFICADOR_OPCOES, ...visibleRecords().map((r) => r.identificador).filter(Boolean)]));
    const setores = Array.from(new Set([...SETOR_OPCOES, ...visibleRecords().map((r) => r.setor).filter(Boolean)]));
    fillSelect('tkFResponsavel', responsaveis, 'Todos os responsáveis', `<option value="${TK_FILTRO_SEM_RESPONSAVEL}">— Sem responsável —</option>`);
    fillSelect('tkFIdentificador', identificadores, 'Todos os identificadores');
    fillSelect('tkFSetor', setores, 'Todos os setores');
  }

  /* ================= TEMPO ================= */

  function parseData(iso) { return iso ? new Date(iso) : null; }

  function horasEntre(a, b) {
    if (!a || !b) return null;
    return Math.max(0, (b.getTime() - a.getTime()) / 3600000);
  }

  function fmtHoras(h) {
    if (h == null) return '—';
    if (h < 1) return Math.round(h * 60) + 'min';
    if (h < 24) return Math.round(h) + 'h';
    const dias = Math.floor(h / 24);
    const resto = Math.round(h % 24);
    return dias + 'd' + (resto ? ' ' + resto + 'h' : '');
  }

  // Ticket aberto: tempo decorrido até agora. Ticket fechado: tempo total
  // até o fechamento (não continua correndo).
  function tempoTicket(r) {
    const abertura = parseData(r.dataAbertura);
    const fim = r.status === STATUS_RESOLVIDO ? parseData(r.dataFechamento) : new Date();
    return horasEntre(abertura, fim);
  }

  function idadeClasse(horas) {
    if (horas == null) return 'tk-age-ok';
    if (horas >= 72) return 'tk-age-old';
    if (horas >= 24) return 'tk-age-mid';
    return 'tk-age-ok';
  }

  function fmtDataHora(iso) {
    const d = parseData(iso);
    if (!d) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Só a data (sem hora) — usado nas colunas PPE/Previsão da lista.
  function fmtDataCurta(iso) {
    const d = parseData(iso);
    if (!d) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // Dias entre hoje e o PPE (negativo = já passou do prazo) — mostrado na
  // lista independente do status, igual a referência mostra até em
  // tickets já finalizados.
  function diasParaPPE(r) {
    const ppe = parseData(r.ppe);
    if (!ppe) return null;
    return Math.round((soData(ppe).getTime() - soData(new Date()).getTime()) / 86400000);
  }

  // Só data, sem hora — pra comparar "dias até o prazo" sem a hora exata
  // do dia empurrar o resultado pra um lado ou outro.
  function soData(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }

  // Prazo = abertura + SLA do identificador (dias corridos). null se o
  // identificador não tem SLA definido em SLA_DIAS.
  function prazoTicket(r) {
    const dias = SLA_DIAS[r.identificador];
    const abertura = parseData(r.dataAbertura);
    if (dias == null || !abertura) return null;
    const prazo = soData(abertura);
    prazo.setDate(prazo.getDate() + dias);
    return prazo;
  }

  // Dias até o prazo (negativo = vencido). Só faz sentido pra ticket aberto.
  function diasParaPrazo(r) {
    if (r.status === STATUS_RESOLVIDO) return null;
    const prazo = prazoTicket(r);
    if (!prazo) return null;
    return Math.round((prazo.getTime() - soData(new Date()).getTime()) / 86400000);
  }

  // Bucket do "Prazo dos pedidos em aberto" — null pra ticket já resolvido
  // (não entra nesse gráfico); 'sem_prazo' pra identificador sem SLA.
  function prazoBucketKey(r) {
    if (r.status === STATUS_RESOLVIDO) return null;
    const d = diasParaPrazo(r);
    if (d == null) return 'sem_prazo';
    if (d < 0) return 'atrasado';
    if (d === 0) return 'hoje';
    if (d <= 3) return '1_3';
    if (d <= 7) return '4_7';
    return '8_mais';
  }

  /* ================= PAPÉIS ================= */

  function souEuOResponsavel(r) { return !!(SESSAO && r.responsavelSlug && r.responsavelSlug === SESSAO.slug); }
  function podeAlterarStatus(r) { return papel === 'gestor' || souEuOResponsavel(r); }

  // Gestor vê todo mundo; colaborador só vê os tickets em que ele é o
  // responsável (mesmo padrão de "colaborador vê só o próprio" do Painel
  // de Erros) — ticket sem responsável nenhum não aparece pra colaborador.
  function visibleRecords() { return papel === 'gestor' ? RECORDS : RECORDS.filter(souEuOResponsavel); }
  function podeAtribuir() { return papel === 'gestor'; }

  /* ================= TOAST ================= */

  function toast(msg, ok) {
    let wrap = document.getElementById('tkToastWrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'tkToastWrap'; wrap.className = 'tk-toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div'); t.className = 'tk-toast';
    t.innerHTML = (ok === true ? '<span class="tok">✓</span> ' : ok === false ? '<span class="terr">!</span> ' : '') + msg;
    wrap.appendChild(t); void t.offsetWidth; t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3200);
  }

  /* ================= NAVEGAÇÃO ================= */

  document.getElementById('tkNav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    tkState.screen = btn.dataset.view;
    tkSelecionados.clear();
    document.querySelectorAll('#tkNav button').forEach((b) => b.classList.toggle('active', b === btn));
    tkRender();
  });
  document.getElementById('tkBtnRefresh').addEventListener('click', () => tkRefreshData(false));
  document.getElementById('tkBtnNovo').addEventListener('click', openNovoTicket);
  document.getElementById('tkFStatus').addEventListener('change', (e) => { tkState.fStatus = e.target.value; tkSelecionados.clear(); tkRender(); });
  document.getElementById('tkFResponsavel').addEventListener('change', (e) => { tkState.fResponsavel = e.target.value; tkSelecionados.clear(); tkRender(); });
  document.getElementById('tkFIdentificador').addEventListener('change', (e) => { tkState.fIdentificador = e.target.value; tkSelecionados.clear(); tkRender(); });
  document.getElementById('tkFSetor').addEventListener('change', (e) => { tkState.fSetor = e.target.value; tkSelecionados.clear(); tkRender(); });
  document.getElementById('tkBusca').addEventListener('input', (e) => { tkState.busca = e.target.value.trim().toLowerCase(); tkSelecionados.clear(); tkRender(); });

  function tkRender() {
    const main = document.getElementById('tkMain');
    const filtEl = document.getElementById('tkFilters');
    filtEl.style.display = tkState.screen === 'dashboard' ? 'none' : '';
    if (tkState.screen === 'dashboard') { renderDashboard(main); return; }
    renderLista(main);
  }

  /* ================= LISTA ================= */

  function rowsFiltradas() {
    return visibleRecords().filter((r) => {
      if (tkState.fStatus === 'abertos' && r.status === STATUS_RESOLVIDO) return false;
      if (tkState.fStatus === 'fechados' && r.status !== STATUS_RESOLVIDO) return false;
      if (tkState.fResponsavel === TK_FILTRO_SEM_RESPONSAVEL) { if (r.responsavel) return false; }
      else if (tkState.fResponsavel && r.responsavel !== tkState.fResponsavel) return false;
      if (tkState.fIdentificador && r.identificador !== tkState.fIdentificador) return false;
      if (tkState.fSetor && r.setor !== tkState.fSetor) return false;
      if (tkState.busca) {
        const termo = tkState.busca;
        const bate = [r.pedido, r.idTicket, r.idVenda].some((v) => String(v || '').toLowerCase().includes(termo));
        if (!bate) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.dataAbertura) - new Date(a.dataAbertura));
  }

  function statusBadge(r) {
    const sd = STATUS_DEF.find((s) => s.status === r.status) || STATUS_DEF[0];
    return `<span class="tk-badge" style="background:color-mix(in oklab, ${sd.cor} 16%, transparent);color:${sd.cor}">${tkEsc(sd.status)}</span>`;
  }

  function renderLista(main) {
    const visiveis = visibleRecords();
    const abertos = visiveis.filter((r) => r.status !== STATUS_RESOLVIDO);
    const semResponsavel = abertos.filter((r) => !r.responsavel).length;
    const rows = rowsFiltradas();
    const podeSelecionar = podeAtribuir();
    const nCols = 10 + (podeSelecionar ? 1 : 0);
    const idsVisiveis = rows.map((r) => r.id);
    const todosSelecionados = podeSelecionar && idsVisiveis.length > 0 && idsVisiveis.every((id) => tkSelecionados.has(id));

    main.innerHTML = `
      <div class="tk-kpis">
        <div class="tk-kpi"><div class="k-l">Abertos</div><div class="k-v">${abertos.length}</div></div>
        ${papel === 'gestor' ? `<div class="tk-kpi tk-kpi-clicavel ${semResponsavel ? 'warn' : ''}" id="tkKpiSemResp" title="Filtrar só os sem responsável"><div class="k-l">Sem responsável</div><div class="k-v">${semResponsavel}</div></div>` : ''}
        <div class="tk-kpi"><div class="k-l">Fechados</div><div class="k-v">${visiveis.length - abertos.length}</div></div>
      </div>
      ${podeSelecionar && tkSelecionados.size > 0 ? renderBulkBar() : ''}
      <div class="tk-card" style="padding:0">
        <div class="tk-tbl-wrap">
          <table>
            <thead><tr>
              ${podeSelecionar ? `<th style="width:32px"><input type="checkbox" id="tkSelAllCheck" ${todosSelecionados ? 'checked' : ''}></th>` : ''}
              <th>Ticket</th><th>Cliente</th><th>Identificador</th><th>Setor</th><th>PPE</th><th>Dias</th><th>Previsão finalização</th><th>Responsável</th><th>Status</th><th>${tkState.fStatus === 'fechados' ? 'Tempo total' : 'Aberto há'}</th>
            </tr></thead>
            <tbody>
              ${rows.length === 0 ? `<tr><td colspan="${nCols}"><div class="tk-empty"><div class="e-title">Nenhum ticket encontrado</div><div class="e-sub">Ajuste os filtros ou clique em "+ Novo ticket".</div></div></td></tr>` : rows.map((r) => {
                const horas = tempoTicket(r);
                const dPPE = diasParaPPE(r);
                const corDias = dPPE == null ? 'var(--text-hint)' : dPPE < 0 ? 'var(--bad-text,var(--bad))' : dPPE === 0 ? 'var(--warn-text,var(--warn))' : 'var(--text)';
                return `<tr class="tk-clickable" data-id="${r.id}">
                  ${podeSelecionar ? `<td class="tk-selcol"><input type="checkbox" class="tk-row-check" data-id="${r.id}" ${tkSelecionados.has(r.id) ? 'checked' : ''}></td>` : ''}
                  <td>${r.idTicket ? '#' + tkEsc(r.idTicket) : '<span style="color:var(--text-hint)">—</span>'}</td>
                  <td style="font-weight:600">${tkEsc(r.pedido) || '—'} ${tkPhotoBadge(r)}</td>
                  <td>${tkEsc(r.identificador) || '—'}</td>
                  <td>${r.setor ? `<span class="tk-badge tk-badge-muted">${tkEsc(r.setor)}</span>` : '—'}</td>
                  <td>${fmtDataCurta(r.ppe)}</td>
                  <td><span style="font-weight:700;font-variant-numeric:tabular-nums;color:${corDias}">${dPPE == null ? '—' : (dPPE > 0 ? '+' : '') + dPPE + 'd'}</span></td>
                  <td>${fmtDataCurta(r.previsaoFinalizacao)}</td>
                  <td>${tkEsc(r.responsavel) || '<span style="color:var(--warn-text,var(--warn))">não atribuído</span>'}</td>
                  <td>${statusBadge(r)}</td>
                  <td><span class="tk-age ${idadeClasse(horas)}">${fmtHoras(horas)}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    main.querySelectorAll('tbody tr.tk-clickable').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.tk-selcol')) return;
        openTicket(Number(tr.dataset.id));
      });
    });
    if (podeSelecionar) wireSelecaoLista(main, idsVisiveis);
    const kpiSemResp = document.getElementById('tkKpiSemResp');
    if (kpiSemResp) {
      kpiSemResp.addEventListener('click', () => {
        tkState.fResponsavel = TK_FILTRO_SEM_RESPONSAVEL;
        const sel = document.getElementById('tkFResponsavel');
        if (sel) sel.value = TK_FILTRO_SEM_RESPONSAVEL;
        tkRender();
      });
    }
  }

  // Barra de ação em massa — só aparece com pelo menos 1 ticket selecionado,
  // e só pra gestor (mesma trava de podeAtribuir() usada no drawer).
  function renderBulkBar() {
    const respOptions = USUARIOS_HUB.map((u) => `<option value="${tkEsc(u.slug)}|${tkEsc(u.nome)}">${tkEsc(u.nome)}</option>`).join('');
    return `
      <div class="tk-bulkbar" id="tkBulkBar">
        <span class="tk-bulkbar-count">${tkSelecionados.size} ticket(s) selecionado(s)</span>
        <select id="tkBulkResponsavel">
          <option value="" selected disabled>Selecione um responsável…</option>
          ${respOptions}
        </select>
        <button class="tk-btn tk-btn-accent" id="tkBulkAtribuirBtn" type="button">Atribuir aos selecionados</button>
        <button class="tk-btn tk-btn-ghost" id="tkBulkCancelarBtn" type="button">Cancelar seleção</button>
      </div>`;
  }

  function wireSelecaoLista(main, idsVisiveis) {
    const selAll = document.getElementById('tkSelAllCheck');
    if (selAll) {
      selAll.addEventListener('change', () => {
        if (selAll.checked) idsVisiveis.forEach((id) => tkSelecionados.add(id));
        else idsVisiveis.forEach((id) => tkSelecionados.delete(id));
        tkRender();
      });
    }
    main.querySelectorAll('.tk-row-check').forEach((chk) => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) tkSelecionados.add(id); else tkSelecionados.delete(id);
        tkRender();
      });
    });
    const btnCancelar = document.getElementById('tkBulkCancelarBtn');
    if (btnCancelar) btnCancelar.addEventListener('click', () => { tkSelecionados.clear(); tkRender(); });

    const btnAtribuir = document.getElementById('tkBulkAtribuirBtn');
    if (btnAtribuir) {
      btnAtribuir.addEventListener('click', async () => {
        const sel = document.getElementById('tkBulkResponsavel');
        if (!sel.value) { toast('Selecione um responsável.', false); return; }
        const [slug, nome] = sel.value.split('|');
        const ids = Array.from(tkSelecionados);
        btnAtribuir.disabled = true;
        btnAtribuir.textContent = 'Atribuindo…';
        // Em paralelo — cada chamada ao Apps Script já leva ~2-3s por conta
        // própria (latência normal do Google), então em sequência N tickets
        // custaria N vezes isso. A própria planilha serializa as escritas
        // com LockService, então não há risco de corrida ao disparar junto.
        const resultados = await Promise.allSettled(ids.map((id) =>
          fetch('/tickets/api/atribuir', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rowIndex: id, responsavel: nome, responsavelSlug: slug }),
          }).then((res) => res.json()).then((json) => {
            if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
          })
        ));
        const falhas = resultados.filter((r) => r.status === 'rejected').length;
        tkSelecionados.clear();
        await tkRefreshData(true);
        if (falhas === 0) {
          toast(`Responsável atribuído a ${ids.length} ticket(s).`, true);
        } else {
          toast(`${ids.length - falhas} de ${ids.length} atribuído(s) — ${falhas} falhou(aram).`, false);
        }
      });
    }
  }

  /* ================= DASHBOARD ================= */

  function tmrDe(lista) {
    const fechados = lista.filter((r) => r.status === STATUS_RESOLVIDO && r.dataAbertura && r.dataFechamento);
    if (!fechados.length) return null;
    const soma = fechados.reduce((s, r) => s + (horasEntre(parseData(r.dataAbertura), parseData(r.dataFechamento)) || 0), 0);
    return soma / fechados.length;
  }

  function rankingPor(campo) {
    const grupos = new Map();
    visibleRecords().filter((r) => r.status === STATUS_RESOLVIDO && r[campo]).forEach((r) => {
      const chave = r[campo];
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(r);
    });
    return Array.from(grupos.entries())
      .map(([nome, lista]) => ({ nome, tmr: tmrDe(lista), n: lista.length }))
      .filter((g) => g.tmr != null)
      .sort((a, b) => b.tmr - a.tmr);
  }

  // Igual rankingPor('identificador'), mas sempre mostra todos os tipos
  // conhecidos (sugestões + os que já apareceram nos tickets), mesmo sem
  // nenhum ticket fechado ainda — pra dar visão completa por tipo, não só
  // dos que já têm dado.
  function rankingPorIdentificador() {
    const visiveis = visibleRecords();
    const grupos = new Map();
    visiveis.filter((r) => r.status === STATUS_RESOLVIDO && r.identificador).forEach((r) => {
      if (!grupos.has(r.identificador)) grupos.set(r.identificador, []);
      grupos.get(r.identificador).push(r);
    });
    const todos = Array.from(new Set([...IDENTIFICADOR_OPCOES, ...visiveis.map((r) => r.identificador).filter(Boolean)]));
    return todos
      .map((nome) => { const lista = grupos.get(nome) || []; return { nome, tmr: lista.length ? tmrDe(lista) : null, n: lista.length }; })
      .sort((a, b) => (a.tmr == null ? 1 : b.tmr == null ? -1 : b.tmr - a.tmr));
  }

  function renderRanking(titulo, sub, grupos) {
    const comDados = grupos.filter((g) => g.tmr != null);
    const max = comDados.length ? Math.max(...comDados.map((g) => g.tmr)) : 1;
    return `
      <div class="tk-card">
        <h3>${titulo}</h3>
        <div class="card-sub">${sub}</div>
        ${grupos.length === 0 ? `<div class="tk-hist-empty">Sem tickets fechados nesse recorte ainda.</div>` : grupos.map((g) => `
          <div class="tk-rk-row">
            <div class="tk-rk-top">
              <span class="tk-rk-name">${tkEsc(g.nome)}</span>
              <span class="tk-rk-count">${g.tmr != null ? fmtHoras(g.tmr) + ' · ' + g.n + ' ticket(s)' : 'sem dados ainda'}</span>
            </div>
            <div class="tk-rk-bar"><i style="width:${g.tmr != null ? Math.max(4, g.tmr / max * 100) : 0}%"></i></div>
          </div>
        `).join('')}
      </div>`;
  }

  function renderKpisTopo(visiveis) {
    const abertosList = visiveis.filter((r) => r.status !== STATUS_RESOLVIDO);
    const fechadosList = visiveis.filter((r) => r.status === STATUS_RESOLVIDO);
    const pctFinalizado = visiveis.length ? Math.round(fechadosList.length / visiveis.length * 100) : 0;

    const comPrazo = abertosList.map((r) => ({ d: diasParaPrazo(r) })).filter((x) => x.d != null);
    const atrasados = comPrazo.filter((x) => x.d < 0);
    const mediaAtraso = atrasados.length ? Math.round(atrasados.reduce((s, x) => s + Math.abs(x.d), 0) / atrasados.length) : 0;
    const venceHoje = comPrazo.filter((x) => x.d === 0).length;
    const vence3d = comPrazo.filter((x) => x.d >= 1 && x.d <= 3).length;

    return `
      <div class="tk-kpis">
        <div class="tk-kpi"><div class="k-l">Total no quadro</div><div class="k-v">${visiveis.length}</div></div>
        <div class="tk-kpi"><div class="k-l">Em aberto</div><div class="k-v">${abertosList.length}</div><div class="k-foot">${fechadosList.length} finalizado(s) (${pctFinalizado}%)</div></div>
        <div class="tk-kpi ${atrasados.length ? 'warn' : ''}"><div class="k-l">Atrasados</div><div class="k-v">${atrasados.length}</div>${atrasados.length ? `<div class="k-foot">média de ${mediaAtraso} dia(s) de atraso</div>` : ''}</div>
        <div class="tk-kpi"><div class="k-l">Vence hoje</div><div class="k-v">${venceHoje}</div></div>
        <div class="tk-kpi"><div class="k-l">Vence em ≤3 dias</div><div class="k-v">${vence3d}</div></div>
        <div class="tk-kpi accent"><div class="k-l">TMR geral</div><div class="k-v">${fmtHoras(tmrDe(visiveis))}</div></div>
      </div>`;
  }

  function renderStatusDonut(visiveis) {
    const total = visiveis.length;
    const counts = STATUS_DEF.map((sd) => ({ ...sd, n: visiveis.filter((r) => r.status === sd.status).length }));
    return `
      <div class="tk-card">
        <h3>Distribuição por status</h3>
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:6px">
          <div style="width:140px;height:140px;flex-shrink:0"><canvas id="tkChartStatus"></canvas></div>
          <div style="flex:1;min-width:180px">
            ${counts.map((c) => `
              <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px">
                <span class="tk-legend-dot" style="background:${c.cor}"></span>
                <span style="flex:1;color:var(--text)">${c.status}</span>
                <span style="font-weight:700;color:var(--text)">${c.n}</span>
                <span style="color:var(--text-muted);font-size:11.5px;min-width:34px;text-align:right">${total ? Math.round(c.n / total * 100) : 0}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;
  }

  function renderPrazoBuckets(visiveis) {
    const abertosList = visiveis.filter((r) => r.status !== STATUS_RESOLVIDO);
    const counts = PRAZO_BUCKETS.map((b) => ({ ...b, n: abertosList.filter((r) => prazoBucketKey(r) === b.key).length }));
    const max = Math.max(1, ...counts.map((c) => c.n));
    return `
      <div class="tk-card">
        <h3>Prazo dos pedidos em aberto</h3>
        <div class="card-sub">SLA por identificador (Pedido atrasado e Erro de Envio: 1 dia · Refabricação: 3 dias).</div>
        ${counts.map((c) => `
          <div class="tk-rk-row">
            <div class="tk-rk-top">
              <span class="tk-rk-name">${c.label}</span>
              <span class="tk-rk-count">${c.n}</span>
            </div>
            <div class="tk-rk-bar"><i style="width:${c.n ? Math.max(4, c.n / max * 100) : 0}%;background:${c.cor}"></i></div>
          </div>
        `).join('')}
      </div>`;
  }

  function contagemPor(visiveis, campo) {
    const grupos = new Map();
    visiveis.filter((r) => r[campo]).forEach((r) => grupos.set(r[campo], (grupos.get(r[campo]) || 0) + 1));
    return Array.from(grupos.entries()).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n);
  }

  function renderRankingContagem(titulo, sub, grupos) {
    const max = grupos.length ? Math.max(...grupos.map((g) => g.n)) : 1;
    return `
      <div class="tk-card">
        <h3>${titulo}</h3>
        <div class="card-sub">${sub}</div>
        ${grupos.length === 0 ? `<div class="tk-hist-empty">Sem dados nesse recorte ainda.</div>` : grupos.map((g) => `
          <div class="tk-rk-row">
            <div class="tk-rk-top">
              <span class="tk-rk-name">${tkEsc(g.nome)}</span>
              <span class="tk-rk-count">${g.n} ticket(s)</span>
            </div>
            <div class="tk-rk-bar"><i style="width:${Math.max(4, g.n / max * 100)}%"></i></div>
          </div>
        `).join('')}
      </div>`;
  }

  function bucketsPorDia(lista, dias) {
    const hoje = soData(new Date());
    const buckets = [];
    for (let i = dias - 1; i >= 0; i--) {
      const dia = new Date(hoje.getTime()); dia.setDate(dia.getDate() - i);
      buckets.push({ dia, abertos: 0, fechados: 0 });
    }
    const idxPorDia = new Map(buckets.map((b, i) => [b.dia.getTime(), i]));
    lista.forEach((r) => {
      const ab = parseData(r.dataAbertura);
      if (ab) { const i = idxPorDia.get(soData(ab).getTime()); if (i != null) buckets[i].abertos++; }
      const fc = parseData(r.dataFechamento);
      if (fc) { const i = idxPorDia.get(soData(fc).getTime()); if (i != null) buckets[i].fechados++; }
    });
    return buckets;
  }

  function renderFluxoChart() {
    const lista = (papel === 'gestor' && dashEscopoChart === 'meus') ? visibleRecords().filter(souEuOResponsavel) : visibleRecords();
    const buckets = bucketsPorDia(lista, 14);
    const max = Math.max(1, ...buckets.map((b) => Math.max(b.abertos, b.fechados)));
    const diaLabel = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    return `
      <div class="tk-card">
        <div class="tk-card-head-row">
          <h3>Abertos x Fechados por dia</h3>
          ${papel === 'gestor' ? `<div class="tk-seg-toggle" id="tkFluxoEscopo">
            <button class="seg ${dashEscopoChart === 'meus' ? 'on' : ''}" data-escopo="meus" type="button">Meus</button>
            <button class="seg ${dashEscopoChart === 'todos' ? 'on' : ''}" data-escopo="todos" type="button">Todos</button>
          </div>` : ''}
        </div>
        <div class="card-sub"><span class="tk-legend-dot azul"></span>Abertos no dia&nbsp;&nbsp;<span class="tk-legend-dot verde"></span>Fechados no dia</div>
        <div class="tk-fluxo-chart">
          ${buckets.map((b) => `
            <div class="tk-fluxo-day">
              <div class="tk-fluxo-bars">
                <div class="tk-fluxo-bar azul" style="height:${b.abertos ? Math.max(4, b.abertos / max * 100) : 0}%" title="${b.abertos} aberto(s)"></div>
                <div class="tk-fluxo-bar verde" style="height:${b.fechados ? Math.max(4, b.fechados / max * 100) : 0}%" title="${b.fechados} fechado(s)"></div>
              </div>
              <div class="tk-fluxo-label">${tkEsc(diaLabel(b.dia))}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderDashboard(main) {
    const visiveis = visibleRecords();

    main.innerHTML = `
      ${renderKpisTopo(visiveis)}
      <div class="tk-grid-2col">
        ${renderStatusDonut(visiveis)}
        ${renderPrazoBuckets(visiveis)}
      </div>
      ${renderRankingContagem('Pedidos por Fábrica', papel === 'gestor' ? 'Quantidade de tickets por setor/fábrica.' : 'Quantidade dos seus tickets por setor/fábrica.', contagemPor(visiveis, 'setor'))}
      ${renderFluxoChart()}
      <div class="tk-grid-2col">
        ${renderRanking('TMR por responsável', 'Tempo médio de resolução entre a abertura e o fechamento, só de tickets fechados.', rankingPor('responsavel'))}
        ${renderRanking('TMR por identificador', 'Quais tipos de ticket demoram mais pra resolver.', rankingPorIdentificador())}
      </div>
    `;

    if (tkStatusChart) { tkStatusChart.destroy(); tkStatusChart = null; }
    const canvasStatus = document.getElementById('tkChartStatus');
    if (canvasStatus) {
      tkStatusChart = new Chart(canvasStatus, {
        type: 'doughnut',
        data: {
          labels: STATUS_DEF.map((s) => s.status),
          datasets: [{ data: STATUS_DEF.map((sd) => visiveis.filter((r) => r.status === sd.status).length), backgroundColor: STATUS_DEF.map((s) => s.cor), borderWidth: 0 }],
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: true } } },
      });
    }

    const escopoBox = document.getElementById('tkFluxoEscopo');
    if (escopoBox) {
      escopoBox.querySelectorAll('.seg').forEach((btn) => {
        btn.addEventListener('click', () => { dashEscopoChart = btn.dataset.escopo; renderDashboard(main); });
      });
    }
  }

  /* ================= DRAWER ================= */

  function parseTicketHash() { const m = (location.hash || '').match(/^#\/t\/(-?\d+)/); return m ? Number(m[1]) : null; }

  function drawerInnerHTML(r) {
    const horas = tempoTicket(r);
    const respOptions = ['<option value="">— não atribuído —</option>']
      .concat(USUARIOS_HUB.map((u) => `<option value="${tkEsc(u.slug)}" ${u.slug === r.responsavelSlug ? 'selected' : ''}>${tkEsc(u.nome)}</option>`))
      .join('');
    return `
      <div class="tk-drawer-head">
        <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:800;letter-spacing:-.2px;color:var(--text)">${tkEsc(r.pedido) || (r.idTicket ? '#' + tkEsc(r.idTicket) : 'Ticket #' + r.id)}</div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">
            ${r.idTicket ? `<span class="tk-idchip">#${tkEsc(r.idTicket)}</span>` : ''}
            ${statusBadge(r)}
            <span class="tk-age ${idadeClasse(horas)}">${r.status === STATUS_RESOLVIDO ? 'Resolvido em ' : 'Aberto há '}${fmtHoras(horas)}</span>
          </div>
        </div>
        <button class="tk-close-btn" id="tkDrwClose">✕</button>
      </div>
      <div class="tk-drawer-body">
        ${podeAlterarStatus(r) ? `<div class="tk-status-seg" style="margin-bottom:18px">${STATUS_DEF.map((sd) => `<button class="tk-stbtn ${r.status === sd.status ? 'on' : ''}" data-status="${sd.status}" style="--c:${sd.cor}">${sd.status}</button>`).join('')}</div>` : ''}
        <div class="tk-sec-title">Dados do ticket</div>
        <div class="tk-field-grid" style="margin-bottom:16px">
          <div class="tk-field"><label>Identificador</label><div class="tk-readonly-block">${tkEsc(r.identificador) || '—'}</div></div>
          <div class="tk-field">
            <label>Setor</label>
            <div style="display:flex;gap:8px">
              <input type="text" id="tkInpSetorTopo" list="tkSetorTopoList" value="${tkEsc(r.setor)}" placeholder="Digite ou selecione" style="flex:1">
              <button class="tk-btn tk-btn-ghost" type="button" id="tkBtnSalvarSetor">Salvar</button>
            </div>
            <datalist id="tkSetorTopoList">${SETOR_ACOMPANHAMENTO_OPCOES.map((o) => `<option value="${tkEsc(o)}">`).join('')}</datalist>
          </div>
          <div class="tk-field"><label>ID da venda</label>${r.idVenda ? `<div><span class="tk-idchip tk-idchip-click" id="tkIdVendaCopy" data-copy="${tkEsc(r.idVenda)}" title="Clique para copiar">#${tkEsc(r.idVenda)}</span></div>` : `<div class="tk-readonly-block">—</div>`}</div>
          <div class="tk-field"><label>Origem</label><div class="tk-readonly-block">${r.origem === 'manual' || !r.origem ? 'Manual' : 'Automático (' + tkEsc(r.origem) + ')'}</div></div>
          <div class="tk-field"><label>Aberto em</label><div class="tk-readonly-block">${fmtDataHora(r.dataAbertura)}</div></div>
          <div class="tk-field"><label>Fechado em</label><div class="tk-readonly-block">${fmtDataHora(r.dataFechamento)}</div></div>
        </div>
        <div class="tk-field" style="margin-bottom:16px">
          <label>Link</label>
          ${r.link
            ? `<a href="${tkEsc(r.link)}" target="_blank" rel="noopener" class="tk-btn tk-btn-ghost" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">Abrir card <i class="ti ti-external-link" aria-hidden="true"></i></a>`
            : `<div style="display:flex;gap:8px">
                <input type="url" id="tkInpLink" placeholder="https://..." style="flex:1">
                <button class="tk-btn tk-btn-ghost" type="button" id="tkBtnSalvarLink">Adicionar</button>
              </div>`}
        </div>
        ${r.observacao ? `<div class="tk-field" style="margin-bottom:16px"><label>Observação</label><div class="tk-readonly-block" style="font-style:italic">${tkEsc(r.observacao)}</div></div>` : ''}

        <div class="tk-sec-title" style="margin-top:20px">Anexos${(() => { const n = tkParseFotos(r.anexos).length; return n ? ` (${n})` : ''; })()}</div>
        ${(() => {
          const fs = tkParseFotos(r.anexos);
          return fs.length ? `<div class="tk-foto-prev" id="tkAnexosExistentes" style="margin-top:0;margin-bottom:12px">${fs.map((u, i) => `<div class="fp"><img class="tk-thumb tk-lb-thumb" data-idx="${i}" src="${tkEsc(tkFotoSrc(u))}" alt="Anexo ${i + 1}" title="Ampliar" loading="lazy"><button type="button" class="rm" data-url="${tkEsc(u)}" title="Remover anexo">✕</button></div>`).join('')}</div>` : '';
        })()}
        <div class="tk-foto-drop" id="tkFotoDrop"><b>Clique para adicionar imagem</b> ou arraste aqui</div>
        <input type="file" id="tkFotoInput" accept="image/*" multiple style="display:none">
        <div class="tk-foto-prev" id="tkFotoPrev"></div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">
          <span class="tk-save-msg" id="tkSaveMsgAnexo"></span>
          <button class="tk-btn tk-btn-ghost" type="button" id="tkBtnEnviarAnexos" style="display:none">Enviar anexos</button>
        </div>

        <div class="tk-sec-title" style="margin-top:20px">Responsável</div>
        ${podeAtribuir()
          ? `<div class="tk-field" style="margin-bottom:0"><select id="tkSelResponsavel">${respOptions}</select>
              <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="tk-btn tk-btn-ghost" id="tkBtnAtribuir" type="button">Atribuir</button></div>
            </div>`
          : `<div class="tk-readonly-block">${tkEsc(r.responsavel) || 'não atribuído'}</div>`}

        <div class="tk-sec-title" style="margin-top:20px">Acompanhamento</div>
        <div style="font-size:12.5px;color:var(--text-muted);margin:-6px 0 12px;line-height:1.45">Informações de quem está tratando o ticket, não afeta prazo de SLA nem status.</div>
        <div class="tk-field-grid" style="margin-bottom:14px">
          <div class="tk-field"><label>PPE (prazo previsto de entrega)</label><input type="date" id="tkInpPpe" value="${tkEsc((r.ppe || '').slice(0, 10))}"></div>
          <div class="tk-field"><label>Previsão de finalização</label><input type="date" id="tkInpPrevisao" value="${tkEsc((r.previsaoFinalizacao || '').slice(0, 10))}"></div>
          <div class="tk-field"><label>P. Folha (prazo de produção)</label><input type="date" id="tkInpPFolha" value="${tkEsc((r.pFolha || '').slice(0, 10))}"></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);margin-bottom:12px;cursor:pointer">
          <input type="checkbox" id="tkChkEvento" ${r.temEvento ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--gold)">
          Este pedido tem evento com data definida
        </label>
        <div class="tk-field" id="tkGrupoDataEvento" style="margin-bottom:14px;display:${r.temEvento ? '' : 'none'}">
          <label>Data do evento</label>
          <input type="date" id="tkInpDataEvento" value="${tkEsc((r.dataEvento || '').slice(0, 10))}">
        </div>
        <div class="tk-field" style="margin-bottom:14px">
          <label>Entrega</label>
          <select id="tkSelEntrega">
            <option value="">— selecione —</option>
            ${['Domicílio', 'Escritório', 'Aeroporto'].map((o) => `<option value="${o}" ${r.entrega === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div class="tk-field" id="tkGrupoAeroporto" style="margin-bottom:14px;display:${r.entrega === 'Aeroporto' ? '' : 'none'}">
          <label>Qual aeroporto?</label>
          <input type="text" id="tkInpAeroporto" value="${tkEsc(r.aeroporto)}" placeholder="Ex: Aeroporto de Natal (NAT)">
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px">
          <span class="tk-save-msg" id="tkSaveMsgAcomp"></span>
          <button class="tk-btn tk-btn-ghost" type="button" id="tkBtnSalvarAcomp">Salvar acompanhamento</button>
        </div>

        <div class="tk-sec-title" style="margin-top:20px">Comentar</div>
        <div class="tk-field" style="margin-bottom:0">
          <textarea id="tkComentarioInput" placeholder="Alguma atualização sobre esse ticket? Deixe um comentário, o gestor será avisado."></textarea>
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">
            <span class="tk-save-msg" id="tkSaveMsgComentario"></span>
            <button class="tk-btn tk-btn-primary" type="button" id="tkBtnComentar">Comentar</button>
          </div>
        </div>

        <div class="tk-sec-title" style="margin-top:20px">Histórico</div>
        <div id="tkHistBox" class="tk-hist-box">Carregando…</div>
      </div>
      <div class="tk-drawer-foot">
        <span class="tk-save-msg" id="tkSaveMsg"></span>
        ${podeAlterarStatus(r) && r.status !== STATUS_RESOLVIDO ? '<button class="tk-btn tk-btn-primary" id="tkDrwResolver">Resolvido</button>' : ''}
      </div>
    `;
  }

  async function carregarHistoricoTicket(rowIndex) {
    const box = document.getElementById('tkHistBox');
    if (!box) return;
    try {
      const res = await fetch('/tickets/api/historico?rowIndex=' + encodeURIComponent(rowIndex));
      const json = await res.json();
      if (CASO_ATUAL !== rowIndex) return;
      const evs = (json && json.ok && json.eventos) ? json.eventos : [];
      if (!evs.length) {
        box.innerHTML = '<div class="tk-hist-empty">Nenhum evento ainda.</div>';
        return;
      }
      const groups = []; const idxByDay = {};
      evs.forEach((ev) => {
        const day = (String(ev.quando || '').split(/[ T]/)[0]) || 'Sem data';
        if (idxByDay[day] === undefined) { idxByDay[day] = groups.length; groups.push({ day, items: [] }); }
        groups[idxByDay[day]].items.push(ev);
      });
      box.innerHTML = groups.map((g) => `<div class="tk-hist-day">${tkEsc(g.day)}</div>` + g.items.map((ev) => `<div class="tk-hist-item">
        <div class="tk-hist-dot"></div>
        <div class="tk-hist-content">
          <div class="tk-hist-line"><b>${tkEsc(ev.acao)}</b>${ev.detalhe ? ' · ' + tkEsc(ev.detalhe) : ''}</div>
          <div class="tk-hist-meta">${tkEsc(ev.usuario) || '—'}</div>
        </div>
      </div>`).join('')).join('');
    } catch (e) {
      if (CASO_ATUAL === rowIndex) box.innerHTML = '<div class="tk-hist-empty">Não consegui carregar o histórico agora.</div>';
    }
  }

  function renderDrawer(id) {
    const r = RECORDS.find((x) => x.id === id);
    if (!r) { closeDrawer(true); return; }
    CASO_ATUAL = id;
    const root = document.getElementById('tkModalRoot');
    const existing = root.querySelector('.tk-drawer');
    const html = drawerInnerHTML(r);
    if (existing) {
      existing.innerHTML = html;
    } else {
      root.innerHTML = `<div class="tk-drawer-scrim" id="tkDrawerScrim"></div><div class="tk-drawer" id="tkDrawer" role="dialog" aria-modal="true" aria-label="Detalhe do ticket">${html}</div>`;
      const scrim = document.getElementById('tkDrawerScrim');
      const dr = document.getElementById('tkDrawer');
      scrim.addEventListener('click', () => closeDrawer(false));
      void dr.offsetWidth;
      scrim.classList.add('show'); dr.classList.add('show');
    }
    wireDrawer(r);
  }

  async function setTicketStatus(r, status) {
    if (!podeAlterarStatus(r) || r.status === status) return;
    const tentarMudar = () => fetch('/tickets/api/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, status }) }).then((res) => res.json());
    try {
      let json = await tentarMudar();
      if (!json.ok) {
        // Erro comum aqui é "Lock timeout" — outra ação (checagem automática
        // de atraso/importação, ou outra pessoa) segurando a planilha por um
        // instante. Quase sempre resolve numa segunda tentativa, então tenta
        // de novo uma vez antes de mostrar erro pra quem tá usando.
        await new Promise((res) => setTimeout(res, 2500));
        json = await tentarMudar();
      }
      if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
      await tkRefreshData(true);
      if (CASO_ATUAL === r.id) renderDrawer(r.id);
      else tkRender();
      toast('Status: ' + status, true);
    } catch (err) {
      toast('Não consegui mudar o status: ' + err.message, false);
    }
  }

  function wireDrawer(r) {
    const $ = (i) => document.getElementById(i);
    carregarHistoricoTicket(r.id);
    $('tkDrwClose').addEventListener('click', () => closeDrawer(false));
    const resolver = $('tkDrwResolver'); if (resolver) resolver.addEventListener('click', () => setTicketStatus(r, STATUS_RESOLVIDO));

    document.querySelectorAll('.tk-drawer .tk-stbtn').forEach((b) => b.addEventListener('click', () => setTicketStatus(r, b.dataset.status)));

    const idVendaCopy = $('tkIdVendaCopy');
    if (idVendaCopy) idVendaCopy.addEventListener('click', () => {
      navigator.clipboard?.writeText(idVendaCopy.dataset.copy).catch(() => {});
      idVendaCopy.textContent = 'Copiado!';
      setTimeout(() => { idVendaCopy.textContent = '#' + idVendaCopy.dataset.copy; }, 900);
    });

    const anexosExistentes = tkParseFotos(r.anexos).map(tkFotoSrc);
    document.querySelectorAll('.tk-drawer .tk-lb-thumb').forEach((el) => {
      el.addEventListener('click', () => tkOpenLightbox(anexosExistentes, Number(el.dataset.idx)));
    });
    document.querySelectorAll('#tkAnexosExistentes .rm').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await hubConfirm('Remover esse anexo?', { textoConfirmar: 'Remover' });
        if (!ok) return;
        btn.disabled = true;
        try {
          const res = await fetch('/tickets/api/anexos/remover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, url: btn.dataset.url }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
          r.anexos = json.anexos || '';
          await tkRefreshData(true);
          renderDrawer(r.id);
          toast('Anexo removido', true);
        } catch (err) {
          toast('Erro: ' + err.message, false);
          btn.disabled = false;
        }
      });
    });

    const btnSalvarLink = $('tkBtnSalvarLink');
    if (btnSalvarLink) {
      btnSalvarLink.addEventListener('click', async () => {
        const inp = $('tkInpLink');
        const link = inp.value.trim();
        if (!link) { inp.focus(); return; }
        btnSalvarLink.disabled = true;
        try {
          const res = await fetch('/tickets/api/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, link }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
          r.link = link;
          await tkRefreshData(true);
          renderDrawer(r.id);
          toast('Link adicionado', true);
        } catch (err) {
          toast('Erro: ' + err.message, false);
          btnSalvarLink.disabled = false;
        }
      });
    }

    const btnSalvarSetor = $('tkBtnSalvarSetor');
    if (btnSalvarSetor) {
      btnSalvarSetor.addEventListener('click', async () => {
        const inp = $('tkInpSetorTopo');
        const setor = inp.value.trim();
        btnSalvarSetor.disabled = true;
        try {
          const res = await fetch('/tickets/api/setor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, setor }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
          r.setor = setor;
          await tkRefreshData(true);
          toast('Setor salvo', true);
        } catch (err) {
          toast('Erro: ' + err.message, false);
        } finally {
          btnSalvarSetor.disabled = false;
        }
      });
    }

    // --- Acompanhamento: evento do cliente + entrega ---
    const chkEvento = $('tkChkEvento');
    const grupoDataEvento = $('tkGrupoDataEvento');
    chkEvento.addEventListener('change', () => { grupoDataEvento.style.display = chkEvento.checked ? '' : 'none'; });
    const selEntrega = $('tkSelEntrega');
    const grupoAeroporto = $('tkGrupoAeroporto');
    selEntrega.addEventListener('change', () => { grupoAeroporto.style.display = selEntrega.value === 'Aeroporto' ? '' : 'none'; });
    $('tkBtnSalvarAcomp').addEventListener('click', async () => {
      const btn = $('tkBtnSalvarAcomp');
      const msg = $('tkSaveMsgAcomp');
      const temEvento = chkEvento.checked;
      const dataEvento = temEvento ? $('tkInpDataEvento').value : '';
      const entrega = selEntrega.value;
      const aeroporto = entrega === 'Aeroporto' ? $('tkInpAeroporto').value.trim() : '';
      const ppe = $('tkInpPpe').value;
      const previsaoFinalizacao = $('tkInpPrevisao').value;
      const pFolha = $('tkInpPFolha').value;
      btn.disabled = true; msg.textContent = 'Gravando…';
      try {
        const res = await fetch('/tickets/api/acompanhamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, temEvento, dataEvento, entrega, aeroporto, ppe, previsaoFinalizacao, pFolha }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
        Object.assign(r, { temEvento, dataEvento, entrega, aeroporto, ppe, previsaoFinalizacao, pFolha });
        await tkRefreshData(true);
        msg.textContent = '';
        toast('Acompanhamento salvo', true);
      } catch (err) {
        msg.textContent = 'Erro: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    });

    // --- Novos anexos: seleção + preview (mesmo padrão do Painel de Erros, só imagem) ---
    const NOVAS_FOTOS = []; // { url: data URL, nome }
    const fotoDrop = $('tkFotoDrop');
    const fotoInput = $('tkFotoInput');
    const fotoPrev = $('tkFotoPrev');
    const btnEnviarAnexos = $('tkBtnEnviarAnexos');
    const renderFotoPrev = () => {
      fotoPrev.innerHTML = NOVAS_FOTOS.map((f, i) => `<div class="fp"><img src="${f.url}" alt=""><button type="button" class="rm" data-i="${i}" title="Remover">✕</button></div>`).join('');
      fotoPrev.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { NOVAS_FOTOS.splice(Number(b.dataset.i), 1); renderFotoPrev(); }));
      fotoDrop.innerHTML = NOVAS_FOTOS.length ? `<b>${NOVAS_FOTOS.length} imagem(ns) selecionada(s)</b> · clique para adicionar mais (até ${MAX_FOTOS})` : `<b>Clique para adicionar imagem</b> ou arraste aqui`;
      btnEnviarAnexos.style.display = NOVAS_FOTOS.length ? '' : 'none';
    };
    const addFotos = async (files) => {
      const lista = Array.from(files).filter((f) => /^image\//.test(f.type));
      if (!lista.length) { toast('Só é possível anexar imagens.', false); return; }
      const tamanhoNovo = lista.reduce((soma, f) => soma + f.size, 0);
      const tamanhoAtual = NOVAS_FOTOS.reduce((soma, f) => soma + (f.url.length * 0.75), 0);
      if (tamanhoAtual + tamanhoNovo > MAX_ANEXOS_MB * 1024 * 1024) {
        toast(`As imagens somadas passariam de ${MAX_ANEXOS_MB} MB. Envie menos ou imagens menores.`, false);
        return;
      }
      for (const f of lista) {
        if (NOVAS_FOTOS.length >= MAX_FOTOS) { toast('Máximo de ' + MAX_FOTOS + ' imagens por vez', false); break; }
        try {
          const url = await tkComprimirImagem(f);
          NOVAS_FOTOS.push({ url, nome: f.name });
        } catch (err) { toast('Arquivo ignorado: ' + err.message, false); }
      }
      renderFotoPrev();
    };
    fotoDrop.addEventListener('click', () => fotoInput.click());
    fotoInput.addEventListener('change', () => { addFotos(fotoInput.files); fotoInput.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => fotoDrop.addEventListener(ev, (e) => { e.preventDefault(); fotoDrop.style.borderColor = 'var(--gold)'; }));
    ['dragleave', 'drop'].forEach((ev) => fotoDrop.addEventListener(ev, (e) => { e.preventDefault(); fotoDrop.style.borderColor = ''; }));
    fotoDrop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFotos(e.dataTransfer.files); });

    btnEnviarAnexos.addEventListener('click', async () => {
      const msg = $('tkSaveMsgAnexo');
      btnEnviarAnexos.disabled = true; msg.textContent = 'Enviando…';
      try {
        const res = await fetch('/tickets/api/anexar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, fotos: NOVAS_FOTOS.map((f) => f.url) }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
        r.anexos = json.anexos || r.anexos;
        await tkRefreshData(true);
        renderDrawer(r.id);
        toast('Anexo(s) adicionado(s)', true);
      } catch (err) {
        msg.textContent = 'Erro: ' + err.message;
        btnEnviarAnexos.disabled = false;
      }
    });

    const btnAtribuir = $('tkBtnAtribuir');
    if (btnAtribuir) {
      btnAtribuir.addEventListener('click', async () => {
        const sel = $('tkSelResponsavel');
        const slug = sel.value;
        const nome = slug ? (USUARIOS_HUB.find((u) => u.slug === slug) || {}).nome || '' : '';
        btnAtribuir.disabled = true;
        try {
          const res = await fetch('/tickets/api/atribuir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, responsavel: nome, responsavelSlug: slug }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
          Object.assign(r, { responsavel: nome, responsavelSlug: slug });
          await tkRefreshData(true);
          renderDrawer(r.id);
          toast('Responsável atualizado', true);
        } catch (err) {
          toast('Erro: ' + err.message, false);
        } finally {
          btnAtribuir.disabled = false;
        }
      });
    }

    const btnComentar = $('tkBtnComentar');
    if (btnComentar) {
      btnComentar.addEventListener('click', async () => {
        const ta = $('tkComentarioInput');
        const msg = $('tkSaveMsgComentario');
        const texto = (ta.value || '').trim();
        if (!texto) { ta.focus(); return; }
        btnComentar.disabled = true; msg.textContent = 'Enviando…';
        try {
          const res = await fetch('/tickets/api/comentar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rowIndex: r.id, comentario: texto }) });
          const json = await res.json();
          if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
          ta.value = ''; msg.textContent = '';
          await carregarHistoricoTicket(r.id);
          toast('Comentário adicionado', true);
        } catch (err) {
          msg.textContent = 'Erro: ' + err.message;
        } finally {
          btnComentar.disabled = false;
        }
      });
    }

  }

  function openTicket(id) {
    if (parseTicketHash() === id) renderDrawer(id);
    else location.hash = '#/t/' + id;
  }

  function closeDrawer(fromHash) {
    const root = document.getElementById('tkModalRoot');
    const dr = root.querySelector('.tk-drawer'), sc = root.querySelector('.tk-drawer-scrim');
    CASO_ATUAL = null;
    if (dr) dr.classList.remove('show');
    if (sc) sc.classList.remove('show');
    setTimeout(() => { const el = document.getElementById('tkModalRoot'); if (CASO_ATUAL === null && el && el.querySelector('.tk-drawer')) el.innerHTML = ''; }, 240);
    if (!fromHash && parseTicketHash() !== null) history.pushState(null, '', '#/tickets');
  }

  function syncFromHash() {
    const id = parseTicketHash();
    if (id !== null && RECORDS.find((x) => x.id === id)) renderDrawer(id);
    else closeDrawer(true);
  }
  window.addEventListener('hashchange', syncFromHash);
  document.addEventListener('keydown', (e) => { if (CASO_ATUAL !== null && e.key === 'Escape') closeDrawer(false); });

  /* ================= NOVO TICKET ================= */

  function openNovoTicket() {
    const modalRoot = document.getElementById('tkModalRoot');
    const optVazia = '<option value="">—</option>';
    const identOptions = optVazia + IDENTIFICADOR_OPCOES.map((o) => `<option value="${tkEsc(o)}">${tkEsc(o)}</option>`).join('');
    const respOptions = optVazia + USUARIOS_HUB.map((u) => `<option value="${tkEsc(u.slug)}">${tkEsc(u.nome)}</option>`).join('');

    modalRoot.innerHTML = `
      <div class="tk-overlay" id="tkOverlayNovo">
        <div class="tk-modal" role="dialog" aria-modal="true" aria-label="Abrir novo ticket">
          <div class="tk-modal-head">
            <div style="flex:1;min-width:0">
              <div class="title">Abrir novo ticket</div>
              <div class="sub">Preencha o que souber. O ID do ticket é gerado automaticamente. Se deixar o responsável em branco, o ticket entra como "não atribuído" e todo gestor é avisado.</div>
            </div>
            <button class="tk-close-btn" id="tkCloseModalNovo">✕</button>
          </div>
          <div class="tk-modal-body">
            <form id="tkFormNovo">
              <div class="tk-field-grid" style="margin-bottom:14px">
                <div class="tk-field"><label>Nome do cliente</label><input type="text" name="pedido" placeholder="Ex: Pedro 9366"></div>
                <div class="tk-field"><label>ID da venda</label><input type="text" name="idVenda" placeholder="Opcional"></div>
              </div>
              <div class="tk-field-grid" style="margin-bottom:14px">
                <div class="tk-field"><label>Identificador *</label><select name="identificador">${identOptions}</select></div>
                <div class="tk-field"><label>Setor</label><input type="text" name="setor" list="tkSetorList" placeholder="Digite ou selecione"></div>
                <datalist id="tkSetorList">${SETOR_OPCOES.map((o) => `<option value="${tkEsc(o)}">`).join('')}</datalist>
              </div>
              <div class="tk-field-grid" style="margin-bottom:14px">
                <div class="tk-field"><label>Responsável</label><select name="responsavelSlug">${respOptions}</select></div>
              </div>
              <div class="tk-field" style="margin-bottom:14px"><label>Link</label><input type="url" name="link" placeholder="https://..."></div>
              <div class="tk-field" style="margin-bottom:14px"><label>Observação</label><textarea name="observacao" placeholder="Contexto inicial do ticket"></textarea></div>
              <div class="tk-field">
                <label>Imagens (opcional)</label>
                <div class="tk-foto-drop" id="tkFotoDropNovo"><b>Clique para adicionar imagem</b> ou arraste aqui</div>
                <input type="file" id="tkFotoInputNovo" accept="image/*" multiple style="display:none">
                <div class="tk-foto-prev" id="tkFotoPrevNovo"></div>
              </div>
            </form>
          </div>
          <div class="tk-modal-foot">
            <span class="tk-save-msg" id="tkSaveMsgNovo"></span>
            <button class="tk-btn tk-btn-ghost" id="tkBtnCancelarNovo">Cancelar</button>
            <button class="tk-btn tk-btn-accent" id="tkBtnCriarTicket">Abrir ticket</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalRoot.innerHTML = ''; };
    document.getElementById('tkCloseModalNovo').addEventListener('click', close);
    document.getElementById('tkBtnCancelarNovo').addEventListener('click', close);
    document.getElementById('tkOverlayNovo').addEventListener('click', (e) => { if (e.target.id === 'tkOverlayNovo') close(); });

    const FOTOS_NOVO = [];
    const fotoDropNovo = document.getElementById('tkFotoDropNovo');
    const fotoInputNovo = document.getElementById('tkFotoInputNovo');
    const fotoPrevNovo = document.getElementById('tkFotoPrevNovo');
    const renderFotoPrevNovo = () => {
      fotoPrevNovo.innerHTML = FOTOS_NOVO.map((f, i) => `<div class="fp"><img src="${f.url}" alt=""><button type="button" class="rm" data-i="${i}" title="Remover">✕</button></div>`).join('');
      fotoPrevNovo.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => { FOTOS_NOVO.splice(Number(b.dataset.i), 1); renderFotoPrevNovo(); }));
      fotoDropNovo.innerHTML = FOTOS_NOVO.length ? `<b>${FOTOS_NOVO.length} imagem(ns) selecionada(s)</b> · clique para adicionar mais (até ${MAX_FOTOS})` : `<b>Clique para adicionar imagem</b> ou arraste aqui`;
    };
    const addFotosNovo = async (files) => {
      const lista = Array.from(files).filter((f) => /^image\//.test(f.type));
      if (!lista.length) { toast('Só é possível anexar imagens.', false); return; }
      const tamanhoNovo = lista.reduce((soma, f) => soma + f.size, 0);
      const tamanhoAtual = FOTOS_NOVO.reduce((soma, f) => soma + (f.url.length * 0.75), 0);
      if (tamanhoAtual + tamanhoNovo > MAX_ANEXOS_MB * 1024 * 1024) {
        toast(`As imagens somadas passariam de ${MAX_ANEXOS_MB} MB. Envie menos ou imagens menores.`, false);
        return;
      }
      for (const f of lista) {
        if (FOTOS_NOVO.length >= MAX_FOTOS) { toast('Máximo de ' + MAX_FOTOS + ' imagens', false); break; }
        try {
          const url = await tkComprimirImagem(f);
          FOTOS_NOVO.push({ url, nome: f.name });
        } catch (err) { toast('Arquivo ignorado: ' + err.message, false); }
      }
      renderFotoPrevNovo();
    };
    fotoDropNovo.addEventListener('click', () => fotoInputNovo.click());
    fotoInputNovo.addEventListener('change', () => { addFotosNovo(fotoInputNovo.files); fotoInputNovo.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => fotoDropNovo.addEventListener(ev, (e) => { e.preventDefault(); fotoDropNovo.style.borderColor = 'var(--gold)'; }));
    ['dragleave', 'drop'].forEach((ev) => fotoDropNovo.addEventListener(ev, (e) => { e.preventDefault(); fotoDropNovo.style.borderColor = ''; }));
    fotoDropNovo.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFotosNovo(e.dataTransfer.files); });

    document.getElementById('tkBtnCriarTicket').addEventListener('click', async () => {
      const form = document.getElementById('tkFormNovo');
      const msg = document.getElementById('tkSaveMsgNovo');
      const fd = new FormData(form);
      const g = (n) => (fd.get(n) || '').toString().trim();

      if (!g('identificador')) { msg.textContent = 'Selecione um identificador.'; return; }

      const responsavelSlug = g('responsavelSlug');
      const responsavel = responsavelSlug ? (USUARIOS_HUB.find((u) => u.slug === responsavelSlug) || {}).nome || '' : '';

      const btn = document.getElementById('tkBtnCriarTicket');
      btn.disabled = true; msg.textContent = 'Gravando…';
      try {
        const res = await fetch('/tickets/api/criar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pedido: g('pedido'), idVenda: g('idVenda'),
            identificador: g('identificador'), setor: g('setor'), responsavel, responsavelSlug,
            link: g('link'), observacao: g('observacao'), fotos: FOTOS_NOVO.map((f) => f.url),
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.erro || json.error || 'Erro desconhecido');
        close();
        await tkRefreshData(true);
        tkRender();
        toast('Ticket aberto', true);
      } catch (err) {
        msg.textContent = 'Erro: ' + err.message; btn.disabled = false;
      }
    });
  }

  tkBoot();
})();
