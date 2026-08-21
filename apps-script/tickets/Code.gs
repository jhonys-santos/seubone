/**
 * ============================================================================
 *  BACKEND — Painel de Ticket SeuBoné (Google Apps Script / Web App)
 * ----------------------------------------------------------------------------
 *  ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/
 *  reaplicar mudanças). O código que realmente roda vive dentro do editor do
 *  Apps Script, na planilha "Tickets". NUNCA preencha o valor de SEGREDO_HUB
 *  abaixo com o real aqui — deixe só no Apps Script (ambiente do Google, fora
 *  deste repositório) e no .env do hub (que já é ignorado pelo Git).
 *
 *    - doGet()                → lê a planilha e devolve os tickets em JSON
 *    - doGet ?action=historico&rowIndex=N → eventos de um ticket
 *    - doPost action:criar       → registra um novo ticket (manual ou via n8n)
 *    - doPost action:atribuir     → define/troca o responsável
 *    - doPost action:mudarStatus  → Aberto/Em acompanhamento/Urgência/Resolvido (Resolvido = fecha)
 *    - doPost action:comentarTicket → comentário de acompanhamento (Histórico)
 *    - doPost action:adicionarAnexos → anexa imagem(ns) a um ticket já existente
 *    - doPost action:atualizarAcompanhamento → evento/entrega/prazos, editado por quem trata o ticket
 *    - doPost action:definirLink → preenche o link do card quando criado sem ele
 *    - doPost action:marcarAtrasoNotificado → controla se já foi avisado o
 *      responsável de um ticket atrasado (evita notificar de novo a cada
 *      checagem periódica do hub, enquanto o atraso for o mesmo)
 *
 *  Mapeamento de colunas por NOME DO CABEÇALHO (tolerante a acento/maiúscula) —
 *  mesma receita do Painel de Erros (COLUNAS + buildColMap_).
 *
 *  Só o hub chama este Apps Script (nunca o navegador direto, nem o n8n
 *  direto — o n8n fala com o hub, que fala com este Apps Script) — por isso a
 *  única autenticação aqui é o segredo compartilhado, sem login de usuário.
 *  "usuario"/"usuarioSlug" em toda escrita vêm sempre da sessão do hub (ou do
 *  payload do webhook n8n, já validado lá), nunca de texto digitado direto
 *  aqui.
 * ============================================================================
 */

var SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

var SHEET_NAME = 'Tickets';
var HIST_SHEET_NAME = 'Historico';

/**
 * Pasta do Google Drive onde as imagens anexadas aos tickets são salvas.
 * Em branco = o script cria/reusa "Fotos - Painel de Ticket" na raiz do
 * Drive. Compartilhadas como "qualquer pessoa com o link pode ver".
 */
var FOTOS_FOLDER_ID = '';
var FOTOS_FOLDER_NAME = 'Fotos - Painel de Ticket';

var COLUNAS = {
  idTicket:       ['id ticket', 'id do ticket', 'ticket'],
  pedido:         ['pedido/cliente', 'pedido', 'cliente'],
  idVenda:        ['id da venda', 'id venda'],
  identificador:  ['identificador'],
  setor:          ['setor'],
  responsavel:    ['responsavel'],
  responsavelSlug:['responsavel slug', 'slug do responsavel'],
  status:         ['status'],
  dataAbertura:   ['data abertura', 'data de abertura'],
  dataFechamento: ['data fechamento', 'data de fechamento'],
  origem:         ['origem'],
  link:           ['link'],
  observacao:     ['observacao', 'observação'],
  anexos:         ['anexos', 'foto', 'fotos', 'imagem', 'imagens', 'anexo'],
  temEvento:      ['tem evento', 'evento com data'],
  dataEvento:     ['data do evento', 'data evento'],
  entrega:        ['entrega'],
  aeroporto:      ['aeroporto', 'qual aeroporto'],
  ppe:            ['ppe', 'prazo previsto de entrega'],
  previsaoFinalizacao: ['previsao de finalizacao', 'previsão de finalização'],
  pFolha:         ['p folha', 'prazo de producao', 'prazo de produção'],
  atrasoNotificado: ['atraso notificado', 'notificado atraso', 'aviso atraso enviado'],
};

var STATUS_ABERTO = 'Aberto';
var STATUS_RESOLVIDO = 'Resolvido';

/* ============================ HELPERS ============================ */

