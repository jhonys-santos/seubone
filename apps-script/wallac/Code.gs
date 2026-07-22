/**
 * Painel de Produção - Wallac
 * Projeto Apps Script isolado (não compartilha deploy com outros painéis)
 *
 * Duas origens de card no mesmo kanban:
 * 1) Compra (aba LTV, filtrada por coluna M = "Wallac")        -> chave "ltv-<linha>"
 * 2) Solicitação de personalização a partir do estoque          -> chave "est-<linha>"
 *    (aba Solicitacoes_Estoque, alimentada pelo formulário)
 */

const SHEET_ID = '1iZ-n84hy4RRNHtkrEHG0mWVGRLi_juvbdhaiR7U9T20';
const ABA_LTV = 'LTV';
const ABA_STATUS = 'Status_Producao_Wallac';
const ABA_ESTOQUE = 'Estoque';
const ABA_SOLICITACOES = 'Solicitacoes_Estoque';
const ABA_PREMIACAO_HISTORICO = 'Premiacao_Historico';
const PERSONALIZADOR = 'Wallac';
const PASTA_LOGOS = 'Logos_Solicitacoes_Wallac';

// Colunas da aba LTV (1-indexed)
const COL_LTV = {
  PRAZO_PRODUCAO: 4,   // D
  PRAZO_ENTREGA: 5,    // E
  ID_VENDA: 6,         // F
  NOME_CARD: 7,        // G
  QUANTIDADE: 9,       // I
  PRODUTO: 10,         // J
  PERSONALIZADOR: 13   // M
};

// Colunas da aba Status_Producao_Wallac (1-indexed)
const COL_STATUS = {
  LINHA_LTV: 1,             // A
  STATUS_ATUAL: 2,          // B
  DATA_RECEBIDO: 3,         // C
  DATA_INICIO_PRODUCAO: 4,  // D
  DATA_FINALIZADO: 5        // E
};

// Colunas da aba Estoque (1-indexed) - crie com esses cabeçalhos:
// A: Produto | B: Quantidade disponível
const COL_ESTOQUE = {
  PRODUTO: 1,
  QUANTIDADE: 2
};

// Colunas da aba Solicitacoes_Estoque (1-indexed) - crie com esses cabeçalhos:
// A: Produto | B: Quantidade | C: ID venda/Cliente | D: Prazo de produção | E: Prazo de entrega
// F: Observações | G: Logo (URL) | H: Status atual | I: Data recebido | J: Data início produção | K: Data finalizado
const COL_SOLICITACAO = {
  PRODUTO: 1,
  QUANTIDADE: 2,
  ID_VENDA_CLIENTE: 3,
  PRAZO_PRODUCAO: 4,
  PRAZO_ENTREGA: 5,
  OBSERVACOES: 6,
  LOGO_URL: 7,
  STATUS_ATUAL: 8,
  DATA_RECEBIDO: 9,
  DATA_INICIO_PRODUCAO: 10,
  DATA_FINALIZADO: 11
};

const STATUS = {
  A_CHEGAR: 'A chegar',
  RECEBIDO: 'Recebido',
  EM_PRODUCAO: 'Em produção',
  FINALIZADO: 'Finalizado'
};

function doGet(e) {
  try {
    const acao = e.parameter.acao;
    if (acao === 'estoque') {
      return responderJSON({ ok: true, produtos: buscarProdutosDisponiveis() });
    }
    if (acao === 'estoque_admin') {
      return responderJSON({ ok: true, itens: buscarEstoqueCompleto() });
    }
    if (acao === 'premiacao_historico') {
      return responderJSON({ ok: true, historico: premiacaoHistorico() });
    }
    if (acao === 'premiacao_semana_atual') {
      return responderJSON({ ok: true, semana: premiacaoSemanaAtual() });
    }
    return responderJSON({ ok: true, cards: buscarCards() });
  } catch (err) {
    return responderJSON({ ok: false, erro: err.message });
  }
}

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);

    if (dados.acao === 'solicitar_personalizacao') {
      return responderJSON(solicitarPersonalizacao(dados));
    }
    if (dados.acao === 'mudar_status') {
      atualizarStatus(dados.chave, dados.novo_status);
      return responderJSON({ ok: true });
    }
    if (dados.acao === 'estoque_adicionar') {
      return responderJSON(adicionarProdutoEstoque(dados));
    }
    if (dados.acao === 'estoque_editar') {
      return responderJSON(editarProdutoEstoque(dados));
    }
    if (dados.acao === 'estoque_remover') {
      return responderJSON(removerProdutoEstoque(dados));
    }
    return responderJSON({ ok: false, erro: 'Ação inválida: ' + dados.acao });
  } catch (err) {
    return responderJSON({ ok: false, erro: err.message });
  }
}

