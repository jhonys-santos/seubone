// Indicadores Equipe (visão de gestor) — comparativo diário por consultor,
// hoje só disponível em planilha. ESTE ARQUIVO AINDA USA DADOS DE EXEMPLO
// (gerados aqui mesmo) só pra validar o layout — a integração com a
// planilha real é o próximo passo, depois que o visual for aprovado.

// Cor por consultor: classe (usada no avatar/legenda) + valor real (usado
// no stroke do SVG, que não lê classe CSS). Dourado fica reservado pra
// linha da Equipe — nunca é a cor de um consultor, pra não ambiguar.
const IE_SERIES = [
  { classe: 'ie-c-0', cor: '#4C8DFF' },
  { classe: 'ie-c-1', cor: '#3DAF72' },
  { classe: 'ie-c-2', cor: '#9c6cd4' },
  { classe: 'ie-c-3', cor: '#E8618C' },
  { classe: 'ie-c-4', cor: '#F0954D' },
  { classe: 'ie-c-5', cor: '#4FD1C5' },
];

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
        <div class="ie-resumo-avatar ${IE_SERIES[i % IE_SERIES.length].classe}">${iniciais}</div>
        <div class="ie-resumo-nome">${nome}</div>
      </div>
      <div class="ie-resumo-stats">${stats}</div>
    </div>`;
  }).join('');
}

// Quebra a série em segmentos contínuos, cortando nos dias sem dado — uma
// linha reta por cima de um buraco sugeriria um valor que não existe.
function ieSegmentos(serie) {
  const segs = [];
  let atual = [];
  serie.forEach((v, i) => {
    if (v == null) { if (atual.length) segs.push(atual); atual = []; return; }
    atual.push([i, v]);
  });
  if (atual.length) segs.push(atual);
  return segs;
}

function ieRenderMetricas() {
  const denso = ieDiasAtuais.length > 10; // mês ou intervalo personalizado longo — rótulos mais compactos
  const n = ieDiasAtuais.length;
  const larguraX = Math.max(1, n - 1);
  const cont = document.getElementById('ie-metricas');

  // Coordenadas em pixel real (não em unidades de viewBox 0-100) — com
  // preserveAspectRatio="none" e um viewBox desproporcional ao tamanho
  // real, um raio/traço definido em "unidades" vira elipse gigante quando
  // o eixo X é esticado muito mais que o Y (bug visto no gráfico: pontos
  // viraram blobs cobrindo o card inteiro). Fixando largura/altura do SVG
  // igual ao viewBox, a escala em X e em Y fica 1:1 e o traço/raio saem
  // do tamanho pedido de verdade.
  const larguraPx = denso ? n * 16 : n * 60;
  const alturaPx = 120;
  const margemY = 8;

  cont.innerHTML = ieConfig.metricas.map((m) => {
    // Série da Equipe por dia — média se a métrica é média, soma se é soma.
    const equipeSerie = ieDiasAtuais.map((_, di) => {
      const valsNoDia = ieConfig.consultores.map((nome) => ieDados[nome][m.key][di]).filter((v) => v != null);
      if (!valsNoDia.length) return null;
      const soma = valsNoDia.reduce((a, b) => a + b, 0);
      return m.agregacao === 'soma' ? soma : soma / valsNoDia.length;
    });
    const totalEquipe = ieAgregar(equipeSerie, m.agregacao);

    // Escala inclui a Equipe — senão a linha dela poderia vazar do gráfico
    // nas métricas de soma, onde ela é sempre maior que qualquer indivíduo.
    const maxVal = Math.max(1, ...[
      ...ieConfig.consultores.flatMap((nome) => ieDados[nome][m.key]),
      ...equipeSerie,
    ].filter((v) => v != null));

    const pontoX = (i) => (i / larguraX) * larguraPx;
    const pontoY = (v) => margemY + (1 - Math.min(1, v / maxVal)) * (alturaPx - margemY * 2);

    const linhaSVG = (serie, cor, largura, tracejado) => ieSegmentos(serie).map((seg) => {
      const pontos = seg.map(([i, v]) => `${pontoX(i).toFixed(1)},${pontoY(v).toFixed(1)}`).join(' ');
      const linha = seg.length > 1
        ? `<polyline points="${pontos}" fill="none" style="stroke:${cor}" stroke-width="${largura}" ${tracejado ? 'stroke-dasharray="4 3"' : ''} stroke-linecap="round" stroke-linejoin="round" />`
        : '';
      const pontosCirculo = seg.map(([i, v]) => `<circle cx="${pontoX(i).toFixed(1)}" cy="${pontoY(v).toFixed(1)}" r="2.2" style="fill:${cor}"><title>${ieFormatValor(v, m.unidade)}</title></circle>`).join('');
      return linha + pontosCirculo;
    }).join('');

    const linhasConsultores = ieConfig.consultores.map((nome, i) =>
      linhaSVG(ieDados[nome][m.key], IE_SERIES[i % IE_SERIES.length].cor, 1.6, false)
    ).join('');
    const linhaEquipe = linhaSVG(equipeSerie, 'var(--gold)', 2.4, true);

    const legendConsultores = ieConfig.consultores.map((nome, i) =>
      `<div class="ie-legend-item"><div class="ie-legend-linha ${IE_SERIES[i % IE_SERIES.length].classe}" style="border-color:${IE_SERIES[i % IE_SERIES.length].cor}"></div>${nome}</div>`
    ).join('');
    const legendEquipe = `<div class="ie-legend-item"><div class="ie-legend-linha ie-c-equipe"></div><strong style="color:var(--text)">Equipe</strong></div>`;

    const labels = ieDiasAtuais.map((dia, di) =>
      `<div class="ie-day-label ${dia.hoje ? 'hoje' : ''}" style="left:${(di / larguraX) * 100}%">${dia.label}</div>`
    ).join('');

    return `<div class="ie-metrica">
      <div class="ie-metrica-head">
        <div class="ie-metrica-titulo">${m.label}</div>
        <div class="ie-metrica-meta">${m.meta ? 'Meta: ' + (m.meta.direcao === 'menor' ? '&lt;' : '&gt;') + ' ' + ieFormatValor(m.meta.valor, m.unidade) : ''}</div>
      </div>
      <div class="ie-metrica-total">Equipe no período: <strong>${ieFormatValor(totalEquipe, m.unidade)}</strong></div>
      <div class="ie-legend">${legendConsultores}${legendEquipe}</div>
      <div class="ie-chart-scroll">
        <div class="ie-chart-inner ${denso ? 'ie-chart-denso' : ''}" style="width:${larguraPx}px">
          <svg class="ie-chart-svg" width="${larguraPx}" height="${alturaPx}" viewBox="0 0 ${larguraPx} ${alturaPx}">
            <line x1="0" y1="${alturaPx - margemY}" x2="${larguraPx}" y2="${alturaPx - margemY}" style="stroke:var(--border)" stroke-width="1" />
            ${linhasConsultores}
            ${linhaEquipe}
          </svg>
          <div class="ie-chart-labels">${labels}</div>
        </div>
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
