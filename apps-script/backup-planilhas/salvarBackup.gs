/**
 * BACKUP AUTOMÁTICO DO BANCO PARA A PLANILHA — trecho para colar nos 5 Apps Scripts:
 *   tickets, erros, registro-demandas, corridas-pagamentos, corridas-avulsas.
 *
 * O hub (seg-sex, 20h de Brasília) manda o conteúdo do banco e este trecho grava
 * UMA ABA NOVA POR DIA, chamada "bkp AAAA-MM-DD <nome>", e apaga as abas "bkp " mais
 * antigas (guarda só os últimos N dias, N vem do hub, hoje 7). As abas originais
 * NUNCA são lidas nem alteradas: só abas cujo nome começa com "bkp " são tocadas.
 *
 * COMO INSTALAR (em cada um dos 5 scripts):
 *  1) Cole TODA a função salvarBackup_ abaixo (de "function salvarBackup_" até o fim) no Code.gs.
 *  2) No doPost, junto das outras linhas "if (action === ...)", adicione UMA linha:
 *       - tickets e erros (planilha onde o script foi criado, usam jsonOut_):
 *           if (action === 'salvarBackup') return jsonOut_(salvarBackup_(body, SpreadsheetApp.getActiveSpreadsheet()));
 *       - registro-demandas, corridas-pagamentos e corridas-avulsas (usam out e SHEET_ID):
 *           if (body.action === 'salvarBackup') return out(salvarBackup_(body, SpreadsheetApp.openById(SHEET_ID)));
 *  3) Implantar > Gerenciar implantações > editar > Nova versão > Implantar.
 */
function salvarBackup_(body, ss) {
  var PREFIXO = 'bkp ';
  var data = String(body.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, error: 'Data inválida: ' + data, erro: 'Data inválida: ' + data };
  var manter = Math.max(1, Math.floor(Number(body.manter) || 7));
  var abas = body.abas || [];
  if (!abas.length) return { ok: false, error: 'Nenhuma aba para gravar.', erro: 'Nenhuma aba para gravar.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var gravadas = [];
    for (var i = 0; i < abas.length; i++) {
      var a = abas[i];
      var cab = a.cabecalho || [];
      var linhas = a.linhas || [];
      var nCols = cab.length;
      if (!nCols) continue;
      var nome = (PREFIXO + data + ' ' + a.nome).substring(0, 99);

      var sh = ss.getSheetByName(nome);
      if (sh) sh.clear(); else sh = ss.insertSheet(nome, ss.getNumSheets());

      var nLin = linhas.length + 1;
      if (sh.getMaxRows() < nLin) sh.insertRowsAfter(sh.getMaxRows(), nLin - sh.getMaxRows());
      if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());

      // Tudo vira texto puro (zero à esquerda de CPF/conta e textos que começam com "=" não são
      // interpretados), menos as colunas numéricas.
      var ehNumero = {};
      (a.colunasNumero || []).forEach(function (c) { ehNumero[c] = true; });
      for (var c = 0; c < nCols; c++) {
        if (!ehNumero[c]) sh.getRange(1, c + 1, nLin, 1).setNumberFormat('@');
      }

      sh.getRange(1, 1, 1, nCols).setValues([cab.map(String)]).setFontWeight('bold');
      sh.setFrozenRows(1);

      var TAM_LOTE = 2000;
      for (var ini = 0; ini < linhas.length; ini += TAM_LOTE) {
        var lote = linhas.slice(ini, ini + TAM_LOTE).map(function (l) {
          var linha = [];
          for (var k = 0; k < nCols; k++) {
            var v = l[k];
            if (v === null || v === undefined) v = '';
            if (typeof v === 'string' && v.length > 49000) v = v.substring(0, 49000); // limite de 50 mil caracteres por célula
            linha.push(v);
          }
          return linha;
        });
        sh.getRange(2 + ini, 1, lote.length, nCols).setValues(lote);
      }
      sh.setTabColor('#9aa0a6');
      gravadas.push({ nome: nome, linhas: linhas.length });
    }
    SpreadsheetApp.flush();

    // Apaga as abas "bkp " de dias mais antigos que os últimos `manter` dias.
    var porData = {};
    ss.getSheets().forEach(function (s) {
      var m = /^bkp (\d{4}-\d{2}-\d{2}) /.exec(s.getName());
      if (m) (porData[m[1]] = porData[m[1]] || []).push(s);
    });
    var datas = Object.keys(porData).sort().reverse(); // mais recentes primeiro
    var removidas = [];
    datas.slice(manter).forEach(function (d) {
      porData[d].forEach(function (s) { removidas.push(s.getName()); ss.deleteSheet(s); });
    });

    return { ok: true, gravadas: gravadas, removidas: removidas };
  } catch (err) {
    var msg = String((err && err.message) || err);
    return { ok: false, error: msg, erro: msg };
  } finally {
    lock.releaseLock();
  }
}