function norm_(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBool_(v) {
  if (v === true) return true;
  var s = norm_(v);
  return s === 'true' || s === 'sim' || s === 'x' || s === 'verdadeiro' || s === '1';
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function buildColMap_(header) {
  var normHeaders = header.map(norm_);
  var map = {};
  Object.keys(COLUNAS).forEach(function (key) {
    var pistas = COLUNAS[key];
    var found = null;
    for (var p = 0; p < pistas.length && found === null; p++) {
      var pe = norm_(pistas[p]);
      for (var c = 0; c < normHeaders.length; c++) {
        if (normHeaders[c] === pe) { found = c; break; }
      }
    }
    for (var p2 = 0; p2 < pistas.length && found === null; p2++) {
      var pi = norm_(pistas[p2]);
      for (var c2 = 0; c2 < normHeaders.length; c2++) {
        if (normHeaders[c2].indexOf(pi) !== -1) { found = c2; break; }
      }
    }
    if (found !== null) map[key] = found;
  });
  return map;
}

function setCell_(sh, rowIndex1, col, key, value) {
  var i = col[key];
  if (i == null) return;
  if (value === undefined || value === null || value === '') return;
  sh.getRange(rowIndex1, i + 1).setValue(value);
}

function fmtDate_(d) {
  if (!d) return '';
  var date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================ HISTÓRICO ============================
 * Mesma receita do Painel de Erros: aba "Historico" com um evento por
 * linha, nunca derruba a chamada principal se a escrita falhar (try/catch
 * silencioso dentro de logHist_).
 */

function getHistSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HIST_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(HIST_SHEET_NAME);
    sh.appendRow(['Data/Hora', 'ID do ticket (linha)', 'ID Ticket', 'Usuário', 'Ação', 'Detalhe', 'Slug']);
  }
  return sh;
}

function logHist_(rowIndex, idTicket, usuario, acao, detalhe, slug) {
  try {
    getHistSheet_().appendRow([new Date(), rowIndex, idTicket || '', usuario || '—', acao || '', detalhe || '', slug || '']);
  } catch (e) {}
}

function histFor_(rowIndex) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HIST_SHEET_NAME);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][1]) !== String(rowIndex)) continue;
    var dt = values[r][0];
    out.push({
      quando: (dt instanceof Date) ? Utilities.formatDate(dt, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : String(dt),
      usuario: String(values[r][3] || '—'),
      acao: String(values[r][4] || ''),
      detalhe: String(values[r][5] || ''),
    });
  }
  return out.reverse();
}

