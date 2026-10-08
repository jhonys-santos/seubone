// Painel de Produção SBP (Wallac) em Postgres. Devolve o mesmo JSON que o Apps Script (apps-script/wallac) devolvia.
// Os cards de COMPRA continuam vindo da aba LTV (planilha manual de outra pessoa, só leitura, via Apps Script); o
// andamento deles, o estoque, as solicitações de personalização e a premiação ficam no banco. O logo (DXF) continua
// no Google Drive: o upload é feito pelo Apps Script (ação salvar_logo).
const db = require('../db');

const STATUS = { A_CHEGAR: 'A chegar', RECEBIDO: 'Recebido', EM_PRODUCAO: 'Em produção', FINALIZADO: 'Finalizado' };
const COLUNA_DATA = { [STATUS.RECEBIDO]: 'data_recebido', [STATUS.EM_PRODUCAO]: 'data_inicio_producao', [STATUS.FINALIZADO]: 'data_finalizado' };
const DIAS_UTEIS_MINIMOS_PRAZO = 2;
const BRT_MS = -3 * 3600000; // Brasília = UTC-3 fixo (sem horário de verão)

const str = (v) => String(v == null ? '' : v);
const num = (v) => Number(v);
const erro = (e) => ({ ok: false, erro: (e && e.message) || String(e) });

