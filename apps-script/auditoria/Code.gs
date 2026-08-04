// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// preso à planilha "Sistema_Registro" da Auditoria de Qualidade. NUNCA preencha
// o valor abaixo com o real aqui — deixe só no Apps Script (ambiente do Google,
// fora deste repositório) e no .env do hub (que já é ignorado pelo Git).
var SEGREDO_HUB = "PREENCHA_APENAS_NO_APPS_SCRIPT_REAL";

// Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
// única autenticação aqui é o segredo compartilhado, sem login de usuário.
// Quem pode acessar (só gestor) já foi decidido no servidor do hub antes de
// chegar aqui; "AuditadoPor" também vem sempre do hub (nome de quem está
// logado), nunca de texto digitado no navegador.

var SHEET_NAME = "Sistema_Registro";

var HEADERS = [
  "Timestamp", "Data", "Semana", "AuditadoPor", "Agente", "TipoOcorrencia", "Canal", "ConversationId",
  "c11", "c12", "c13", "c14",
  "c21", "c22", "c23", "c24",
  "c31", "c32", "c33", "c34",
  "S1", "S2", "S3", "Total", "Classificacao",
  "FG1", "FG2", "FG3", "FG4", "FalhaGrave",
  "Observacoes"
];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function num_(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function weekLabel_(dateStr) {
  var d = new Date(dateStr);
  var utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = utc.getUTCDay(); // 0 = domingo, 5 = sexta
  var diffToFriday = (day - 5 + 7) % 7;
  var friday = new Date(utc);
  friday.setUTCDate(utc.getUTCDate() - diffToFriday);
  var thursday = new Date(friday);
  thursday.setUTCDate(friday.getUTCDate() + 6);
  function fmt(x) {
    return ("0" + x.getUTCDate()).slice(-2) + "/" + ("0" + (x.getUTCMonth() + 1)).slice(-2);
  }
  return fmt(friday) + " a " + fmt(thursday);
}

function classify_(total, critical) {
  if (critical) return "CRITICO";
  if (total >= 90) return "EXCELENTE";
  if (total >= 75) return "BOM";
  if (total >= 60) return "REGULAR";
  return "CRITICO";
}

function computeScore_(b) {
  var s1 = num_(b.c11) + num_(b.c12) + num_(b.c13) + num_(b.c14);
  var s2 = num_(b.c21) + num_(b.c22) + num_(b.c23) + num_(b.c24);
  var s3 = num_(b.c31) + num_(b.c32) + num_(b.c33) + num_(b.c34);
  var critical = !!(b.fg1 || b.fg2 || b.fg3 || b.fg4);
  var total = critical ? 0 : s1 + s2 + s3;
  return {
    section1: s1,
    section2: s2,
    section3: s3,
    total: total,
    criticalFailure: critical,
    classification: classify_(total, critical),
  };
}

/** GET: devolve todas as auditorias já salvas, como JSON. Exige ?segredo=. */
function doGet(e) {
  var p = e.parameter;
  if (p.segredo !== SEGREDO_HUB) return jsonOut_({ ok: false, error: "Nao autorizado" });

  var sheet = getSheet_();
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[1]) continue; // pula linha sem data
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    data.push(obj);
  }
  return jsonOut_({ ok: true, data: data });
}

/** POST: recebe uma nova auditoria, calcula o score e grava na planilha. */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return jsonOut_({ ok: false, error: "Nao autorizado" });

    if (!body.data || !body.agente || !body.tipoOcorrencia || !body.canal || !body.conversationId) {
      return jsonOut_({ ok: false, error: "Campos obrigatórios faltando." });
    }

    var result = computeScore_(body);
    var sheet = getSheet_();

    sheet.appendRow([
      new Date(),
      body.data,
      weekLabel_(body.data),
      body.auditadoPor || "",
      body.agente,
      body.tipoOcorrencia,
      body.canal,
      body.conversationId,
      num_(body.c11), num_(body.c12), num_(body.c13), num_(body.c14),
      num_(body.c21), num_(body.c22), num_(body.c23), num_(body.c24),
      num_(body.c31), num_(body.c32), num_(body.c33), num_(body.c34),
      result.section1, result.section2, result.section3, result.total, result.classification,
      body.fg1 ? "Sim" : "Nao",
      body.fg2 ? "Sim" : "Nao",
      body.fg3 ? "Sim" : "Nao",
      body.fg4 ? "Sim" : "Nao",
      result.criticalFailure ? "Sim" : "Nao",
      body.observacoes || "",
    ]);

    return jsonOut_({ ok: true, result: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}
