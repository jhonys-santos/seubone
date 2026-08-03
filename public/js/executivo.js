// Dashboard Executivo (rascunho, gestor) — 100% client-side, chamando os
// mesmos endpoints que os painéis originais já expõem (nenhum Apps Script
// novo). Reaproveita IE_TIMES/ieDiasSemana/ieDiasMes/ieFmtISO/ieBarCol/
// ieFormatValor/ieAtingeMeta/ieAgregar, definidos em indicadores-equipe.js
// (carregado antes deste script na view) — evita duplicar a config de
// metas/unidades e a lógica de barra que já existe pra esse painel.

// ── KPIs DA EQUIPE (TMA/CSAT/TMR Refab/TMR PPF+1 com histórico + NPS) ──
const EXEC_METRICAS = [
  { time: 'atendimento', key: 'tma' },
  { time: 'atendimento', key: 'csat' },
  { time: 'atendimento', key: 'tmt_refab' },
  { time: 'resolucao', key: 'tempo_ppf' },
];

let excDiasAtuais = ieDiasSemana();

function excSetPeriodo(periodo, btn) {
  document.querySelectorAll('.ie-tabs .ie-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  excDiasAtuais = periodo === 'mes' ? ieDiasMes() : ieDiasSemana();
  excCarregarKpis();
}
window.excSetPeriodo = excSetPeriodo;

async function excCarregarKpis() {
  const cont = document.getElementById('exec-kpis-chart');
  cont.innerHTML = '<div class="ie-carregando"><i class="ti ti-loader-2" aria-hidden="true"></i> Carregando indicadores...</div>';

  const desde = ieFmtISO(excDiasAtuais[0].data);
  const ate = ieFmtISO(excDiasAtuais[excDiasAtuais.length - 1].data);

  try {
    const [atendimento, resolucao] = await Promise.all([
      fetch(`/indicadores-equipe/api/dados?time=atendimento&desde=${desde}&ate=${ate}`).then((r) => r.json()),
      fetch(`/indicadores-equipe/api/dados?time=resolucao&desde=${desde}&ate=${ate}`).then((r) => r.json()),
    ]);
    if (!atendimento.ok) throw new Error(atendimento.erro || 'Falha ao buscar Time Atendimento');
    if (!resolucao.ok) throw new Error(resolucao.erro || 'Falha ao buscar Time Resolução');
    excRenderKpisChart({ atendimento: atendimento.porEquipe || {}, resolucao: resolucao.porEquipe || {} });
  } catch (err) {
    cont.innerHTML = `<div class="ie-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar os indicadores: ${err.message}</div>`;
  }
}

// Só o valor agregado do período + meta — sem gráfico diário, pra dar uma
// leitura rápida da equipe no período (semana/mês), no mesmo estilo de
// card usado no NPS e no resto do dashboard (verde dentro da meta, vermelho
// fora dela).
function excRenderKpisChart(porEquipe) {
  const cont = document.getElementById('exec-kpis-chart');

  cont.innerHTML = EXEC_METRICAS.map(({ time, key }) => {
    const m = IE_TIMES[time].metricas.find((mm) => mm.key === key);
    const serie = porEquipe[time][key] || [];
    const totalPeriodo = ieAgregar(serie, m.agregacao);
    const atinge = ieAtingeMeta(totalPeriodo, m.meta);
    const cardCls = atinge === null ? '' : atinge ? 'status-ok' : 'status-danger';
    const valCls = atinge === null ? '' : atinge ? 'ok' : 'danger';
    const metaTxt = m.meta ? (m.meta.direcao === 'menor' ? '&lt;' : '&gt;') + ' ' + ieFormatValor(m.meta.valor, m.unidade) : '';

    return `<div class="hh-kpi-card ${cardCls}">
      <div class="hh-kpi-label">${m.label}</div>
      <div class="hh-kpi-value ${valCls}">${ieFormatValor(totalPeriodo, m.unidade)}</div>
      <div class="hh-kpi-meta">Meta: <span>${metaTxt}</span></div>
    </div>`;
  }).join('');
}

async function excCarregarNps() {
  const el = document.getElementById('exec-val-nps');
  try {
    const resp = await fetch('/ranking-sac/api/csv/kpi', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rows = parseCSV(await resp.text()); // parseCSV/cleanStr/safeNum vêm de hub-home.js
    let nps = '--';
    rows.forEach((row) => {
      if (cleanStr(row[0]).toLowerCase().includes('nps da equipe')) {
        const v = safeNum(cleanStr(row[1]));
        nps = v != null ? v : '--';
      }
    });
    el.textContent = nps;
  } catch (err) {
    el.textContent = '--';
  }
}

// ── SOLICITAÇÕES AO FINANCEIRO (Registro/Reembolso/Pagamento pendentes) ──
async function excCarregarFinanceiro() {
  const cont = document.getElementById('exec-financeiro');
  try {
    const [registro, reembolso, pagamento] = await Promise.all([
      fetch('/registro-demandas/api/list').then((r) => r.json()),
      fetch('/registro-demandas/api/list-reembolso').then((r) => r.json()),
      fetch('/registro-demandas/api/list-pagamento').then((r) => r.json()),
    ]);
    const contarPendentes = (lista) => (Array.isArray(lista) ? lista : []).filter((it) => it.Status === 'Pendente').length;
    const cards = [
      { label: 'Registro pendentes', valor: contarPendentes(registro) },
      { label: 'Reembolso pendentes', valor: contarPendentes(reembolso) },
      { label: 'Pagamento pendentes', valor: contarPendentes(pagamento) },
    ];
    cont.innerHTML = cards.map((c) => `<div class="hh-kpi-card"><div class="hh-kpi-label">${c.label}</div><div class="hh-kpi-value">${c.valor}</div></div>`).join('');
  } catch (err) {
    cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar as solicitações ao financeiro.</div>`;
  }
}

// ── QUITAÇÕES PENDENTES (total + atrasados) ──────────────────────────
// Réplica de calcularUrgencia() em quitacoes-painel.js: sem "dataPrevista"
// válida vencida, cai pro fallback de dias em aberto — aqui só importa se
// está atrasado ou não, não o rótulo completo.
function excParseDataPrevista(str) {
  if (!str) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + 'T00:00:00' : str);
  return isNaN(d.getTime()) ? null : d;
}
function excQuitacaoAtrasada(it) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const prevista = excParseDataPrevista(it.dataPrevista);
  if (prevista) return prevista < hoje;
  const cadastro = new Date(it.dataCadastro);
  cadastro.setHours(0, 0, 0, 0);
  const diasAberto = Math.max(0, Math.round((hoje - cadastro) / 86400000));
  return diasAberto > 7;
}

async function excCarregarQuitacoes() {
  const cont = document.getElementById('exec-quitacoes');
  try {
    const resp = await fetch('/quitacoes/api/lista');
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('sem-acesso');
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');
    const itens = json.itens || [];
    const atrasados = itens.filter(excQuitacaoAtrasada).length;
    cont.innerHTML = `
      <div class="hh-kpi-card"><div class="hh-kpi-label">Pendentes</div><div class="hh-kpi-value">${itens.length}</div></div>
      <div class="hh-kpi-card ${atrasados > 0 ? 'status-danger' : 'status-ok'}"><div class="hh-kpi-label">Atrasadas</div><div class="hh-kpi-value ${atrasados > 0 ? 'danger' : 'ok'}">${atrasados}</div></div>
    `;
  } catch (err) {
    cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-lock" aria-hidden="true"></i> Sem acesso ao painel de Quitações nesta conta.</div>`;
  }
}

// ── PRODUÇÃO (WALLAC) — contagem de cards por coluna do kanban ───────
async function excCarregarWallac() {
  const cont = document.getElementById('exec-wallac');
  try {
    const resp = await fetch('/wallac/api/cards');
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('sem-acesso');
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');
    const cards = json.cards || [];
    const colunas = ['A chegar', 'Recebido', 'Em produção', 'Finalizado'];
    const porColuna = {};
    colunas.forEach((c) => (porColuna[c] = 0));
    cards.forEach((c) => { if (porColuna[c.status] != null) porColuna[c.status]++; });
    cont.innerHTML = colunas.map((c) => `<div class="hh-kpi-card"><div class="hh-kpi-label">${c}</div><div class="hh-kpi-value">${porColuna[c]}</div></div>`).join('');
  } catch (err) {
    cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-lock" aria-hidden="true"></i> Sem acesso ao painel Wallac nesta conta.</div>`;
  }
}

// ── CORRIDAS AVULSAS — total da semana atual (segunda a domingo) ─────
function excSemanaAtual() {
  const hoje = new Date();
  const dow = hoje.getDay(); // 0=domingo
  const offsetSegunda = dow === 0 ? -6 : 1 - dow;
  const segunda = new Date(hoje); segunda.setDate(hoje.getDate() + offsetSegunda);
  const domingo = new Date(segunda); domingo.setDate(segunda.getDate() + 6);
  return { desde: ieFmtISO(segunda), ate: ieFmtISO(domingo) };
}

async function excCarregarCorridas() {
  const cont = document.getElementById('exec-corridas');
  try {
    const { desde, ate } = excSemanaAtual();
    const resp = await fetch(`/corridas-avulsas/api/lista?desde=${desde}&ate=${ate}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');
    const total = (json.itens || []).reduce((soma, it) => soma + (Number(it.valor) || 0), 0);
    const totalFmt = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    cont.innerHTML = `<div class="hh-kpi-card"><div class="hh-kpi-label">Total da semana</div><div class="hh-kpi-value" style="font-size:20px">${totalFmt}</div></div>`;
  } catch (err) {
    cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar as corridas avulsas.</div>`;
  }
}

excCarregarKpis();
excCarregarNps();
excCarregarFinanceiro();
excCarregarQuitacoes();
excCarregarWallac();
excCarregarCorridas();
