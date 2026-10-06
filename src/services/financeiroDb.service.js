// Solicitações Financeiro (Registro de Demandas, Reembolso, Pagamento) e Corridas
// Avulsas em Postgres. Cada função devolve o mesmo JSON que o Apps Script devolvia
// (apps-script/registro-demandas, corridas-pagamentos e corridas-avulsas), pra tela
// e os webhooks do n8n não perceberem a troca. Anexos continuam no Google Drive:
// o upload ainda é feito pelo Apps Script (ações salvarAnexos / salvarPrints).
const db = require('../db');

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
// Data sem hora no formato que o Apps Script devolvia (meia-noite de Brasília em UTC). A tela só usa
// os 10 primeiros caracteres, e new Date() cai no dia certo no fuso do Brasil.
const dataIso = (col) => `coalesce(to_char(${col}, 'YYYY-MM-DD') || 'T03:00:00.000Z', '')`;

const str = (v) => String(v == null ? '' : v);

/** "2026-10-12" ou ISO -> "2026-10-12" (ou null). ISO com horário é convertido para o dia em Brasília. */
function paraData(v) {
  const s = str(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return s.slice(0, 10); // sem fuso: já é hora local
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    // Data "sem hora" que a planilha guardou como meia-noite local (Brasília = 03:00 UTC): o dia é o do instante em UTC;
    // se por algum fuso à frente a meia-noite local caiu na tarde do dia anterior (UTC), é o dia seguinte.
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() + (d.getUTCHours() >= 12 ? 86400000 : 0)).toISOString().slice(0, 10);
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ── Upload de anexos (continua no Google Drive, via Apps Script de cada área) ──
let uploaderAnexos = async (urlBase, anexos) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const r = await chamarAppsScript(urlBase, { method: 'POST', body: { action: 'salvarAnexos', anexos } });
  if (!r || !r.ok) throw new Error((r && r.erro) || 'Falha ao salvar anexos no Drive');
  return r.anexos || [];
};
let uploaderPrints = async (urlBase, imagens, id) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  const r = await chamarAppsScript(urlBase, { method: 'POST', body: { action: 'salvarPrints', imagens, id } });
  if (!r || !r.ok) throw new Error((r && r.erro) || 'Falha ao salvar prints no Drive');
  return r.urls || [];
};
/** Só para testes. */
function definirUploaders({ anexos, prints }) { if (anexos) uploaderAnexos = anexos; if (prints) uploaderPrints = prints; }

const urlDe = (area) => {
  const env = require('../config/env');
  return area === 'registro' ? env.registroDemandasAppsScriptUrl : area === 'pagamento' ? env.corridasPagamentosAppsScriptUrl : env.corridasAvulsasAppsScriptUrl;
};

async function anexosProcessados(area, anexos) {
  if (!Array.isArray(anexos) || !anexos.length) return [];
  return uploaderAnexos(urlDe(area), anexos);
}

/** id = prefixo + milissegundos, como antes; se colidir, tenta o próximo milissegundo. */
async function inserirComId(prefixo, inserir, base = Date.now()) {
  for (let i = 0; i < 10; i++) {
    try { return await inserir(prefixo + (base + i)); } catch (e) { if (e && e.code === '23505') continue; throw e; }
  }
  throw new Error('Não foi possível gerar um id único.');
}

const erroDeEscrita = (e) => ({ ok: false, erro: (e && e.message) || String(e) });

// ── Leitura ──────────────────────────────────────────────────────────────
const SQL_REGISTRO = `select id as "ID", ${dataIso('data')} as "Data", ${dataIso('data_vencimento')} as "DataVencimento",
  id_compra as "IDCompra", link_card as "LinkCard", solicitante as "Solicitante", empresa as "Empresa",
  numero_corporativo as "NumeroCorporativo", tipo_demanda as "TipoDemanda", demanda_solicitada as "DemandaSolicitada",
  observacao as "Observacao", email as "Email", coalesce(nullif(anexos, ''), '[]') as "Anexos",
  coalesce(nullif(status, ''), 'Pendente') as "Status", feito_por as "FeitoPor",
  to_char(inserido_em at time zone 'UTC', ${ISO_UTC}) as "InseridoEm", solicitante_slug as "SolicitanteSlug"
  from registro_demandas order by ordem`;

const SQL_REEMBOLSO = `select id as "ID", ${dataIso('data_vencimento')} as "DataVencimento", id_referencia as "IDReferencia",
  cpf_cnpj as "CPFCNPJ", email as "Email", motivo_reembolso as "MotivoReembolso", razao_social_cliente as "RazaoSocialCliente",
  banco as "Banco", agencia as "Agencia", conta as "Conta", chave_pix as "ChavePix", tipo_chave as "TipoChave",
  valor::float8 as "Valor", empresa_responsavel as "EmpresaResponsavel", coalesce(nullif(anexos, ''), '[]') as "Anexos",
  coalesce(nullif(status, ''), 'Pendente') as "Status", feito_por as "FeitoPor",
  to_char(inserido_em at time zone 'UTC', ${ISO_UTC}) as "InseridoEm", solicitante_slug as "SolicitanteSlug"
  from reembolsos order by ordem`;

