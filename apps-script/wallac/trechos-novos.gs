/**
 * WALLAC — TRECHOS NOVOS para colar no Apps Script do Painel de Produção (Code.gs que já existe lá).
 * NÃO substitua o Code.gs inteiro: só ADICIONE o que está abaixo, no lugar indicado. O resto continua igual.
 *
 * Para quê:
 *  - segredo do hub: hoje o endereço do script atende qualquer pessoa que tenha a URL; passa a exigir o segredo do hub.
 *  - exportar: o hub copia Status_Producao_Wallac, Estoque, Solicitacoes_Estoque e Premiacao_Historico para o banco.
 *  - salvar_logo: só sobe o logo (DXF) para o Drive e devolve o link (o hub grava a solicitação no banco).
 *  - salvarBackup: cópia diária do banco em abas "bkp AAAA-MM-DD ..." (backup automático).
 *  - removerGatilhoPremiacao: rode UMA vez DEPOIS que o hub assumir (o hub fecha a semana sozinho, sexta 16h30).
 *
 * COMO COLAR:
 *  1) No topo do Code.gs, junto das outras constantes, adicione:
 *       var SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';   // idêntico ao APPS_SCRIPT_SHARED_SECRET do hub
 *  2) Em doGet(e), logo depois de "try {", adicione:
 *       if (e.parameter.segredo !== SEGREDO_HUB) return responderJSON({ ok: false, erro: 'Nao autorizado' });
 *     e, junto das outras ações (antes do "return responderJSON({ ok: true, cards: ... })" final):
 *       if (acao === 'exportar') return responderJSON(exportarWallac_());
 *  3) Em doPost(e), logo depois de "const dados = JSON.parse(e.postData.contents);", adicione:
 *       if (dados.segredo !== SEGREDO_HUB) return responderJSON({ ok: false, erro: 'Nao autorizado' });
 *     e, junto das outras ações:
 *       if (dados.acao === 'salvar_logo') return responderJSON(salvarLogoSomente_(dados));
 *       if (dados.acao === 'salvarBackup') return responderJSON(salvarBackup_(dados, SpreadsheetApp.openById(SHEET_ID)));
 *  4) Cole TUDO abaixo desta linha no fim do Code.gs (inclusive a função salvarBackup_ que está no arquivo
 *     apps-script/backup-planilhas/salvarBackup.gs: cole-a também).
 *  5) Implantar > Gerenciar implantações > Editar > Nova versão > Implantar.
 */

// ---------- Exportação para o banco ----------
function exportarWallac_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tz = Session.getScriptTimeZone();
  const iso = (v) => (v instanceof Date && !isNaN(v.getTime())) ? v.toISOString() : '';
  const dia = (v) => {
    if (v === '' || v == null) return '';
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  };
  const mes = (v) => (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, tz, 'yyyy-MM') : String(v == null ? '' : v);

  const status = [];
  const dSt = ss.getSheetByName(ABA_STATUS).getDataRange().getValues();
  for (let i = 1; i < dSt.length; i++) {
    if (!dSt[i][COL_STATUS.LINHA_LTV - 1]) continue;
    status.push({
      linha_ltv: Number(dSt[i][COL_STATUS.LINHA_LTV - 1]),
      status_atual: String(dSt[i][COL_STATUS.STATUS_ATUAL - 1] || ''),
      data_recebido: iso(dSt[i][COL_STATUS.DATA_RECEBIDO - 1]),
      data_inicio_producao: iso(dSt[i][COL_STATUS.DATA_INICIO_PRODUCAO - 1]),
      data_finalizado: iso(dSt[i][COL_STATUS.DATA_FINALIZADO - 1])
    });
  }

  const estoque = [];
  const dEs = ss.getSheetByName(ABA_ESTOQUE).getDataRange().getValues();
  for (let i = 1; i < dEs.length; i++) {
    if (!dEs[i][COL_ESTOQUE.PRODUTO - 1]) continue;
    estoque.push({ linha: i + 1, produto: String(dEs[i][COL_ESTOQUE.PRODUTO - 1]), quantidade: Number(dEs[i][COL_ESTOQUE.QUANTIDADE - 1]) || 0 });
  }

  const solicitacoes = [];
  const abaSol = ss.getSheetByName(ABA_SOLICITACOES);
  if (abaSol) {
    const dSo = abaSol.getDataRange().getValues();
    for (let i = 1; i < dSo.length; i++) {
      const l = dSo[i];
      if (!l[COL_SOLICITACAO.PRODUTO - 1]) continue;
      solicitacoes.push({
        linha: i + 1,
        produto: String(l[COL_SOLICITACAO.PRODUTO - 1]),
        quantidade: Number(l[COL_SOLICITACAO.QUANTIDADE - 1]) || 0,
        id_venda_cliente: String(l[COL_SOLICITACAO.ID_VENDA_CLIENTE - 1] || ''),
        prazo_producao: dia(l[COL_SOLICITACAO.PRAZO_PRODUCAO - 1]),
        prazo_entrega: dia(l[COL_SOLICITACAO.PRAZO_ENTREGA - 1]),
        observacoes: String(l[COL_SOLICITACAO.OBSERVACOES - 1] || ''),
        logo_url: String(l[COL_SOLICITACAO.LOGO_URL - 1] || ''),
        status_atual: String(l[COL_SOLICITACAO.STATUS_ATUAL - 1] || ''),
        data_recebido: iso(l[COL_SOLICITACAO.DATA_RECEBIDO - 1]),
        data_inicio_producao: iso(l[COL_SOLICITACAO.DATA_INICIO_PRODUCAO - 1]),
        data_finalizado: iso(l[COL_SOLICITACAO.DATA_FINALIZADO - 1]),
        solicitante: String(l[COL_SOLICITACAO.SOLICITANTE - 1] || '')
      });
    }
  }

  const premiacao = getAbaPremiacaoHistorico(ss).getDataRange().getValues().slice(1)
    .filter((r) => r[0] !== '')
    .map((r) => ({
      semana_inicio: dia(r[0]), semana_fim: dia(r[1]), pecas_no_prazo: Number(r[2]) || 0, faixa: String(r[3] || ''),
      coins_da_semana: Number(r[4]) || 0, mes_referencia: mes(r[5]), coins_acumulados_no_mes: Number(r[6]) || 0
    }));

  return { ok: true, status: status, estoque: estoque, solicitacoes: solicitacoes, premiacao: premiacao };
}

// ---------- Só sobe o logo para o Drive (o hub grava a solicitação no banco) ----------
function salvarLogoSomente_(dados) {
  try {
    if (!dados.logo_base64) return { ok: false, erro: 'O arquivo DXF do logo é obrigatório.' };
    return { ok: true, url: salvarLogo(dados.logo_base64, dados.logo_nome || 'logo.dxf') };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

// ---------- Rode UMA vez, depois que o hub assumir a premiação ----------
function removerGatilhoPremiacao() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'fecharSemanaPremiacao')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
