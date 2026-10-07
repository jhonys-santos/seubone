/**
 * SISTEMA DE ACOMPANHAMENTO DE PEDIDOS URGENTES — SeuBoné
 * Backend (Google Apps Script) — hoje só o hub fala com ele (nunca o navegador direto).
 *
 * ATENÇÃO: este arquivo é só uma cópia de referência. O código que realmente roda vive dentro do editor do
 * Apps Script, na planilha "Pedidos Urgentes". NUNCA preencha o SEGREDO_HUB abaixo com o real aqui: deixe só
 * no Apps Script (fora deste repositório) e no .env do hub (APPS_SCRIPT_SHARED_SECRET).
 *
 * Ações:
 *   GET  ?action=list                  → lista os pedidos (usado enquanto o painel roda na planilha)
 *   POST action:create / despachar     → escrita na planilha (idem)
 *   POST action:salvarArquivos         → SÓ salva manifesto, nota fiscal e foto da OS no Drive e devolve os links
 *                                        (usado quando o painel roda no Postgres: o hub grava os links no banco)
 *   POST action:salvarBackup           → cópia diária do banco para abas "bkp AAAA-MM-DD ..." (ver backup-planilhas)
 */

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
var SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

const SHEET_NAME = 'Pedidos';
const FOLDER_NAME = 'Manifestos - Pedidos Urgentes';
const FOLDER_IMAGENS_NAME = 'Imagens OS - Pedidos Urgentes';

// ---------- SETUP (rodar uma vez) ----------
function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const headers = [
    'ID', 'OS', 'Cliente', 'LinkCRM', 'Transportadora', 'Modalidade',
    'TipoEnvioAereo', 'AeroportoRetirada', 'OSImagemId',
    'ManifestoLink', 'NotaFiscalLink', 'Observacao', 'Prazo', 'Status', 'InseridoPor', 'InseridoEm',
    'DespachadoPor', 'DespachadoEm'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // cria (ou localiza) as pastas no Drive
  [FOLDER_NAME, FOLDER_IMAGENS_NAME].forEach(nome => {
    const folders = DriveApp.getFoldersByName(nome);
    if (!folders.hasNext()) DriveApp.createFolder(nome);
  });

  SpreadsheetApp.getUi().alert('Configuração concluída. Pode implantar como App da Web.');
}

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getFolder_() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function getFolderImagens_() {
  const folders = DriveApp.getFoldersByName(FOLDER_IMAGENS_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_IMAGENS_NAME);
}

// salva um arquivo base64 numa pasta do Drive e deixa público (view) — usado por manifesto, NF e imagem da OS
function salvarArquivo_(base64, nome, mimeType, pasta) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', nome);
  const file = pasta.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file;
}

// ---------- LEITURA (GET) ----------
function doGet(e) {
  try {
    if (e.parameter.segredo !== SEGREDO_HUB) return jsonOut_({ erro: 'Nao autorizado' });
    const action = e.parameter.action || 'list';

    if (action === 'list') {
      const status = e.parameter.status || null; // "Pendente" | "Despachado" | null (todos)
      const desde = e.parameter.desde || null;   // filtro por data de InseridoEm, formato YYYY-MM-DD
      const ate = e.parameter.ate || null;
      return jsonOut_(listarPedidos_(status, desde, ate));
    }

    return jsonOut_({ erro: 'ação inválida' });
  } catch (err) {
    return jsonOut_({ erro: 'Erro no backend (doGet): ' + err.message });
  }
}

function listarPedidos_(status, desde, ate) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  let pedidos = data.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(p => p.ID); // ignora linhas vazias

  if (status) pedidos = pedidos.filter(p => p.Status === status);

  if (desde) {
    const d = new Date(desde + 'T00:00:00');
    pedidos = pedidos.filter(p => new Date(p.InseridoEm) >= d);
  }
  if (ate) {
    const a = new Date(ate + 'T23:59:59');
    pedidos = pedidos.filter(p => new Date(p.InseridoEm) <= a);
  }

  // datas viram string ISO pra não quebrar no JSON
  pedidos.forEach(p => {
    if (p.Prazo instanceof Date) p.Prazo = p.Prazo.toISOString();
    if (p.InseridoEm instanceof Date) p.InseridoEm = p.InseridoEm.toISOString();
    if (p.DespachadoEm instanceof Date) p.DespachadoEm = p.DespachadoEm.toISOString();
  });

  return pedidos;
}

