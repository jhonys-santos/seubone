// Indicadores Equipe (visão de gestor) — comparativo diário por consultor,
// puxado da planilha "KPI PV - 2026" (aba "KPI Visão 2026") via
// /indicadores-equipe/api/dados.

const IE_CORES = ['ie-c-0', 'ie-c-1', 'ie-c-2', 'ie-c-3', 'ie-c-4', 'ie-c-5'];
// Mesmas cores de IE_CORES, mas em valor literal — usado na linha de
// tendência (SVG), que não lê classe CSS.
const IE_CORES_HEX = ['#4C8DFF', '#3DAF72', '#9c6cd4', '#E8618C', '#F0954D', '#4FD1C5'];

function ieFormatMinutos(mins) {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h + ':' + String(m).padStart(2, '0');
}
function ieFormatValor(valor, unidade) {
  if (valor == null) return '—';
  if (unidade === 'tempo') return ieFormatMinutos(valor);
  if (unidade === 'pct') return valor.toFixed(0) + '%';
  return String(Math.round(valor));
}
function ieAtingeMeta(valor, meta) {
  if (!meta || valor == null) return null;
  return meta.direcao === 'menor' ? valor <= meta.valor : valor >= meta.valor;
}

// ── PERÍODO (rótulos + data real de cada dia, pra montar desde/até da API) ──
function ieFmtDDMM(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
function ieDiasSemana() {
  const hoje = new Date();
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje); d.setDate(hoje.getDate() - i);
    labels.push({ data: d, label: ieFmtDDMM(d), hoje: i === 0 });
  }
  return labels;
}
function ieDiasMes() {
  const hoje = new Date();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const labels = [];
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
    labels.push({ data: d, label: String(dia), hoje: dia === hoje.getDate() });
  }
  return labels;
}
// "YYYY-MM-DD" (valor nativo de <input type="date">) como data local, pra
// não cair um dia por causa de fuso horário se interpretasse como UTC.
function ieParseDataLocal(str) {
  const [ano, mes, dia] = str.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}
function ieMesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function ieDiasPersonalizado(deStr, ateStr) {
  const de = ieParseDataLocal(deStr), ate = ieParseDataLocal(ateStr);
  const hoje = new Date();
  const labels = [];
  const atual = new Date(de);
  while (atual <= ate) {
    labels.push({ data: new Date(atual), label: ieFmtDDMM(atual), hoje: ieMesmoDia(atual, hoje) });
    atual.setDate(atual.getDate() + 1);
  }
  return labels;
}
function ieFmtISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const IE_TIMES = {
  atendimento: {
    titulo: 'Time Atendimento',
    consultores: ['Iasmin Cristina', 'Nathalia Guedes', 'Francis Medeiros'],
    resumoKeys: ['tma', 'csat', 'atendimentos', 'tickets_refab', 'tmt_refab'],
    metricas: [
      { key: 'tma', label: 'TMA', unidade: 'tempo', agregacao: 'media', meta: { valor: 30, direcao: 'menor' } },
      { key: 'csat', label: 'CSAT', unidade: 'pct', agregacao: 'media', meta: { valor: 95, direcao: 'maior' } },
      { key: 'atendimentos', label: 'Atendimentos', unidade: 'num', agregacao: 'soma' },
      { key: 'tickets_refab', label: 'Tickets Refabricação', unidade: 'num', agregacao: 'soma' },
      { key: 'tmt_refab', label: 'TMT Refabricação', unidade: 'tempo', agregacao: 'media', meta: { valor: 84 * 60, direcao: 'menor' } },
    ],
  },
  resolucao: {
    titulo: 'Time Resolução',
    consultores: ['Gabrielle Batista', 'Daniel Sheldon'],
    resumoKeys: ['csat', 'tempo_ppf', 'qtd_ppf'],
    metricas: [
      { key: 'csat', label: 'CSAT', unidade: 'pct', agregacao: 'media', meta: { valor: 95, direcao: 'maior' } },
      { key: 'tempo_ppf', label: 'Tempo PPF+1', unidade: 'tempo', agregacao: 'media' },
      { key: 'qtd_ppf', label: 'Tickets PPF+1', unidade: 'num', agregacao: 'soma' },
      // Planilha só tem essa métrica no nível de Equipe, sem quebra por
      // consultor — por isso não entra em resumoKeys nem tem gráfico
      // individual (semIndividual), só o gráfico de Equipe.
      { key: 'tempo_logo', label: 'Tempo retorno teste de logo', unidade: 'tempo', agregacao: 'media', meta: { valor: 120, direcao: 'menor' }, semIndividual: true },
    ],
  },
};