// ── Datas em Brasília ───────────────────────────────────────────────────────
const diaBrt = (d) => new Date(d.getTime() + BRT_MS).toISOString().slice(0, 10);
const somarDias = (dia, n) => { const t = new Date(dia + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diaDaSemana = (dia) => new Date(dia + 'T00:00:00Z').getUTCDay(); // 0 = domingo
/** Segunda-feira (AAAA-MM-DD) da semana que contém `dia` (domingo conta como a semana que terminou). */
const segundaDe = (dia) => somarDias(dia, diaDaSemana(dia) === 0 ? -6 : 1 - diaDaSemana(dia));
function somarDiasUteis(dia, n) {
  let d = dia; let somados = 0;
  while (somados < n) { d = somarDias(d, 1); const w = diaDaSemana(d); if (w !== 0 && w !== 6) somados++; }
  return d;
}

// ── Cards de COMPRA (aba LTV, via Apps Script) ──────────────────────────────
let ultimoLtvBom = null; // se o Google falhar numa leitura, usa a última boa (o kanban não fica em branco por um soluço do Sheets)
let fonteLtv = async () => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const env = require('../config/env');
  const r = await chamarAppsScript(env.wallacAppsScriptUrl, { cache: true });
  if (!r || typeof r !== 'object' || !r.ok || !Array.isArray(r.cards)) throw new Error((r && r.erro) || 'A planilha LTV não respondeu');
  return r.cards.filter((c) => c.origem === 'compra');
};
/** Só para testes. */
function definirFonteLtv(fn) { fonteLtv = fn; ultimoLtvBom = null; }

async function cardsLtv() {
  try {
    const l = await fonteLtv();
    ultimoLtvBom = { quando: Date.now(), cards: l };
    return l;
  } catch (e) {
    if (ultimoLtvBom && Date.now() - ultimoLtvBom.quando < 30 * 60000) return ultimoLtvBom.cards; // até 30 min de tolerância
    throw e;
  }
}
const linhaDaChave = (chave) => { const m = /^ltv-(\d+)$/.exec(str(chave)); return m ? Number(m[1]) : null; };

/** A planilha entregava o ID da venda como NÚMERO quando só tem dígitos (célula numérica) e como texto nos demais casos. */
const idVendaDoCard = (v) => (!str(v).trim() ? '(sem ref.)' : /^\d{1,15}$/.test(str(v).trim()) ? Number(str(v).trim()) : v);

// ── Leitura do kanban ───────────────────────────────────────────────────────
async function cards() {
  try {
    const ltv = await cardsLtv();
    const st = await db.query('select linha_ltv, status_atual from wallac_status');
    const porLinha = new Map(st.rows.map((x) => [Number(x.linha_ltv), x.status_atual]));
    const compra = ltv.map((c) => ({ ...c, status: porLinha.get(linhaDaChave(c.chave)) || STATUS.A_CHEGAR }));
    const sol = await db.query(`select * from wallac_solicitacoes where btrim(produto) <> '' order by id`);
    const estoque = sol.rows.map((x) => ({
      chave: 'est-' + x.id, origem: 'estoque', id_venda: idVendaDoCard(x.id_venda_cliente), nome_card: '', produto: x.produto, quantidade: num(x.quantidade),
      prazo_producao: x.prazo_producao || null, prazo_entrega: x.prazo_entrega || null, observacoes: x.observacoes || '', logo_url: x.logo_url || '',
      solicitante: x.solicitante || '', status: x.status_atual || STATUS.RECEBIDO,
    }));
    return { ok: true, cards: compra.concat(estoque) };
  } catch (e) { return erro(e); }
}

// ── Mudança de status ───────────────────────────────────────────────────────
async function mudarStatus(chave, novoStatus) {
  try {
    const status = str(novoStatus);
    const coluna = COLUNA_DATA[status] || null; // só Recebido / Em produção / Finalizado carimbam data
    const linha = linhaDaChave(chave);
    if (linha != null) {
      const sets = ['status_atual = excluded.status_atual'];
      if (coluna) sets.push(`${coluna} = now()`);
      await db.query(
        `insert into wallac_status (linha_ltv, status_atual${coluna ? ', ' + coluna : ''}) values ($1, $2${coluna ? ', now()' : ''})
         on conflict (linha_ltv) do update set ${sets.join(', ')}`,
        [linha, status],
      );
      return { ok: true };
    }
    const m = /^est-(\d+)$/.exec(str(chave));
    if (m) {
      const r = await db.query(`update wallac_solicitacoes set status_atual = $2${coluna ? `, ${coluna} = now()` : ''} where id = $1`, [Number(m[1]), status]);
      return r.rowCount ? { ok: true } : { ok: false, erro: 'Solicitação não encontrada.' };
    }
    return { ok: false, erro: 'Chave inválida: ' + str(chave) };
  } catch (e) { return erro(e); }
}

// ── Estoque ─────────────────────────────────────────────────────────────────
async function estoquePublico() {
  try {
    const r = await db.query('select produto, quantidade from wallac_estoque where btrim(produto) <> \'\' and quantidade > 0 order by id');
    return { ok: true, produtos: r.rows.map((x) => ({ produto: x.produto, quantidade_disponivel: num(x.quantidade) })) };
  } catch (e) { return erro(e); }
}

async function estoqueAdmin() {
  try {
    const r = await db.query('select id, produto, quantidade from wallac_estoque where btrim(produto) <> \'\' order by id');
    return { ok: true, itens: r.rows.map((x) => ({ linha: Number(x.id), produto: x.produto, quantidade: num(x.quantidade) })) };
  } catch (e) { return erro(e); }
}

function validarProdutoEQtd(d) {
  if (!d || !str(d.produto).trim()) return 'Nome do produto é obrigatório.';
  const q = num(d.quantidade);
  if (Number.isNaN(q) || q < 0) return 'Quantidade inválida.';
  return null;
}

async function adicionarProdutoEstoque(d) {
  const problema = validarProdutoEQtd(d);
  if (problema) return { ok: false, erro: problema };
  try {
    const nome = str(d.produto).trim();
    const ja = await db.query('select 1 from wallac_estoque where upper(btrim(produto)) = upper($1) limit 1', [nome]);
    if (ja.rowCount) return { ok: false, erro: 'Esse produto já existe no estoque. Edite a linha existente em vez de criar outra.' };
    await db.query('insert into wallac_estoque (produto, quantidade) values ($1, $2)', [nome, num(d.quantidade)]);
    return { ok: true };
  } catch (e) { return erro(e); }
}

async function editarProdutoEstoque(d) {
  const linha = num(d && d.linha);
  if (!linha || linha < 2) return { ok: false, erro: 'Linha inválida.' };
  const problema = validarProdutoEQtd(d);
  if (problema) return { ok: false, erro: problema };
  try {
    const r = await db.query('update wallac_estoque set produto = $2, quantidade = $3 where id = $1', [linha, str(d.produto).trim(), num(d.quantidade)]);
    return r.rowCount ? { ok: true } : { ok: false, erro: 'Produto não encontrado.' };
  } catch (e) { return erro(e); }
}

async function removerProdutoEstoque(d) {
  const linha = num(d && d.linha);
  if (!linha || linha < 2) return { ok: false, erro: 'Linha inválida.' };
  try {
    await db.query('delete from wallac_estoque where id = $1', [linha]);
    return { ok: true };
  } catch (e) { return erro(e); }
}

// ── Solicitar personalização (formulário público) ───────────────────────────
let uploaderLogo = async (base64, nome) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const env = require('../config/env');
  const r = await chamarAppsScript(env.wallacAppsScriptUrl, { method: 'POST', body: { acao: 'salvar_logo', logo_base64: base64, logo_nome: nome } });
  if (!r || !r.ok || !r.url) throw new Error((r && r.erro) || 'Falha ao salvar o logo no Drive');
  return r.url;
};
/** Só para testes. */
function definirUploaderLogo(fn) { uploaderLogo = fn; }

