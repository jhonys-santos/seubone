// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// numa planilha nova (ex: "Pagamentos - Corridas Avulsas"). NUNCA preencha os
// valores abaixo com os reais aqui — deixe só no Apps Script (ambiente do
// Google, fora deste repositório) e no .env do hub (que já é ignorado pelo Git).
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// ID da pasta do Google Drive onde os anexos ficam salvos — crie uma pasta
// no Drive, abra ela, e copie o ID que aparece na URL (.../folders/ESSE_ID).
// Precisa ser uma pasta que a conta Google dona deste Apps Script tenha
// acesso de edição.
const PASTA_ANEXOS_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

const ABA_PAGAMENTOS = 'Pagamentos';

// Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
// única autenticação aqui é o segredo compartilhado, sem login de usuário.

function doGet(e) {
  const p = e.parameter;
  try {
    if (p.segredo !== SEGREDO_HUB) return out({ erro: 'Nao autorizado' });
    if (p.action === 'list') return out(listarPagamentos());
    return out({ erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ erro: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (body.action === 'create') return out(criarPagamento(body));
    if (body.action === 'marcar') return out(marcarPagamento(body));
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

// Colunas (1-indexed): ID, DataVencimento, CPFCNPJ, Email, Motivo,
// RazaoSocial, Banco, Agencia, Conta, ChavePix, TipoChave, Valor,
// EmpresaResponsavel, Solicitante, NumeroNotaFiscal, Anexos, Status,
// FeitoPor, InseridoEm.

function getAbaPagamentos(ss) {
  let aba = ss.getSheetByName(ABA_PAGAMENTOS);
  if (!aba) {
    aba = ss.insertSheet(ABA_PAGAMENTOS);
    aba.appendRow([
      'ID', 'DataVencimento', 'CPFCNPJ', 'Email', 'Motivo', 'RazaoSocial',
      'Banco', 'Agencia', 'Conta', 'ChavePix', 'TipoChave', 'Valor',
      'EmpresaResponsavel', 'Solicitante', 'NumeroNotaFiscal', 'Anexos',
      'Status', 'FeitoPor', 'InseridoEm',
    ]);
    // CPFCNPJ, Agencia, Conta, ChavePix, NumeroNotaFiscal
    formatarColunasComoTexto(aba, ['C2:C', 'H2:H', 'I2:I', 'J2:J', 'O2:O']);
  }
  return aba;
}

function criarPagamento(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaPagamentos(ss);
  const id = gerarId('PG');
  const anexos = processarAnexos(body.anexos);

  aba.appendRow([
    id,
    body.dataVencimento || '',
    '', // CPFCNPJ — escrito abaixo como texto puro
    body.email || '',
    body.motivo || '',
    body.razaoSocial || '',
    body.banco || '',
    '', // Agencia — idem
    '', // Conta — idem
    '', // ChavePix — idem
    body.tipoChave || '',
    Number(body.valor) || 0,
    body.empresaResponsavel || '',
    body.solicitante || '',
    '', // NumeroNotaFiscal — idem
    JSON.stringify(anexos),
    'Pendente',
    '',
    new Date(),
  ]);

  // appendRow() converte string numérica (ex: "0099") pra número mesmo com
  // a coluna formatada como texto — só setNumberFormat + setValue direto
  // na célula, feitos juntos, garantem que o zero à esquerda não se perca.
  const linha = aba.getLastRow();
  aba.getRange(linha, 3).setNumberFormat('@').setValue(body.cpfCnpj || '');
  aba.getRange(linha, 8).setNumberFormat('@').setValue(body.agencia || '');
  aba.getRange(linha, 9).setNumberFormat('@').setValue(body.conta || '');
  aba.getRange(linha, 10).setNumberFormat('@').setValue(body.chavePix || '');
  aba.getRange(linha, 15).setNumberFormat('@').setValue(body.numeroNotaFiscal || '');

  return { ok: true, id: id, anexos: anexos };
}

function linhaParaPagamento(r) {
  return {
    ID: String(r[0]),
    DataVencimento: formatarDataSaida(r[1]),
    CPFCNPJ: String(r[2] || ''),
    Email: String(r[3] || ''),
    Motivo: String(r[4] || ''),
    RazaoSocial: String(r[5] || ''),
    Banco: String(r[6] || ''),
    Agencia: String(r[7] || ''),
    Conta: String(r[8] || ''),
    ChavePix: String(r[9] || ''),
    TipoChave: String(r[10] || ''),
    Valor: Number(r[11]) || 0,
    EmpresaResponsavel: String(r[12] || ''),
    Solicitante: String(r[13] || ''),
    NumeroNotaFiscal: String(r[14] || ''),
    Anexos: String(r[15] || '[]'),
    Status: String(r[16] || 'Pendente'),
    FeitoPor: String(r[17] || ''),
    InseridoEm: formatarDataSaida(r[18]),
  };
}

function listarPagamentos() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaPagamentos(ss);
  const linhas = aba.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  return linhas.map(linhaParaPagamento);
}

// Callback do n8n (financeiro concluiu no ClickUp) — substitui os anexos
// originais pelo comprovante, não soma (mesma decisão tomada no Registro
// de Demandas).
function marcarPagamento(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = getAbaPagamentos(ss);
    const dados = aba.getDataRange().getValues();

    let linhaEncontrada = -1;
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === String(body.id)) {
        linhaEncontrada = i + 1;
        break;
      }
    }
    if (linhaEncontrada === -1) {
      return { ok: false, erro: 'Pagamento não encontrado: ' + body.id };
    }

    aba.getRange(linhaEncontrada, 17).setValue('Feito'); // Status
    aba.getRange(linhaEncontrada, 18).setValue(body.concluidoPor || 'Financeiro (n8n)'); // FeitoPor

    if (Array.isArray(body.anexos) && body.anexos.length) {
      const anexosNovos = processarAnexos(body.anexos);
      aba.getRange(linhaEncontrada, 16).setValue(JSON.stringify(anexosNovos)); // Anexos
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- HELPERS ----------

function formatarColunasComoTexto(aba, ranges) {
  ranges.forEach((r) => aba.getRange(r).setNumberFormat('@'));
}

function gerarId(prefixo) {
  return prefixo + new Date().getTime();
}

function formatarDataSaida(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString();
}

function processarAnexos(lista) {
  if (!Array.isArray(lista) || !lista.length) return [];
  return lista.map((a) => salvarAnexo(a.base64, a.tipo, a.nome));
}

function salvarAnexo(base64, tipo, nome) {
  const pasta = obterPastaAnexos();
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, tipo || 'application/octet-stream', nome || 'anexo');
  const arquivo = pasta.createFile(blob);
  try {
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    // segue mesmo assim — pode ser bloqueado por política do Workspace
  }
  return {
    nome: nome || arquivo.getName(),
    url: arquivo.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + arquivo.getId(),
  };
}

function obterPastaAnexos() {
  return DriveApp.getFolderById(PASTA_ANEXOS_ID);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