function responderJSON(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- LEITURA DO KANBAN (duas origens) ----------

function buscarCards() {
  return buscarCardsCompra().concat(buscarCardsEstoque());
}

function buscarCardsCompra() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const abaLtv = ss.getSheetByName(ABA_LTV);
  const abaStatus = ss.getSheetByName(ABA_STATUS);

  const dadosLtv = abaLtv.getDataRange().getValues();
  const dadosStatus = abaStatus.getDataRange().getValues();

  const mapaStatus = {};
  for (let i = 1; i < dadosStatus.length; i++) {
    const linha = dadosStatus[i][COL_STATUS.LINHA_LTV - 1];
    if (linha) {
      mapaStatus[linha] = dadosStatus[i][COL_STATUS.STATUS_ATUAL - 1] || STATUS.A_CHEGAR;
    }
  }

  const cards = [];
  for (let i = 1; i < dadosLtv.length; i++) {
    const linhaAtual = i + 1;
    const personalizador = dadosLtv[i][COL_LTV.PERSONALIZADOR - 1];
    if (String(personalizador).trim().toUpperCase() !== PERSONALIZADOR.toUpperCase()) continue;

    const idVenda = dadosLtv[i][COL_LTV.ID_VENDA - 1];
    if (!idVenda) continue;

    cards.push({
      chave: 'ltv-' + linhaAtual,
      origem: 'compra',
      id_venda: idVenda,
      nome_card: dadosLtv[i][COL_LTV.NOME_CARD - 1],
      produto: dadosLtv[i][COL_LTV.PRODUTO - 1],
      quantidade: dadosLtv[i][COL_LTV.QUANTIDADE - 1],
      prazo_producao: formatarData(dadosLtv[i][COL_LTV.PRAZO_PRODUCAO - 1]),
      prazo_entrega: formatarData(dadosLtv[i][COL_LTV.PRAZO_ENTREGA - 1]),
      observacoes: '',
      logo_url: '',
      status: mapaStatus[linhaAtual] || STATUS.A_CHEGAR
    });
  }
  return cards;
}

function buscarCardsEstoque() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName(ABA_SOLICITACOES);
  if (!aba) return [];

  const dados = aba.getDataRange().getValues();
  const cards = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const produto = linha[COL_SOLICITACAO.PRODUTO - 1];
    if (!produto) continue;

    cards.push({
      chave: 'est-' + (i + 1),
      origem: 'estoque',
      id_venda: linha[COL_SOLICITACAO.ID_VENDA_CLIENTE - 1] || '(sem ref.)',
      nome_card: '',
      produto: produto,
      quantidade: linha[COL_SOLICITACAO.QUANTIDADE - 1],
      prazo_producao: formatarData(linha[COL_SOLICITACAO.PRAZO_PRODUCAO - 1]),
      prazo_entrega: formatarData(linha[COL_SOLICITACAO.PRAZO_ENTREGA - 1]),
      observacoes: linha[COL_SOLICITACAO.OBSERVACOES - 1] || '',
      logo_url: linha[COL_SOLICITACAO.LOGO_URL - 1] || '',
      status: linha[COL_SOLICITACAO.STATUS_ATUAL - 1] || STATUS.RECEBIDO
    });
  }
  return cards;
}