const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

async function solicitarPersonalizacao(d, agora = new Date()) {
  const dados = d || {};
  const qtd = num(dados.quantidade);
  if (!dados.produto || !qtd || qtd <= 0) return { ok: false, erro: 'Produto e quantidade são obrigatórios.' };
  if (!dados.id_venda_cliente || !dados.prazo_producao || !dados.prazo_entrega) return { ok: false, erro: 'ID venda/Cliente, prazo de produção e prazo de entrega são obrigatórios.' };
  if (!dados.logo_base64) return { ok: false, erro: 'O arquivo DXF do logo é obrigatório.' };
  if (!dados.solicitante) return { ok: false, erro: 'O nome de quem está solicitando é obrigatório.' };
  // Prazo mínimo: hoje + 2 dias úteis (data de Brasília). Mesma regra do navegador, repetida aqui para não confiar só no cliente.
  const minimo = somarDiasUteis(diaBrt(agora), DIAS_UTEIS_MINIMOS_PRAZO);
  if (DIA_VALIDO.test(str(dados.prazo_producao)) && str(dados.prazo_producao) < minimo) return { ok: false, erro: 'Prazo de produção selecionado é inferior ao permitido, caso necessário fale diretamente com Wallac.' };
  if (DIA_VALIDO.test(str(dados.prazo_entrega)) && str(dados.prazo_entrega) < minimo) return { ok: false, erro: 'Prazo de entrega selecionado é inferior ao permitido, caso necessário fale diretamente com Wallac.' };

  const ehOutro = !!dados.eh_outro;
  const produto = str(dados.produto).trim();
  try {
    if (!ehOutro) { // confere o estoque ANTES de subir o logo (sem arquivo órfão por falta de produto)
      const e = await db.query('select quantidade from wallac_estoque where btrim(produto) = $1 order by id limit 1', [produto]);
      if (!e.rowCount) return { ok: false, erro: 'Produto não encontrado no estoque.' };
      if (num(e.rows[0].quantidade) < qtd) return { ok: false, erro: 'Estoque insuficiente. Disponível: ' + num(e.rows[0].quantidade) + '.' };
    }
    const logoUrl = await uploaderLogo(dados.logo_base64, dados.logo_nome || 'logo.dxf');
    return await db.transaction(async (tx) => {
      if (!ehOutro) {
        const e = await tx.query('select id, quantidade from wallac_estoque where btrim(produto) = $1 order by id limit 1 for update', [produto]);
        if (!e.rowCount) return { ok: false, erro: 'Produto não encontrado no estoque.' };
        if (num(e.rows[0].quantidade) < qtd) return { ok: false, erro: 'Estoque insuficiente. Disponível: ' + num(e.rows[0].quantidade) + '.' };
        await tx.query('update wallac_estoque set quantidade = quantidade - $2 where id = $1', [e.rows[0].id, qtd]);
      }
      await tx.query(
        `insert into wallac_solicitacoes (produto, quantidade, id_venda_cliente, prazo_producao, prazo_entrega, observacoes, logo_url, status_atual, data_recebido, solicitante)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)`,
        [str(dados.produto), qtd, str(dados.id_venda_cliente), str(dados.prazo_producao), str(dados.prazo_entrega), str(dados.observacoes), logoUrl, STATUS.RECEBIDO, str(dados.solicitante)],
      );
      return { ok: true };
    });
  } catch (e) { return erro(e); }
}