// ── RENDER ────────────────────────────────────────────────────
let ieDados = null;       // porConsultor: { [nome]: { [key]: [valores] } }
let ieDadosEquipe = null; // porEquipe: { [key]: [valores] } — vem pronto da planilha, não é derivado
let ieDiasAtuais = null;
let ieConfig = null;

function ieAgregar(serie, agregacao) {
  const vals = (serie || []).filter((v) => v != null);
  if (!vals.length) return null;
  const soma = vals.reduce((a, b) => a + b, 0);
  return agregacao === 'soma' ? soma : soma / vals.length;
}

function ieRenderResumo() {
  const grid = document.getElementById('ie-resumo-grid');
  grid.innerHTML = ieConfig.consultores.map((nome, i) => {
    const iniciais = nome.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const stats = ieConfig.resumoKeys.map((key) => {
      const m = ieConfig.metricas.find((mm) => mm.key === key);
      const serie = ieDados[nome][key];
      const valor = ieAgregar(serie, m.agregacao);
      const atinge = ieAtingeMeta(valor, m.meta);
      const cls = atinge === null ? '' : atinge ? 'ok' : 'bad';
      return `<div class="ie-resumo-stat"><span class="ie-resumo-stat-lbl">${m.label}</span><span class="ie-resumo-stat-val ${cls}">${ieFormatValor(valor, m.unidade)}</span></div>`;
    }).join('');
    return `<div class="ie-resumo-card">
      <div class="ie-resumo-head">
        <div class="ie-resumo-avatar ${IE_CORES[i % IE_CORES.length]}">${iniciais}</div>
        <div class="ie-resumo-nome">${nome}</div>
      </div>
      <div class="ie-resumo-stats">${stats}</div>
    </div>`;
  }).join('');
}

// Uma célula de gráfico de barra (usada tanto na linha por consultor
// quanto, sozinha, na linha da Equipe — que não passa "corClasse", pois
// a cor dela já vem do CSS de .ie-chart-equipe).
function ieBarCol(valor, maxVal, corClasse, tooltip) {
  const alturaPct = valor == null ? 0 : Math.max(2, Math.round((valor / maxVal) * 100));
  return `<div class="ie-bar-col"><div class="ie-bar ${corClasse || ''}" style="height:${alturaPct}%"></div><div class="ie-bar-tooltip">${tooltip}</div></div>`;
}

// Regressão linear simples sobre a série (ignorando dias sem dado) — mesma
// conta que Meus Indicadores já usa nos gráficos de evolução.
function ieCalcTrend(valores) {
  const pontos = valores.map((v, i) => (v != null ? { x: i, y: v } : null)).filter(Boolean);
  if (pontos.length < 2) return null;
  const n = pontos.length;
  const sx = pontos.reduce((a, p) => a + p.x, 0), sy = pontos.reduce((a, p) => a + p.y, 0);
  const sxy = pontos.reduce((a, p) => a + p.x * p.y, 0), sxx = pontos.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const m = (n * sxy - sx * sy) / denom, b = (sy - m * sx) / n;
  return (x) => m * x + b;
}

// Desenha a linha tracejada de tendência por cima de uma coluna específica
// (colIndex) dentro de cada .ie-day-group de um gráfico já renderizado —
// precisa medir posição real na tela, por isso só roda depois do innerHTML
// já estar no DOM (chamado via setTimeout no fim do render).
function ieDesenharTendencia(chartEl, valores, maxVal, colIndex, cor) {
  const trendFn = ieCalcTrend(valores);
  if (!trendFn) return;
  const grupos = chartEl.querySelectorAll('.ie-day-group');
  if (grupos.length < 2) return;
  const chartRect = chartEl.getBoundingClientRect();
  const pts = [];
  grupos.forEach((grupo, i) => {
    const row = grupo.querySelector('.ie-bars-row');
    const col = row.children[colIndex];
    if (!col) return;
    const colRect = col.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const x = colRect.left - chartRect.left + colRect.width / 2;
    const yVal = Math.max(0, Math.min(maxVal, trendFn(i)));
    const y = (rowRect.bottom - chartRect.top) - (yVal / maxVal) * rowRect.height;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  });
  if (pts.length < 2) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ie-trend-svg');
  svg.style.cssText = `position:absolute;top:0;left:0;width:${chartEl.scrollWidth}px;height:100%;pointer-events:none;overflow:visible;`;
  const linha = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  linha.setAttribute('points', pts.join(' '));
  linha.setAttribute('fill', 'none');
  linha.style.stroke = cor;
  linha.setAttribute('stroke-width', '1.5');
  linha.setAttribute('stroke-dasharray', '4 3');
  linha.setAttribute('stroke-linecap', 'round');
  svg.appendChild(linha);
  chartEl.style.position = 'relative';
  chartEl.appendChild(svg);
}

