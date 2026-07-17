// Indicadores Equipe (visão de gestor) — comparativo diário por consultor,
// hoje só disponível em planilha. ESTE ARQUIVO AINDA USA DADOS DE EXEMPLO
// (gerados aqui mesmo) só pra validar o layout — a integração com a
// planilha real é o próximo passo, depois que o visual for aprovado.

const IE_CORES = ['ie-c-0', 'ie-c-1', 'ie-c-2', 'ie-c-3', 'ie-c-4', 'ie-c-5'];

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

// ── DADOS DE EXEMPLO ──────────────────────────────────────────
function ieGerarSerie(dias, base, variacao, foldaChance) {
  const serie = [];
  for (let i = 0; i < dias; i++) {
    if (foldaChance && Math.random() < foldaChance) { serie.push(null); continue; }
    serie.push(Math.max(0, Math.round(base + (Math.random() - 0.5) * variacao)));
  }
  return serie;
}

function ieDiasSemana() {
  const hoje = new Date();
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje); d.setDate(hoje.getDate() - i);
    labels.push({ label: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), hoje: i === 0 });
  }
  return labels;
}
function ieDiasMes() {
  const hoje = new Date();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const labels = [];
  for (let d = 1; d <= diasNoMes; d++) {
    labels.push({ label: String(d), hoje: d === hoje.getDate() });
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
    labels.push({ label: String(atual.getDate()).padStart(2, '0') + '/' + String(atual.getMonth() + 1).padStart(2, '0'), hoje: ieMesmoDia(atual, hoje) });
    atual.setDate(atual.getDate() + 1);
  }
  return labels;
}

function ieMontarDados(consultores, metricas, dias) {
  const porConsultor = {};
  consultores.forEach((c, i) => {
    const foldaChance = 1 / 7 + (i * 0.03); // cada um "descansa" em dias levemente diferentes
    const dados = {};
    metricas.forEach((m) => {
      dados[m.key] = ieGerarSerie(dias, m.base, m.variacao, foldaChance);
    });
    porConsultor[c] = dados;
  });
  return porConsultor;
}

const IE_TIMES = {
  atendimento: {
    titulo: 'Time Atendimento',
    consultores: ['Iasmin Cristina', 'Francis Medeiros', 'Nathalia Guedes'],
    resumoKeys: ['tma', 'csat', 'atendimentos', 'tickets', 'tmt_refab'],
    metricas: [
      { key: 'tma', label: 'TMA', unidade: 'tempo', agregacao: 'media', meta: { valor: 30, direcao: 'menor' }, base: 22, variacao: 14 },
      { key: 'csat', label: 'CSAT', unidade: 'pct', agregacao: 'media', meta: { valor: 95, direcao: 'maior' }, base: 97, variacao: 8 },
      { key: 'atendimentos', label: 'Atendimentos', unidade: 'num', agregacao: 'soma', base: 20, variacao: 16 },
      { key: 'pesquisas', label: 'Pesquisas respondidas', unidade: 'num', agregacao: 'soma', base: 4, variacao: 5 },
      // Time Atendimento também é responsável por tickets de refabricação.
      { key: 'tickets', label: 'Tickets resolvidos', unidade: 'num', agregacao: 'soma', base: 8, variacao: 8 },
      { key: 'tmt_refab', label: 'TMT Refabricação', unidade: 'tempo', agregacao: 'media', meta: { valor: 84 * 60, direcao: 'menor' }, base: 60 * 60, variacao: 40 * 60 },
    ],
  },
  resolucao: {
    titulo: 'Time Resolução',
    consultores: ['Gabrielle Batista', 'Daniel Sheldon'],
    resumoKeys: ['tickets', 'tmt_refab'],
    metricas: [
      { key: 'tickets', label: 'Tickets resolvidos', unidade: 'num', agregacao: 'soma', base: 5, variacao: 6 },
      { key: 'tmt_refab', label: 'TMT Refabricação', unidade: 'tempo', agregacao: 'media', meta: { valor: 84 * 60, direcao: 'menor' }, base: 60 * 60, variacao: 40 * 60 },
      { key: 'tmt_atrasado', label: 'TMT Pedido Atrasado', unidade: 'tempo', agregacao: 'media', meta: { valor: 24 * 60, direcao: 'menor' }, base: 20 * 60, variacao: 16 * 60 },
      { key: 'tempo_logo', label: 'Tempo retorno teste de logo', unidade: 'tempo', agregacao: 'media', meta: { valor: 120, direcao: 'menor' }, base: 90, variacao: 90 },
    ],
  },
};

