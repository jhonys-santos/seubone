/**
 * ============================================================================
 *  BACKEND — Painel de Erros SeuBoné (Google Apps Script / Web App)
 * ----------------------------------------------------------------------------
 *  ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/
 *  reaplicar mudanças). O código que realmente roda vive dentro do editor do
 *  Apps Script, na planilha "Cadastro de erros". NUNCA preencha o valor de
 *  SEGREDO_HUB abaixo com o real aqui — deixe só no Apps Script (ambiente do
 *  Google, fora deste repositório) e no .env do hub (que já é ignorado pelo
 *  Git).
 *
 *  Liga a planilha "Cadastro de erros" ao painel do hub.
 *    - doGet()                → lê a planilha e devolve os registros em JSON
 *    - doGet ?action=historico&rowIndex=N → eventos de um caso
 *    - doPost action:criar     → registra um novo erro (append de linha)
 *    - doPost action:audit     → atualiza os campos de auditoria de uma linha
 *    - doPost action:setStatus → muda o status de um caso
 *    - doPost action:setSetor  → preenche só o setor (backfill de legado)
 *    - doPost action:comentarCaso → comentário de acompanhamento (Histórico)
 *
 *  Mapeamento de colunas por NOME DO CABEÇALHO (tolerante a acento/maiúscula).
 *
 *  Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
 *  única autenticação aqui é o segredo compartilhado, sem login de usuário.
 *  "usuario" em toda escrita vem sempre da sessão do hub, nunca de texto
 *  digitado no navegador — quem pode auditar (papel) já foi decidido no
 *  servidor do hub antes de chegar aqui.
 * ============================================================================
 */

var SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

var SHEET_GID = 396842648;
var SHEET_NAME = 'Respostas do Form';

/**
 * Pasta do Google Drive onde as fotos enviadas pelo painel serão salvas.
 * Crie uma pasta, copie o ID da URL (.../folders/ESTE_ID) e cole abaixo.
 * Em branco = o script cria/reusa "Fotos - Painel de Erros" na raiz do Drive.
 * As fotos são compartilhadas como "qualquer pessoa com o link pode ver".
 */
var FOTOS_FOLDER_ID = '';
var FOTOS_FOLDER_NAME = 'Fotos - Painel de Erros';

var COLUNAS = {
  data:          ['carimbo de data/hora'],
  auditoria:     ['auditoria'],
  idVenda:       ['id da venda'],
  nomeCard:      ['nome do card'],
  descricao:     ['descricao e solucao', 'descricao do erro', 'descricao'],
  linkPedido:    ['link do card', 'link do pedido'],
  quemCadastrou: ['quem cadastrou'],
  culpaDe:       ['culpa de', 'culpa'],
  setor:         ['setor do problema', 'setor'],
  responsavel:   ['responsavel'],
  empresa:       ['empresa'],
  tipoProblema:  ['tipo de problema'],
  subproblema:   ['subproblema'],
  qtd:           ['quantidade de produtos', 'quantidade'],
  custo:         ['custo do erro', 'custo'],
  tipoProduto:   ['tipo de produto'],
  linha:         ['linha do produto', 'linha'],
  queFim:        ['que fim'],
  tipoResolucao: ['solucao', 'tipo de resolucao'],
  status:        ['status'],
  foto:          ['foto', 'fotos', 'imagem', 'imagens', 'anexo'],
  // Fila de aprovação de Refabricação (Fase 3) — colunas novas na aba.
  aprovacaoRefab:      ['aprovacaorefab'],
  comentarioAprovacao: ['comentarioaprovacao'],
};

// Valores possíveis de AprovacaoRefab — cai em "Pendente" sozinho quando o
// Tipo de Resolução vira "Refabricação" (na criação OU numa auditoria
// posterior), sem nunca sobrescrever uma decisão que já foi tomada.
var REFAB_PENDENTE = 'Pendente';
var REFAB_APROVADO = 'Aprovado';
var REFAB_REPROVADO = 'Reprovado';
var REFAB_FINALIZADO = 'Finalizado';

/* ============================ HELPERS ============================ */

function norm_(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === SHEET_GID) return sheets[i];
  }
  var byName = ss.getSheetByName(SHEET_NAME);
  return byName || sheets[0];
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
  if (map.data == null) map.data = 0;
  return map;
}

function parseNumber_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return v;
  var s = String(v).replace(/r\$/i, '').replace(/\s/g, '').trim();
  if (s === '' || s === '-') return '';
  s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? '' : n;
}

function parseBool_(v) {
  if (v === true) return true;
  var s = norm_(v);
  return s === 'true' || s === 'sim' || s === 'x' || s === 'verdadeiro' || s === '1';
}

