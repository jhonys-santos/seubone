// Painel de Erros em Postgres (Supabase). Cada função devolve o mesmo JSON que o
// Apps Script devolvia (apps-script/erros/Code.gs), pra tela não perceber a troca.
// As regras (auditoria nunca apaga campo, fila de Refabricação, número em pt-BR,
// histórico em cada ação) foram portadas de lá.
const db = require('../db');

const AGORA_BRASILIA = "(now() at time zone 'America/Sao_Paulo')";
const REFAB_PENDENTE = 'Pendente';
const REFAB_APROVADO = 'Aprovado';
const REFAB_REPROVADO = 'Reprovado';
const REFAB_FINALIZADO = 'Finalizado';

const txt = (v) => String(v == null ? '' : v).trim();
const inteiro = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);
const faltou = { ok: false, error: 'rowIndex ausente' };
const naoAchou = { ok: false, error: 'Caso não encontrado.' };

/** Mesmo parseNumber_ do Apps Script: "R$ 1.234,56" -> 1234.56; vazio/inválido -> null. */
function parseNumero(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/r\$/i, '').replace(/\s/g, '').trim();
  if (s === '' || s === '-') return null;
  s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

const extrairLink = (texto) => { const m = String(texto || '').match(/https?:\/\/[^\s)]+/i); return m ? m[0] : ''; };

// ── Upload de arquivos (continua no Google Drive, via Apps Script) ───────
let uploader = async (fotos, idVenda) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const env = require('../config/env');
  const r = await chamarAppsScript(env.errosAppsScriptUrl, { method: 'POST', body: { action: 'salvarFotos', fotos, idVenda } });
  if (!r || !r.ok) throw new Error((r && r.error) || 'Falha ao salvar no Drive');
  return { urls: r.urls || [], falhas: r.falhas || 0, erroExemplo: r.erroExemplo || '' };
};
/** Só para testes. */
function definirUploader(fn) { uploader = fn; }

// ── Histórico ────────────────────────────────────────────────────────────
async function logHist(q, rowIndex, idVenda, usuario, acao, detalhe, slug) {
  try {
    await q.query(
      'insert into erros_historico (caso_row_index, id_venda, usuario, acao, detalhe, slug) values ($1,$2,$3,$4,$5,$6)',
      [rowIndex, idVenda || '', usuario || '—', acao || '', detalhe || '', slug || ''],
    );
  } catch (e) {
    console.error('[erros-db] falha ao gravar histórico:', e.message); // nunca derruba a ação principal
  }
}

// ── Leitura ──────────────────────────────────────────────────────────────
const COLUNAS_LISTA = `
  row_index::int as "rowIndex", to_char(data, 'DD/MM/YYYY') as data, auditoria, id_venda as "idVenda", nome_card as "nomeCard",
  descricao, quem_cadastrou as "quemCadastrou", culpa_de as "culpaDe", setor, responsavel, empresa,
  tipo_problema as "tipoProblema", subproblema, qtd::float8 as qtd, custo::float8 as custo, tipo_produto as "tipoProduto",
  linha, que_fim as "queFim", tipo_resolucao as "tipoResolucao", status, foto, link_pedido as "linkPedido",
  aprovacao_refab as "aprovacaoRefab", comentario_aprovacao as "comentarioAprovacao", comentario_final as "comentarioFinal",
  registrado_por_slug as "registradoPorSlug"`;

async function listar() {
  const r = await db.query(`select ${COLUNAS_LISTA} from erros_casos where trim(id_venda) <> '' or trim(nome_card) <> '' order by row_index`);
  const rows = r.rows.map((x) => ({
    ...x,
    data: x.data || '',
    qtd: x.qtd == null ? '' : x.qtd,
    custo: x.custo == null ? '' : x.custo,
    linkPedido: x.linkPedido || extrairLink(x.descricao),
  }));
  return { ok: true, rows };
}

async function historico(rowIndex) {
  const n = inteiro(rowIndex);
  if (n == null) return { ok: true, eventos: [] };
  const r = await db.query(
    `select to_char(quando, 'DD/MM/YYYY HH24:MI') as quando, usuario, acao, detalhe
       from erros_historico where caso_row_index = $1 order by id desc`,
    [n],
  );
  return { ok: true, eventos: r.rows };
}