/* ============================ LEITURA (GET) ============================ */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.segredo !== SEGREDO_HUB) return jsonOut_({ ok: false, error: 'Nao autorizado' });

    if (p.action === 'historico') {
      return jsonOut_({ ok: true, eventos: histFor_(p.rowIndex) });
    }

    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return jsonOut_({ ok: true, tickets: [] });

    var header = values[0];
    var col = buildColMap_(header);
    var get = function (row, key) {
      var i = col[key];
      return (i == null) ? '' : row[i];
    };

    var tickets = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var pedido = get(row, 'pedido');
      var idTicket = get(row, 'idTicket');
      if (String(pedido).trim() === '' && String(idTicket).trim() === '') continue;

      tickets.push({
        rowIndex:        r + 1,
        idTicket:        String(idTicket || '').trim(),
        pedido:          String(pedido || '').trim(),
        idVenda:         String(get(row, 'idVenda') || '').trim(),
        identificador:   String(get(row, 'identificador') || '').trim(),
        setor:           String(get(row, 'setor') || '').trim(),
        responsavel:     String(get(row, 'responsavel') || '').trim(),
        responsavelSlug: String(get(row, 'responsavelSlug') || '').trim(),
        status:          String(get(row, 'status') || '').trim() || STATUS_ABERTO,
        dataAbertura:    fmtDate_(get(row, 'dataAbertura')),
        dataFechamento:  fmtDate_(get(row, 'dataFechamento')),
        origem:          String(get(row, 'origem') || '').trim(),
        link:            String(get(row, 'link') || '').trim(),
        observacao:      String(get(row, 'observacao') || '').trim(),
        anexos:          String(get(row, 'anexos') || '').trim(),
        temEvento:       parseBool_(get(row, 'temEvento')),
        dataEvento:      fmtDate_(get(row, 'dataEvento')),
        entrega:         String(get(row, 'entrega') || '').trim(),
        aeroporto:       String(get(row, 'aeroporto') || '').trim(),
        ppe:                 fmtDate_(get(row, 'ppe')),
        previsaoFinalizacao: fmtDate_(get(row, 'previsaoFinalizacao')),
        pFolha:              fmtDate_(get(row, 'pFolha')),
        atrasoNotificado:    parseBool_(get(row, 'atrasoNotificado')),
      });
    }
    return jsonOut_({ ok: true, tickets: tickets });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ============================ ESCRITA (POST) ============================ */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return jsonOut_({ ok: false, error: 'Nao autorizado' });

    var action = body.action;
    if (action === 'criar')          return criarTicket_(body);
    if (action === 'atribuir')       return atribuirResponsavel_(body);
    if (action === 'mudarStatus')    return mudarStatus_(body);
    if (action === 'comentarTicket') return comentarTicket_(body);
    if (action === 'adicionarAnexos') return adicionarAnexos_(body);
    if (action === 'atualizarAcompanhamento') return atualizarAcompanhamento_(body);
    if (action === 'definirLink') return definirLink_(body);
    if (action === 'marcarAtrasoNotificado') return marcarAtrasoNotificado_(body);

    return jsonOut_({ ok: false, error: 'Ação inválida: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Lock por toda a função — mesma razão do Painel de Erros: sem ele, duas
 * criações quase simultâneas (ex: duas chamadas do n8n em sequência) podiam
 * calcular a MESMA "próxima linha livre" e se sobrescrever.
 */
function criarTicket_(f) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return jsonOut_({ ok: false, error: 'Sistema ocupado, tente novamente em alguns segundos.' }); }
  try {
    if (!f.identificador) {
      return jsonOut_({ ok: false, error: 'Identificador é obrigatório.' });
    }

    var sh = getSheet_();
    var header = sh.getDataRange().getValues()[0];
    var col = buildColMap_(header);
    var novaLinha = sh.getLastRow() + 1;

    // ID do ticket é sempre gerado por aqui (nunca aceito de quem chama) —
    // "T" + a própria linha da planilha, garantido único pelo LockService
    // que envolve toda esta função.
    var idGerado = 'T' + String(novaLinha - 1).padStart(5, '0');

    setCell_(sh, novaLinha, col, 'idTicket', idGerado);
    setCell_(sh, novaLinha, col, 'pedido', f.pedido);
    setCell_(sh, novaLinha, col, 'idVenda', f.idVenda);
    setCell_(sh, novaLinha, col, 'identificador', f.identificador);
    setCell_(sh, novaLinha, col, 'setor', f.setor);
    setCell_(sh, novaLinha, col, 'responsavel', f.responsavel);
    setCell_(sh, novaLinha, col, 'responsavelSlug', f.responsavelSlug);
    setCell_(sh, novaLinha, col, 'status', STATUS_ABERTO);
    setCell_(sh, novaLinha, col, 'dataAbertura', new Date());
    setCell_(sh, novaLinha, col, 'origem', f.origem || 'manual');
    setCell_(sh, novaLinha, col, 'link', f.link);
    setCell_(sh, novaLinha, col, 'observacao', f.observacao);

    if (f.fotos && f.fotos.length) {
      try {
        var links = salvarFotos_(f.fotos, idGerado);
        if (links) setCell_(sh, novaLinha, col, 'anexos', links);
      } catch (e) {
        logHist_(novaLinha, idGerado, f.usuario, 'Falha ao salvar anexos', String(e && e.message || e), f.usuarioSlug);
      }
    }

    logHist_(novaLinha, idGerado, f.usuario || (f.origem === 'n8n' ? 'n8n' : ''), 'Ticket aberto',
      [f.identificador, f.setor].filter(String).join(' · '), f.usuarioSlug);

    return jsonOut_({ ok: true, rowIndex: novaLinha, idTicket: idGerado });
  } finally {
    lock.releaseLock();
  }
}

