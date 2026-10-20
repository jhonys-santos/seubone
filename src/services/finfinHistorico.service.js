// Solicitações do formulário novo (finfin) no MESMO formato de linha que o Histórico de solicitações já usa para o Registro antigo
// (ID, Data, IDCompra, LinkCard, Solicitante, DemandaSolicitada, Observacao, Anexos, Status, FeitoPor, InseridoEm...), para a página
// do Histórico mostrar tudo junto, no layout de sempre.
const db = require('../db');

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * "ehGestor": cards de TESTE (modo 'teste' do formulário novo) só aparecem para gestor; os de produção, para todos.
 * Status: concluído no finfin = "Feito"; cancelado = "Cancelado"; o resto = "Pendente".
 * "ID venda" mostra o código do card (DM-…): é a chave que o financeiro usa no finfin (o formulário novo não pergunta o ID da venda).
 */
async function listarParaHistorico({ ehGestor = false } = {}) {
  const r = await db.query(
    `select codigo as "ID",
            to_char(criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as "Data",
            '' as "DataVencimento",
            codigo as "IDCompra",
            link_lulu as "LinkCard",
            solicitante_nome as "Solicitante",
            'SeuBoné' as "Empresa",
            telefone as "NumeroCorporativo",
            '' as "TipoDemanda",
            demanda as "DemandaSolicitada",
            case when especificacao <> '' then especificacao || ' — ' || descricao else descricao end as "Observacao",
            solicitante_email as "Email",
            coalesce(nullif(anexos_retorno::text, ''), '[]') as "Anexos",
            case coluna when 'concluido' then 'Feito' when 'cancelado' then 'Cancelado' else 'Pendente' end as "Status",
            concluido_por as "FeitoPor",
            to_char(criado_em at time zone 'UTC', ${ISO_UTC}) as "InseridoEm",
            solicitante_slug as "SolicitanteSlug",
            'finfin' as "Origem"
       from finfin_demandas
      where codigo <> '' and formulario = 'gerais' and ($1::boolean or modo <> 'teste')
      order by ordem`, [!!ehGestor]);
  return r.rows;
}

/**
 * Pagamentos do formulário novo (finfin) no MESMO formato de linha do Histórico de Pagamentos (planilha/tabela "pagamentos"): RazaoSocial,
 * Solicitante, CPFCNPJ, Motivo, Banco, Agencia, Conta, ChavePix, TipoChave, Valor, NumeroNotaFiscal, Anexos, Status, FeitoPor, InseridoEm...
 * Pago no finfin = "Feito"; cancelado = "Cancelado"; o resto = "Pendente". Cards de teste só aparecem para gestor.
 */
const TIPO_PIX = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Aleatória' };
async function listarPagamentosParaHistorico({ ehGestor = false } = {}) {
  const r = await db.query(
    `select codigo, solicitante_nome, solicitante_email, solicitante_slug, dados, anexos_retorno, coluna, concluido_por, criado_em
       from finfin_demandas
      where codigo <> '' and formulario = 'pagamento' and ($1::boolean or modo <> 'teste')
      order by ordem`, [!!ehGestor]);
  const json = (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return v || {}; };
  return r.rows.map((l) => {
    const d = json(l.dados);
    return {
      ID: l.codigo,
      DataVencimento: d.vencimento || '',
      Solicitante: l.solicitante_nome,
      Email: l.solicitante_email,
      RazaoSocial: d.razao_social || '',
      CPFCNPJ: d.cpf_cnpj || '',
      Motivo: d.motivo || '',
      Banco: d.banco || '',
      Agencia: d.agencia || '',
      Conta: d.conta || '',
      ChavePix: d.pix_chave || '',
      TipoChave: TIPO_PIX[d.pix_tipo] || d.pix_tipo || '',
      Valor: d.valor != null ? d.valor : '',
      Empresa: 'SeuBoné',
      NumeroNotaFiscal: d.nota_fiscal || '',
      Anexos: JSON.stringify(Array.isArray(json(l.anexos_retorno)) ? json(l.anexos_retorno) : []),
      Status: l.coluna === 'pago' ? 'Feito' : l.coluna === 'cancelado' ? 'Cancelado' : 'Pendente',
      FeitoPor: l.concluido_por || '',
      InseridoEm: new Date(l.criado_em).toISOString(),
      SolicitanteSlug: l.solicitante_slug,
      Origem: 'finfin',
    };
  });
}

/**
 * Reembolsos do formulário novo (finfin) no MESMO formato de linha do Histórico de Reembolsos (IDReferencia = ID da venda, RazaoSocialCliente,
 * MotivoReembolso...). Pago = "Feito"; negado = "Negado"; o resto = "Pendente". Cards de teste só aparecem para gestor.
 */
async function listarReembolsosParaHistorico({ ehGestor = false } = {}) {
  const r = await db.query(
    `select codigo, solicitante_nome, solicitante_email, solicitante_slug, link_lulu, dados, anexos_retorno, coluna, concluido_por, criado_em
       from finfin_demandas
      where codigo <> '' and formulario = 'reembolso_sac' and ($1::boolean or modo <> 'teste')
      order by ordem`, [!!ehGestor]);
  const json = (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return v || {}; };
  return r.rows.map((l) => {
    const d = json(l.dados);
    return {
      ID: l.codigo,
      DataVencimento: d.vencimento || '',
      IDReferencia: d.id_venda || '',
      LinkLulu: l.link_lulu || '',
      CPFCNPJ: d.cpf_cnpj || '',
      Email: l.solicitante_email,
      Solicitante: l.solicitante_nome,
      MotivoReembolso: d.motivo || '',
      RazaoSocialCliente: d.razao_social || '',
      Banco: d.banco || '',
      Agencia: d.agencia || '',
      Conta: d.conta || '',
      ChavePix: d.pix_chave || '',
      TipoChave: TIPO_PIX[d.pix_tipo] || d.pix_tipo || '',
      Valor: d.valor != null ? d.valor : '',
      EmpresaResponsavel: 'SeuBoné',
      Anexos: JSON.stringify(Array.isArray(json(l.anexos_retorno)) ? json(l.anexos_retorno) : []),
      Status: l.coluna === 'pago' ? 'Feito' : l.coluna === 'negado' ? 'Negado' : 'Pendente',
      FeitoPor: l.concluido_por || '',
      InseridoEm: new Date(l.criado_em).toISOString(),
      SolicitanteSlug: l.solicitante_slug,
      Origem: 'finfin',
    };
  });
}

module.exports = { listarParaHistorico, listarPagamentosParaHistorico, listarReembolsosParaHistorico };