function ieRenderMetricas() {
  const denso = ieDiasAtuais.length > 10; // mês ou intervalo personalizado longo — 1 barra por dia, sem agrupar por consultor
  const cont = document.getElementById('ie-metricas');

  // Calcula tudo uma vez só — o mesmo objeto alimenta o HTML e, depois que
  // ele estiver no DOM, o desenho das linhas de tendência.
  const porMetrica = ieConfig.metricas.map((m) => {
    const equipeSerie = ieDadosEquipe[m.key] || [];
    const totalEquipe = ieAgregar(equipeSerie, m.agregacao);
    const maxValEquipe = Math.max(1, ...equipeSerie.filter((v) => v != null));
    if (m.semIndividual) return { m, equipeSerie, totalEquipe, maxVal: 1, maxValEquipe };

    // Escala do gráfico por consultor NÃO inclui a Equipe — ela vira um
    // gráfico próprio, com a própria escala, bem abaixo. Numa métrica de
    // soma a Equipe é sempre maior que qualquer indivíduo; misturando as
    // duas escalas as barras de cada pessoa ficariam pequenas/achatadas.
    const maxVal = Math.max(1, ...ieConfig.consultores.flatMap((nome) => (ieDados[nome][m.key] || []).filter((v) => v != null)));
    return { m, equipeSerie, totalEquipe, maxVal, maxValEquipe };
  });

  cont.innerHTML = porMetrica.map(({ m, equipeSerie, totalEquipe, maxVal, maxValEquipe }) => {
    const legend = m.semIndividual ? '' : ieConfig.consultores.map((nome, i) => `<div class="ie-legend-item"><div class="ie-legend-dot ${IE_CORES[i % IE_CORES.length]}"></div>${nome}</div>`).join('');

    const dias = m.semIndividual ? '' : ieDiasAtuais.map((dia, di) => {
      const bars = ieConfig.consultores.map((nome, i) => {
        const v = (ieDados[nome][m.key] || [])[di];
        return ieBarCol(v, maxVal, IE_CORES[i % IE_CORES.length], `${nome.split(' ')[0]}: ${ieFormatValor(v, m.unidade)}`);
      }).join('');
      return `<div class="ie-day-group">
        <div class="ie-bars-row">${bars}</div>
        <div class="ie-day-label ${dia.hoje ? 'hoje' : ''}">${dia.label}</div>
      </div>`;
    }).join('');

    const diasEquipe = ieDiasAtuais.map((dia, di) => {
      const v = equipeSerie[di];
      const bar = ieBarCol(v, maxValEquipe, null, `Equipe: ${ieFormatValor(v, m.unidade)}`);
      return `<div class="ie-day-group">
        <div class="ie-bars-row">${bar}</div>
        <div class="ie-day-label ${dia.hoje ? 'hoje' : ''}">${dia.label}</div>
      </div>`;
    }).join('');

    return `<div class="ie-metrica">
      <div class="ie-metrica-head">
        <div class="ie-metrica-titulo">${m.label}${m.semIndividual ? ' <span class="ie-metrica-tag">só equipe</span>' : ''}</div>
        <div class="ie-metrica-meta">${m.meta ? 'Meta: ' + (m.meta.direcao === 'menor' ? '&lt;' : '&gt;') + ' ' + ieFormatValor(m.meta.valor, m.unidade) : ''}</div>
      </div>
      <div class="ie-metrica-total">Equipe no período: <strong>${ieFormatValor(totalEquipe, m.unidade)}</strong></div>
      ${m.semIndividual ? '' : `
        <div class="ie-legend">${legend}</div>
        <div class="ie-chart ${denso ? 'ie-chart-mes' : ''}">${dias}</div>
      `}

      <div class="ie-equipe-section">
        ${m.semIndividual ? '' : '<div class="ie-equipe-head"><i class="ti ti-users" aria-hidden="true"></i> Equipe</div>'}
        <div class="ie-chart ie-chart-equipe ${denso ? 'ie-chart-mes' : ''}">${diasEquipe}</div>
      </div>
    </div>`;
  }).join('');

  // Linhas de tendência só depois que as barras já estão no DOM (precisa
  // medir posição/altura renderizada de verdade). setTimeout em vez de
  // requestAnimationFrame — o mesmo padrão que Meus Indicadores já usa,
  // porque rAF fica pausado em aba em segundo plano/minimizada.
  setTimeout(() => {
    const blocos = cont.querySelectorAll('.ie-metrica');
    porMetrica.forEach(({ m, equipeSerie, maxVal, maxValEquipe }, mi) => {
      const bloco = blocos[mi];
      if (!bloco) return;
      const chartEquipe = bloco.querySelector('.ie-chart-equipe');
      ieDesenharTendencia(chartEquipe, equipeSerie, maxValEquipe, 0, 'var(--gold)');
      if (m.semIndividual) return;
      const chartConsultores = bloco.querySelector('.ie-chart:not(.ie-chart-equipe)');
      ieConfig.consultores.forEach((nome, i) => {
        ieDesenharTendencia(chartConsultores, ieDados[nome][m.key] || [], maxVal, i, IE_CORES_HEX[i % IE_CORES_HEX.length]);
      });
    });
  }, 60);
}