// ── Premiação (SB Coin) ─────────────────────────────────────────────────────
// Soma a QUANTIDADE de todo card (compra ou estoque) que virou "Finalizado" dentro da semana (segunda a sexta) E até o
// prazo de produção do card (compara só o dia). <30 peças = Nenhuma, 30-49 = Bronze (2), 50-79 = Prata (4), 80+ = Ouro (6).
function faixaECoins(pecas) {
  if (pecas >= 80) return { faixa: 'Ouro', coins: 6 };
  if (pecas >= 50) return { faixa: 'Prata', coins: 4 };
  if (pecas >= 30) return { faixa: 'Bronze', coins: 2 };
  return { faixa: 'Nenhuma', coins: 0 };
}

const noPrazo = (finalizadoEm, prazo) => !!prazo && DIA_VALIDO.test(prazo) && diaBrt(new Date(finalizadoEm)) <= prazo;

async function calcularSemana(segunda) {
  const sexta = somarDias(segunda, 4);
  const ini = `${segunda}T00:00:00-03:00`; const fim = `${sexta}T23:59:59.999-03:00`;
  let pecas = 0;
  const fin = await db.query(
    `select linha_ltv, data_finalizado from wallac_status where status_atual = $1 and data_finalizado >= $2::timestamptz and data_finalizado <= $3::timestamptz`,
    [STATUS.FINALIZADO, ini, fim]);
  if (fin.rowCount) {
    const ltv = await cardsLtv(); // quantidade e prazo de produção estão na LTV (indexados pela linha)
    const porLinha = new Map(ltv.map((c) => [linhaDaChave(c.chave), c]));
    for (const x of fin.rows) {
      const c = porLinha.get(Number(x.linha_ltv));
      if (!c) continue;
      if (noPrazo(x.data_finalizado, c.prazo_producao)) pecas += Number(c.quantidade) || 0;
    }
  }
  const sol = await db.query(
    `select quantidade, prazo_producao, data_finalizado from wallac_solicitacoes where status_atual = $1 and data_finalizado >= $2::timestamptz and data_finalizado <= $3::timestamptz`,
    [STATUS.FINALIZADO, ini, fim]);
  for (const x of sol.rows) if (noPrazo(x.data_finalizado, x.prazo_producao)) pecas += num(x.quantidade) || 0;
  return pecas;
}

async function premiacaoSemanaAtual(agora = new Date()) {
  try {
    const segunda = segundaDe(diaBrt(agora));
    const pecas = await calcularSemana(segunda);
    const r = faixaECoins(pecas);
    return { ok: true, semana: { semana_inicio: segunda, semana_fim: somarDias(segunda, 4), pecas_no_prazo: pecas, faixa: r.faixa, coins_projetado: r.coins } };
  } catch (e) { return erro(e); }
}

const dataComFuso = (d) => `${d}T00:00:00-03:00`; // a tela faz new Date(...) e mostra dia/mês: com fuso cai no dia certo em Brasília