function fmtDate_(v) {
  if (v instanceof Date) {
    var d = ('0' + v.getDate()).slice(-2);
    var m = ('0' + (v.getMonth() + 1)).slice(-2);
    return d + '/' + m + '/' + v.getFullYear();
  }
  return String(v == null ? '' : v).trim();
}

function extractUrl_(texto) {
  var m = String(texto || '').match(/https?:\/\/[^\s)]+/i);
  return m ? m[0] : '';
}

/* ============================ FOTOS (Google Drive) ============================ */

function getFotosFolder_() {
  if (FOTOS_FOLDER_ID) {
    try { return DriveApp.getFolderById(FOTOS_FOLDER_ID); } catch (e) {}
  }
  var it = DriveApp.getFoldersByName(FOTOS_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOTOS_FOLDER_NAME);
}

function salvarFotos_(fotos, idVenda) {
  if (!fotos || !fotos.length) return '';
  var folder;
  try {
    folder = getFotosFolder_();
  } catch (e) {
    // Erro típico: o deploy não tem o escopo do Drive autorizado. Mensagem clara p/ o Histórico.
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
      var nome = 'erro_' + (idVenda || 's-id') + '_' + (i + 1) + '_' + new Date().getTime() + '.' + ext;
      var blob = Utilities.newBlob(bytes, mime, nome);
      var file = folder.createFile(blob);
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
      urls.push(file.getUrl());
    } catch (e) {}
  }
  return urls.join(',');
}

/**
 * Diagnóstico: lista os arquivos da pasta de fotos (mais recentes primeiro) e
 * marca quais têm a URL gravada em algum "Foto" da planilha — arquivo com
 * naPlanilha:false chegou no Drive mas não foi vinculado a nenhuma linha
 * (upload que "sumiu" do painel). Usado só via ?action=fotos (diagnóstico
 * interno, chamado pelo hub — não tem tela própria).
 */
