// Home (visão executiva) — reúne o que antes ficava espalhado:
// KPIs/Agenda/Foco vinham do Ranking SAC (planilha "TV"), Escala/Trocas/
// Sugestão vinham do Painel SAC. Aqui os dois mundos convivem na mesma
// página; cada bloco só roda se o elemento correspondente existir (o EJS
// só desenha o bloco pra quem tem acesso ao painel de origem).

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const hoje = new Date();
const diaHoje = hoje.getDate(), mesHoje = hoje.getMonth(), anoHoje = hoje.getFullYear();

// ── RELÓGIO ──────────────────────────────────────────────────
(function () {
  const el = document.getElementById('hh-clock');
  if (!el) return;
  const tick = () => { el.textContent = new Date().toLocaleTimeString('pt-BR'); };
  tick();
  setInterval(tick, 1000);
})();

// ── UTILS DE CSV (mesmo parsing usado no Ranking SAC) ─────────
function cleanStr(v) { if (v == null) return ''; return String(v).replace(/^"|"$/g, '').trim(); }
function safeNum(v) { if (v == null || v === '' || v === '-' || v === '—') return null; const n = parseFloat(String(v).replace(/"/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
function parseTime(v) { if (v == null || v === '' || v === '-' || v === '—') return null; const s = cleanStr(v); if (!s || s === '-' || s === '—') return null; const p = s.split(':'); if (p.length < 2) return null; const h = parseInt(p[0]) || 0, m = parseInt(p[1]) || 0; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
function timeStrToMin(s) { if (!s || s === '-' || s === '—') return 9999; const p = String(s).replace(/"/g, '').split(':'); return parseInt(p[0] || 0) * 60 + parseInt(p[1] || 0); }
function parseCSV(text) {
  return text.split('\n').map((line) => {
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur.trim());
    return cols;
  });
}

// ── KPIs DA EQUIPE + AGENDA + FOCO (dados do Ranking SAC) ─────
(function () {
  const kpisGrid = document.getElementById('hh-kpis-grid');
  if (!kpisGrid) return; // sem acesso a ranking-sac, nada a fazer aqui

  async function fetchSheet(chave) {
    const resp = await fetch(`/ranking-sac/api/csv/${chave}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return parseCSV(await resp.text());
  }

  function parseKPIs(rows) {
    const k = { tma: '--', csat: '--', nps: '--', refab: '--', ppf: '--' };
    rows.forEach((row) => {
      const label = cleanStr(row[0]).toLowerCase();
      const val = cleanStr(row[1]);
      if (label.includes('tma da equipe')) k.tma = parseTime(val) || val;
      if (label.includes('csat da equipe')) k.csat = safeNum(val);
      if (label.includes('nps da equipe')) k.nps = safeNum(val);
      if (label.includes('refabrica')) k.refab = parseTime(val) || val;
      if (label.includes('ppf') && label.includes('tmr') && !label.includes('refabri')) k.ppf = parseTime(val) || val;
    });
    return k;
  }

  function parseAgendaCSV(rows) {
    const dados = { agenda: [], foco: '' };
    const fi = rows.findIndex((r) => cleanStr(r[0]).toUpperCase().includes('FOCO DA SEMANA'));
    if (fi !== -1 && rows[fi + 1]) dados.foco = cleanStr(rows[fi + 1][0]);
    const di = rows.findIndex((r) => cleanStr(r[0]).toLowerCase() === 'dia');
    if (di !== -1) {
      for (let i = di + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !cleanStr(r[0]) || !cleanStr(r[2])) continue;
        dados.agenda.push({ dia: cleanStr(r[0]), hora: cleanStr(r[1]), desc: cleanStr(r[2]), tipo: cleanStr(r[3]) || 'Outro' });
      }
    }
    return dados;
  }

  function renderKPIs(k) {
    const fmt = (v) => v || '--';
    document.getElementById('hh-val-tma').innerHTML = fmt(k.tma) + '<span class="hh-kpi-unit">h</span>';
    document.getElementById('hh-val-csat').innerHTML = fmt(k.csat) + '<span class="hh-kpi-unit">%</span>';
    document.getElementById('hh-val-nps').textContent = fmt(k.nps);
    document.getElementById('hh-val-refab').innerHTML = fmt(k.refab) + '<span class="hh-kpi-unit">h</span>';
    document.getElementById('hh-val-ppf').innerHTML = fmt(k.ppf) + '<span class="hh-kpi-unit">h</span>';
    function setCard(id, good) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('status-ok', 'status-danger');
      el.classList.add(good ? 'status-ok' : 'status-danger');
      const v = el.querySelector('.hh-kpi-value');
      v.classList.toggle('ok', good);
      v.classList.toggle('danger', !good);
    }
    setCard('hh-card-tma', timeStrToMin(k.tma) <= 30);
    setCard('hh-card-csat', parseFloat(k.csat) >= 95);
    setCard('hh-card-nps', parseFloat(k.nps) >= 80);
    setCard('hh-card-refab', timeStrToMin(k.refab) <= 84 * 60);
    setCard('hh-card-ppf', timeStrToMin(k.ppf) <= 24 * 60);
  }

  function renderAgenda(eventos) {
    const diasOrdem = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const hojeMap = { 'segunda-feira': 'Segunda', 'terça-feira': 'Terça', 'quarta-feira': 'Quarta', 'quinta-feira': 'Quinta', 'sexta-feira': 'Sexta' };
    const diaHojeNome = hojeMap[new Date().toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase()] || '';
    const porDia = {}; diasOrdem.forEach((d) => { porDia[d] = []; });
    eventos.forEach((ev) => { if (porDia[ev.dia]) porDia[ev.dia].push(ev); });
    diasOrdem.forEach((d) => { porDia[d].sort((a, b) => a.hora.localeCompare(b.hora)); });
    const tipoClass = { '1:1': 'tipo-11', 'Reunião': 'tipo-reuniao', 'Evento': 'tipo-evento', 'Escala': 'tipo-escala', 'Outro': 'tipo-outro' };
    document.getElementById('hh-agenda-grid').innerHTML = diasOrdem.map((dia) => {
      const isHoje = dia === diaHojeNome;
      let h = `<div class="hh-agenda-col"><div class="hh-agenda-col-head${isHoje ? ' hoje' : ''}">${dia}${isHoje ? ' <span style="color:var(--gold);font-size:8px">HOJE</span>' : ''}</div>`;
      const evs = porDia[dia];
      if (!evs.length) { h += `<div class="hh-agenda-vazio">livre</div>`; }
      else { evs.forEach((ev) => { const tc = tipoClass[ev.tipo] || 'tipo-outro'; h += `<div class="hh-evento ${tc}"><div class="hh-evento-hora">${ev.hora}</div><div class="hh-evento-desc">${ev.desc}</div></div>`; }); }
      h += '</div>';
      return h;
    }).join('');
  }

  function renderFoco(texto) {
    const el = document.getElementById('hh-foco-texto');
    if (texto && texto.trim()) { el.textContent = texto.trim(); el.classList.remove('placeholder'); }
    else { el.textContent = 'Sem foco definido para esta semana.'; el.classList.add('placeholder'); }
  }

  async function carregarEquipe() {
    try {
      const [rowsKPI, rowsAgenda] = await Promise.all([fetchSheet('kpi'), fetchSheet('agenda')]);
      renderKPIs(parseKPIs(rowsKPI));
      const ag = parseAgendaCSV(rowsAgenda);
      renderAgenda(ag.agenda);
      renderFoco(ag.foco);
    } catch (e) { console.error('Erro ao carregar dados da equipe', e); }
  }

  carregarEquipe();
  setInterval(carregarEquipe, 300000);
})();

// ── ESCALA + TROCAS + SUGESTÃO (dados do Painel SAC) ──────────
(function () {
  const escGrid = document.getElementById('esc-grid');
  if (!escGrid) return; // sem acesso a painel-sac, nada a fazer aqui

  const API_BASE = '/painel-sac/api';
  const usuarioLogado = window.USUARIO_SESSAO;
  const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  let escalaMes = mesHoje, escalaAno = anoHoje;
  let trocasPendentes = [];
  let consultoresCache = [];
  let sabadosCache = {}; // por slug — reaproveitado tanto pro "seu sábado" quanto pro "sábado do colega"

  function atualizarLabelEscala() {
    const el = document.getElementById('escala-mes-label');
    if (el) el.textContent = MESES[escalaMes] + ' ' + escalaAno;
  }

  function mostrarBadgePendente() {
    const count = document.getElementById('trocas-count');
    const btn = document.getElementById('btn-trocas');
    if (!count || !btn) return;
    const n = (trocasPendentes || []).length;
    count.textContent = n;
    btn.style.opacity = n > 0 ? '1' : '0.5';
    btn.style.boxShadow = n > 0 ? '0 0 0 2px rgba(245,184,0,0.3)' : 'none';
  }

  function renderEscala(escala, mes, ano) {
    document.getElementById('esc-hdr').innerHTML = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d) => `<div class="hh-esc-head">${d}</div>`).join('');
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const dowPrimeiro = new Date(ano, mes, 1).getDay();
    const offset = (dowPrimeiro + 6) % 7;
    let html = '';
    for (let i = 0; i < offset; i++) html += '<div></div>';
    (escala || []).forEach((item) => {
      if (item.dia > diasNoMes) return;
      const isH = mes === mesHoje && ano === anoHoje && item.dia === diaHoje;
      html += `<div class="hh-day-cell hh-d-${item.status || 'F'} ${isH ? 'hh-d-today' : ''}"><div class="hh-day-n">${item.dia}</div><div class="hh-day-s">${item.status || 'F'}</div></div>`;
    });
    document.getElementById('esc-grid').innerHTML = html;
    escalaMes = mes; escalaAno = ano;
    // Só existe pra colaborador — na visão de gestor esse título virou um
    // texto fixo ("Minha escala"), sem id pra não ser sobrescrito aqui.
    const tituloEl = document.getElementById('escala-title');
    if (tituloEl) tituloEl.textContent = `Escala de serviço · ${MESES[mes].toUpperCase()} ${ano}`;
    atualizarLabelEscala();
    mostrarBadgePendente();
  }

  async function navEscala(dir) {
    escalaMes += dir;
    if (escalaMes > 11) { escalaMes = 0; escalaAno++; }
    if (escalaMes < 0) { escalaMes = 11; escalaAno--; }
    await carregarEscala();
  }
  window.navEscala = navEscala;

  async function carregarEscala() {
    try {
      const res = await fetch(`${API_BASE}/escala?mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      trocasPendentes = json.trocas_pendentes || [];
      const minhaEscala = json.escala || [];
      // Gestor "puro" (ex: Jhonys) não tem aba de escala própria na
      // planilha — a API sempre devolve [] pra ele. Em vez de mostrar um
      // calendário vazio (parece quebrado), esconde o bloco "minha escala"
      // só nesse caso; colaborador com mês legitimamente vazio continua
      // vendo o calendário normal (comportamento de antes).
      const wrap = document.getElementById('hh-minha-escala-wrap');
      if (wrap) wrap.style.display = usuarioLogado.role === 'gestor' && !minhaEscala.length ? 'none' : '';
      renderEscala(minhaEscala, escalaMes, escalaAno);
    } catch (e) {
      console.error('Erro ao carregar escala', e);
      document.getElementById('esc-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1">Escala ainda não disponível.</div>';
    }
    carregarEscalaEquipe(); // independente da escala pessoal — só existe a div pra gestor
  }

  // Busca com prazo máximo — nenhuma chamada da escala da equipe pode ficar
  // pendurada pra sempre (ex: Apps Script lento/instável em produção); depois
  // de "ms" sem resposta, desiste e quem chamou trata como falha.
  function fetchComPrazo(url, ms) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), ms);
    return fetch(url, { signal: controlador.signal }).finally(() => clearTimeout(timer));
  }

  // ── ESCALA DA EQUIPE (gestor) ─────────────────────────────────
  // Não existe uma ação no Apps Script que devolva a escala de todo mundo
  // de uma vez só — busca a lista de consultores e faz uma chamada de
  // /api/escala por pessoa, em paralelo. Roda automaticamente ao carregar a
  // página (sem ação do usuário), então não pode usar carregarConsultores()
  // direto — em caso de erro ela dispara um hubAlert() que FICA TRAVADO
  // esperando alguém clicar num modal que ninguém pediu pra abrir. Aqui é
  // tudo silencioso: erro vira estado vazio na tela, nunca um modal preso.
  async function carregarEscalaEquipe() {
    const cont = document.getElementById('hh-equipe-grid');
    if (!cont) return; // div só existe na home de quem é gestor
    try {
      if (!consultoresCache.length) {
        const res = await fetchComPrazo(`${API_BASE}/consultores`, 40000);
        const json = await res.json();
        if (!Array.isArray(json.consultores)) throw new Error(json.erro || 'resposta inválida');
        consultoresCache = json.consultores.filter((c) => c.slug !== usuarioLogado.slug);
      }
      const resultados = await Promise.all(consultoresCache.map((p) =>
        fetchComPrazo(`${API_BASE}/escala?slug=${encodeURIComponent(p.slug)}&mes=${escalaMes}&ano=${escalaAno}`, 40000)
          .then((r) => r.json())
          .then((json) => ({ pessoa: p, escala: json.escala || [] }))
          .catch(() => ({ pessoa: p, escala: [] }))
      ));
      renderEscalaEquipe(resultados, escalaMes, escalaAno);
    } catch (e) {
      console.error('Erro ao carregar escala da equipe', e);
      cont.innerHTML = '<div class="empty-state">Não foi possível carregar a escala da equipe agora. Tente atualizar a página em alguns minutos.</div>';
    }
  }

  function renderEscalaEquipe(resultados, mes, ano) {
    const cont = document.getElementById('hh-equipe-grid');
    if (!cont) return;
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();

    // Quem não tem NENHUM dia de escala nesse mês não é do time 5x2 (ex:
    // Wallac, que também é "consultor" pra outros fins, mas não entra
    // nessa rotação) — fora daqui, senão sobra uma linha vazia sem sentido.
    const comEscala = resultados.filter((r) => r.escala.length);

    const headCells = [];
    for (let dia = 1; dia <= diasNoMes; dia++) {
      headCells.push(`<div class="hh-eq-cell">${dia}</div>`);
    }

    const linhas = comEscala.map(({ pessoa, escala }) => {
      const porDia = {};
      escala.forEach((d) => { porDia[d.dia] = d.status; });
      const cells = [];
      for (let dia = 1; dia <= diasNoMes; dia++) {
        const status = porDia[dia] || '';
        cells.push(`<div class="hh-eq-cell st-${status || 'vazio'} editavel" data-slug="${pessoa.slug}" data-dia="${dia}" data-nome="${pessoa.nome}" onclick="excAbrirEditorEscala(this)" title="${pessoa.nome} · dia ${dia}${status ? ': ' + status : ' — sem dado'} (clique pra editar)">${status}</div>`);
      }
      return `<div class="hh-eq-row"><div class="hh-eq-name">${pessoa.nome.split(' ')[0]}</div><div class="hh-eq-days">${cells.join('')}</div></div>`;
    }).join('');

    if (!comEscala.length) {
      cont.innerHTML = '<div class="empty-state">Nenhuma escala encontrada pra esse mês.</div>';
      return;
    }

    cont.innerHTML = `<div class="hh-eq-grid">
      <div class="hh-eq-row hh-eq-head"><div class="hh-eq-name"></div><div class="hh-eq-days">${headCells.join('')}</div></div>
      ${linhas}
    </div>`;
  }

  // ── EDITAR ESCALA DA EQUIPE (gestor, direto no quadro) ────────
  let editEscalaAlvo = null; // { slug, dia, nome, cellEl }

  function excAbrirEditorEscala(cellEl) {
    const statusAtual = Array.from(cellEl.classList)
      .find((c) => c.startsWith('st-') && c !== 'st-vazio');
    editEscalaAlvo = {
      slug: cellEl.dataset.slug,
      dia: parseInt(cellEl.dataset.dia),
      nome: cellEl.dataset.nome,
      cellEl,
    };
    const dataFmt = `${String(editEscalaAlvo.dia).padStart(2, '0')}/${String(escalaMes + 1).padStart(2, '0')}/${escalaAno}`;
    document.getElementById('edit-escala-quem').textContent = `${editEscalaAlvo.nome} · ${dataFmt}`;
    document.getElementById('edit-escala-status').value = statusAtual ? statusAtual.slice(3) : 'F';
    document.getElementById('edit-escala-erro').style.display = 'none';
    document.getElementById('modal-editar-escala').classList.add('show');
  }
  window.excAbrirEditorEscala = excAbrirEditorEscala;

  function fecharEditorEscala() {
    document.getElementById('modal-editar-escala').classList.remove('show');
    editEscalaAlvo = null;
  }
  window.fecharEditorEscala = fecharEditorEscala;

  async function salvarEdicaoEscala() {
    if (!editEscalaAlvo) return;
    const status = document.getElementById('edit-escala-status').value;
    const erroEl = document.getElementById('edit-escala-erro');
    erroEl.style.display = 'none';
    try {
      const res = await fetch(`${API_BASE}/escala`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: editEscalaAlvo.slug, dia: editEscalaAlvo.dia, mes: escalaMes, ano: escalaAno, status }),
      });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao salvar.'; erroEl.style.display = 'block'; return; }
      // Atualiza a célula na hora — não faz sentido esperar outra rodada
      // (lenta) no Apps Script só pra confirmar o que a gente já sabe que
      // gravou.
      const cell = editEscalaAlvo.cellEl;
      cell.className = cell.className.replace(/st-\S+/, 'st-' + status);
      cell.textContent = status;
      cell.title = `${editEscalaAlvo.nome} · dia ${editEscalaAlvo.dia}: ${status} (clique pra editar)`;
      fecharEditorEscala();
    } catch (e) {
      erroEl.textContent = 'Erro ao salvar: ' + e.message;
      erroEl.style.display = 'block';
    }
  }
  window.salvarEdicaoEscala = salvarEdicaoEscala;

  // Sábados de um slug qualquer no mês/ano atualmente exibido no calendário —
  // reaproveitado tanto pro "seu sábado" quanto pro "sábado do colega".
  // Chave inclui mês/ano pra não reaproveitar cache de um mês já navegado.
  async function fetchSabados(slug) {
    const chave = `${slug}_${escalaMes}_${escalaAno}`;
    if (!sabadosCache[chave]) {
      const res = await fetch(`${API_BASE}/sabados-consultor?alvo=${encodeURIComponent(slug)}&mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      sabadosCache[chave] = json.sabados || [];
    }
    return sabadosCache[chave];
  }

  function opcoesSabados(sabados) {
    if (!sabados.length) return '<option value="">Nenhum sábado disponível neste mês</option>';
    return '<option value="">Selecione o sábado…</option>' +
      sabados.map((s) => `<option value="${s.dia}|${escalaMes}|${escalaAno}">${s.dia} ${MESES_ABREV[escalaMes]} ${escalaAno} (${s.status})</option>`).join('');
  }

  async function carregarMeusSabados() {
    const sel = document.getElementById('troca-dia-meu-select');
    sel.innerHTML = '<option value="">Carregando…</option>';
    try {
      const sabados = await fetchSabados(usuarioLogado.slug);
      sel.innerHTML = opcoesSabados(sabados);
    } catch (e) {
      sel.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }

  async function carregarSabadosAlvo() {
    const slug = document.getElementById('troca-consultor').value;
    const sel = document.getElementById('troca-dia-alvo');
    if (!slug) { sel.innerHTML = '<option value="">Selecione o consultor primeiro…</option>'; return; }
    sel.innerHTML = '<option value="">Carregando…</option>';
    sel.innerHTML = opcoesSabados(await fetchSabados(slug));
  }
  window.carregarSabadosAlvo = carregarSabadosAlvo;

  async function carregarConsultores() {
    if (consultoresCache.length) return;
    try {
      const res = await fetch(`${API_BASE}/consultores`);
      const json = await res.json();
      if (json.erro) { await hubAlert('Erro ao carregar consultores: ' + json.erro, 'erro'); }
      consultoresCache = (json.consultores || []).filter((c) => c.slug !== usuarioLogado.slug);
    } catch (e) {
      await hubAlert('Erro ao buscar consultores: ' + e.message, 'erro');
    }
  }

  async function carregarListaPendentes() {
    const lista = document.getElementById('troca-pendente-lista');
    lista.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px">Verificando solicitações…</div>';
    try {
      const res = await fetch(`${API_BASE}/escala?mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      trocasPendentes = json.trocas_pendentes || [];
      mostrarBadgePendente();
    } catch (e) { /* usa cache local se a busca falhar */ }

    const nomes = {};
    consultoresCache.forEach((c) => (nomes[c.slug] = c.nome));

    if (!trocasPendentes.length) {
      lista.innerHTML = '<div style="font-size:12px;color:var(--text-hint);text-align:center;padding:24px"><i class="ti ti-checks" style="font-size:24px;display:block;margin-bottom:8px;color:var(--ok-text)"></i>Nenhuma troca pendente no momento.</div>';
      return;
    }

    lista.innerHTML = trocasPendentes.map((t) => `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px">
        <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:var(--text)">
          <i class="ti ti-arrows-exchange" style="color:var(--gold);margin-right:4px"></i>
          ${nomes[t.solicitante] || t.solicitante} quer trocar com você
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          Sábado deles: <strong style="color:var(--text)">${t.dia_sol} ${MESES_ABREV[t.mes_sol]} ${t.ano_sol}</strong> →
          Seu sábado: <strong style="color:var(--text)">${t.dia_alvo} ${MESES_ABREV[t.mes_alvo]} ${t.ano_alvo}</strong>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="responderTroca('${t.id}', true)" style="flex:1;background:var(--gold);color:var(--on-gold,#1A1A18);border:none;border-radius:var(--radius-sm);padding:8px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer">✓ Aceitar</button>
          <button onclick="responderTroca('${t.id}', false)" style="background:none;border:1px solid rgba(212,75,75,0.4);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;color:var(--bad-text);font-family:inherit;cursor:pointer">✕ Recusar</button>
        </div>
      </div>
    `).join('');
  }

  async function abrirTrocas() {
    document.getElementById('modal-trocas').classList.add('show');
    document.getElementById('troca-erro').style.display = 'none';
    document.getElementById('troca-consultor').innerHTML = '<option value="">Selecione o consultor…</option>';
    document.getElementById('troca-dia-alvo').innerHTML = '<option value="">Selecione o consultor primeiro…</option>';
    document.getElementById('trocas-mes-ref').textContent = `${MESES[escalaMes]} ${escalaAno}`;

    const bloqueado = new Date().getDay() === 5;
    document.getElementById('trocas-bloqueado-aviso').style.display = bloqueado ? 'block' : 'none';
    document.getElementById('trocas-form').style.display = bloqueado ? 'none' : 'block';

    if (!bloqueado) {
      carregarMeusSabados();
      await carregarConsultores();
      document.getElementById('troca-consultor').innerHTML = '<option value="">Selecione o consultor…</option>' +
        consultoresCache.map((c) => `<option value="${c.slug}">${c.nome}</option>`).join('');
    } else {
      await carregarConsultores();
    }

    await carregarListaPendentes();
  }
  window.abrirTrocas = abrirTrocas;

  function fecharTrocas() { document.getElementById('modal-trocas').classList.remove('show'); }
  window.fecharTrocas = fecharTrocas;

  async function enviarTroca() {
    const erroEl = document.getElementById('troca-erro');
    const meuVal = document.getElementById('troca-dia-meu-select').value;
    const slug = document.getElementById('troca-consultor').value;
    const alvoVal = document.getElementById('troca-dia-alvo').value;
    erroEl.style.display = 'none';
    if (!meuVal) { erroEl.textContent = 'Selecione o seu sábado.'; erroEl.style.display = 'block'; return; }
    if (!slug) { erroEl.textContent = 'Selecione o consultor.'; erroEl.style.display = 'block'; return; }
    if (!alvoVal) { erroEl.textContent = 'Selecione o sábado do colega.'; erroEl.style.display = 'block'; return; }
    const [dia_solicitante, mes_solicitante, ano_solicitante] = meuVal.split('|').map(Number);
    const [dia_alvo, mes_alvo, ano_alvo] = alvoVal.split('|').map(Number);
    const payload = { dia_solicitante, mes_solicitante, ano_solicitante, consultor_alvo: slug, dia_alvo, mes_alvo, ano_alvo };
    try {
      const res = await fetch(`${API_BASE}/solicitar-troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao solicitar.'; erroEl.style.display = 'block'; return; }
      fecharTrocas();
      await hubAlert('Solicitação enviada! O colega receberá a notificação no painel.', 'sucesso');
    } catch (e) {
      erroEl.textContent = e.message; erroEl.style.display = 'block';
    }
  }
  window.enviarTroca = enviarTroca;

  async function responderTroca(idTroca, aceitar) {
    const payload = { id_troca: idTroca, aceitar };
    try {
      const res = await fetch(`${API_BASE}/responder-troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) { await hubAlert('Erro: ' + (json.erro || 'tente novamente'), 'erro'); return; }
      if (aceitar) {
        await hubAlert('Troca aceita! As escalas foram atualizadas.', 'sucesso');
        await carregarEscala();
      } else {
        await hubAlert('Troca recusada.', 'info');
      }
      await carregarListaPendentes();
    } catch (e) { await hubAlert('Erro: ' + e.message, 'erro'); }
  }
  window.responderTroca = responderTroca;

  // ── SUGESTÃO ──
  function abrirSugestao() {
    document.getElementById('sug-form').style.display = 'block';
    document.getElementById('sug-ok').style.display = 'none';
    document.getElementById('sug-titulo').value = '';
    document.getElementById('sug-texto').value = '';
    document.getElementById('popup-sugestao').classList.add('open');
  }
  window.abrirSugestao = abrirSugestao;

  async function enviarSugestao() {
    const titulo = document.getElementById('sug-titulo').value.trim();
    const texto = document.getElementById('sug-texto').value.trim();
    if (!titulo || !texto) { await hubAlert('Preencha o título e a sugestão antes de enviar.', 'erro'); return; }
    try {
      await fetch(`${API_BASE}/sugestao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo, sugestao: texto }) });
      document.getElementById('sug-nome-ok').textContent = `Obrigado pela contribuição, ${usuarioLogado.nome.split(' ')[0]}.`;
      document.getElementById('sug-form').style.display = 'none';
      document.getElementById('sug-ok').style.display = 'block';
    } catch (e) { await hubAlert('Erro ao enviar. Tente novamente.', 'erro'); }
  }
  window.enviarSugestao = enviarSugestao;

  carregarEscala();
})();
