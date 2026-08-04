// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// preso à planilha que já tem as abas "Agenda" (Foco da Semana + Agenda da
// Semana) e "KPI" (Ranking SAC). NUNCA preencha os valores abaixo com os reais
// aqui — deixe só no Apps Script (ambiente do Google, fora deste repositório)
// e no .env do hub (que já é ignorado pelo Git).
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Só o hub chama este Apps Script (nunca o navegador direto) — por isso a
// única autenticação aqui é o segredo compartilhado, sem login de usuário.
// Quem pode editar (só gestor) já foi decidido no servidor do hub antes de
// chegar aqui.

function doGet(e) {
  const p = e.parameter;
  try {
    if (p.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (p.action === 'ler') return out({ ok: true, dados: lerFocoAgenda() });
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.segredo !== SEGREDO_HUB) return out({ ok: false, erro: 'Nao autorizado' });
    if (body.action === 'salvarFoco') return out(salvarFoco(body.texto));
    if (body.action === 'adicionarEvento') return out(adicionarEvento(body.dia, body.hora, body.descricao, body.tipo));
    if (body.action === 'editarEvento') return out(editarEvento(body.linha, body.dia, body.hora, body.descricao, body.tipo));
    if (body.action === 'excluirEvento') return out(excluirEvento(body.linha));
    return out({ ok: false, erro: 'Acao desconhecida' });
  } catch (err) {
    return out({ ok: false, erro: err.message });
  }
}

// A aba "AGENDA E FOCO" já existe na planilha, com este layout (colunas A-D):
//   linha 1: "FOCO DA SEMANA"
//   linha 2: texto do foco atual
//   linha 3: em branco
//   linha 4: cabeçalho "Dia,Horário,Descrição,Tipo"
//   linha 5+: um evento por linha (pode ter linhas em branco entre eles)
// As colunas F-I têm uma tabela antiga (compromissos "1:1") que a Home nunca
// leu — as funções abaixo não tocam nela, só nas colunas A-D.
function getAbaAgenda(ss) {
  return ss.getSheetByName('AGENDA E FOCO');
}

// Célula de horário formatada como "hora" no Sheets vem como objeto Date
// (com a data zero do Sheets, 30/12/1899) em vez de texto — pega hora/
// minuto direto do objeto (getHours/getMinutes, sem Utilities.formatDate
// e sem informar nome de fuso) porque essa data zero usa um fuso histórico
// estranho; getHours()/getMinutes() já leem certo o "relógio de parede"
// pretendido, sem precisar converter nada. Se já vier como texto puro
// (linha nova digitada via API), usa direto.
function formatarHora(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    const h = String(v.getHours()).padStart(2, '0');
    const m = String(v.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  return String(v || '').trim();
}

function lerFocoAgenda() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaAgenda(ss);
  if (!aba) return { foco: '', eventos: [] };

  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return { foco: '', eventos: [] };

  const rows = aba.getRange(1, 1, ultimaLinha, 4).getValues();
  const foco = String(rows[1] ? rows[1][0] : '').trim();

  const headerIdx = rows.findIndex((r) => String(r[0] || '').trim().toLowerCase() === 'dia');
  const eventos = [];
  if (headerIdx !== -1) {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const dia = String(r[0] || '').trim();
      const descricao = String(r[2] || '').trim();
      if (!dia || !descricao) continue; // linha em branco/separadora
      eventos.push({
        linha: i + 1, // 1-indexed — usado pra editar/excluir esse evento depois
        dia: dia,
        hora: formatarHora(r[1]),
        descricao: descricao,
        tipo: String(r[3] || '').trim() || 'Outro',
      });
    }
  }
  return { foco: foco, eventos: eventos };
}

function salvarFoco(texto) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaAgenda(ss);
  if (!aba) return { ok: false, erro: 'Aba Agenda nao encontrada.' };
  aba.getRange(2, 1).setValue(String(texto || ''));
  return { ok: true };
}

function adicionarEvento(dia, hora, descricao, tipo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaAgenda(ss);
  if (!aba) return { ok: false, erro: 'Aba Agenda nao encontrada.' };
  if (!dia || !descricao) return { ok: false, erro: 'Informe pelo menos dia e descricao.' };
  aba.appendRow([dia, hora || '', descricao, tipo || 'Outro']);
  return { ok: true };
}

function editarEvento(linha, dia, hora, descricao, tipo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaAgenda(ss);
  if (!aba) return { ok: false, erro: 'Aba Agenda nao encontrada.' };
  const linhaNum = parseInt(linha);
  if (!linhaNum || linhaNum < 1) return { ok: false, erro: 'Linha invalida.' };
  aba.getRange(linhaNum, 1, 1, 4).setValues([[dia || '', hora || '', descricao || '', tipo || 'Outro']]);
  return { ok: true };
}

function excluirEvento(linha) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaAgenda(ss);
  if (!aba) return { ok: false, erro: 'Aba Agenda nao encontrada.' };
  const linhaNum = parseInt(linha);
  if (!linhaNum || linhaNum < 1) return { ok: false, erro: 'Linha invalida.' };
  // Limpa só as colunas A-D (o resto da linha, se tiver algo nas colunas
  // F-I do legado, fica intocado) — mais seguro que deletar a linha, que
  // deslocaria o numero de linha de todo mundo depois dela.
  aba.getRange(linhaNum, 1, 1, 4).clearContent();
  return { ok: true };
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