const SQL_PAGAMENTO = `select id as "ID", ${dataIso('data_vencimento')} as "DataVencimento", cpf_cnpj as "CPFCNPJ", email as "Email",
  motivo as "Motivo", razao_social as "RazaoSocial", banco as "Banco", agencia as "Agencia", conta as "Conta",
  chave_pix as "ChavePix", tipo_chave as "TipoChave", valor::float8 as "Valor", empresa_responsavel as "EmpresaResponsavel",
  solicitante as "Solicitante", numero_nota_fiscal as "NumeroNotaFiscal", coalesce(nullif(anexos, ''), '[]') as "Anexos",
  coalesce(nullif(status, ''), 'Pendente') as "Status", feito_por as "FeitoPor",
  to_char(inserido_em at time zone 'UTC', ${ISO_UTC}) as "InseridoEm", solicitante_slug as "SolicitanteSlug"
  from pagamentos order by ordem`;

// "list" do Apps Script devolve um array cru (não { ok, ... }): o front já espera esse formato.
const listarRegistros = async () => (await db.query(SQL_REGISTRO)).rows;
const listarReembolsos = async () => (await db.query(SQL_REEMBOLSO)).rows;
const listarPagamentos = async () => (await db.query(SQL_PAGAMENTO)).rows;

// ── Criação ──────────────────────────────────────────────────────────────
async function criarRegistro(b) {
  try {
    const anexos = await anexosProcessados('registro', b.anexos);
    const id = await inserirComId('RD', async (novoId) => {
      await db.query(
        `insert into registro_demandas (id, data, data_vencimento, id_compra, link_card, solicitante, empresa, numero_corporativo,
           tipo_demanda, demanda_solicitada, observacao, email, anexos, status, solicitante_slug)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Pendente',$14)`,
        [novoId, paraData(b.data), paraData(b.dataVencimento), str(b.idCompra), str(b.linkCard), str(b.solicitante), str(b.empresa),
          str(b.numeroCorporativo), str(b.tipoDemanda), str(b.demandaSolicitada), str(b.observacao), str(b.email), JSON.stringify(anexos),
          str(b.solicitanteSlug)],
      );
      return novoId;
    });
    return { ok: true, id, anexos };
  } catch (e) { return erroDeEscrita(e); }
}

async function criarReembolso(b) {
  try {
    const anexos = await anexosProcessados('registro', b.anexos);
    const id = await inserirComId('RB', async (novoId) => {
      await db.query(
        `insert into reembolsos (id, data_vencimento, id_referencia, cpf_cnpj, email, motivo_reembolso, razao_social_cliente, banco,
           agencia, conta, chave_pix, tipo_chave, valor, empresa_responsavel, anexos, status, solicitante_slug)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Pendente',$16)`,
        // "id" do corpo é a referência digitada no formulário (IDReferencia), não o id interno.
        [novoId, paraData(b.dataVencimento), str(b.id), str(b.cpfCnpj), str(b.email), str(b.motivo), str(b.razaoSocial), str(b.banco),
          str(b.agencia), str(b.conta), str(b.chavePix), str(b.tipoChave), Number(b.valor) || 0, str(b.empresaResponsavel),
          JSON.stringify(anexos), str(b.solicitanteSlug)],
      );
      return novoId;
    });
    return { ok: true, id, anexos };
  } catch (e) { return erroDeEscrita(e); }
}

async function criarPagamento(b) {
  try {
    const anexos = await anexosProcessados('pagamento', b.anexos);
    const id = await inserirComId('PG', async (novoId) => {
      await db.query(
        `insert into pagamentos (id, data_vencimento, cpf_cnpj, email, motivo, razao_social, banco, agencia, conta, chave_pix, tipo_chave,
           valor, empresa_responsavel, solicitante, numero_nota_fiscal, anexos, status, solicitante_slug)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Pendente',$17)`,
        [novoId, paraData(b.dataVencimento), str(b.cpfCnpj), str(b.email), str(b.motivo), str(b.razaoSocial), str(b.banco), str(b.agencia),
          str(b.conta), str(b.chavePix), str(b.tipoChave), Number(b.valor) || 0, str(b.empresaResponsavel), str(b.solicitante),
          str(b.numeroNotaFiscal), JSON.stringify(anexos), str(b.solicitanteSlug)],
      );
      return novoId;
    });
    return { ok: true, id, anexos };
  } catch (e) { return erroDeEscrita(e); }
}

