// Os kanbans do finfin (módulo Demandas) que o hub alimenta. Cada um tem o seu formulário no hub, a sua chave de modo (teste/producao),
// a coluna que encerra o pedido e a mensagem que o solicitante recebe quando o financeiro devolve o retorno.
//
//   gerais         "Envio de demandas - Gerais"   -> Registro (/registro-demandas)
//   pagamento      "Pagamentos"                   -> Pagamento (e "Solicitar pagamento" de Corridas Avulsas)
//   reembolso_sac  "Solicitações de reembolso - SAC" -> Reembolso
//   analise_termo  "Análise de termo"             -> Análise de termo (página nova)
//
// "colunas": só as colunas que geram aviso ao solicitante. Qualquer outra coluna apenas atualiza o status do pedido.
//   fecha: encerra o pedido (marca concluído; some da consulta automática).  msg(d): texto do aviso; d = { codigo, demanda, anexos, comentario }.
//   canonica: nome gravado quando o finfin usa um apelido da coluna (ex.: "finalizado" = "concluido").
const curto = (s, n = 160) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const comComentario = (txt, d) => (d.comentario ? `${txt} Retorno: ${curto(d.comentario)}` : txt);
const anexosTxt = (d) => (d.anexos ? ` ${d.anexos} anexo(s) do financeiro.` : '');

const FORMULARIOS = {
  gerais: {
    chave: 'gerais', modoEnv: 'finfinDemandasModo', link: '/registro-demandas/historico', driveArea: 'registro',
    colunas: (() => {
      const concluido = { fecha: true, msg: (d) => `Sua solicitação ${d.codigo} (${d.demanda}) foi concluída pelo financeiro.${anexosTxt(d)}` };
      return { concluido, finalizado: { ...concluido, canonica: 'concluido' }, concluida: { ...concluido, canonica: 'concluido' } };
    })(),
  },
  pagamento: {
    chave: 'pagamento', modoEnv: 'finfinPagamentoModo', link: '/registro-demandas/historico-pagamento', driveArea: 'pagamento',
    nomesColunas: { backlog: 'Backlog', lancar_omie: 'Lançar no Omie', aguardando: 'Ajuste/Aguardando retorno', lancado: 'Lançado', pago: 'Pago', cancelado: 'Cancelado' },
    colunas: {
      pago: { fecha: true, msg: (d) => comComentario(`Seu pagamento ${d.codigo} foi pago pelo financeiro.${anexosTxt(d)}`, d) },
      paga: { fecha: true, canonica: 'pago', msg: (d) => comComentario(`Seu pagamento ${d.codigo} foi pago pelo financeiro.${anexosTxt(d)}`, d) },
      cancelado: { fecha: true, msg: (d) => comComentario(`Seu pagamento ${d.codigo} foi cancelado pelo financeiro.`, d) },
    },
  },
  reembolso_sac: {
    chave: 'reembolso_sac', modoEnv: 'finfinReembolsoModo', link: '/registro-demandas/historico-reembolso', driveArea: 'registro',
    nomesColunas: { solicitacao_feita: 'Solicitação feita', em_aprovacao: 'Em aprovação', aprovado: 'Aprovado', aguardando: 'Aguardando retorno/Ajuste', lancado: 'Lançado no Omie', pago: 'Pago', negado: 'Negado' },
    colunas: {
      pago: { fecha: true, msg: (d) => comComentario(`Seu reembolso ${d.codigo} foi pago pelo financeiro.${anexosTxt(d)}`, d) },
      negado: { fecha: true, msg: (d) => comComentario(`Seu reembolso ${d.codigo} foi negado.`, d) },
      aprovado: { fecha: false, msg: (d) => comComentario(`Seu reembolso ${d.codigo} foi aprovado e segue para o pagamento.`, d) },
      aguardando: { fecha: false, msg: (d) => comComentario(`Seu reembolso ${d.codigo} está aguardando retorno ou ajuste.`, d) },
    },
  },
  analise_termo: {
    chave: 'analise_termo', modoEnv: 'finfinAnaliseTermoModo', link: '/registro-demandas/analise-termo', driveArea: 'registro',
    nomesColunas: { em_analise: 'Em análise', reprovado: 'Reprovado', ajustar: 'Ajustar', pre_aprovado: 'Pré-aprovado' },
    colunas: {
      pre_aprovado: { fecha: true, msg: (d) => comComentario(`Seu termo ${d.codigo} foi pré-aprovado.`, d) },
      reprovado: { fecha: true, msg: (d) => comComentario(`Seu termo ${d.codigo} foi reprovado.`, d) },
      ajustar: { fecha: false, msg: (d) => comComentario(`Seu termo ${d.codigo} precisa de ajuste.`, d) },
    },
  },
};

const obter = (formulario) => FORMULARIOS[formulario] || FORMULARIOS.gerais;
/** Regra da coluna ({ fecha, msg }) ou null se a coluna não gera aviso. */
const regraDaColuna = (formulario, chave) => obter(formulario).colunas[chave] || null;
/** Está em teste? (a chave de modo de cada formulário vive no env: FINFIN_DEMANDAS_MODO, FINFIN_PAGAMENTO_MODO, ...) */
const emTeste = (formulario, env) => env[obter(formulario).modoEnv] !== 'producao';

module.exports = { FORMULARIOS, obter, regraDaColuna, emTeste };
