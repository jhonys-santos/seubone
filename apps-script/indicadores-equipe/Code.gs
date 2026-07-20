// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// na própria planilha "KPI PV - 2026". NUNCA preencha os dois valores abaixo
// com os reais aqui — deixe só no Apps Script (ambiente do Google, fora deste
// repositório) e no .env do hub (que já é ignorado pelo Git).
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL'; // 1FDKXWMGWls1RaX8R0tRxS4OS7o39m0JTXR1ly3SiXvQ

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// A aba de dados é "KPI Visão 2026" — uma linha por dia (coluna A), com
// vários blocos de métrica lado a lado, cada um com uma coluna por
// consultor (ver TIMES abaixo). Índices 0-based, achados inspecionando o
// cabeçalho de duas linhas da aba — se a planilha mudar de layout, é aqui
// que se ajusta.
const ABA_DADOS = 'KPI Visão 2026';

// IMPORTANTE: a coluna "Equipe" de 3 blocos (Qtd. Refabricação, Tempo
// PPF+1, Qtd. PPF+1) está com fórmula quebrada na planilha — sempre volta
// 0/vazio mesmo em dias com dado real por consultor (confirmado comparando
// com a soma manual). Por isso, pra métrica com quebra por consultor, a
// Equipe é somada/calculada aqui a partir dos valores individuais (mais
// confiável, e também bate certinho nos blocos que já funcionam, como
// Atendimentos). Só "tempo_logo" não tem coluna por consultor — pra essa,
// não tem outra opção além de ler a própria coluna Equipe da planilha.
const TIMES = {
  atendimento: {
    consultores: ['Iasmin Cristina', 'Nathalia Guedes', 'Francis Medeiros'],
    metricas: {
      tma:           { tipo: 'tempo', agregacao: 'media', porNome: { 'Iasmin Cristina': 3, 'Nathalia Guedes': 5, 'Francis Medeiros': 6 } },
      csat:          { tipo: 'pct',   agregacao: 'media', porNome: { 'Iasmin Cristina': 10, 'Nathalia Guedes': 12, 'Francis Medeiros': 13 } },
      atendimentos:  { tipo: 'num',   agregacao: 'soma',  porNome: { 'Iasmin Cristina': 18, 'Nathalia Guedes': 20, 'Francis Medeiros': 21 } },
      tmt_refab:     { tipo: 'tempo', agregacao: 'media', porNome: { 'Iasmin Cristina': 26, 'Nathalia Guedes': 25, 'Francis Medeiros': 27 } },
      tickets_refab: { tipo: 'num',   agregacao: 'soma',  porNome: { 'Iasmin Cristina': 31, 'Nathalia Guedes': 30, 'Francis Medeiros': 32 } },
    },
  },
  resolucao: {
    consultores: ['Gabrielle Batista', 'Daniel Sheldon'],
    metricas: {
      csat:       { tipo: 'pct',   agregacao: 'media', porNome: { 'Gabrielle Batista': 11, 'Daniel Sheldon': 14 } },
      tempo_ppf:  { tipo: 'tempo', agregacao: 'media', porNome: { 'Gabrielle Batista': 35, 'Daniel Sheldon': 36 } },
      qtd_ppf:    { tipo: 'num',   agregacao: 'soma',  porNome: { 'Gabrielle Batista': 39, 'Daniel Sheldon': 40 } },
      // Sem quebra por consultor na planilha — só a coluna Equipe (essa,
      // ao menos por enquanto, sempre "0:00:00" — sem dado real ainda).
      tempo_logo: { tipo: 'tempo', agregacao: 'media', equipeCol: 42, porNome: {} },
    },
  },
};

function doGet(e) {
  const p = e.parameter;
  try {
    if (p.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (p.action === 'dados') {
      const time = TIMES[p.time];
      if (!time) return out({ ok: false, erro: 'Time desconhecido: ' + p.time });
      return out({ ok: true, ...buscarDados(time, p.desde, p.ate) });
    }
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

function buscarDados(time, desdeStr, ateStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName(ABA_DADOS);
  if (!aba) throw new Error('Aba "' + ABA_DADOS + '" nao encontrada.');

  const desde = parseDateBR(desdeStr), ate = parseDateBR(ateStr);
  ate.setHours(23, 59, 59, 999);

  const linhas = aba.getDataRange().getValues().slice(2); // linhas 1-2 são cabeçalho
  const linhasNoPeriodo = linhas.filter((r) => {
    const d = parseDate(r[0]);
    return d && d >= desde && d <= ate;
  });

  const porConsultor = {};
  time.consultores.forEach((nome) => { porConsultor[nome] = {}; });
  const porEquipe = {};

  Object.keys(time.metricas).forEach((key) => {
    const metrica = time.metricas[key];
    const ler = valorPorTipo(metrica.tipo);
    const temIndividual = Object.keys(metrica.porNome).length > 0;

    time.consultores.forEach((nome) => {
      const col = metrica.porNome[nome];
      porConsultor[nome][key] = col === undefined ? [] : linhasNoPeriodo.map((r) => ler(r[col]));
    });

    if (temIndividual) {
      porEquipe[key] = linhasNoPeriodo.map((_, di) => {
        const valores = time.consultores
          .map((nome) => porConsultor[nome][key][di])
          .filter((v) => v != null);
        if (!valores.length) return null;
        const soma = valores.reduce((a, b) => a + b, 0);
        return metrica.agregacao === 'soma' ? soma : Math.round(soma / valores.length);
      });
    } else {
      porEquipe[key] = linhasNoPeriodo.map((r) => ler(r[metrica.equipeCol]));
    }
  });

  return { porConsultor, porEquipe };
}

// Cada tipo de métrica tem sua própria regra de "isso é 'sem dado' pra
// esse dia" — pra tempo, célula vazia OU "0:00:00" quer dizer que não teve
// ocorrência (uma resolução em zero segundos não existe); pra quantidade,
// 0 é uma contagem real (pode ter tido zero atendimentos mesmo).
function valorPorTipo(tipo) {
  if (tipo === 'tempo') return (v) => { const min = toMinutos(v); return min && min > 0 ? min : null; };
  if (tipo === 'pct') return (v) => parsePct(v);
  return (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
}

function parseDateBR(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  return null;
}

// ── Helpers portados de painel-sac/Code.gs (mesma planilha/convenções) ──

function parseDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return new Date(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate());
  }
  if (typeof val === 'number') {
    if (val > 40000 && val < 100000) {
      const d = new Date((val - 25569) * 86400000);
      if (isNaN(d.getTime())) return null;
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return null;
  }
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toMinutos(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    const BASE_MS = -2209161600000;
    const totalMs = val.getTime() - BASE_MS;
    if (totalMs <= 0) return null;
    return Math.round(totalMs / 60000);
  }
  if (typeof val === 'number') {
    if (val === 0) return null;
    if (val >= 1000) return null;
    return Math.round(val * 24 * 60);
  }
  const str = String(val).trim();
  if (!str || str === '0') return null;
  const partes = str.split(':');
  if (partes.length >= 2) {
    const h = parseInt(partes[0]) || 0;
    const min = parseInt(partes[1]) || 0;
    const seg = partes[2] ? parseInt(partes[2]) : 0;
    const total = h * 60 + min + seg / 60;
    return total > 0 ? Math.round(total) : null;
  }
  return null;
}

function parsePct(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace('%', '').replace(',', '.'));
  if (isNaN(n)) return null;
  return n > 1 ? Math.round(n) : Math.round(n * 100);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