// ── Marcar como feito (webhook do n8n e rotas /api/marcar*) ──────────────
// Registro e Reembolso compartilham a lógica; o comprovante do financeiro SUBSTITUI os anexos originais.
async function marcarGenerico({ tabela, colunaReferencia }, b) {
  try {
    const achou = await db.query(`select ${colunaReferencia} as referencia, solicitante_slug from ${tabela} where id = $1`, [str(b.id)]);
    if (!achou.rows.length) return { ok: false, erro: 'Solicitação não encontrada: ' + b.id };

    const sets = []; const params = [str(b.id)];
    if (b.status) { params.push(str(b.status)); sets.push(`status = $${params.length}`); }
    if (b.marcadoPor !== undefined) { params.push(str(b.marcadoPor)); sets.push(`feito_por = $${params.length}`); }
    if (Array.isArray(b.anexos) && b.anexos.length) {
      params.push(JSON.stringify(await anexosProcessados('registro', b.anexos)));
      sets.push(`anexos = $${params.length}`);
    }
    if (sets.length) await db.query(`update ${tabela} set ${sets.join(', ')} where id = $1`, params);
    return { ok: true, referencia: str(achou.rows[0].referencia), solicitanteSlug: str(achou.rows[0].solicitante_slug) };
  } catch (e) { return erroDeEscrita(e); }
}
const marcarRegistro = (b) => marcarGenerico({ tabela: 'registro_demandas', colunaReferencia: 'id_compra' }, b);
const marcarReembolso = (b) => marcarGenerico({ tabela: 'reembolsos', colunaReferencia: 'id_referencia' }, b);

async function marcarPagamento(b) {
  try {
    const achou = await db.query('select solicitante_slug from pagamentos where id = $1', [str(b.id)]);
    if (!achou.rows.length) return { ok: false, erro: 'Pagamento não encontrado: ' + b.id };
    const params = [str(b.id), b.concluidoPor || 'Financeiro (n8n)'];
    let anexosSql = '';
    if (Array.isArray(b.anexos) && b.anexos.length) { params.push(JSON.stringify(await anexosProcessados('pagamento', b.anexos))); anexosSql = ', anexos = $3'; }
    await db.query(`update pagamentos set status = 'Feito', feito_por = $2${anexosSql} where id = $1`, params);
    return { ok: true, solicitanteSlug: str(achou.rows[0].solicitante_slug) };
  } catch (e) { return erroDeEscrita(e); }
}

// ── Corridas avulsas ─────────────────────────────────────────────────────
function paraItemCorrida(r) {
  return {
    id: r.id, dataCadastro: r.dataCadastro, dataCorrida: r.dataCorrida || '', numeroNf: r.numeroNf, endereco: r.endereco, valor: r.valor,
    printUrls: Array.isArray(r.printUrls) ? r.printUrls : [], registradoPorSlug: r.registradoPorSlug, registradoPorNome: r.registradoPorNome,
    nomeMotorista: r.nomeMotorista,
  };
}

/** Lista as corridas (todas, ou de desde a ate, inclusive), da data mais antiga para a mais nova. */
async function listarCorridas(desde, ate) {
  const d = paraData(desde), a = paraData(ate);
  const r = await db.query(
    `select id, to_char(data_cadastro at time zone 'UTC', ${ISO_UTC}) as "dataCadastro", to_char(data_corrida, 'YYYY-MM-DD') as "dataCorrida",
            numero_nf as "numeroNf", endereco, valor::float8 as valor, print_urls as "printUrls",
            registrado_por_slug as "registradoPorSlug", registrado_por_nome as "registradoPorNome", nome_motorista as "nomeMotorista"
       from corridas
      where (data_corrida is null or (($1::date is null or data_corrida >= $1::date) and ($2::date is null or data_corrida <= $2::date)))
      order by data_corrida nulls first, ordem`,
    [d, a],
  );
  return { ok: true, itens: r.rows.map(paraItemCorrida) };
}

async function cadastrarCorrida(b) {
  try {
    const id = 'CA' + Date.now();
    // "imagens" é o formato atual ([{base64,tipo}], um ou mais prints); "imagemBase64/imagemTipo" é o antigo (um print só).
    const imagens = Array.isArray(b.imagens) && b.imagens.length ? b.imagens : (b.imagemBase64 ? [{ base64: b.imagemBase64, tipo: b.imagemTipo }] : []);
    const urls = imagens.length ? await uploaderPrints(urlDe('corridas'), imagens, id) : [];
    const idFinal = await inserirComId('CA', async (novoId) => {
      await db.query(
        `insert into corridas (id, data_corrida, numero_nf, endereco, valor, print_urls, registrado_por_slug, registrado_por_nome, nome_motorista)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [novoId, paraData(b.dataCorrida), str(b.numeroNf), str(b.endereco), Number(b.valor) || 0, JSON.stringify(urls), str(b.registradoPorSlug),
          str(b.registradoPorNome), str(b.nomeMotorista)],
      );
      return novoId;
    }, Number(id.slice(2)));
    return { ok: true, id: idFinal, printUrls: urls };
  } catch (e) { return erroDeEscrita(e); }
}

module.exports = {
  listarRegistros, listarReembolsos, listarPagamentos, criarRegistro, criarReembolso, criarPagamento,
  marcarRegistro, marcarReembolso, marcarPagamento, listarCorridas, cadastrarCorrida,
  definirUploaders, paraData,
};
