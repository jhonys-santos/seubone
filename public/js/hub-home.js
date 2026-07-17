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
  let escalaMes = mesHoje, escalaAno = anoHoje;
  let trocasPendentes = [];
  let trocaDiaMeu = null, trocaMesMeu = null, trocaAnoMeu = null;
  let consultoresCache = [];
  let sabadosAlvoCache = {};

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
    const dowPrimeiro = new Date(ano, mes, 1).getDay();
    const offset = (dowPrimeiro + 6) % 7;
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const bloqueado = new Date().getDay() === 5;
    let html = '';
    for (let i = 0; i < offset; i++) html += '<div></div>';
    (escala || []).forEach((item) => {
      if (item.dia > diasNoMes) return;
      const isH = mes === mesHoje && ano === anoHoje && item.dia === diaHoje;
      const dow = new Date(ano, mes, item.dia).getDay();
      const isSab = dow === 6;
      const podeClicar = isSab && !bloqueado;
      const clique = podeClicar ? `onclick="abrirTroca(${item.dia},${mes},${ano},'${item.status}')" style="cursor:pointer"` : '';
      const trocaBadge = podeClicar ? `<div style="position:absolute;top:3px;right:3px;font-size:8px;color:var(--gold);opacity:0.7"><i class="ti ti-arrows-exchange"></i></div>` : '';
      html += `<div class="hh-day-cell hh-d-${item.status || 'F'} ${isH ? 'hh-d-today' : ''}" ${clique} style="position:relative">${trocaBadge}<div class="hh-day-n">${item.dia}</div><div class="hh-day-s">${item.status || 'F'}</div></div>`;
    });
    document.getElementById('esc-grid').innerHTML = html;
    escalaMes = mes; escalaAno = ano;
    document.getElementById('escala-title').textContent = `Escala de serviço · ${MESES[mes].toUpperCase()} ${ano}`;
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
      renderEscala(json.escala || [], escalaMes, escalaAno);
    } catch (e) {
      console.error('Erro ao carregar escala', e);
      document.getElementById('esc-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1">Escala ainda não disponível.</div>';
    }
  }

  async function abrirTroca(dia, mes, ano, status) {
    const dataSabado = new Date(ano, mes, dia);
    const hojeD = new Date(); hojeD.setHours(0, 0, 0, 0);
    if (dataSabado < hojeD) {
      await hubAlert('Não é possível solicitar troca para um sábado que já passou.', 'erro');
      return;
    }
    trocaDiaMeu = dia; trocaMesMeu = mes; trocaAnoMeu = ano;
    document.getElementById('troca-dia-meu').textContent = `${dia} de ${MESES[mes]} de ${ano} (${status})`;
    document.getElementById('troca-erro').style.display = 'none';
    document.getElementById('troca-dia-alvo').innerHTML = '<option value="">Selecione o consultor primeiro…</option>';

    if (!consultoresCache.length) {
      try {
        const res = await fetch(`${API_BASE}/consultores`);
        const json = await res.json();
        if (json.erro) { await hubAlert('Erro ao carregar consultores: ' + json.erro, 'erro'); }
        consultoresCache = (json.consultores || []).filter((c) => c.slug !== usuarioLogado.slug);
      } catch (e) {
        await hubAlert('Erro ao buscar consultores: ' + e.message, 'erro');
      }
    }
    const sel = document.getElementById('troca-consultor');
    sel.innerHTML = '<option value="">Selecione o consultor…</option>' + consultoresCache.map((c) => `<option value="${c.slug}">${c.nome}</option>`).join('');
    document.getElementById('modal-troca').classList.add('show');
  }
  window.abrirTroca = abrirTroca;

  function fecharTroca() { document.getElementById('modal-troca').classList.remove('show'); }
  window.fecharTroca = fecharTroca;

  async function carregarSabadosAlvo() {
    const slug = document.getElementById('troca-consultor').value;
    if (!slug) return;
    const sel = document.getElementById('troca-dia-alvo');
    sel.innerHTML = '<option value="">Carregando…</option>';
    if (!sabadosAlvoCache[slug]) {
      const res = await fetch(`${API_BASE}/sabados-consultor?alvo=${encodeURIComponent(slug)}&mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      sabadosAlvoCache[slug] = json.sabados || [];
    }
    const sabados = sabadosAlvoCache[slug];
    if (!sabados.length) { sel.innerHTML = '<option value="">Nenhum sábado disponível neste mês</option>'; return; }
    const mesesAbrev = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    sel.innerHTML = '<option value="">Selecione o sábado…</option>' + sabados.map((s) => `<option value="${s.dia}|${escalaMes}|${escalaAno}">${s.dia} ${mesesAbrev[escalaMes]} ${escalaAno} (${s.status})</option>`).join('');
  }
  window.carregarSabadosAlvo = carregarSabadosAlvo;

  async function enviarTroca() {
    const erroEl = document.getElementById('troca-erro');
    const slug = document.getElementById('troca-consultor').value;
    const alvoVal = document.getElementById('troca-dia-alvo').value;
    erroEl.style.display = 'none';
    if (!slug) { erroEl.textContent = 'Selecione o consultor.'; erroEl.style.display = 'block'; return; }
    if (!alvoVal) { erroEl.textContent = 'Selecione o sábado do colega.'; erroEl.style.display = 'block'; return; }
    const [dia_alvo, mes_alvo, ano_alvo] = alvoVal.split('|').map(Number);
    const payload = { dia_solicitante: trocaDiaMeu, mes_solicitante: trocaMesMeu, ano_solicitante: trocaAnoMeu, consultor_alvo: slug, dia_alvo, mes_alvo, ano_alvo };
    try {
      const res = await fetch(`${API_BASE}/solicitar-troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao solicitar.'; erroEl.style.display = 'block'; return; }
      fecharTroca();
      await hubAlert('Solicitação enviada! O colega receberá a notificação no painel.', 'sucesso');
    } catch (e) {
      erroEl.textContent = e.message; erroEl.style.display = 'block';
    }
  }
  window.enviarTroca = enviarTroca;

  async function abrirTrocasPendentes() {
    const lista = document.getElementById('troca-pendente-lista');
    lista.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px">Verificando solicitações…</div>';
    document.getElementById('modal-troca-pendente').classList.add('show');

    try {
      const res = await fetch(`${API_BASE}/escala?mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      trocasPendentes = json.trocas_pendentes || [];
      mostrarBadgePendente();
    } catch (e) { /* usa cache local se a busca falhar */ }

    if (!consultoresCache.length) {
      try {
        const res2 = await fetch(`${API_BASE}/consultores`);
        const json2 = await res2.json();
        consultoresCache = json2.consultores || [];
      } catch (e) {}
    }

    const mesesAbrev = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
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
          Sábado deles: <strong style="color:var(--text)">${t.dia_sol} ${mesesAbrev[t.mes_sol]} ${t.ano_sol}</strong> →
          Seu sábado: <strong style="color:var(--text)">${t.dia_alvo} ${mesesAbrev[t.mes_alvo]} ${t.ano_alvo}</strong>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="responderTroca('${t.id}', true)" style="flex:1;background:var(--gold);color:var(--on-gold,#1A1A18);border:none;border-radius:var(--radius-sm);padding:8px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer">✓ Aceitar</button>
          <button onclick="responderTroca('${t.id}', false)" style="background:none;border:1px solid rgba(212,75,75,0.4);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;color:var(--bad-text);font-family:inherit;cursor:pointer">✕ Recusar</button>
        </div>
      </div>
    `).join('');
  }
  window.abrirTrocasPendentes = abrirTrocasPendentes;

  function fecharTrocaPendente() { document.getElementById('modal-troca-pendente').classList.remove('show'); }
  window.fecharTrocaPendente = fecharTrocaPendente;

  async function responderTroca(idTroca, aceitar) {
    const payload = { id_troca: idTroca, aceitar };
    try {
      const res = await fetch(`${API_BASE}/responder-troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) { await hubAlert('Erro: ' + (json.erro || 'tente novamente'), 'erro'); return; }
      trocasPendentes = trocasPendentes.filter((t) => t.id !== idTroca);
      fecharTrocaPendente();
      if (aceitar) {
        await hubAlert('Troca aceita! As escalas foram atualizadas.', 'sucesso');
        await carregarEscala();
      } else {
        await hubAlert('Troca recusada.', 'info');
      }
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
