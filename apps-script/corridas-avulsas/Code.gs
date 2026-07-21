// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// numa planilha nova (ex: "Corridas Avulsas"). NUNCA preencha os valores abaixo
// com os reais aqui — deixe só no Apps Script (ambiente do Google, fora deste
// repositório) e no .env do hub (que já é ignorado pelo Git).
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// ID da pasta do Google Drive onde os prints do motorista ficam salvos —
// crie uma pasta no Drive, abra ela, e copie o ID que aparece na URL
// (.../folders/ESSE_ID_AQUI). Precisa ser uma pasta que a conta Google
// dona deste Apps Script tenha acesso de edição.
const PASTA_PRINTS_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
// única autenticação aqui é o segredo compartilhado, sem login de usuário.
// Quem pode ver o quê já foi decidido no servidor do hub antes de chegar aqui.

function doGet(e) {
  const p = e.parameter;
  try {
    if (p.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (p.action === 'lista') {
      return out({ ok: true, itens: listarCorridas(p.desde, p.ate) });
    }
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (body.action === 'cadastrar') return out(cadastrarCorrida(body));
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

function getAbaCorridas(ss) {
  let aba = ss.getSheetByName('Corridas');
  if (!aba) {
    aba = ss.insertSheet('Corridas');
    aba.appendRow([
      'id', 'dataCadastro', 'dataCorrida', 'numeroNf', 'endereco', 'valor',
      'printUrl', 'registradoPorSlug', 'registradoPorNome', 'nomeMotorista',
    ]);
  }
  return aba;
}

// r[n] instanceof Date não é confiável para valores vindos de getValues() —
// pegadinha conhecida do Apps Script. Object.prototype.toString detecta o
// tipo de verdade independente de em qual "mundo" o objeto Date foi criado.
function ehData(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function linhaParaItem(r) {
  return {
    id: String(r[0]),
    dataCadastro: ehData(r[1]) ? r[1].toISOString() : String(r[1]),
    dataCorrida: ehData(r[2]) ? r[2].toISOString().slice(0, 10) : String(r[2] || ''),
    numeroNf: String(r[3] || ''),
    endereco: String(r[4] || ''),
    valor: Number(r[5]) || 0,
    printUrl: String(r[6] || ''),
    registradoPorSlug: String(r[7] || ''),
    registradoPorNome: String(r[8] || ''),
    nomeMotorista: String(r[9] || ''),
  };
}

function listarCorridas(desdeStr, ateStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaCorridas(ss);
  const rows = aba.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  let itens = rows.map(linhaParaItem);

  if (desdeStr || ateStr) {
    const desde = desdeStr ? new Date(desdeStr + 'T00:00:00') : null;
    const ate = ateStr ? new Date(ateStr + 'T23:59:59') : null;
    itens = itens.filter((it) => {
      const ref = new Date(it.dataCorrida + 'T12:00:00');
      if (desde && ref < desde) return false;
      if (ate && ref > ate) return false;
      return true;
    });
  }

  itens.sort((a, b) => new Date(a.dataCorrida) - new Date(b.dataCorrida));
  return itens;
}

function gerarId() {
  return 'CA' + new Date().getTime();
}

function cadastrarCorrida(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaCorridas(ss);
  const id = gerarId();
  const printUrl = body.imagemBase64 ? salvarPrint(body.imagemBase64, body.imagemTipo, id) : '';
  aba.appendRow([
    id,
    new Date(),
    body.dataCorrida || '',
    body.numeroNf || '',
    body.endereco || '',
    Number(body.valor) || 0,
    printUrl,
    body.registradoPorSlug || '',
    body.registradoPorNome || '',
    body.nomeMotorista || '',
  ]);
  return { ok: true, id: id, printUrl: printUrl };
}

function salvarPrint(base64, mimeType, id) {
  const pasta = DriveApp.getFolderById(PASTA_PRINTS_ID);
  const bytes = Utilities.base64Decode(base64);
  const extensao = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', 'corrida-' + id + '.' + extensao);
  const arquivo = pasta.createFile(blob);
  // "Qualquer um com o link" (só visualizar) — pra dar pra abrir o print
  // direto do hub sem pedir login Google de novo. Algumas contas Google
  // Workspace bloqueiam compartilhamento "qualquer um com o link" por
  // política do admin — nesse caso não deixa travar o cadastro inteiro
  // (o arquivo já foi salvo; só não vira link público, abre normalmente
  // pra quem já tem acesso à pasta/domínio).
  try {
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // segue mesmo assim
  }
  return arquivo.getUrl();
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
