// Envio de um pedido do hub para o kanban correspondente do finfin (Pagamento, Reembolso SAC, Análise de termo) + recibo local.
// Usado pelas telas de cada formulário e pelo "Solicitar pagamento" de Corridas Avulsas (que é um pagamento).
// As demandas gerais (Registro) têm o próprio fluxo, em registroDemandasFinfin.routes.js.
const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const finfin = require('./finfinDemandas.service');
const formularios = require('./finfinFormularios');

const MONTAR = { pagamento: finfin.montarCardPagamento, reembolso_sac: finfin.montarCardReembolso, analise_termo: finfin.montarCardAnaliseTermo };
const ROTULO = { pagamento: 'Pagamento', reembolso_sac: 'Reembolso', analise_termo: 'Análise de termo' };

const emTeste = (formulario) => formularios.emTeste(formulario, env);
const formularioValido = (f) => Object.prototype.hasOwnProperty.call(MONTAR, f);

/**
 * usuario: { slug, nome } (da sessão; nunca do corpo)   corpo: o que o formulário mandou   origem: texto livre guardado junto (ex.: 'corridas-avulsas')
 * Devolve { http, json } já no formato de resposta das rotas.
 */
async function enviar({ formulario, usuario, corpo, origem = '' }) {
  if (!formularioValido(formulario)) return { http: 400, json: { ok: false, erro: 'Formulário desconhecido.' } };
  if (!finfin.configurado()) return { http: 503, json: { ok: false, erro: 'A integração com o finfin ainda não está configurada (falta o token no servidor).' } };
  const teste = emTeste(formulario);
  const { payload, erros } = MONTAR[formulario]({ ...(corpo || {}), solicitante: usuario.nome }, { prefixoTitulo: teste ? '[TESTE] ' : '' });
  if (erros.length) return { http: 422, json: { ok: false, erro: erros[0], erros } };

  const r = await finfin.criarCard(payload);
  if (!r.ok) {
    const detalhe = r.erros ? Object.values(r.erros).join(' ') : '';
    return { http: r.status === 422 ? 422 : 502, json: { ok: false, erro: r.erro + (detalhe ? ' ' + detalhe : ''), erros: r.erros || null } };
  }

  // Recibo local (o card mora no finfin). Se gravar falhar, o card já existe: não derruba a resposta.
  try {
    const c = payload.campos;
    const dados = { ...c, origem: origem || undefined };
    delete dados.solicitante_nome; delete dados.solicitante_email;
    await db.query(
      `insert into finfin_demandas (id_finfin, codigo, solicitante_slug, solicitante_nome, solicitante_email, demanda, link_lulu, coluna, modo, formulario, dados, anexos_enviados)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::json,$12::json) on conflict (id_finfin) do nothing`,
      [payload.id, String(r.codigo || ''), usuario.slug || '', usuario.nome || '', c.solicitante_email, ROTULO[formulario], c.link_lulu || '',
        (r.coluna && r.coluna.chave) || 'backlog', teste ? 'teste' : 'producao', formulario, JSON.stringify(dados),
        JSON.stringify((payload.anexos || []).map((a) => ({ nome: a.nome, hash: crypto.createHash('sha256').update(Buffer.from(a.conteudo_base64, 'base64')).digest('hex') })))],
    );
  } catch (e) { console.error(`[finfin-${formulario}] card criado, mas falhou ao gravar o recibo:`, e.message); }

  return { http: 200, json: { ok: true, codigo: r.codigo, coluna: r.coluna || null, anexos: r.anexos || null } };
}

module.exports = { enviar, emTeste, formularioValido, ROTULO };