// ── Escrita ──────────────────────────────────────────────────────────────
/** Se virou "Refabricação" e ainda não está na fila, entra como Pendente (nunca sobrescreve uma decisão). */
async function entrarNaFilaRefab(q, rowIndex, tipoResolucao) {
  if (tipoResolucao !== 'Refabricação') return false;
  const r = await q.query(
    "update erros_casos set aprovacao_refab = $2 where row_index = $1 and trim(aprovacao_refab) = '' returning row_index",
    [rowIndex, REFAB_PENDENTE],
  );
  return r.rowCount > 0;
}

async function criar(f, usuario, usuarioSlug) {
  f = f || {};
  let fotosErro = null;
  let fotosErroAcao = 'Fotos não salvas';
  let foto = '';
  if (f.fotosUrls && f.fotosUrls.length) {
    foto = f.fotosUrls.join(','); // fluxo atual: já foram salvas no Drive antes de criar o caso
  } else if (f.fotos && f.fotos.length) {
    // fluxo antigo (upload junto com a criação), mantido por compatibilidade
    try {
      const res = await uploader(f.fotos, f.idVenda);
      if (res.urls.length) foto = res.urls.join(',');
      if (res.falhas > 0) {
        fotosErro = res.urls.length
          ? `${res.falhas} de ${f.fotos.length} arquivo(s) não foram salvos (${res.erroExemplo || 'motivo desconhecido'}).`
          : `Nenhum arquivo foi salvo (${res.erroExemplo || 'formato inesperado'}).`;
      }
    } catch (e) {
      fotosErro = String((e && e.message) || e);
      fotosErroAcao = 'Falha ao salvar fotos';
    }
  }

  return db.transaction(async (tx) => {
    const ins = await tx.query(
      `insert into erros_casos (data, auditoria, status, id_venda, nome_card, descricao, link_pedido, quem_cadastrou, culpa_de, setor,
                                responsavel, empresa, tipo_problema, subproblema, qtd, custo, tipo_produto, que_fim, tipo_resolucao,
                                foto, registrado_por_slug)
       values ((now() at time zone 'America/Sao_Paulo')::date, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       returning row_index::int as "rowIndex"`,
      [!!f.auditoria, txt(f.status) || (f.auditoria ? 'resolvido' : 'novo'), txt(f.idVenda), txt(f.nomeCard), f.descricao == null ? '' : String(f.descricao),
        txt(f.linkPedido), txt(f.quemCadastrou), txt(f.culpaDe), txt(f.setor), txt(f.responsavel), txt(f.empresa), txt(f.tipoProblema),
        txt(f.subproblema), parseNumero(f.qtd), parseNumero(f.custo), txt(f.tipoProduto), txt(f.queFim), txt(f.tipoResolucao), foto,
        usuarioSlug || ''],
    );
    const rowIndex = ins.rows[0].rowIndex;
    const quem = usuario || f.quemCadastrou;
    if (fotosErro) await logHist(tx, rowIndex, f.idVenda, quem, fotosErroAcao, fotosErro, usuarioSlug);
    await logHist(tx, rowIndex, f.idVenda, quem, 'Caso registrado',
      f.auditoria ? 'já auditado (' + (f.status || 'resolvido') + ')' : 'pendente de auditoria', usuarioSlug);
    const entrouRefab = await entrarNaFilaRefab(tx, rowIndex, f.tipoResolucao);
    if (entrouRefab) await logHist(tx, rowIndex, f.idVenda, quem, 'Entrou na fila de aprovação de Refabricação', '', usuarioSlug);
    return { ok: true, rowIndex, entrouAprovacaoRefab: entrouRefab, fotosSalvas: !fotosErro, fotosErro };
  });
}