function listarFotosDiagnostico_() {
  var folder = getFotosFolder_();
  var it = folder.getFiles();
  var arquivos = [];
  while (it.hasNext()) {
    var f = it.next();
    arquivos.push({ nome: f.getName(), url: f.getUrl(), criadoTs: f.getDateCreated().getTime() });
  }
  arquivos.sort(function (a, b) { return b.criadoTs - a.criadoTs; });

  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var col = buildColMap_(values[0]);
  var urlsNaPlanilha = {};
  if (col.foto != null) {
    for (var r = 1; r < values.length; r++) {
      String(values[r][col.foto] || '').split(',').forEach(function (u) {
        u = u.trim();
        if (u) urlsNaPlanilha[u] = true;
      });
    }
  }
  return arquivos.map(function (a) {
    return {
      nome: a.nome,
      url: a.url,
      criado: Utilities.formatDate(new Date(a.criadoTs), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      naPlanilha: !!urlsNaPlanilha[a.url],
    };
  });
}

/**
 * Rode ESTA função no editor (botão ▶) para ATIVAR e TESTAR o pipeline de fotos:
 *   1) na 1ª vez o Apps Script vai pedir autorização do escopo do Google Drive — ACEITE;
 *   2) confirma que a coluna "Foto" existe na planilha;
 *   3) cria e apaga um arquivo de teste na pasta de fotos.
 * Se tudo passar, é só republicar a implantação (Nova versão) para as fotos subirem ao vivo.
 */
function testarPipelineFotos() {
  var sh = getSheet_();
  var header = sh.getDataRange().getValues()[0];
  var col = buildColMap_(header);
  if (col.foto == null) {
    Logger.log('❌ A planilha NÃO tem a coluna "Foto". Adicione um cabeçalho "Foto" e rode de novo.');
    return;
  }
  Logger.log('✔ Coluna "Foto" encontrada na posição ' + (col.foto + 1) + '.');
  var folder = getFotosFolder_(); // dispara o pedido de autorização do Drive na 1ª vez
  Logger.log('✔ Pasta de fotos acessível: "' + folder.getName() + '" (' + folder.getId() + ').');
  var blob = Utilities.newBlob('teste', 'text/plain', 'teste_pipeline_fotos.txt');
  var file = folder.createFile(blob);
  Logger.log('✔ Criei um arquivo de teste; apagando…');
  file.setTrashed(true);
  Logger.log('✅ Pipeline de fotos OK. Agora republique a implantação (Nova versão) e as fotos vão subir.');
}

/**
 * Diagnóstico do "salto de linha": mostra até onde vão os dados reais e o que
 * está ocupando as linhas abaixo (geralmente fórmulas em colunas auxiliares).
 * Rode no editor (▶) e veja o resultado em Execuções / Logs.
 */
function diagnosticarLinhas() {
  var sh = getSheet_();
  var header = sh.getDataRange().getValues()[0];
  var col = buildColMap_(header);
  var lastRow = sh.getLastRow();
  var maxRows = sh.getMaxRows();
  var ultDados = ultimaLinhaDeDados_(sh, col);
  Logger.log('Aba: ' + sh.getName());
  Logger.log('getLastRow (qualquer conteúdo): ' + lastRow);
  Logger.log('getMaxRows (grade total): ' + maxRows);
  Logger.log('Última linha com ID/nome (dados reais): ' + ultDados);
  Logger.log('→ Novos registros passarão a ir para a linha ' + (ultDados + 1) + ' (antes iam para ' + (lastRow + 1) + ').');
  if (lastRow > ultDados) {
    var faixaIni = ultDados + 1;
    var nLin = lastRow - ultDados;
    var vals = sh.getRange(faixaIni, 1, nLin, header.length).getValues();
    var colsComConteudo = [];
    for (var c = 0; c < header.length; c++) {
      var tem = false;
      for (var r = 0; r < vals.length && !tem; r++) {
        if (String(vals[r][c] == null ? '' : vals[r][c]).trim() !== '') tem = true;
      }
      if (tem) colsComConteudo.push('col ' + (c + 1) + ' ("' + header[c] + '")');
    }
    Logger.log('Linhas ' + faixaIni + '–' + lastRow + ' têm conteúdo nestas colunas: ' +
      (colsComConteudo.length ? colsComConteudo.join(', ') : '(nenhuma — pode ser formatação/grade)'));
    Logger.log('Para compactar: selecione as linhas ' + faixaIni + ' até ' + lastRow +
      ' e use "Excluir linhas" (limpe também as fórmulas dessas colunas auxiliares se não forem necessárias).');
  } else {
    Logger.log('Sem faixa fantasma — os dados vão até o fim. Nada a compactar.');
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================ HISTÓRICO ============================ */

var HIST_SHEET_NAME = 'Historico';

function getHistSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HIST_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(HIST_SHEET_NAME);
    sh.appendRow(['Data/Hora', 'ID do caso', 'ID venda', 'Usuário', 'Ação', 'Detalhe', 'Slug']);
  } else if (!sh.getRange(1, 7).getValue()) {
    // Sheet já existia de antes da coluna Slug (fila de aprovação de
    // Refabricação) — completa o cabeçalho sem precisar recriar a aba.
    sh.getRange(1, 7).setValue('Slug');
  }
  return sh;
}

function logHist_(caseRow, idVenda, usuario, acao, detalhe, slug) {
  try {
    getHistSheet_().appendRow([new Date(), caseRow, idVenda || '', usuario || '—', acao || '', detalhe || '', slug || '']);
  } catch (e) {}
}

/** Devolve o slug de quem registrou (ação "Caso registrado" no Histórico)
 *  cada rowIndex já visto — usado pra filtrar a fila de Refabricação por
 *  colaborador e pra notificar quem cadastrou quando o caso é decidido. */
function mapaRegistradoPorSlug_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HIST_SHEET_NAME);
  var mapa = {};
  if (!sh) return mapa;
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][4]) !== 'Caso registrado') continue;
    var caseRow = String(values[r][1]);
    if (mapa[caseRow] == null) mapa[caseRow] = String(values[r][6] || '');
  }
  return mapa;
}

function histFor_(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HIST_SHEET_NAME);
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

/* ============================ USUÁRIOS/LOGIN removidos do fluxo do hub ============================
 * As funções abaixo (getUsuarios_, gerarHashSenha, criarUsuario, seedUsuarios,
 * cadastrarUsuarios, trocarSenha) ficam aqui só como histórico/utilitário de
 * editor — o painel dentro do hub usa a sessão do hub, não faz mais login
 * próprio nem chama ?action=usuarios. Não removi porque não fazem mal
 * parado (só rodam se você mesmo executar no editor), mas não são mais
 * chamados por doGet/doPost.
 */
var USUARIOS_SHEET_NAME = 'Usuarios';
var SENHA_SALT = 'seubone::v1::';

function sha256Hex_(txt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SENHA_SALT + String(txt), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function getUsuariosSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(USUARIOS_SHEET_NAME);
}

/** EDITOR: gera o hash de uma senha (não usado mais pelo login — histórico). */
function gerarHashSenha() {
  var senha = 'troque-esta-senha';
  Logger.log('Senha: ' + senha);
  Logger.log('SenhaHash: ' + sha256Hex_(senha));
}