function formatarData(valor) {
  if (!valor) return null;
  const d = (valor instanceof Date) ? valor : new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ---------- MUDANÇA DE STATUS (kanban) ----------

function atualizarStatus(chave, novoStatus) {
  if (chave.indexOf('ltv-') === 0) {
    atualizarStatusCompra(Number(chave.replace('ltv-', '')), novoStatus);
  } else if (chave.indexOf('est-') === 0) {
    atualizarStatusEstoqueCard(Number(chave.replace('est-', '')), novoStatus);
  } else {
    throw new Error('Chave inválida: ' + chave);
  }
}

function atualizarStatusCompra(linhaLtv, novoStatus) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const abaStatus = ss.getSheetByName(ABA_STATUS);
    const dados = abaStatus.getDataRange().getValues();

    let linhaEncontrada = -1;
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][COL_STATUS.LINHA_LTV - 1] == linhaLtv) {
        linhaEncontrada = i + 1;
        break;
      }
    }

    const agora = new Date();

    if (linhaEncontrada === -1) {
      const novaLinha = [linhaLtv, novoStatus, '', '', ''];
      if (novoStatus === STATUS.RECEBIDO) novaLinha[COL_STATUS.DATA_RECEBIDO - 1] = agora;
      if (novoStatus === STATUS.EM_PRODUCAO) novaLinha[COL_STATUS.DATA_INICIO_PRODUCAO - 1] = agora;
      if (novoStatus === STATUS.FINALIZADO) novaLinha[COL_STATUS.DATA_FINALIZADO - 1] = agora;
      abaStatus.appendRow(novaLinha);
    } else {
      abaStatus.getRange(linhaEncontrada, COL_STATUS.STATUS_ATUAL).setValue(novoStatus);
      if (novoStatus === STATUS.RECEBIDO) abaStatus.getRange(linhaEncontrada, COL_STATUS.DATA_RECEBIDO).setValue(agora);
      if (novoStatus === STATUS.EM_PRODUCAO) abaStatus.getRange(linhaEncontrada, COL_STATUS.DATA_INICIO_PRODUCAO).setValue(agora);
      if (novoStatus === STATUS.FINALIZADO) abaStatus.getRange(linhaEncontrada, COL_STATUS.DATA_FINALIZADO).setValue(agora);
    }
  } finally {
    lock.releaseLock();
  }
}

function atualizarStatusEstoqueCard(linhaSolicitacao, novoStatus) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = ss.getSheetByName(ABA_SOLICITACOES);
    const agora = new Date();

    aba.getRange(linhaSolicitacao, COL_SOLICITACAO.STATUS_ATUAL).setValue(novoStatus);
    if (novoStatus === STATUS.RECEBIDO) aba.getRange(linhaSolicitacao, COL_SOLICITACAO.DATA_RECEBIDO).setValue(agora);
    if (novoStatus === STATUS.EM_PRODUCAO) aba.getRange(linhaSolicitacao, COL_SOLICITACAO.DATA_INICIO_PRODUCAO).setValue(agora);
    if (novoStatus === STATUS.FINALIZADO) aba.getRange(linhaSolicitacao, COL_SOLICITACAO.DATA_FINALIZADO).setValue(agora);
  } finally {
    lock.releaseLock();
  }
}

// ---------- ESTOQUE E SOLICITAÇÃO DE PERSONALIZAÇÃO ----------

function buscarProdutosDisponiveis() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName(ABA_ESTOQUE);
  const dados = aba.getDataRange().getValues();

  const produtos = [];
  for (let i = 1; i < dados.length; i++) {
    const nome = dados[i][COL_ESTOQUE.PRODUTO - 1];
    const qtd = Number(dados[i][COL_ESTOQUE.QUANTIDADE - 1]) || 0;
    if (nome && qtd > 0) {
      produtos.push({ produto: nome, quantidade_disponivel: qtd });
    }
  }
  return produtos;
}

