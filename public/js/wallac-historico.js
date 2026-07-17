// Histórico de cards Finalizados do SBP — usa a mesma lista de dados do
// kanban (/wallac/api/cards), filtrando por status no cliente e sem o
// limite de exibição que o board ativo tem (essa planilha não tem uma
// ação de histórico separada no Apps Script).

const API_BASE = '/wallac/api';
let finalizadosCache = [];
let termoHistorico = '';

// Observação às vezes vem com um link colado dentro do texto (ex: o link
// do card no Bitrix) — separa o link do resto pra virar um botão clicável
// em vez de aparecer como texto cru quebrando linha no card.
function extrairLink(texto) {
  if (!texto) return { texto: '', link: null };
  const m = texto.match(/https?:\/\/\S+/);
  if (!m) return { texto, link: null };
  const link = m[0].replace(/[.,;)]+$/, '');
  const texto2 = (texto.slice(0, m.index) + texto.slice(m.index + m[0].length)).trim();
  return { texto: texto2, link };
}

function formatarDataBR(iso) {
  if (!iso) return '-';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function renderizarItem(card) {
  const seloOrigem = card.origem === 'estoque' ? `<span class="selo-origem">estoque</span>` : '';
  const { texto: obsTexto, link: obsLink } = extrairLink(card.observacoes);
  const linhaObs = obsTexto ? `<div class="card-obs">${obsTexto}</div>` : '';
  const linhaLink = obsLink
    ? `<a class="card-link-btn" href="${obsLink}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Abrir link</a>`
    : '';
  const linhaLogo = card.logo_url
    ? `<a class="card-logo-btn" href="${card.logo_url}" target="_blank" rel="noopener"><i class="ti ti-download" aria-hidden="true"></i> Baixar logo</a>`
    : '';
  const div = document.createElement('div');
  div.className = 'card status-finalizado';
  div.innerHTML = `
    <div class="card-id">#${card.id_venda} ${card.nome_card ? '- ' + card.nome_card : ''}${seloOrigem}</div>
    <div class="card-produto">${card.produto || ''} · Qtd: ${card.quantidade || '-'}</div>
    <div class="card-linha"><span>Produção até</span><span>${formatarDataBR(card.prazo_producao)}</span></div>
    <div class="card-linha"><span>Entrega cliente</span><span>${formatarDataBR(card.prazo_entrega)}</span></div>
    ${linhaObs}
    ${linhaLink}
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
