// Histórico de cards Finalizados do SBP — usa a mesma lista de dados do
// kanban (/wallac/api/cards), filtrando por status no cliente e sem o
// limite de exibição que o board ativo tem (essa planilha não tem uma
// ação de histórico separada no Apps Script).

const API_BASE = '/wallac/api';
let finalizadosCache = [];
let termoHistorico = '';

function driveIdDeUrl(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : null;
}
function thumbDrive(url, tamanho) {
  const id = driveIdDeUrl(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=${tamanho}` : url;
}
function abrirLogo(url) {
  document.getElementById('lightboxImg').src = thumbDrive(url, 'w1000');
  document.getElementById('lightbox').classList.add('aberto');
}
function fecharLogo() {
  document.getElementById('lightbox').classList.remove('aberto');
  document.getElementById('lightboxImg').src = '';
}

function formatarDataBR(iso) {
  if (!iso) return '-';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function renderizarItem(card) {
  const seloOrigem = card.origem === 'estoque' ? `<span class="selo-origem">estoque</span>` : '';
  const linhaObs = card.observacoes ? `<div class="card-obs">${card.observacoes}</div>` : '';
  const linhaLogo = card.logo_url
    ? `<img src="${thumbDrive(card.logo_url, 'w100')}" class="card-logo-thumb" alt="logo" onclick="abrirLogo('${card.logo_url}')">`
    : '';
  const div = document.createElement('div');
  div.className = 'card status-finalizado';
  div.innerHTML = `
    <div class="card-id">#${card.id_venda} ${card.nome_card ? '- ' + card.nome_card : ''}${seloOrigem}</div>
    <div class="card-produto">${card.produto || ''} · Qtd: ${card.quantidade || '-'}</div>
    <div class="card-linha"><span>Produção até</span><span>${formatarDataBR(card.prazo_producao)}</span></div>
    <div class="card-linha"><span>Entrega cliente</span><span>${formatarDataBR(card.prazo_entrega)}</span></div>
    ${linhaObs}
    ${linhaLogo}
  `;
  return div;
}

function renderizarLista() {
  const termo = termoHistorico.trim().toLowerCase();
  const lista = document.getElementById('historico-lista');
  const filtrados = (!termo
    ? finalizadosCache
    : finalizadosCache.filter((c) =>
        String(c.id_venda || '').toLowerCase().includes(termo) ||
        String(c.nome_card || '').toLowerCase().includes(termo) ||
        String(c.produto || '').toLowerCase().includes(termo)
      )
  ).slice().reverse(); // mais recentes primeiro

  lista.innerHTML = '';
  if (filtrados.length === 0) {
    lista.innerHTML = '<div class="vazio">Nenhum pedido finalizado encontrado.</div>';
    return;
  }
  filtrados.forEach((c) => lista.appendChild(renderizarItem(c)));
}

function buscarHistorico(valor) {
  termoHistorico = valor;
  renderizarLista();
}

async function carregarHistorico() {
  const lista = document.getElementById('historico-lista');
  lista.innerHTML = '<div class="vazio">Carregando...</div>';
  try {
    const resp = await fetch(`${API_BASE}/cards`);
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro);
    finalizadosCache = dados.cards.filter((c) => c.status === 'Finalizado');
    renderizarLista();
  } catch (err) {
    lista.innerHTML = '<div class="vazio">Erro ao carregar histórico.</div>';
  }
}

carregarHistorico();