function solicitarPersonalizacao(dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const abaEstoque = ss.getSheetByName(ABA_ESTOQUE);
    const abaSolicitacoes = ss.getSheetByName(ABA_SOLICITACOES);

    const qtdSolicitada = Number(dados.quantidade);
    if (!dados.produto || !qtdSolicitada || qtdSolicitada <= 0) {
      return { ok: false, erro: 'Produto e quantidade são obrigatórios.' };
    }
    if (!dados.id_venda_cliente || !dados.prazo_producao || !dados.prazo_entrega) {
      return { ok: false, erro: 'ID venda/Cliente, prazo de produção e prazo de entrega são obrigatórios.' };
    }
    if (!dados.logo_base64) {
      return { ok: false, erro: 'A imagem do logo é obrigatória.' };
    }

    const ehOutro = !!dados.eh_outro;

    if (!ehOutro) {
      const dadosEstoque = abaEstoque.getDataRange().getValues();
      let linhaEstoque = -1;
      let qtdAtual = 0;
      for (let i = 1; i < dadosEstoque.length; i++) {
        if (String(dadosEstoque[i][COL_ESTOQUE.PRODUTO - 1]).trim() === String(dados.produto).trim()) {
          linhaEstoque = i + 1;
          qtdAtual = Number(dadosEstoque[i][COL_ESTOQUE.QUANTIDADE - 1]) || 0;
          break;
        }
      }
      if (linhaEstoque === -1) {
        return { ok: false, erro: 'Produto não encontrado no estoque.' };
      }
      if (qtdAtual < qtdSolicitada) {
        return { ok: false, erro: 'Estoque insuficiente. Disponível: ' + qtdAtual + '.' };
      }
      abaEstoque.getRange(linhaEstoque, COL_ESTOQUE.QUANTIDADE).setValue(qtdAtual - qtdSolicitada);
    }

    const logoUrl = salvarLogo(dados.logo_base64, dados.logo_nome || 'logo.png');

    const agora = new Date();
    abaSolicitacoes.appendRow([
      dados.produto,
      qtdSolicitada,
      dados.id_venda_cliente || '',
      dados.prazo_producao || '',
      dados.prazo_entrega || '',
      dados.observacoes || '',
      logoUrl,
      STATUS.RECEBIDO,
      agora,
      '',
      ''
    ]);

    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  } finally {
    lock.releaseLock();
  }
}

function salvarLogo(base64Data, nomeArquivo) {
  const partesBase64 = base64Data.indexOf(',') > -1 ? base64Data.split(',')[1] : base64Data;
  const blob = Utilities.newBlob(Utilities.base64Decode(partesBase64), 'image/png', nomeArquivo);
  const pasta = obterPastaLogos();
  const arquivo = pasta.createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?id=' + arquivo.getId();
}

function obterPastaLogos() {
  const pastas = DriveApp.getFoldersByName(PASTA_LOGOS);
  if (pastas.hasNext()) return pastas.next();
  return DriveApp.createFolder(PASTA_LOGOS);
}

// ---------- GESTÃO DE ESTOQUE (adicionar / editar / remover) ----------

function buscarEstoqueCompleto() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName(ABA_ESTOQUE);
  const dados = aba.getDataRange().getValues();

  const itens = [];
  for (let i = 1; i < dados.length; i++) {
    const produto = dados[i][COL_ESTOQUE.PRODUTO - 1];
    if (!produto) continue;
    itens.push({
      linha: i + 1,
      produto: produto,
      quantidade: Number(dados[i][COL_ESTOQUE.QUANTIDADE - 1]) || 0
    });
  }
  return itens;
}

function adicionarProdutoEstoque(dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!dados.produto || !String(dados.produto).trim()) {
      return { ok: false, erro: 'Nome do produto é obrigatório.' };
    }
    const qtd = Number(dados.quantidade);
    if (isNaN(qtd) || qtd < 0) {
      return { ok: false, erro: 'Quantidade inválida.' };
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = ss.getSheetByName(ABA_ESTOQUE);
    const dadosAtuais = aba.getDataRange().getValues();

    for (let i = 1; i < dadosAtuais.length; i++) {
      if (String(dadosAtuais[i][COL_ESTOQUE.PRODUTO - 1]).trim().toUpperCase() === String(dados.produto).trim().toUpperCase()) {
        return { ok: false, erro: 'Esse produto já existe no estoque. Edite a linha existente em vez de criar outra.' };
      }
    }

    aba.appendRow([dados.produto.trim(), qtd]);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  } finally {
    lock.releaseLock();
  }
}

function editarProdutoEstoque(dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const linha = Number(dados.linha);
    if (!linha || linha < 2) {
      return { ok: false, erro: 'Linha inválida.' };
    }
    if (!dados.produto || !String(dados.produto).trim()) {
      return { ok: false, erro: 'Nome do produto é obrigatório.' };
    }
    const qtd = Number(dados.quantidade);
    if (isNaN(qtd) || qtd < 0) {
      return { ok: false, erro: 'Quantidade inválida.' };
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = ss.getSheetByName(ABA_ESTOQUE);
    aba.getRange(linha, COL_ESTOQUE.PRODUTO).setValue(dados.produto.trim());
    aba.getRange(linha, COL_ESTOQUE.QUANTIDADE).setValue(qtd);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  } finally {
    lock.releaseLock();
  }
}