// auditoria: campo -> coluna. Valor vazio/ausente NUNCA apaga o que já está salvo (como o setCell_ da planilha).
const CAMPOS_AUDITORIA = {
  culpaDe: 'culpa_de', setor: 'setor', responsavel: 'responsavel', empresa: 'empresa', tipoProduto: 'tipo_produto', linha: 'linha',
  tipoProblema: 'tipo_problema', subproblema: 'subproblema', qtd: 'qtd', custo: 'custo', queFim: 'que_fim',
  tipoResolucao: 'tipo_resolucao', comentarioFinal: 'comentario_final',
};

async function auditar(rowIndex, f, usuario, usuarioSlug) {
  const n = inteiro(rowIndex);
  if (n == null) return faltou;
  f = f || {};
  const sets = ['auditoria = true', 'status = $2'];
  const params = [n, txt(f.status) || 'resolvido'];
  for (const [campo, coluna] of Object.entries(CAMPOS_AUDITORIA)) {
    const v = f[campo];
    if (v === undefined || v === null || v === '') continue;
    params.push(campo === 'qtd' || campo === 'custo' ? parseNumero(v) : txt(v));
    sets.push(`${coluna} = $${params.length}`);
  }
  return db.transaction(async (tx) => {
    const r = await tx.query(`update erros_casos set ${sets.join(', ')} where row_index = $1 returning id_venda, nome_card`, params);
    if (!r.rows.length) return naoAchou;
    const { id_venda: idVenda, nome_card: nomeCard } = r.rows[0];
    await logHist(tx, n, idVenda, usuario, 'Auditoria salva',
      [f.setor, f.tipoResolucao, (f.custo ? 'R$ ' + f.custo : '')].filter(Boolean).join(' · '), usuarioSlug);
    const entrouRefab = await entrarNaFilaRefab(tx, n, f.tipoResolucao);
    if (entrouRefab) await logHist(tx, n, idVenda, usuario, 'Entrou na fila de aprovação de Refabricação', '', usuarioSlug);
    return { ok: true, rowIndex: n, entrouAprovacaoRefab: entrouRefab, idVenda: txt(idVenda), nomeCard: txt(nomeCard) };
  });
}

async function decidirRefab(rowIndex, decisao, comentario, usuario, usuarioSlug) {
  const n = inteiro(rowIndex);
  if (n == null || (decisao !== REFAB_APROVADO && decisao !== REFAB_REPROVADO)) return { ok: false, error: 'rowIndex/decisao inválidos' };
  return db.transaction(async (tx) => {
    const r = await tx.query(
      `update erros_casos set aprovacao_refab = $2, comentario_aprovacao = $3 where row_index = $1
       returning id_venda, nome_card, registrado_por_slug`,
      [n, decisao, comentario || ''],
    );
    if (!r.rows.length) return naoAchou;
    const c = r.rows[0];
    await logHist(tx, n, c.id_venda, usuario, 'Refabricação ' + (decisao === REFAB_APROVADO ? 'aprovada' : 'reprovada'), comentario || '', usuarioSlug);
    return { ok: true, rowIndex: n, decisao, idVenda: txt(c.id_venda), nomeCard: txt(c.nome_card), registradoPorSlug: c.registrado_por_slug || '' };
  });
}

async function finalizarRefab(rowIndex, usuario, usuarioSlug) {
  const n = inteiro(rowIndex);
  if (n == null) return faltou;
  return db.transaction(async (tx) => {
    const r = await tx.query('select aprovacao_refab, id_venda from erros_casos where row_index = $1 for update', [n]);
    if (!r.rows.length) return naoAchou;
    if (txt(r.rows[0].aprovacao_refab) !== REFAB_APROVADO) return { ok: false, error: 'Só é possível finalizar um caso já aprovado.' };
    await tx.query('update erros_casos set aprovacao_refab = $2 where row_index = $1', [n, REFAB_FINALIZADO]);
    await logHist(tx, n, r.rows[0].id_venda, usuario, 'Enviado para produção', '', usuarioSlug);
    return { ok: true, rowIndex: n };
  });
}

