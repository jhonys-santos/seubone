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
    resumoKeys: ['tma', 'csat', 'atendimentos'],
    metricas: [
      { key: 'tma', label: 'TMA', unidade: 'tempo', agregacao: 'media', meta: { valor: 30, direcao: 'menor' }, base: 22, variacao: 14 },
      { key: 'csat', label: 'CSAT', unidade: 'pct', agregacao: 'media', meta: { valor: 95, direcao: 'maior' }, base: 97, variacao: 8 },
      { key: 'atendimentos', label: 'Atendimentos', unidade: 'num', agregacao: 'soma', base: 20, variacao: 16 },
      { key: 'pesquisas', label: 'Pesquisas respondidas', unidade: 'num', agregacao: 'soma', base: 4, variacao: 5 },
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

function ieRenderMetricas(periodo) {
  const cont = document.getElementById('ie-metricas');
  cont.innerHTML = ieConfig.metricas.map((m) => {
    const totalEquipe = ieAgregar(
      ieDiasAtuais.map((_, di) => {
        const valsNoDia = ieConfig.consultores.map((nome) => ieDados[nome][m.key][di]).filter((v) => v != null);
        return valsNoDia.length ? (m.agregacao === 'soma' ? valsNoDia.reduce((a, b) => a + b, 0) : valsNoDia.reduce((a, b) => a + b, 0) / valsNoDia.length) : null;
      }),
      m.agregacao === 'soma' ? 'soma' : 'media'
    );

    const maxVal = Math.max(1, ...ieConfig.consultores.flatMap((nome) => ieDados[nome][m.key].filter((v) => v != null)));

    const legend = ieConfig.consultores.map((nome, i) => `<div class="ie-legend-item"><div class="ie-legend-dot ${IE_CORES[i % IE_CORES.length]}"></div>${nome}</div>`).join('');

    const dias = ieDiasAtuais.map((dia, di) => {
      const bars = ieConfig.consultores.map((nome, i) => {
        const v = ieDados[nome][m.key][di];
        const alturaPct = v == null ? 0 : Math.max(2, Math.round((v / maxVal) * 100));
        return `<div class="ie-bar-col"><div class="ie-bar ${IE_CORES[i % IE_CORES.length]}" style="height:${alturaPct}%"></div><div class="ie-bar-tooltip">${nome.split(' ')[0]}: ${ieFormatValor(v, m.unidade)}</div></div>`;
      }).join('');
      return `<div class="ie-day-group">
        <div class="ie-bars-row">${bars}</div>
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
      <div class="ie-chart ${periodo === 'mes' ? 'ie-chart-mes' : ''}">${dias}</div>
    </div>`;
  }).join('');
}

function ieSetPeriodo(periodo, btn) {
  document.querySelectorAll('.ie-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ieDiasAtuais = periodo === 'mes' ? ieDiasMes() : ieDiasSemana();
  ieDados = ieMontarDados(ieConfig.consultores, ieConfig.metricas, ieDiasAtuais.length);
  ieRenderResumo();
  ieRenderMetricas(periodo);
}
window.ieSetPeriodo = ieSetPeriodo;

(function init() {
  const time = window.IE_TIME;
  ieConfig = IE_TIMES[time];
  if (!ieConfig) return;
  document.getElementById('ie-titulo').textContent = 'Indicadores Equipe · ' + ieConfig.titulo;
  ieSetPeriodo('semana', document.querySelector('.ie-tab[data-periodo="semana"]'));
})();
