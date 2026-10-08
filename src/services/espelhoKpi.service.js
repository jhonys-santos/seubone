// ESPELHO dos KPIs: copia para o banco os números que a planilha "KPI PV - 2026" (via Apps Script) e os CSVs publicados do
// Ranking SAC já calculam, para os painéis lerem do banco (rápido) sem abrir a planilha a cada consulta.
//  - NÃO recalcula nada e NÃO escreve em planilha nenhuma.
//  - Se a cópia estiver velha (sincronização parada) ou ausente, devolve null e quem chamou usa o caminho de sempre (planilha).
//  - Só liga com ESPELHO_KPI=on.
const db = require('../db');
const env = require('../config/env');

const TIMES = ['atendimento', 'resolucao'];
const CSVS = ['atd', 'rsl', 'kpi', 'agenda'];
const VALIDADE_KPI_MS = 3 * 3600000;   // a planilha é atualizada 3x ao dia; a cópia é renovada a cada 15 min
const VALIDADE_CSV_MS = 20 * 60000;    // o Google republica o CSV a cada poucos minutos; a cópia é renovada a cada 5 min
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const ativo = () => env.espelhoKpi === 'on';

// ── Sincronização: KPI (Apps Script) ─────────────────────────────────────────
let buscarKpi = async (time) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  return chamarAppsScript(env.indicadoresEquipeAppsScriptUrl, { params: { action: 'dadosCompleto', time }, timeoutMs: 120000 });
};
/** Só para testes. */
function definirBuscaKpi(fn) { buscarKpi = fn; }

async function sincronizarKpi() {
  const resultado = {};
  for (const time of TIMES) {
    try {
      const r = await buscarKpi(time);
      if (!r || typeof r !== 'object' || !r.ok || !Array.isArray(r.datas) || !r.porConsultor || !r.porEquipe) throw new Error((r && r.erro) || 'resposta inesperada do Apps Script (ele já tem a ação dadosCompleto?)');
      if (!r.datas.every((d) => DIA.test(d))) throw new Error('datas fora do formato AAAA-MM-DD');
      // Trava de segurança: uma resposta muito menor que a cópia atual não a sobrescreve (ex.: aba renomeada/limpa por engano).
      const atual = await db.query('select json_array_length(datas) as n from kpi_espelho where time = $1', [time]);
      if (atual.rows[0] && r.datas.length < atual.rows[0].n * 0.5) throw new Error(`a planilha devolveu ${r.datas.length} dias e a cópia tem ${atual.rows[0].n}: não sobrescrevi`);
      await db.query(
        `insert into kpi_espelho (time, datas, por_consultor, por_equipe, atualizado_em) values ($1, $2::json, $3::json, $4::json, now())
         on conflict (time) do update set datas = excluded.datas, por_consultor = excluded.por_consultor, por_equipe = excluded.por_equipe, atualizado_em = now()`,
        [time, JSON.stringify(r.datas), JSON.stringify(r.porConsultor), JSON.stringify(r.porEquipe)],
      );
      resultado[time] = { ok: true, dias: r.datas.length };
    } catch (e) {
      resultado[time] = { ok: false, erro: (e && e.message) || String(e) };
    }
  }
  return resultado;
}

/**
 * Mesma resposta que o Apps Script daria para `dados` (time, desde, ate), tirada da cópia: fatia cada série pelos dias do período.
 * Devolve null quando não pode responder com segurança (espelho desligado, cópia velha/ausente, parâmetros fora do padrão).
 */
async function obterDados(time, desde, ate, agora = Date.now()) {
  if (!ativo() || !TIMES.includes(time) || !DIA.test(String(desde)) || !DIA.test(String(ate))) return null;
  const r = await db.query('select datas, por_consultor, por_equipe, atualizado_em from kpi_espelho where time = $1', [time]);
  const linha = r.rows[0];
  if (!linha || agora - new Date(linha.atualizado_em).getTime() > VALIDADE_KPI_MS) return null;
  const datas = linha.datas;
  const idx = []; datas.forEach((d, i) => { if (d >= desde && d <= ate) idx.push(i); });
  const fatiar = (serie) => (Array.isArray(serie) && serie.length === datas.length ? idx.map((i) => serie[i]) : serie);
  const porConsultor = {};
  for (const [nome, metricas] of Object.entries(linha.por_consultor)) {
    porConsultor[nome] = {};
    for (const [k, serie] of Object.entries(metricas)) porConsultor[nome][k] = fatiar(serie);
  }
  const porEquipe = {};
  for (const [k, serie] of Object.entries(linha.por_equipe)) porEquipe[k] = fatiar(serie);
  return { ok: true, porConsultor, porEquipe };
}

// ── Sincronização: CSVs publicados do Ranking SAC ────────────────────────────
let buscarTexto = async (url) => {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};
/** Só para testes. */
function definirBuscaTexto(fn) { buscarTexto = fn; }

const parecePlanilhaCsv = (t) => typeof t === 'string' && t.trim().length > 10 && !/^\s*<(!doctype|html)/i.test(t) && t.includes(',');

async function sincronizarCsvs() {
  const resultado = {};
  for (const chave of CSVS) {
    const url = env.rankingSacCsvUrls[chave];
    if (!url) { resultado[chave] = { ok: false, erro: 'URL não configurada' }; continue; }
    try {
      const texto = await buscarTexto(url);
      if (!parecePlanilhaCsv(texto)) throw new Error('o Google não devolveu um CSV');
      await db.query(
        `insert into csv_espelho (chave, conteudo, atualizado_em) values ($1, $2, now())
         on conflict (chave) do update set conteudo = excluded.conteudo, atualizado_em = now()`,
        [chave, texto],
      );
      resultado[chave] = { ok: true, bytes: texto.length };
    } catch (e) {
      resultado[chave] = { ok: false, erro: (e && e.message) || String(e) };
    }
  }
  return resultado;
}

/** Último CSV copiado (texto cru, igual ao publicado), ou null se desligado/ausente/velho. */
async function obterCsv(chave, agora = Date.now()) {
  if (!ativo() || !CSVS.includes(chave)) return null;
  const r = await db.query('select conteudo, atualizado_em from csv_espelho where chave = $1', [chave]);
  const linha = r.rows[0];
  if (!linha || agora - new Date(linha.atualizado_em).getTime() > VALIDADE_CSV_MS) return null;
  return linha.conteudo;
}

// ── Agendamento ──────────────────────────────────────────────────────────────
function iniciarEspelho() {
  if (!ativo()) { console.log('[espelho] desligado (defina ESPELHO_KPI=on para ligar)'); return; }
  const rodar = (nome, fn) => async () => {
    try {
      const r = await fn();
      const falhas = Object.entries(r).filter(([, v]) => !v.ok);
      if (falhas.length) console.error(`[espelho] ${nome}: falhou em`, falhas.map(([k, v]) => `${k} (${v.erro})`).join('; '));
    } catch (e) { console.error(`[espelho] ${nome}:`, e.message); }
  };
  const kpi = rodar('kpi', sincronizarKpi); const csv = rodar('csv', sincronizarCsvs);
  kpi(); csv();
  setInterval(kpi, 15 * 60000);
  setInterval(csv, 5 * 60000);
  console.log('[espelho] ligado: KPI a cada 15 min e CSVs a cada 5 min');
}

module.exports = { sincronizarKpi, obterDados, sincronizarCsvs, obterCsv, iniciarEspelho, definirBuscaKpi, definirBuscaTexto, TIMES, CSVS };