async function comentarCaso(rowIndex, comentario, usuario, usuarioSlug) {
  const n = inteiro(rowIndex);
  if (n == null) return faltou;
  const texto = txt(comentario);
  if (!texto) return { ok: false, error: 'Comentário vazio.' };
  const r = await db.query('select id_venda, nome_card from erros_casos where row_index = $1', [n]);
  if (!r.rows.length) return naoAchou;
  await logHist(db, n, r.rows[0].id_venda, usuario, 'Comentário', texto, usuarioSlug);
  return { ok: true, rowIndex: n, idVenda: txt(r.rows[0].id_venda), nomeCard: txt(r.rows[0].nome_card) };
}

async function setStatus(rowIndex, status, usuario) {
  const n = inteiro(rowIndex);
  if (n == null || !status) return { ok: false, error: 'rowIndex/status ausente' };
  const s = txt(status);
  return db.transaction(async (tx) => {
    // "resolvido" também marca como auditado; nunca desmarca (mesma regra da planilha)
    const r = await tx.query(
      `update erros_casos set status = $2, auditoria = case when $2 = 'resolvido' then true else auditoria end
        where row_index = $1 returning id_venda`,
      [n, s],
    );
    if (!r.rows.length) return naoAchou;
    await logHist(tx, n, r.rows[0].id_venda, usuario, 'Status alterado', '→ ' + s);
    return { ok: true, rowIndex: n, status: s };
  });
}

async function setSetor(rowIndex, setor, usuario) {
  const n = inteiro(rowIndex);
  if (n == null || !setor) return { ok: false, error: 'rowIndex/setor ausente' };
  const s = txt(setor);
  const r = await db.query('update erros_casos set setor = $2 where row_index = $1 returning id_venda', [n, s]);
  if (!r.rows.length) return naoAchou;
  await logHist(db, n, r.rows[0].id_venda, usuario, 'Setor preenchido', '→ ' + s);
  return { ok: true, rowIndex: n, setor: s };
}

async function setDescricao(rowIndex, descricao, usuario) {
  const n = inteiro(rowIndex);
  if (n == null) return faltou;
  const texto = txt(descricao);
  if (!texto) return { ok: false, error: 'Descrição vazia.' };
  const r = await db.query('update erros_casos set descricao = $2 where row_index = $1 returning id_venda', [n, texto]);
  if (!r.rows.length) return naoAchou;
  await logHist(db, n, r.rows[0].id_venda, usuario, 'Descrição editada', '', '');
  return { ok: true, rowIndex: n, descricao: texto };
}

async function adicionarAnexos(rowIndex, fotos, usuario, usuarioSlug) {
  const n = inteiro(rowIndex);
  if (n == null) return faltou;
  if (!fotos || !fotos.length) return { ok: false, error: 'Nenhum arquivo enviado.' };
  const c = await db.query('select id_venda from erros_casos where row_index = $1', [n]);
  if (!c.rows.length) return naoAchou;
  const idVenda = c.rows[0].id_venda;

  let res;
  try { res = await uploader(fotos, idVenda); } catch (e) { res = { urls: [], falhas: fotos.length, erroExemplo: String((e && e.message) || e) }; }
  if (!res.urls.length) return { ok: false, error: 'Não consegui salvar os arquivos' + (res.erroExemplo ? ` (${res.erroExemplo})` : '') + '.' };

  // Sempre acrescenta (nunca substitui), de forma atômica.
  const novos = res.urls.join(',');
  const r = await db.query(
    `update erros_casos set foto = case when trim(foto) = '' then $2 else trim(foto) || ',' || $2 end where row_index = $1 returning foto`,
    [n, novos],
  );
  const detalhe = `${res.urls.length} arquivo(s)` + (res.falhas ? ` · ${res.falhas} falharam: ${res.erroExemplo || 'motivo desconhecido'}` : '');
  await logHist(db, n, idVenda, usuario, 'Anexo(s) adicionado(s)', detalhe, usuarioSlug);
  return { ok: true, rowIndex: n, foto: r.rows[0].foto, falhas: res.falhas, erroExemplo: res.falhas ? res.erroExemplo : '' };
}

module.exports = {
  listar, historico, criar, auditar, decidirRefab, finalizarRefab, comentarCaso, setStatus, setSetor, setDescricao, adicionarAnexos,
  definirUploader, parseNumero, extrairLink,
};
