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
      where codigo <> '' and ($1::boolean or modo <> 'teste')
      order by ordem`, [!!ehGestor]);
  return r.rows;
}

module.exports = { listarParaHistorico };
