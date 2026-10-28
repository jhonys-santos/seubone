// Aprovação de Reembolso SAC dentro do hub: só gestor aprova ou nega; o hub move o card no finfin ("aprovado" / "negado") e guarda quem decidiu, quando e o motivo
// (o finfin registra tudo que vem pela API como "Sistema" e não aceita comentário ao mover). O solicitante é avisado no hub.
const db = require('../db');
const finfin = require('./finfinDemandas.service');
const retorno = require('./finfinRetorno.service');

const FORMULARIO = 'reembolso_sac';
const PENDENTES = ['solicitacao_feita', 'em_aprovacao'];
const COLUNA_DA_DECISAO = { aprovar: 'aprovado', negar: 'negado' };
const NOME_COLUNA = { solicitacao_feita: 'Solicitação feita', em_aprovacao: 'Em aprovação', aprovado: 'Aprovado', aguardando: 'Aguardando retorno/Ajuste', lancado: 'Lançado no Omie', pago: 'Pago', negado: 'Negado' };

const erro = (http, mensagem, extra = {}) => ({ http, json: { ok: false, erro: mensagem, ...extra } });
const json = (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return v || {}; };

function linha(r) {
  const d = json(r.dados);
  const anexos = json(r.anexos_enviados);
  return {
    codigo: r.codigo,
    criadoEm: new Date(r.criado_em).toISOString(),
    solicitante: r.solicitante_nome,
    email: r.solicitante_email,
    idVenda: d.id_venda || '',
    linkLulu: r.link_lulu || '',
    vencimento: d.vencimento || '',
    cliente: d.razao_social || '',
    cpfCnpj: d.cpf_cnpj || '',
    motivo: d.motivo || '',
    banco: d.banco || '', agencia: d.agencia || '', conta: d.conta || '',
    pixTipo: d.pix_tipo || '', pixChave: d.pix_chave || '',
    valor: d.valor != null ? Number(d.valor) : null,
    anexos: (Array.isArray(anexos) ? anexos : []).map((a) => a && a.nome).filter(Boolean),
    coluna: r.coluna,
    colunaNome: NOME_COLUNA[r.coluna] || r.coluna,
    teste: r.modo === 'teste',
    decisao: r.decisao ? { decisao: r.decisao, motivo: r.decisao_motivo || '', por: r.decisao_por || '', em: new Date(r.decisao_em).toISOString() } : null,
  };
}

const SELECT = `select f.codigo, f.criado_em, f.solicitante_nome, f.solicitante_email, f.link_lulu, f.dados, f.anexos_enviados, f.coluna, f.modo,
       d.decisao, d.motivo as decisao_motivo, d.por_nome as decisao_por, d.em as decisao_em
  from finfin_demandas f
  left join lateral (select * from finfin_decisoes x where x.codigo = f.codigo order by x.em desc limit 1) d on true
 where f.formulario = '${FORMULARIO}' and f.codigo <> ''`;

/** aba: 'pendentes' (aguardando decisão, mais antigos primeiro) ou 'decididos' (já aprovados/negados no hub, mais recentes primeiro). */
async function listar(aba) {
  const r = aba === 'decididos'
    ? await db.query(`${SELECT} and d.decisao is not null order by d.em desc limit 150`)
    : await db.query(`${SELECT} and f.coluna = any($1) order by f.criado_em asc`, [PENDENTES]);
  return { ok: true, itens: r.rows.map(linha) };
}

/**
 * Aprova ou nega um reembolso. usuario: { slug, nome, role } (da sessão). Devolve { http, json }.
 * Ordem: valida -> confere a coluna atual NO FINFIN -> move o card -> registra a decisão -> atualiza o recibo e avisa o solicitante.
 * Se o finfin recusar, nada muda no hub.
 */
async function decidir({ codigo, decisao, motivo, usuario }) {
  if (!usuario || usuario.role !== 'gestor') return erro(403, 'Só gestor pode aprovar ou negar reembolsos.');
  const para = COLUNA_DA_DECISAO[decisao];
  if (!para) return erro(400, 'Decisão inválida (use aprovar ou negar).');
  const cod = String(codigo || '').trim();
  const texto = String(motivo || '').trim().slice(0, 1000);
  if (decisao === 'negar' && texto.length < 5) return erro(422, 'Informe o motivo da negativa (pelo menos 5 caracteres).');
  if (!finfin.configurado()) return erro(503, 'A integração com o finfin ainda não está configurada (falta o token no servidor).');

  const rec = (await db.query("select codigo, coluna from finfin_demandas where codigo = $1 and formulario = $2", [cod, FORMULARIO])).rows[0];
  if (!rec) return erro(404, 'Reembolso não encontrado.');

  // Confere onde o card está AGORA no finfin (o financeiro pode ter movido): só decide quem ainda está aguardando decisão.
  const atual = await finfin.consultarCard(cod);
  if (!atual.ok) return erro(502, 'Não consegui confirmar o card no finfin: ' + atual.erro);
  const colunaAtual = atual.card && atual.card.coluna && atual.card.coluna.chave;
  if (!PENDENTES.includes(colunaAtual)) {
    if (colunaAtual && colunaAtual !== rec.coluna) await db.query('update finfin_demandas set coluna = $2, atualizado_em = now() where codigo = $1', [cod, colunaAtual]);
    const ja = (await db.query('select por_nome, decisao, em from finfin_decisoes where codigo = $1 order by em desc limit 1', [cod])).rows[0];
    return erro(409, `Este reembolso já está em "${NOME_COLUNA[colunaAtual] || colunaAtual}" no finfin${ja ? ` (${ja.decisao === 'aprovado' ? 'aprovado' : 'negado'} por ${ja.por_nome})` : ''}. Atualize a lista.`, { colunaAtual });
  }

  const mov = await finfin.moverCard(cod, para);
  if (!mov.ok) return erro(mov.status === 429 ? 429 : 502, 'O finfin não aceitou a mudança de coluna: ' + mov.erro + (mov.erros ? ' ' + Object.values(mov.erros).join(' ') : ''));

  let avisoRegistro = null;
  try {
    await db.query(
      `insert into finfin_decisoes (codigo, formulario, decisao, coluna_de, coluna_para, motivo, por_slug, por_nome) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cod, FORMULARIO, para, colunaAtual, para, texto, usuario.slug || '', usuario.nome || '']);
  } catch (e) { console.error('[reembolso-aprovacao] card movido no finfin, mas falhou ao registrar quem decidiu:', e.message); avisoRegistro = 'O card foi movido no finfin, mas não consegui registrar a decisão no hub.'; }

  // Atualiza o recibo (coluna, quem concluiu, motivo) e avisa o solicitante: mesmo caminho do retorno do finfin, sem marcar como "chegou pelo webhook".
  try {
    await retorno.processarEvento({ codigo: cod, coluna: { chave: para }, concluido_por: usuario.nome || '', comentario: texto }, { origem: 'hub' });
  } catch (e) { console.error('[reembolso-aprovacao] decisão registrada, mas falhou ao atualizar o recibo/avisar:', e.message); avisoRegistro = avisoRegistro || 'A decisão foi aplicada, mas o aviso ao solicitante pode não ter saído.'; }

  return { http: 200, json: { ok: true, codigo: cod, coluna: para, colunaNome: NOME_COLUNA[para], aviso: avisoRegistro } };
}

module.exports = { listar, decidir, PENDENTES, NOME_COLUNA };