async function premiacaoHistorico() {
  try {
    const r = await db.query(
      `select to_char(semana_inicio, 'YYYY-MM-DD') as ini, to_char(semana_fim, 'YYYY-MM-DD') as fim, pecas_no_prazo, faixa, coins_da_semana, mes_referencia, coins_acumulados_no_mes
         from wallac_premiacao order by semana_inicio`);
    return {
      ok: true,
      historico: r.rows.map((x) => ({
        semana_inicio: dataComFuso(x.ini), semana_fim: dataComFuso(x.fim), pecas_no_prazo: Number(x.pecas_no_prazo) || 0, faixa: x.faixa,
        coins_da_semana: Number(x.coins_da_semana) || 0, mes_referencia: /^\d{4}-\d{2}$/.test(x.mes_referencia) ? dataComFuso(x.mes_referencia + '-01') : x.mes_referencia,
        coins_acumulados_no_mes: Number(x.coins_acumulados_no_mes) || 0,
      })),
    };
  } catch (e) { return erro(e); }
}

/**
 * Fecha a semana (segunda a sexta) que contém `agora`, uma única vez. Roda sozinha às sextas 16h30 (Brasília) ou, se o hub
 * estava fora do ar, assim que voltar até domingo. Devolve a linha gravada, ou null se a semana já estava fechada.
 */
async function fecharSemana(agora = new Date()) {
  const segunda = segundaDe(diaBrt(agora));
  const ja = await db.query('select 1 from wallac_premiacao where semana_inicio = $1::date', [segunda]);
  if (ja.rowCount) return null;
  const pecas = await calcularSemana(segunda);
  const r = faixaECoins(pecas);
  const sexta = somarDias(segunda, 4);
  const mes = sexta.slice(0, 7);
  const acum = await db.query('select coalesce(sum(coins_da_semana), 0)::int as s from wallac_premiacao where mes_referencia = $1', [mes]);
  const ins = await db.query(
    `insert into wallac_premiacao (semana_inicio, semana_fim, pecas_no_prazo, faixa, coins_da_semana, mes_referencia, coins_acumulados_no_mes)
     values ($1::date, $2::date, $3, $4, $5, $6, $7) on conflict (semana_inicio) do nothing`,
    [segunda, sexta, pecas, r.faixa, r.coins, mes, acum.rows[0].s + r.coins]);
  return ins.rowCount ? { semana_inicio: segunda, pecas_no_prazo: pecas, faixa: r.faixa, coins: r.coins, coins_acumulados_no_mes: acum.rows[0].s + r.coins } : null;
}

/** Sexta a partir das 16h30 de Brasília até domingo. */
function devidoParaFechar(agora = new Date()) {
  const b = new Date(agora.getTime() + BRT_MS);
  const dia = b.getUTCDay(); const min = b.getUTCHours() * 60 + b.getUTCMinutes();
  return (dia === 5 && min >= 16 * 60 + 30) || dia === 6 || dia === 0;
}

/** Confere a cada 10 min se é hora de fechar a semana da premiação (só com WALLAC_BACKEND=db). */
function iniciarFechamentoPremiacao() {
  const env = require('../config/env');
  const tick = async () => {
    if (env.wallacBackend !== 'db' || !devidoParaFechar()) return;
    try {
      const r = await fecharSemana();
      if (r) console.log('[wallac] semana da premiação fechada:', JSON.stringify(r));
    } catch (e) { console.error('[wallac] falha ao fechar a semana da premiação:', e.message); }
  };
  tick();
  setInterval(tick, 10 * 60 * 1000);
}

module.exports = {
  iniciarFechamentoPremiacao,
  cards, mudarStatus, estoquePublico, estoqueAdmin, adicionarProdutoEstoque, editarProdutoEstoque, removerProdutoEstoque,
  solicitarPersonalizacao, premiacaoSemanaAtual, premiacaoHistorico, fecharSemana, devidoParaFechar,
  definirFonteLtv, definirUploaderLogo, faixaECoins, segundaDe, somarDiasUteis, STATUS,
};