function removerProdutoEstoque(dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const linha = Number(dados.linha);
    if (!linha || linha < 2) {
      return { ok: false, erro: 'Linha inválida.' };
    }
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = ss.getSheetByName(ABA_ESTOQUE);
    aba.deleteRow(linha);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ---------- PREMIAÇÃO (SB Coin) ----------
// Fecha toda sexta-feira às 16h30 (gatilho automático, ver
// configurarGatilhoPremiacao) e responde à ação "premiacao_historico"
// chamada pela tela de Premiação no hub.
//
// Regra: soma a QUANTIDADE (LTV coluna I) de todo card das duas origens
// do kanban (compra e estoque) que virou "Finalizado" dentro da semana E
// até o prazo de produção daquele card (comparando só a data, ignorando a
// hora). Faixas: <30 peças = Nenhuma (0 coins), 30-49 = Bronze (2 coins),
// 50-79 = Prata (4 coins), 80+ = Ouro (6 coins). Semana = segunda a sexta.

function premiacaoEhData(v) {
  return v instanceof Date && !isNaN(v.getTime());
}

// Mesma data ou antes, ignorando a hora — evita que "finalizado às 23h no
// próprio dia do prazo" conte como atrasado por causa da hora exata.
function premiacaoNoPrazo(dataFinalizado, prazoProducao) {
  if (!premiacaoEhData(dataFinalizado) || !premiacaoEhData(prazoProducao)) return false;
  const f = new Date(dataFinalizado.getFullYear(), dataFinalizado.getMonth(), dataFinalizado.getDate());
  const p = new Date(prazoProducao.getFullYear(), prazoProducao.getMonth(), prazoProducao.getDate());
  return f <= p;
}

// Segunda-feira (00:00) da semana de "d".
function premiacaoSegunda(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dia = date.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  date.setDate(date.getDate() + diff);
  return date;
}

function premiacaoCalcularSemana(segunda) {
  const sexta = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 4, 23, 59, 59, 999);
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let pecasNoPrazo = 0;

  // Origem 1: compra — o prazo de produção e a quantidade estão na LTV,
  // indexados pela mesma linha que Status_Producao_Wallac guarda em
  // LINHA_LTV (não é preciso cruzar por ID, é a própria linha da planilha).
  const dadosLtv = ss.getSheetByName(ABA_LTV).getDataRange().getValues();
  const dadosStatus = ss.getSheetByName(ABA_STATUS).getDataRange().getValues();
  for (let i = 1; i < dadosStatus.length; i++) {
    const linhaLtv = dadosStatus[i][COL_STATUS.LINHA_LTV - 1];
    const statusAtual = dadosStatus[i][COL_STATUS.STATUS_ATUAL - 1];
    const dataFinalizado = dadosStatus[i][COL_STATUS.DATA_FINALIZADO - 1];
    if (statusAtual !== STATUS.FINALIZADO || !premiacaoEhData(dataFinalizado)) continue;
    if (dataFinalizado < segunda || dataFinalizado > sexta) continue;

    const linhaDadosLtv = dadosLtv[linhaLtv - 1];
    if (!linhaDadosLtv) continue;
    const prazoProducao = linhaDadosLtv[COL_LTV.PRAZO_PRODUCAO - 1];
    if (!premiacaoNoPrazo(dataFinalizado, prazoProducao)) continue;

    pecasNoPrazo += Number(linhaDadosLtv[COL_LTV.QUANTIDADE - 1]) || 0;
  }

  // Origem 2: estoque — já tem prazo de produção e quantidade na própria
  // linha de Solicitacoes_Estoque.
  const abaSolic = ss.getSheetByName(ABA_SOLICITACOES);
  if (abaSolic) {
    const dadosSolic = abaSolic.getDataRange().getValues();
    for (let i = 1; i < dadosSolic.length; i++) {
      const linha = dadosSolic[i];
      const statusAtual = linha[COL_SOLICITACAO.STATUS_ATUAL - 1];
      const dataFinalizado = linha[COL_SOLICITACAO.DATA_FINALIZADO - 1];
      if (statusAtual !== STATUS.FINALIZADO || !premiacaoEhData(dataFinalizado)) continue;
      if (dataFinalizado < segunda || dataFinalizado > sexta) continue;

      // Prazo pode ter sido digitado como texto no formulário (não um
      // Date do Sheets) — trata os dois casos.
      const prazoBruto = linha[COL_SOLICITACAO.PRAZO_PRODUCAO - 1];
      const prazoProducao = premiacaoEhData(prazoBruto) ? prazoBruto : new Date(prazoBruto);
      if (!premiacaoNoPrazo(dataFinalizado, prazoProducao)) continue;

      pecasNoPrazo += Number(linha[COL_SOLICITACAO.QUANTIDADE - 1]) || 0;
    }
  }

  return pecasNoPrazo;
}