/* ============================ LEITURA (GET) ============================ */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.segredo !== SEGREDO_HUB) return jsonOut_({ ok: false, error: 'Nao autorizado' });

    if (p.action === 'historico') {
      return jsonOut_({ ok: true, eventos: histFor_(p.rowIndex) });
    }
    if (p.action === 'fotos') {
      return jsonOut_({ ok: true, arquivos: listarFotosDiagnostico_() });
    }
    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return jsonOut_({ ok: true, rows: [] });

    var header = values[0];
    var col = buildColMap_(header);
    var get = function (row, key) {
      var i = col[key];
      return (i == null) ? '' : row[i];
    };

    var registradoPorSlugMap = mapaRegistradoPorSlug_();

    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var idVenda = get(row, 'idVenda');
      var nomeCard = get(row, 'nomeCard');
      if (String(idVenda).trim() === '' && String(nomeCard).trim() === '') continue;

      var descricao = String(get(row, 'descricao') || '');
      var rowIndex = r + 1;
      rows.push({
        rowIndex:      rowIndex,
        data:          fmtDate_(get(row, 'data')),
        auditoria:     parseBool_(get(row, 'auditoria')),
        idVenda:       String(idVenda || '').trim(),
        nomeCard:      String(nomeCard || '').trim(),
        descricao:     descricao,
        quemCadastrou: String(get(row, 'quemCadastrou') || '').trim(),
        culpaDe:       String(get(row, 'culpaDe') || '').trim(),
        setor:         String(get(row, 'setor') || '').trim(),
        responsavel:   String(get(row, 'responsavel') || '').trim(),
        empresa:       String(get(row, 'empresa') || '').trim(),
        tipoProblema:  String(get(row, 'tipoProblema') || '').trim(),
        subproblema:   String(get(row, 'subproblema') || '').trim(),
        qtd:           parseNumber_(get(row, 'qtd')),
        custo:         parseNumber_(get(row, 'custo')),
        tipoProduto:   String(get(row, 'tipoProduto') || '').trim(),
        linha:         String(get(row, 'linha') || '').trim(),
        queFim:        String(get(row, 'queFim') || '').trim(),
        tipoResolucao: String(get(row, 'tipoResolucao') || '').trim(),
        status:        String(get(row, 'status') || '').trim(),
        foto:          String(get(row, 'foto') || '').trim(),
        // Casos antigos tinham o link embutido no texto da descrição; casos
        // novos gravam na coluna própria ("Link do card") — cai pro texto só
        // se a coluna estiver vazia, pra não perder o link dos casos velhos.
        linkPedido:    String(get(row, 'linkPedido') || '').trim() || extractUrl_(descricao),
        aprovacaoRefab:      String(get(row, 'aprovacaoRefab') || '').trim(),
        comentarioAprovacao: String(get(row, 'comentarioAprovacao') || '').trim(),
        registradoPorSlug:   registradoPorSlugMap[String(rowIndex)] || '',
      });
    }
    return jsonOut_({ ok: true, version: 'fotos-fix-2026-08', aba: sh.getName(), rows: rows });
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

    if (action === 'criar') return criarCaso_(body.fields || {}, body.usuario, body.usuarioSlug);
    if (action === 'audit') return auditarCaso_(body.rowIndex, body.fields || {}, body.usuario, body.usuarioSlug);
    if (action === 'setStatus') return setStatus_(body.rowIndex, body.status, body.usuario);
    if (action === 'setSetor')  return setSetor_(body.rowIndex, body.setor, body.usuario);
    if (action === 'decidirRefab')  return decidirRefab_(body.rowIndex, body.decisao, body.comentario, body.usuario, body.usuarioSlug);
    if (action === 'finalizarRefab') return finalizarRefab_(body.rowIndex, body.usuario, body.usuarioSlug);
    if (action === 'comentarCaso') return comentarCaso_(body.rowIndex, body.comentario, body.usuario, body.usuarioSlug);

    return jsonOut_({ ok: false, error: 'Ação desconhecida: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function setCell_(sh, rowIndex1, col, key, value) {
  var i = col[key];
  if (i == null) return;
  if (value === undefined || value === null || value === '') return;
  sh.getRange(rowIndex1, i + 1).setValue(value);
}

/**
 * Última linha que REALMENTE tem um registro (ID da venda ou Nome do card preenchido).
 * getLastRow() conta qualquer conteúdo em qualquer coluna — inclusive fórmulas
 * arrastadas nas colunas auxiliares da direita — e por isso empurrava os novos
 * registros para lá embaixo (ex.: linha 3559 em vez de 347). Aqui olhamos só as
 * colunas de ID e nome, então o append continua logo após os dados reais.
 */
function ultimaLinhaDeDados_(sh, col) {
  var ultima = sh.getLastRow();
  if (ultima < 2) return 1; // só cabeçalho (ou vazia)
  var idCol   = (col.idVenda != null)  ? col.idVenda  : null;
  var nomeCol = (col.nomeCard != null) ? col.nomeCard : null;
  if (idCol == null && nomeCol == null) return ultima; // sem como saber; usa o padrão
  var ids   = idCol   != null ? sh.getRange(1, idCol + 1,   ultima, 1).getValues()   : null;
  var nomes = nomeCol != null ? sh.getRange(1, nomeCol + 1, ultima, 1).getValues() : null;
  for (var r = ultima - 1; r >= 1; r--) { // r=0 é o cabeçalho
    var temId   = ids   && String(ids[r][0]   == null ? '' : ids[r][0]).trim()   !== '';
    var temNome = nomes && String(nomes[r][0] == null ? '' : nomes[r][0]).trim() !== '';
    if (temId || temNome) return r + 1; // 1-based
  }
  return 1;
}

/**
 * Se o Tipo de Resolução for "Refabricação" e a linha ainda não tiver
 * entrado na fila (célula AprovacaoRefab vazia), marca como "Pendente" —
 * nunca sobrescreve uma decisão que já foi tomada (Aprovado/Reprovado/
 * Finalizado), mesmo que uma auditoria posterior reafirme "Refabricação".
 * Devolve true se acabou de entrar agora (pra avisar os gestores).
 */
function entrarNaFilaRefab_(sh, rowIndex, col, tipoResolucao) {
  if (tipoResolucao !== 'Refabricação' || col.aprovacaoRefab == null) return false;
  var atual = String(sh.getRange(rowIndex, col.aprovacaoRefab + 1).getValue() || '').trim();
  if (atual !== '') return false;
  sh.getRange(rowIndex, col.aprovacaoRefab + 1).setValue(REFAB_PENDENTE);
  return true;
}

/**
 * Lock por toda a função: sem ele, duas criações quase simultâneas podiam
 * calcular a MESMA "próxima linha livre" (ultimaLinhaDeDados_) e escrever
 * uma por cima da outra célula a célula — foi assim que uma foto chegou a
 * subir no Drive mas o link nunca ficou gravado em lugar nenhum da planilha
 * (a linha certa acabou recebendo os dados da OUTRA submissão). O timeout é
 * generoso (20s) porque salvarFotos_ pode demorar com várias fotos.
 */
function criarCaso_(f, usuario, usuarioSlug) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return jsonOut_({ ok: false, error: 'Sistema ocupado, tente novamente em alguns segundos.' }); }
  try {
    var sh = getSheet_();
    var header = sh.getDataRange().getValues()[0];
    var col = buildColMap_(header);

    var novaLinha = ultimaLinhaDeDados_(sh, col) + 1;

    var hoje = new Date();
    setCell_(sh, novaLinha, col, 'data', fmtDate_(hoje));

    setCell_(sh, novaLinha, col, 'auditoria',     f.auditoria ? 'TRUE' : 'FALSE');
    setCell_(sh, novaLinha, col, 'status',        f.status || (f.auditoria ? 'resolvido' : 'novo'));
    setCell_(sh, novaLinha, col, 'idVenda',       f.idVenda);
    setCell_(sh, novaLinha, col, 'nomeCard',      f.nomeCard);
    setCell_(sh, novaLinha, col, 'descricao',     f.descricao);
    setCell_(sh, novaLinha, col, 'linkPedido',    f.linkPedido);
    setCell_(sh, novaLinha, col, 'quemCadastrou', f.quemCadastrou);
    setCell_(sh, novaLinha, col, 'culpaDe',       f.culpaDe);
    setCell_(sh, novaLinha, col, 'setor',         f.setor);
    setCell_(sh, novaLinha, col, 'responsavel',   f.responsavel);
    setCell_(sh, novaLinha, col, 'empresa',       f.empresa);
    setCell_(sh, novaLinha, col, 'tipoProblema',  f.tipoProblema);
    setCell_(sh, novaLinha, col, 'subproblema',   f.subproblema);
    setCell_(sh, novaLinha, col, 'qtd',           f.qtd);
    setCell_(sh, novaLinha, col, 'custo',         f.custo);
    setCell_(sh, novaLinha, col, 'tipoProduto',   f.tipoProduto);
    setCell_(sh, novaLinha, col, 'queFim',        f.queFim);
    setCell_(sh, novaLinha, col, 'tipoResolucao', f.tipoResolucao);

    // fotosErro fica pra avisar quem cadastrou (o registro em si sempre vale,
    // mesmo se o anexo falhar) — antes disso a resposta dizia sempre "ok" e o
    // caso subia sem anexo sem ninguém perceber.
    var fotosErro = null;
    if (f.fotos && f.fotos.length) {
      if (col.foto == null) {
        fotosErro = 'A planilha não tem a coluna "Foto". Adicione um cabeçalho "Foto".';
        logHist_(novaLinha, f.idVenda, usuario || f.quemCadastrou, 'Fotos não salvas', fotosErro, usuarioSlug);
      } else {
        try {
          var links = salvarFotos_(f.fotos, f.idVenda);
          if (links) {
            setCell_(sh, novaLinha, col, 'foto', links);
          } else {
            fotosErro = 'Nenhum link gerado (formato inesperado).';
            logHist_(novaLinha, f.idVenda, usuario || f.quemCadastrou, 'Fotos não salvas', fotosErro, usuarioSlug);
          }
        } catch (e) {
          fotosErro = String(e && e.message || e);
          logHist_(novaLinha, f.idVenda, usuario || f.quemCadastrou, 'Falha ao salvar fotos', fotosErro, usuarioSlug);
        }
      }
    }

    logHist_(novaLinha, f.idVenda, usuario || f.quemCadastrou, 'Caso registrado',
      f.auditoria ? 'já auditado (' + (f.status || 'resolvido') + ')' : 'pendente de auditoria', usuarioSlug);

    var entrouRefab = entrarNaFilaRefab_(sh, novaLinha, col, f.tipoResolucao);
    if (entrouRefab) {
      logHist_(novaLinha, f.idVenda, usuario || f.quemCadastrou, 'Entrou na fila de aprovação de Refabricação', '', usuarioSlug);
    }

    return jsonOut_({ ok: true, rowIndex: novaLinha, entrouAprovacaoRefab: entrouRefab, fotosSalvas: !fotosErro, fotosErro: fotosErro });
  } finally {
    lock.releaseLock();
  }
}