// ---------- ESCRITA (POST) ----------
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return jsonOut_({ erro: 'Nao autorizado' });
    const action = body.action;

    if (action === 'create') return jsonOut_(criarPedido_(body));
    if (action === 'despachar') return jsonOut_(despacharPedido_(body));
    // Só salva os arquivos no Drive e devolve os links (o hub grava no banco). Não mexe na planilha.
    if (action === 'salvarArquivos') return jsonOut_(salvarArquivosSomente_(body));
    // Cópia do banco para abas "bkp AAAA-MM-DD ..." (backup automático do hub).
    if (action === 'salvarBackup') return jsonOut_(salvarBackup_(body, SpreadsheetApp.getActiveSpreadsheet()));

    return jsonOut_({ erro: 'ação inválida' });
  } catch (err) {
    return jsonOut_({ erro: 'Erro no backend (doPost): ' + err.message });
  }
}

function salvarArquivosSomente_(body) {
  let manifestoLink = '';
  let notaFiscalLink = '';
  let osImagemId = '';

  if (body.manifestoBase64 && body.manifestoNome) {
    manifestoLink = salvarArquivo_(body.manifestoBase64, body.manifestoNome, 'application/pdf', getFolder_()).getUrl();
  }
  if (body.notaFiscalBase64 && body.notaFiscalNome) {
    notaFiscalLink = salvarArquivo_(body.notaFiscalBase64, body.notaFiscalNome, 'application/pdf', getFolder_()).getUrl();
  }
  if (body.osImagemBase64 && body.osImagemNome) {
    osImagemId = salvarArquivo_(body.osImagemBase64, body.osImagemNome, body.osImagemTipo || 'image/jpeg', getFolderImagens_()).getId();
  }
  return { ok: true, manifestoLink: manifestoLink, notaFiscalLink: notaFiscalLink, osImagemId: osImagemId };
}

function criarPedido_(body) {
  const sheet = getSheet_();
  const id = Utilities.getUuid();
  let manifestoLink = '';
  let notaFiscalLink = '';
  let osImagemId = '';

  if (body.manifestoBase64 && body.manifestoNome) {
    const file = salvarArquivo_(body.manifestoBase64, body.manifestoNome, 'application/pdf', getFolder_());
    manifestoLink = file.getUrl();
  }

  if (body.notaFiscalBase64 && body.notaFiscalNome) {
    const fileNf = salvarArquivo_(body.notaFiscalBase64, body.notaFiscalNome, 'application/pdf', getFolder_());
    notaFiscalLink = fileNf.getUrl();
  }

  if (body.osImagemBase64 && body.osImagemNome) {
    const fileImg = salvarArquivo_(body.osImagemBase64, body.osImagemNome, body.osImagemTipo || 'image/jpeg', getFolderImagens_());
    osImagemId = fileImg.getId();
  }

  sheet.appendRow([
    id,
    body.os || '',
    body.cliente || '',
    body.linkCrm || '',
    body.transportadora || '',
    body.modalidade || '',
    body.tipoEnvioAereo || '',
    body.aeroporto || '',
    osImagemId,
    manifestoLink,
    notaFiscalLink,
    body.observacao || '',
    body.prazo ? new Date(body.prazo) : '',
    'Pendente',
    body.inseridoPor || '',
    new Date(),
    '',
    ''
  ]);

  return { ok: true, id: id, manifestoLink: manifestoLink, notaFiscalLink: notaFiscalLink, osImagemId: osImagemId };
}

function despacharPedido_(body) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  const statusCol = headers.indexOf('Status');
  const despPorCol = headers.indexOf('DespachadoPor');
  const despEmCol = headers.indexOf('DespachadoEm');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === body.id) {
      sheet.getRange(i + 1, statusCol + 1).setValue('Despachado');
      sheet.getRange(i + 1, despPorCol + 1).setValue(body.despachadoPor || '');
      sheet.getRange(i + 1, despEmCol + 1).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, erro: 'pedido não encontrado' };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================ BACKUP PARA PLANILHAS (aba bkp) ============================ */

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