function atribuirResponsavel_(f) {
  if (!f.rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);
    sh.getRange(f.rowIndex, col.responsavel + 1).setValue(f.responsavel || '');
    if (col.responsavelSlug != null) sh.getRange(f.rowIndex, col.responsavelSlug + 1).setValue(f.responsavelSlug || '');

    var idTicket = (col.idTicket != null) ? sh.getRange(f.rowIndex, col.idTicket + 1).getValue() : '';
    logHist_(f.rowIndex, idTicket, f.usuario, 'Responsável atribuído', f.responsavel || '', f.usuarioSlug);

    return jsonOut_({ ok: true, rowIndex: f.rowIndex, idTicket: String(idTicket || '') });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Preenche o link do card quando o ticket foi criado sem ele — sem trava
 * de role (igual comentar/fechar), qualquer um com acesso ao painel pode
 * adicionar.
 */
function definirLink_(f) {
  if (!f.rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var texto = String(f.link || '').trim();
  if (!texto) return jsonOut_({ ok: false, error: 'Link vazio.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);
    if (col.link == null) return jsonOut_({ ok: false, error: 'Coluna "Link" não existe na planilha.' });
    sh.getRange(f.rowIndex, col.link + 1).setValue(texto);

    var idTicket = (col.idTicket != null) ? sh.getRange(f.rowIndex, col.idTicket + 1).getValue() : '';
    logHist_(f.rowIndex, idTicket, f.usuario, 'Link adicionado', texto, f.usuarioSlug);

    return jsonOut_({ ok: true, rowIndex: f.rowIndex, idTicket: String(idTicket || ''), link: texto });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Acompanhamento de quem está tratando o ticket (evento do cliente,
 * entrega) — não é decisão de gestão, só anotação de quem está com o
 * ticket, por isso sem trava de role (igual comentar/fechar).
 */
function atualizarAcompanhamento_(f) {
  if (!f.rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);

    var temEvento = !!f.temEvento;
    if (col.temEvento != null) sh.getRange(f.rowIndex, col.temEvento + 1).setValue(temEvento ? 'TRUE' : 'FALSE');
    if (col.dataEvento != null) sh.getRange(f.rowIndex, col.dataEvento + 1).setValue(temEvento ? (f.dataEvento || '') : '');
    if (col.entrega != null) sh.getRange(f.rowIndex, col.entrega + 1).setValue(f.entrega || '');
    if (col.aeroporto != null) sh.getRange(f.rowIndex, col.aeroporto + 1).setValue(f.entrega === 'Aeroporto' ? (f.aeroporto || '') : '');
    if (col.ppe != null) sh.getRange(f.rowIndex, col.ppe + 1).setValue(f.ppe || '');
    if (col.previsaoFinalizacao != null) sh.getRange(f.rowIndex, col.previsaoFinalizacao + 1).setValue(f.previsaoFinalizacao || '');
    if (col.pFolha != null) sh.getRange(f.rowIndex, col.pFolha + 1).setValue(f.pFolha || '');

    var idTicket = (col.idTicket != null) ? sh.getRange(f.rowIndex, col.idTicket + 1).getValue() : '';
    var detalhe = [temEvento ? 'evento em ' + (f.dataEvento || '?') : '', f.entrega].filter(String).join(' · ');
    logHist_(f.rowIndex, idTicket, f.usuario, 'Acompanhamento atualizado', detalhe, f.usuarioSlug);

    return jsonOut_({ ok: true, rowIndex: f.rowIndex, idTicket: String(idTicket || '') });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Muda o status do ticket entre os 4 estados (Aberto / Em acompanhamento /
 * Urgência / Resolvido). "Resolvido" fecha o ticket (grava Data fechamento);
 * saindo de "Resolvido" pra qualquer outro estado (reabertura) limpa essa
 * data — não fica uma data de fechamento velha num ticket reaberto.
 */
function mudarStatus_(f) {
  if (!f.rowIndex || !f.status) return jsonOut_({ ok: false, error: 'rowIndex/status ausente' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);

    var statusAtual = String(sh.getRange(f.rowIndex, col.status + 1).getValue() || '').trim();
    if (statusAtual === STATUS_RESOLVIDO && f.status === STATUS_RESOLVIDO) {
      return jsonOut_({ ok: false, error: 'Esse ticket já está resolvido.' });
    }

    sh.getRange(f.rowIndex, col.status + 1).setValue(f.status);
    if (f.status === STATUS_RESOLVIDO) {
      sh.getRange(f.rowIndex, col.dataFechamento + 1).setValue(new Date());
    } else if (statusAtual === STATUS_RESOLVIDO) {
      sh.getRange(f.rowIndex, col.dataFechamento + 1).setValue('');
    }

    var idTicket = (col.idTicket != null) ? sh.getRange(f.rowIndex, col.idTicket + 1).getValue() : '';
    logHist_(f.rowIndex, idTicket, f.usuario, 'Status alterado', statusAtual + ' → ' + f.status, f.usuarioSlug);

    return jsonOut_({ ok: true, rowIndex: f.rowIndex, idTicket: String(idTicket || ''), status: f.status });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Comentário de acompanhamento — não edita nenhum campo, só grava um evento
 * no Histórico. Qualquer usuário com acesso ao painel pode comentar (mesma
 * regra do Painel de Erros).
 */
function comentarTicket_(f) {
  if (!f.rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var texto = String(f.comentario || '').trim();
  if (!texto) return jsonOut_({ ok: false, error: 'Comentário vazio.' });

  var sh = getSheet_();
  var col = buildColMap_(sh.getDataRange().getValues()[0]);
  var idTicket = (col.idTicket != null) ? sh.getRange(f.rowIndex, col.idTicket + 1).getValue() : '';

  logHist_(f.rowIndex, idTicket, f.usuario, 'Comentário', texto, f.usuarioSlug);

  return jsonOut_({ ok: true, rowIndex: f.rowIndex, idTicket: String(idTicket || '') });
}

/**
 * Marca/desmarca se o responsável já foi avisado do atraso deste ticket —
 * chamado pelo checador periódico do hub (Node), nunca pela UI. Não gera
 * evento no Histórico (é controle interno, não uma ação de alguém).
 */
function marcarAtrasoNotificado_(f) {
  if (!f.rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);
    if (col.atrasoNotificado == null) return jsonOut_({ ok: false, error: 'Coluna "Atraso Notificado" não existe na planilha.' });
    sh.getRange(f.rowIndex, col.atrasoNotificado + 1).setValue(f.notificado ? 'TRUE' : 'FALSE');
    return jsonOut_({ ok: true, rowIndex: f.rowIndex });
  } finally {
    lock.releaseLock();
  }
}

/* ============================ ANEXOS (Google Drive) ============================
 * Mesma receita do Painel de Erros: imagens chegam como data URL (já
 * comprimidas no navegador), são salvas como arquivo no Drive, e o link de
 * cada uma entra na coluna "Anexos" separado por vírgula.
 */

function getFotosFolder_() {
  if (FOTOS_FOLDER_ID) {
    try { return DriveApp.getFolderById(FOTOS_FOLDER_ID); } catch (e) {}
  }
  var it = DriveApp.getFoldersByName(FOTOS_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOTOS_FOLDER_NAME);
}

function salvarFotos_(fotos, idTicket) {
  if (!fotos || !fotos.length) return '';
  var folder;
  try {
    folder = getFotosFolder_();
  } catch (e) {
    throw new Error('Sem acesso ao Google Drive. Autorize o escopo do Drive (rode getFotosFolder_ no editor) e republique a implantação. Detalhe: ' + (e && e.message || e));
  }
  var urls = [];
  for (var i = 0; i < fotos.length; i++) {
    try {
      var dataUrl = String(fotos[i] || '');
      var m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) continue;
      var mime = m[1];
      var bytes = Utilities.base64Decode(m[2]);
      var ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      var nome = 'ticket_' + (idTicket || 's-id') + '_' + (i + 1) + '_' + new Date().getTime() + '.' + ext;
      var blob = Utilities.newBlob(bytes, mime, nome);
      var file = folder.createFile(blob);
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
      urls.push(file.getUrl());
    } catch (e) {}
  }
  return urls.join(',');
}

/**
 * Anexa imagem(ns) a um ticket já existente (criado antes, com ou sem
 * responsável) — não troca nada além da coluna Anexos, e nunca substitui
 * links já salvos: sempre acrescenta aos que já existem na linha.
 */
function adicionarAnexos_(f) {
  if (!f.rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  if (!f.fotos || !f.fotos.length) return jsonOut_({ ok: false, error: 'Nenhum arquivo enviado.' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return jsonOut_({ ok: false, error: 'Sistema ocupado, tente novamente em alguns segundos.' }); }
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);
    if (col.anexos == null) return jsonOut_({ ok: false, error: 'Coluna "Anexos" não existe na planilha.' });

    var idTicket = (col.idTicket != null) ? sh.getRange(f.rowIndex, col.idTicket + 1).getValue() : '';
    var novosLinks = salvarFotos_(f.fotos, idTicket);
    if (!novosLinks) return jsonOut_({ ok: false, error: 'Não consegui salvar os arquivos.' });

    var atual = String(sh.getRange(f.rowIndex, col.anexos + 1).getValue() || '').trim();
    var combinado = atual ? atual + ',' + novosLinks : novosLinks;
    sh.getRange(f.rowIndex, col.anexos + 1).setValue(combinado);

    logHist_(f.rowIndex, idTicket, f.usuario, 'Anexo(s) adicionado(s)', f.fotos.length + ' arquivo(s)', f.usuarioSlug);

    return jsonOut_({ ok: true, rowIndex: f.rowIndex, idTicket: String(idTicket || ''), anexos: combinado });
  } finally {
    lock.releaseLock();
  }
}