function auditarCaso_(rowIndex, f, usuario, usuarioSlug) {
  if (!rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var sh = getSheet_();
  var header = sh.getDataRange().getValues()[0];
  var col = buildColMap_(header);

  setCell_(sh, rowIndex, col, 'auditoria',     'TRUE');
  setCell_(sh, rowIndex, col, 'status',        f.status || 'resolvido');
  setCell_(sh, rowIndex, col, 'culpaDe',       f.culpaDe);
  setCell_(sh, rowIndex, col, 'setor',         f.setor);
  setCell_(sh, rowIndex, col, 'responsavel',   f.responsavel);
  setCell_(sh, rowIndex, col, 'empresa',       f.empresa);
  setCell_(sh, rowIndex, col, 'tipoProduto',   f.tipoProduto);
  setCell_(sh, rowIndex, col, 'linha',         f.linha);
  setCell_(sh, rowIndex, col, 'tipoProblema',  f.tipoProblema);
  setCell_(sh, rowIndex, col, 'subproblema',   f.subproblema);
  setCell_(sh, rowIndex, col, 'qtd',           f.qtd);
  setCell_(sh, rowIndex, col, 'custo',         f.custo);
  setCell_(sh, rowIndex, col, 'queFim',        f.queFim);
  setCell_(sh, rowIndex, col, 'tipoResolucao', f.tipoResolucao);

  // idVenda/nomeCard não vêm no payload de auditoria (o form só reenvia os
  // campos editáveis) — lê da própria planilha, igual decidirRefab_, pra dar
  // pro hub notificar o gestor com o card certo quando o gatilho de
  // Refabricação disparar aqui em vez de na criação.
  var idVenda = (col.idVenda != null) ? sh.getRange(rowIndex, col.idVenda + 1).getValue() : '';
  var nomeCard = (col.nomeCard != null) ? sh.getRange(rowIndex, col.nomeCard + 1).getValue() : '';

  logHist_(rowIndex, idVenda, usuario, 'Auditoria salva',
    [f.setor, f.tipoResolucao, (f.custo ? 'R$ ' + f.custo : '')].filter(String).join(' · '), usuarioSlug);

  var entrouRefab = entrarNaFilaRefab_(sh, rowIndex, col, f.tipoResolucao);
  if (entrouRefab) {
    logHist_(rowIndex, idVenda, usuario, 'Entrou na fila de aprovação de Refabricação', '', usuarioSlug);
  }

  return jsonOut_({ ok: true, rowIndex: rowIndex, entrouAprovacaoRefab: entrouRefab, idVenda: String(idVenda || ''), nomeCard: String(nomeCard || '') });
}

/**
 * Aprova ou reprova um caso na fila de Refabricação (só gestor, decidido no
 * hub) — grava a decisão + comentário e devolve quem cadastrou (slug) pra o
 * hub notificar essa pessoa de volta.
 */
function decidirRefab_(rowIndex, decisao, comentario, usuario, usuarioSlug) {
  if (!rowIndex || (decisao !== REFAB_APROVADO && decisao !== REFAB_REPROVADO)) {
    return jsonOut_({ ok: false, error: 'rowIndex/decisao inválidos' });
  }
  var sh = getSheet_();
  var header = sh.getDataRange().getValues()[0];
  var col = buildColMap_(header);
  if (col.aprovacaoRefab == null) return jsonOut_({ ok: false, error: 'Coluna "AprovacaoRefab" não existe na planilha.' });

  var idVenda = (col.idVenda != null) ? sh.getRange(rowIndex, col.idVenda + 1).getValue() : '';
  var nomeCard = (col.nomeCard != null) ? sh.getRange(rowIndex, col.nomeCard + 1).getValue() : '';

  sh.getRange(rowIndex, col.aprovacaoRefab + 1).setValue(decisao);
  if (col.comentarioAprovacao != null) sh.getRange(rowIndex, col.comentarioAprovacao + 1).setValue(comentario || '');

  logHist_(rowIndex, idVenda, usuario, 'Refabricação ' + (decisao === REFAB_APROVADO ? 'aprovada' : 'reprovada'), comentario || '', usuarioSlug);

  var registradoPorSlug = mapaRegistradoPorSlug_()[String(rowIndex)] || '';
  return jsonOut_({ ok: true, rowIndex: rowIndex, decisao: decisao, idVenda: String(idVenda || ''), nomeCard: String(nomeCard || ''), registradoPorSlug: registradoPorSlug });
}

/**
 * Quem cadastrou marca que já enviou pra produção (sistema externo) — só
 * pode finalizar um caso que já foi Aprovado.
 */
function finalizarRefab_(rowIndex, usuario, usuarioSlug) {
  if (!rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var sh = getSheet_();
  var header = sh.getDataRange().getValues()[0];
  var col = buildColMap_(header);
  if (col.aprovacaoRefab == null) return jsonOut_({ ok: false, error: 'Coluna "AprovacaoRefab" não existe na planilha.' });

  var atual = String(sh.getRange(rowIndex, col.aprovacaoRefab + 1).getValue() || '').trim();
  if (atual !== REFAB_APROVADO) return jsonOut_({ ok: false, error: 'Só é possível finalizar um caso já aprovado.' });

  var idVenda = (col.idVenda != null) ? sh.getRange(rowIndex, col.idVenda + 1).getValue() : '';
  sh.getRange(rowIndex, col.aprovacaoRefab + 1).setValue(REFAB_FINALIZADO);
  logHist_(rowIndex, idVenda, usuario, 'Enviado para produção', '', usuarioSlug);

  return jsonOut_({ ok: true, rowIndex: rowIndex });
}

/**
 * Comentário de acompanhamento num caso já registrado — não edita nenhum
 * campo, só grava um evento no Histórico (qualquer usuário com acesso ao
 * painel pode comentar, mesmo colaborador sem permissão de auditoria). O hub
 * usa idVenda/nomeCard devolvidos aqui pra notificar os gestores com o card
 * certo.
 */
function comentarCaso_(rowIndex, comentario, usuario, usuarioSlug) {
  if (!rowIndex) return jsonOut_({ ok: false, error: 'rowIndex ausente' });
  var texto = String(comentario || '').trim();
  if (!texto) return jsonOut_({ ok: false, error: 'Comentário vazio.' });

  var sh = getSheet_();
  var col = buildColMap_(sh.getDataRange().getValues()[0]);
  var idVenda = (col.idVenda != null) ? sh.getRange(rowIndex, col.idVenda + 1).getValue() : '';
  var nomeCard = (col.nomeCard != null) ? sh.getRange(rowIndex, col.nomeCard + 1).getValue() : '';

  logHist_(rowIndex, idVenda, usuario, 'Comentário', texto, usuarioSlug);

  return jsonOut_({ ok: true, rowIndex: rowIndex, idVenda: String(idVenda || ''), nomeCard: String(nomeCard || '') });
}

function setStatus_(rowIndex, status, usuario) {
  if (!rowIndex || !status) return jsonOut_({ ok: false, error: 'rowIndex/status ausente' });
  var sh = getSheet_();
  var col = buildColMap_(sh.getDataRange().getValues()[0]);
  if (col.status == null) return jsonOut_({ ok: false, error: 'Coluna "Status" não existe na planilha. Adicione um cabeçalho "Status".' });
  var idVenda = (col.idVenda != null) ? sh.getRange(rowIndex, col.idVenda + 1).getValue() : '';
  setCell_(sh, rowIndex, col, 'status', status);
  if (status === 'resolvido') setCell_(sh, rowIndex, col, 'auditoria', 'TRUE');
  logHist_(rowIndex, idVenda, usuario, 'Status alterado', '→ ' + status);
  return jsonOut_({ ok: true, rowIndex: rowIndex, status: status });
}

/** Backfill do setor: grava SÓ o setor de uma linha (não mexe em auditoria/status). */
function setSetor_(rowIndex, setor, usuario) {
  if (!rowIndex || !setor) return jsonOut_({ ok: false, error: 'rowIndex/setor ausente' });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) { return jsonOut_({ ok: false, error: 'ocupado, tente de novo' }); }
  try {
    var sh = getSheet_();
    var col = buildColMap_(sh.getDataRange().getValues()[0]);
    if (col.setor == null) return jsonOut_({ ok: false, error: 'Coluna de setor não encontrada na planilha.' });
    var idVenda = (col.idVenda != null) ? sh.getRange(rowIndex, col.idVenda + 1).getValue() : '';
    setCell_(sh, rowIndex, col, 'setor', setor);
    logHist_(rowIndex, idVenda, usuario, 'Setor preenchido', '→ ' + setor);
    return jsonOut_({ ok: true, rowIndex: rowIndex, setor: setor });
  } finally { lock.releaseLock(); }
}

/**
 * MIGRAÇÃO (rode UMA vez após criar a coluna "Status"): preenche o status das
 * linhas antigas a partir de "Auditoria" — auditado→resolvido, senão→novo.
 */
function migrarStatus() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var col = buildColMap_(values[0]);
  if (col.status == null) { Logger.log('Crie a coluna "Status" antes de migrar.'); return; }
  var n = 0;
  for (var r = 1; r < values.length; r++) {
    var atual = String(values[r][col.status] || '').trim();
    var idv = String(values[r][col.idVenda] || '').trim();
    if (atual !== '' || idv === '') continue;
    var status = parseBool_(values[r][col.auditoria]) ? 'resolvido' : 'novo';
    sh.getRange(r + 1, col.status + 1).setValue(status);
    n++;
  }
  Logger.log('Migração concluída: ' + n + ' linha(s) preenchida(s).');
}