function ieMostraErro(msg) {
  document.getElementById('ie-resumo-grid').innerHTML = '';
  document.getElementById('ie-metricas').innerHTML = `<div class="ie-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${msg}</div>`;
}

async function ieRenderPeriodo() {
  const cont = document.getElementById('ie-metricas');
  cont.innerHTML = '<div class="ie-carregando"><i class="ti ti-loader-2" aria-hidden="true"></i> Carregando indicadores...</div>';
  document.getElementById('ie-resumo-grid').innerHTML = '';

  const desde = ieFmtISO(ieDiasAtuais[0].data);
  const ate = ieFmtISO(ieDiasAtuais[ieDiasAtuais.length - 1].data);

  try {
    const resp = await fetch(`/indicadores-equipe/api/dados?time=${window.IE_TIME}&desde=${desde}&ate=${ate}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');

    ieDados = json.porConsultor;
    ieDadosEquipe = json.porEquipe;
    ieRenderResumo();
    ieRenderMetricas();
  } catch (err) {
    ieMostraErro('Não foi possível carregar os indicadores: ' + err.message);
  }
}

function ieSetPeriodo(periodo, btn) {
  document.querySelectorAll('.ie-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const custom = document.getElementById('ie-periodo-custom');
  if (periodo === 'personalizado') {
    custom.style.display = 'flex';
    return; // espera o gestor escolher as datas e clicar em "Aplicar"
  }
  custom.style.display = 'none';

  ieDiasAtuais = periodo === 'mes' ? ieDiasMes() : ieDiasSemana();
  ieRenderPeriodo();
}
window.ieSetPeriodo = ieSetPeriodo;

function ieAplicarPersonalizado() {
  const erroEl = document.getElementById('ie-periodo-erro');
  erroEl.style.display = 'none';
  const de = document.getElementById('ie-data-de').value;
  const ate = document.getElementById('ie-data-ate').value;

  if (!de || !ate) { erroEl.textContent = 'Selecione as duas datas.'; erroEl.style.display = 'inline'; return; }
  if (de > ate) { erroEl.textContent = '"De" precisa vir antes de "Até".'; erroEl.style.display = 'inline'; return; }

  const dias = ieDiasPersonalizado(de, ate);
  if (dias.length > 180) { erroEl.textContent = 'Selecione um intervalo de até 180 dias.'; erroEl.style.display = 'inline'; return; }

  ieDiasAtuais = dias;
  ieRenderPeriodo();
}
window.ieAplicarPersonalizado = ieAplicarPersonalizado;

(function init() {
  const time = window.IE_TIME;
  ieConfig = IE_TIMES[time];
  if (!ieConfig) return;
  document.getElementById('ie-titulo').textContent = 'Indicadores Equipe · ' + ieConfig.titulo;
  ieSetPeriodo('semana', document.querySelector('.ie-tab[data-periodo="semana"]'));
})();
