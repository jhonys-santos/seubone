// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// na própria planilha. NUNCA preencha os dois valores abaixo com os reais aqui
// — deixe só no Apps Script (ambiente do Google, fora deste repositório) e no
// .env do hub (que já é ignorado pelo Git).
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
// única autenticação aqui é o segredo compartilhado, sem login de usuário.
// Quem pode ver o quê já foi decidido no servidor do hub antes de chegar aqui.

function doGet(e) {
  const p = e.parameter;
  try {
    if (p.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (p.action === 'lista') {
      return out({ ok: true, itens: listarQuitacoes(p.status, p.desde, p.ate) });
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
    if (body.action === 'cadastrar') return out(cadastrarQuitacao(body));
    if (body.action === 'marcarPago') return out(marcarPago(body.id));
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

function getAbaQuitacoes(ss) {
  let aba = ss.getSheetByName('Quitacoes');
  if (!aba) {
    aba = ss.insertSheet('Quitacoes');
    aba.appendRow([
      'id', 'dataCadastro', 'idVendaOmie', 'cliente', 'dataPrevista', 'linkCrm', 'modalidade',
      'tipoEnvioAereo', 'aeroporto', 'freteDedicado', 'transportadora', 'entregador',
      'observacao', 'cadastradoPorSlug', 'cadastradoPorNome', 'status', 'dataPagamento',
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
    idVendaOmie: String(r[2] || ''),
    cliente: String(r[3] || ''),
    dataPrevista: ehData(r[4]) ? r[4].toISOString().slice(0, 10) : (r[4] ? String(r[4]) : ''),
    linkCrm: String(r[5] || ''),
    modalidade: String(r[6] || ''),
    tipoEnvioAereo: String(r[7] || ''),
    aeroporto: String(r[8] || ''),
    freteDedicado: String(r[9]).toLowerCase().trim() === 'true',
    transportadora: String(r[10] || ''),
    entregador: String(r[11] || ''),
    observacao: String(r[12] || ''),
    cadastradoPorSlug: String(r[13] || ''),
    cadastradoPorNome: String(r[14] || ''),
    status: String(r[15] || 'pendente'),
    dataPagamento: ehData(r[16]) ? r[16].toISOString() : (r[16] ? String(r[16]) : ''),
  };
}

function listarQuitacoes(status, desdeStr, ateStr) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaQuitacoes(ss);
  const rows = aba.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  let itens = rows.map(linhaParaItem).filter((it) => it.status === (status || 'pendente'));

  if (desdeStr || ateStr) {
    const desde = desdeStr ? new Date(desdeStr + 'T00:00:00') : null;
    const ate = ateStr ? new Date(ateStr + 'T23:59:59') : null;
    itens = itens.filter((it) => {
      const ref = it.dataPagamento ? new Date(it.dataPagamento) : new Date(it.dataCadastro);
      if (desde && ref < desde) return false;
      if (ate && ref > ate) return false;
      return true;
    });
  }

  itens.sort((a, b) => new Date(b.dataCadastro) - new Date(a.dataCadastro));
  return itens;
}

function gerarIdQuitacao() {
  return 'QT' + new Date().getTime();
}

function cadastrarQuitacao(body) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaQuitacoes(ss);
  const id = gerarIdQuitacao();
  aba.appendRow([
    id,
    new Date(),
    body.idVendaOmie || '',
    body.cliente || '',
    body.dataPrevista || '',
    body.linkCrm || '',
    body.modalidade || '',
    body.tipoEnvioAereo || '',
    body.aeroporto || '',
    body.freteDedicado ? 'true' : 'false',
    body.transportadora || '',
    body.entregador || '',
    body.observacao || '',
    body.cadastradoPorSlug || '',
    body.cadastradoPorNome || '',
    'pendente',
    '',
  ]);
  return { ok: true, id: id };
}

function marcarPago(id) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaQuitacoes(ss);
  const rows = aba.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      aba.getRange(i + 1, 16).setValue('pago');
      aba.getRange(i + 1, 17).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, erro: 'Pedido nao encontrado.' };
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