/* ============================ NORMALIZAÇÃO DE DADOS ============================ */

var SINONIMOS = {
  responsavel: {
    'Fábrica Caicó': ['fabrica caico', 'fabrica caicó', 'fábrica caico', 'fabrica-caico', 'caico', 'caicó'],
    'Fábrica': ['fabrica', 'fábrica', 'producao', 'produção', 'producao (fabrica)', 'produção (fábrica)'],
  },
  empresa: {
    'ACM': ['acm'],
    'ITC': ['itc'],
    'TUBA': ['tuba'],
    'SUPERNOVA': ['supernova', 'super nova'],
    'BIGBANG': ['bigbang', 'big bang'],
  },
  setor: {
    'Vendas': ['vendas', 'venda', 'comercial'],
    'Fábrica': ['fabrica', 'fábrica'],
    'Dupla (Vendedor e Designer)': ['dupla', 'dupla (vendedor e designer)', 'vendedor e designer'],
    'Escritório': ['escritorio', 'escritório'],
    'Cliente': ['cliente'],
  },
};

function canonizar_(coluna, valor) {
  var v = String(valor == null ? '' : valor).trim();
  if (v === '') return '';
  var regras = SINONIMOS[coluna];
  if (!regras) return v;
  var alvo = norm_(v);
  var chaves = Object.keys(regras);
  for (var k = 0; k < chaves.length; k++) {
    if (norm_(chaves[k]) === alvo) return chaves[k];
    var variantes = regras[chaves[k]];
    for (var i = 0; i < variantes.length; i++) {
      if (norm_(variantes[i]) === alvo) return chaves[k];
    }
  }
  return v;
}

