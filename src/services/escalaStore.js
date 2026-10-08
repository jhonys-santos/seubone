// Ponto único de acesso à Escala de serviço e às Trocas de sábado do Painel SAC: decide, a cada chamada,
// se vai pro Postgres (ESCALA_BACKEND=db) ou pra planilha via Apps Script (padrão).
const env = require('../config/env');
const { chamarAppsScript } = require('./appsScriptClient');
const banco = require('./escalaDb.service');

const usaBanco = () => env.escalaBackend === 'db';
const url = () => env.painelSacAppsScriptUrl;
const post = (body) => chamarAppsScript(url(), { method: 'POST', body });

const planilha = {
  escala: (slug, mes, ano) => chamarAppsScript(url(), { params: { action: 'escala', usuario: slug, mes, ano }, cache: true }),
  escalaEquipe: (mes, ano) => chamarAppsScript(url(), { params: { action: 'escalaEquipe', mes, ano }, cache: true }),
  sabadosConsultor: (usuario, alvo, mes, ano) => chamarAppsScript(url(), { params: { action: 'sabadosConsultor', usuario, alvo, mes, ano }, cache: true }),
  atualizarEscala: ({ slug, dia, mes, ano, status }) => post({ action: 'atualizarEscala', slug, dia, mes, ano, status }),
  atualizarEscalaLote: ({ slugs, dias, status }) => post({ action: 'atualizarEscalaLote', slugs, dias, status }),
  solicitarTroca: (usuario, b) => post({
    action: 'solicitarTroca', usuario,
    dia_solicitante: b.dia_solicitante, mes_solicitante: b.mes_solicitante, ano_solicitante: b.ano_solicitante,
    consultor_alvo: b.consultor_alvo, dia_alvo: b.dia_alvo, mes_alvo: b.mes_alvo, ano_alvo: b.ano_alvo,
  }),
  responderTroca: (usuario, idTroca, aceitar) => post({ action: 'responderTroca', usuario, id_troca: idTroca, aceitar }),
};

// Mesma conversão que o Apps Script fazia em "dados": mês/ano ausentes valem o mês/ano de hoje.
const mesAnoDoDados = (mes, ano) => {
  const h = banco.hojeBrasilia();
  const m = parseInt(mes !== undefined ? mes : h.mes, 10);
  const a = parseInt(ano || h.ano, 10);
  return [m, a];
};

const store = {
  escala: (slug, mes, ano) => (usaBanco() ? banco.escalaDaPessoa(slug, parseInt(mes, 10), parseInt(ano, 10)) : planilha.escala(slug, mes, ano)),
  escalaEquipe: (mes, ano) => (usaBanco() ? banco.escalaEquipe(parseInt(mes, 10), parseInt(ano, 10)) : planilha.escalaEquipe(mes, ano)),
  sabadosConsultor: (usuario, alvo, mes, ano) => (usaBanco() ? banco.sabadosConsultor(String(alvo), parseInt(mes, 10), parseInt(ano, 10)) : planilha.sabadosConsultor(usuario, alvo, mes, ano)),
  atualizarEscala: (b) => (usaBanco() ? banco.atualizarEscala(b) : planilha.atualizarEscala(b)),
  atualizarEscalaLote: (b) => (usaBanco() ? banco.atualizarEscalaLote(b) : planilha.atualizarEscalaLote(b)),
  solicitarTroca: (usuario, b) => (usaBanco() ? banco.solicitarTroca(usuario, b) : planilha.solicitarTroca(usuario, b)),
  responderTroca: (usuario, idTroca, aceitar) => (usaBanco() ? banco.responderTroca(usuario, idTroca, aceitar) : planilha.responderTroca(usuario, idTroca, aceitar)),
  /**
   * A resposta da ação "dados" do Apps Script traz, junto dos indicadores, a escala e as trocas pendentes. Com o banco
   * ligado, essas duas partes passam a vir do banco (os indicadores continuam como vieram).
   */
  async sobreporNoDados(json, slug, mes, ano) {
    if (!usaBanco() || !json || json.erro || !json.indicadores) return json;
    const [m, a] = mesAnoDoDados(mes, ano);
    json.escala = await banco.buscarEscala(slug, m, a);
    json.trocas_pendentes = await banco.trocasPendentes(slug);
    return json;
  },
};

module.exports = store;