// ── RENDER ────────────────────────────────────────────────────
let ieDados = null;
let ieDiasAtuais = null;
let ieConfig = null;

function ieAgregar(serie, agregacao) {
  const vals = serie.filter((v) => v != null);
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

function ieRenderMetricas() {
  const denso = ieDiasAtuais.length > 10; // mês ou intervalo personalizado longo — 1 barra por dia, sem agrupar por consultor
  const cont = document.getElementById('ie-metricas');
  cont.innerHTML = ieConfig.metricas.map((m) => {
    // Série da Equipe por dia — média se a métrica é média, soma se é soma.
    const equipeSerie = ieDiasAtuais.map((_, di) => {
      const valsNoDia = ieConfig.consultores.map((nome) => ieDados[nome][m.key][di]).filter((v) => v != null);
      if (!valsNoDia.length) return null;
      const soma = valsNoDia.reduce((a, b) => a + b, 0);
      return m.agregacao === 'soma' ? soma : soma / valsNoDia.length;
    });
    const totalEquipe = ieAgregar(equipeSerie, m.agregacao);

    // Escala do gráfico por consultor NÃO inclui a Equipe — ela vira um
    // gráfico próprio, com a própria escala, bem abaixo. Numa métrica de
    // soma a Equipe é sempre maior que qualquer indivíduo; misturando as
    // duas escalas as barras de cada pessoa ficariam pequenas/achatadas.
    const maxVal = Math.max(1, ...ieConfig.consultores.flatMap((nome) => ieDados[nome][m.key].filter((v) => v != null)));
    const maxValEquipe = Math.max(1, ...equipeSerie.filter((v) => v != null));

    const legend = ieConfig.consultores.map((nome, i) => `<div class="ie-legend-item"><div class="ie-legend-dot ${IE_CORES[i % IE_CORES.length]}"></div>${nome}</div>`).join('');

    const dias = ieDiasAtuais.map((dia, di) => {
      const bars = ieConfig.consultores.map((nome, i) => {
        const v = ieDados[nome][m.key][di];
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
        <div class="ie-metrica-titulo">${m.label}</div>
        <div class="ie-metrica-meta">${m.meta ? 'Meta: ' + (m.meta.direcao === 'menor' ? '&lt;' : '&gt;') + ' ' + ieFormatValor(m.meta.valor, m.unidade) : ''}</div>
      </div>
      <div class="ie-metrica-total">Equipe no período: <strong>${ieFormatValor(totalEquipe, m.unidade)}</strong></div>
      <div class="ie-legend">${legend}</div>
      <div class="ie-chart ${denso ? 'ie-chart-mes' : ''}">${dias}</div>

      <div class="ie-equipe-section">
        <div class="ie-equipe-head"><i class="ti ti-users" aria-hidden="true"></i> Equipe</div>
        <div class="ie-chart ie-chart-equipe ${denso ? 'ie-chart-mes' : ''}">${diasEquipe}</div>
      </div>
    </div>`;
  }).join('');
}

function ieRenderPeriodo() {
  ieDados = ieMontarDados(ieConfig.consultores, ieConfig.metricas, ieDiasAtuais.length);
  ieRenderResumo();
  ieRenderMetricas();
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