function premiacaoFaixaECoins(pecas) {
  if (pecas >= 80) return { faixa: 'Ouro', coins: 6 };
  if (pecas >= 50) return { faixa: 'Prata', coins: 4 };
  if (pecas >= 30) return { faixa: 'Bronze', coins: 2 };
  return { faixa: 'Nenhuma', coins: 0 };
}

function getAbaPremiacaoHistorico(ss) {
  let aba = ss.getSheetByName(ABA_PREMIACAO_HISTORICO);
  if (!aba) {
    aba = ss.insertSheet(ABA_PREMIACAO_HISTORICO);
    aba.appendRow(['semana_inicio', 'semana_fim', 'pecas_no_prazo', 'faixa', 'coins_da_semana', 'mes_referencia', 'coins_acumulados_no_mes']);
  }
  return aba;
}

// Progresso da semana em andamento (não grava nada — só calcula na hora
// pra tela de Premiação mostrar em tempo real, sem esperar sexta-feira).
function premiacaoSemanaAtual() {
  const segunda = premiacaoSegunda(new Date());
  const sexta = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 4);
  const pecas = premiacaoCalcularSemana(segunda);
  const resultado = premiacaoFaixaECoins(pecas);
  return {
    semana_inicio: Utilities.formatDate(segunda, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    semana_fim: Utilities.formatDate(sexta, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    pecas_no_prazo: pecas,
    faixa: resultado.faixa,
    coins_projetado: resultado.coins
  };
}

// Roda sozinha toda sexta 16h30 via gatilho (ver configurarGatilhoPremiacao).
function fecharSemanaPremiacao() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const hoje = new Date();
    const segunda = premiacaoSegunda(hoje);
    const sexta = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 4);
    const segundaStr = Utilities.formatDate(segunda, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const aba = getAbaPremiacaoHistorico(ss);

    // Evita duplicar se essa semana já foi fechada.
    const linhasExistentes = aba.getDataRange().getValues().slice(1);
    if (linhasExistentes.some((r) => String(r[0]) === segundaStr)) return;

    const pecas = premiacaoCalcularSemana(segunda);
    const resultado = premiacaoFaixaECoins(pecas);

    const mesReferencia = Utilities.formatDate(sexta, Session.getScriptTimeZone(), 'yyyy-MM');
    const coinsAcumuladosAntes = linhasExistentes
      .filter((r) => String(r[5]) === mesReferencia)
      .reduce((soma, r) => soma + (Number(r[4]) || 0), 0);

    aba.appendRow([
      segundaStr,
      Utilities.formatDate(sexta, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      pecas, resultado.faixa, resultado.coins, mesReferencia, coinsAcumuladosAntes + resultado.coins
    ]);
  } finally {
    lock.releaseLock();
  }
}

// Rode esta função UMA VEZ manualmente no editor (▶ Executar, selecionando
// ela no menu de funções) pra criar o gatilho semanal — não precisa rodar
// de novo depois disso.
function configurarGatilhoPremiacao() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'fecharSemanaPremiacao')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('fecharSemanaPremiacao')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(16)
    .nearMinute(30)
    .create();
}

function premiacaoHistorico() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaPremiacaoHistorico(ss);
  const linhas = aba.getDataRange().getValues().slice(1).filter((r) => r[0] !== '');
  return linhas.map((r) => ({
    semana_inicio: String(r[0]),
    semana_fim: String(r[1]),
    pecas_no_prazo: Number(r[2]) || 0,
    faixa: String(r[3]),
    coins_da_semana: Number(r[4]) || 0,
    mes_referencia: String(r[5]),
    coins_acumulados_no_mes: Number(r[6]) || 0
  }));
}