/** NORMALIZAÇÃO (rode no editor: ▶ Executar → normalizarDados). */
function normalizarDados() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var col = buildColMap_(values[0]);
  var colunasAlvo = ['responsavel', 'empresa', 'setor'];
  var alterados = 0, detalhes = [];
  for (var r = 1; r < values.length; r++) {
    for (var c = 0; c < colunasAlvo.length; c++) {
      var chave = colunasAlvo[c];
      if (col[chave] == null) continue;
      var atual = values[r][col[chave]];
      var novo = canonizar_(chave, atual);
      if (novo !== String(atual == null ? '' : atual).trim() && novo !== '') {
        sh.getRange(r + 1, col[chave] + 1).setValue(novo);
        alterados++;
        if (detalhes.length < 40) detalhes.push('linha ' + (r + 1) + ' · ' + chave + ': "' + atual + '" → "' + novo + '"');
      }
    }
  }
  Logger.log('Normalização concluída: ' + alterados + ' célula(s) padronizada(s).');
  detalhes.forEach(function (d) { Logger.log('  ' + d); });
}

/* ============================ DIAGNÓSTICO ============================ */

function verColunas() {
  var sh = getSheet_();
  Logger.log('Aba lida: "' + sh.getName() + '" (gid ' + sh.getSheetId() + ') — ' + sh.getLastColumn() + ' colunas, ' + sh.getLastRow() + ' linhas');
  var header = sh.getDataRange().getValues()[0];
  var col = buildColMap_(header);
  Logger.log('Cabeçalhos da planilha:');
  header.forEach(function (h, i) { Logger.log('  [' + i + '] ' + h); });
  Logger.log('---');
  Logger.log('Mapeamento (chave do painel → coluna):');
  Object.keys(COLUNAS).forEach(function (k) {
    var i = col[k];
    Logger.log('  ' + k + ' → ' + (i == null ? '(NÃO ENCONTRADA)' : '[' + i + '] ' + header[i]));
  });
}
