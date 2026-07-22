// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// numa planilha nova (ex: "Solicitações Financeiro"). NUNCA preencha os valores
// abaixo com os reais aqui — deixe só no Apps Script (ambiente do Google, fora
// deste repositório) e no .env do hub (que já é ignorado pelo Git).
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// ID da pasta do Google Drive onde os anexos (Registro e Reembolso) ficam
// salvos — crie uma pasta no Drive, abra ela, e copie o ID que aparece na
// URL (.../folders/ESSE_ID_AQUI). Precisa ser uma pasta que a conta Google
// dona deste Apps Script tenha acesso de edição.
const PASTA_ANEXOS_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

const ABA_REGISTRO = 'Registro';
const ABA_REEMBOLSO = 'Reembolso';

// Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
// única autenticação aqui é o segredo compartilhado, sem login de usuário.

function doGet(e) {
  const p = e.parameter;
  try {
    if (p.segredo !== SEGREDO_HUB) return out({ erro: 'Nao autorizado' });
    // "list"/"listReembolso" devolvem um array cru (não {ok, itens:...}) —
    // é o formato que o front-end do hub já espera pra essas duas ações.
    if (p.action === 'list') return out(listarRegistros());
    if (p.action === 'listReembolso') return out(listarReembolsos());
    return out({ erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ erro: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (body.action === 'create') return out(criarRegistro(body));
    if (body.action === 'createReembolso') return out(criarReembolso(body));
    if (body.action === 'marcar') {
      return out(marcarGenerico({ nomeAba: ABA_REGISTRO, colStatus: 14, colFeitoPor: 15, colAnexos: 13 }, body));
    }
    if (body.action === 'marcarReembolso') {
      return out(marcarGenerico({ nomeAba: ABA_REEMBOLSO, colStatus: 16, colFeitoPor: 17, colAnexos: 15 }, body));
    }
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

// ---------- REGISTRO ----------
// Colunas (1-indexed): ID, Data, DataVencimento, IDCompra, LinkCard,
// Solicitante, Empresa, NumeroCorporativo, TipoDemanda, DemandaSolicitada,
// Observacao, Email, Anexos, Status, FeitoPor, InseridoEm.

function getAbaRegistro(ss) {
  let aba = ss.getSheetByName(ABA_REGISTRO);
  if (!aba) {
    aba = ss.insertSheet(ABA_REGISTRO);
    aba.appendRow([
      'ID', 'Data', 'DataVencimento', 'IDCompra', 'LinkCard', 'Solicitante', 'Empresa',
      'NumeroCorporativo', 'TipoDemanda', 'DemandaSolicitada', 'Observacao', 'Email',
      'Anexos', 'Status', 'FeitoPor', 'InseridoEm',
    ]);
    formatarColunasComoTexto(aba, ['D2:D', 'H2:H']); // IDCompra, NumeroCorporativo
  }
  return aba;
}

function criarRegistro(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaRegistro(ss);
  const id = gerarId('RD');
  const anexos = processarAnexos(body.anexos);

  aba.appendRow([
    id,
    body.data || '',
    body.dataVencimento || '',
    body.idCompra || '',
    body.linkCard || '',
    body.solicitante || '',
    body.empresa || '',
    body.numeroCorporativo || '',
    body.tipoDemanda || '',
    body.demandaSolicitada || '',
    body.observacao || '',
    body.email || '',
    JSON.stringify(anexos),
    'Pendente',
    '',
    new Date(),
  ]);

  return { ok: true, id: id, anexos: anexos };
}

function linhaParaRegistro(r) {
  return {
    ID: String(r[0]),
    Data: formatarDataSaida(r[1]),
    DataVencimento: formatarDataSaida(r[2]),
    IDCompra: String(r[3] || ''),
    LinkCard: String(r[4] || ''),
    Solicitante: String(r[5] || ''),
    Empresa: String(r[6] || ''),
    NumeroCorporativo: String(r[7] || ''),
    TipoDemanda: String(r[8] || ''),
    DemandaSolicitada: String(r[9] || ''),
    Observacao: String(r[10] || ''),
    Email: String(r[11] || ''),
    Anexos: String(r[12] || '[]'),
    Status: String(r[13] || 'Pendente'),
    FeitoPor: String(r[14] || ''),
    InseridoEm: formatarDataSaida(r[15]),
  };
}

function listarRegistros() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaRegistro(ss);
  const linhas = aba.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  return linhas.map(linhaParaRegistro);
}

// ---------- REEMBOLSO ----------
// Colunas (1-indexed): ID, DataVencimento, IDReferencia, CPFCNPJ, Email,
// MotivoReembolso, RazaoSocialCliente, Banco, Agencia, Conta, ChavePix,
// TipoChave, Valor, EmpresaResponsavel, Anexos, Status, FeitoPor, InseridoEm.

function getAbaReembolso(ss) {
  let aba = ss.getSheetByName(ABA_REEMBOLSO);
  if (!aba) {
    aba = ss.insertSheet(ABA_REEMBOLSO);
    aba.appendRow([
      'ID', 'DataVencimento', 'IDReferencia', 'CPFCNPJ', 'Email', 'MotivoReembolso',
      'RazaoSocialCliente', 'Banco', 'Agencia', 'Conta', 'ChavePix', 'TipoChave',
      'Valor', 'EmpresaResponsavel', 'Anexos', 'Status', 'FeitoPor', 'InseridoEm',
    ]);
    // IDReferencia, CPFCNPJ, Agencia, Conta, ChavePix
    formatarColunasComoTexto(aba, ['C2:C', 'D2:D', 'I2:I', 'J2:J', 'K2:K']);
  }
  return aba;
}

function criarReembolso(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaReembolso(ss);
  const id = gerarId('RB');
  const anexos = processarAnexos(body.anexos);

  aba.appendRow([
    id,
    body.dataVencimento || '',
    body.id || '', // referência digitada pelo solicitante (não é o ID interno)
    body.cpfCnpj || '',
    body.email || '',
    body.motivo || '',
    body.razaoSocial || '',
    body.banco || '',
    body.agencia || '',
    body.conta || '',
    body.chavePix || '',
    body.tipoChave || '',
    Number(body.valor) || 0,
    body.empresaResponsavel || '',
    JSON.stringify(anexos),
    'Pendente',
    '',
    new Date(),
  ]);

  return { ok: true, id: id, anexos: anexos };
}

function linhaParaReembolso(r) {
  return {
    ID: String(r[0]),
    DataVencimento: formatarDataSaida(r[1]),
    IDReferencia: String(r[2] || ''),
    CPFCNPJ: String(r[3] || ''),
    Email: String(r[4] || ''),
    MotivoReembolso: String(r[5] || ''),
    RazaoSocialCliente: String(r[6] || ''),
    Banco: String(r[7] || ''),
    Agencia: String(r[8] || ''),
    Conta: String(r[9] || ''),
    ChavePix: String(r[10] || ''),
    TipoChave: String(r[11] || ''),
    Valor: Number(r[12]) || 0,
    EmpresaResponsavel: String(r[13] || ''),
    Anexos: String(r[14] || '[]'),
    Status: String(r[15] || 'Pendente'),
    FeitoPor: String(r[16] || ''),
    InseridoEm: formatarDataSaida(r[17]),
  };
}

function listarReembolsos() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaReembolso(ss);
  const linhas = aba.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  return linhas.map(linhaParaReembolso);
}

// ---------- MARCAR (Registro e Reembolso compartilham a mesma lógica) ----------
// Além de status/feitoPor, aceita um "anexos" opcional (base64) — usado
// pelo webhook de retorno do n8n pra anexar o comprovante (PDF/imagem) sem
// substituir os anexos originais da solicitação.

function marcarGenerico(cfg, body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = ss.getSheetByName(cfg.nomeAba);
    const dados = aba.getDataRange().getValues();

    let linhaEncontrada = -1;
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][0]) === String(body.id)) {
        linhaEncontrada = i + 1;
        break;
      }
    }
    if (linhaEncontrada === -1) {
      return { ok: false, erro: 'Solicitação não encontrada: ' + body.id };
    }

    if (body.status) aba.getRange(linhaEncontrada, cfg.colStatus).setValue(body.status);
    if (body.marcadoPor !== undefined) aba.getRange(linhaEncontrada, cfg.colFeitoPor).setValue(body.marcadoPor || '');

    if (body.anexos && body.anexos.length) {
      const anexosNovos = processarAnexos(body.anexos);
      const celAnexos = aba.getRange(linhaEncontrada, cfg.colAnexos);
      let anexosAtuais = [];
      try { anexosAtuais = JSON.parse(celAnexos.getValue() || '[]'); } catch (e) {}
      celAnexos.setValue(JSON.stringify(anexosAtuais.concat(anexosNovos)));
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- HELPERS ----------

// Evita que o Sheets "auto-converta" campo de referência/documento que
// parece número (ex: agência "0001", CPF, chave pix) — sem isso, o Sheets
// vira número sozinho e come o zero à esquerda (bug real, achado testando:
// "0001" virou "1"). Só roda na criação da aba; se a aba já existia antes
// dessa correção, rode corrigirFormatoTextoExistente() uma vez manualmente.
function formatarColunasComoTexto(aba, ranges) {
  ranges.forEach((r) => aba.getRange(r).setNumberFormat('@'));
}

// Rode esta função UMA VEZ manualmente (▶ Executar) se a aba Reembolso já
// tinha sido criada antes dessa correção — reformata as colunas existentes
// pra texto (não mexe nos valores já salvos, só formatação; se algum já
// virou número, corrija a célula manualmente depois).
function corrigirFormatoTextoExistente() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const abaRegistro = ss.getSheetByName(ABA_REGISTRO);
  if (abaRegistro) formatarColunasComoTexto(abaRegistro, ['D2:D', 'H2:H']);
  const abaReembolso = ss.getSheetByName(ABA_REEMBOLSO);
  if (abaReembolso) formatarColunasComoTexto(abaReembolso, ['C2:C', 'D2:D', 'I2:I', 'J2:J', 'K2:K']);
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
  if (!lista || !lista.length) return [];
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
  const pasta = DriveApp.getFolderById(PASTA_ANEXOS_ID);
  return pasta;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
