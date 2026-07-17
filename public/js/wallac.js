// Kanban de produção Wallac — portado da nova versão do painel (nova
// planilha/Apps Script, identificador do card agora é "chave" em vez de
// "linha_ltv"). Endpoints continuam em /wallac/api/... (proxy do hub) em
// vez do Apps Script direto, então a resposta do POST já vem legível (sem
// precisar de mode:'no-cors', que só existia por causa do fetch direto do
// navegador para o domínio do Google).

const API_BASE = '/wallac/api';

const COLUNAS = ['A chegar', 'Recebido', 'Em produção', 'Finalizado'];
const PROXIMO_STATUS = {
  'A chegar': 'Recebido',
  'Recebido': 'Em produção',
  'Em produção': 'Finalizado',
  'Finalizado': null
};
const TEXTO_BOTAO = {
  'A chegar': 'Marcar recebido',
  'Recebido': 'Iniciar produção',
  'Em produção': 'Finalizar'
};

const INTERVALO_POLLING = 20000; // 20s
const MAX_FINALIZADOS_NO_BOARD = 8; // resto fica só no histórico (/wallac/historico)
let arrastando = false;
let cardsAtuais = [];
let termoBusca = '';

function diasRestantes(prazoISO) {
  if (!prazoISO) return null;
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const prazo = new Date(prazoISO + 'T00:00:00');
  return Math.round((prazo - hoje) / 86400000);
}

function corUrgencia(card) {
  if (card.status === 'Finalizado') return 'finalizado';
  const dias = diasRestantes(card.prazo_entrega);
  if (dias === null) return 'verde';
  if (dias <= 0) return 'vermelho';
  if (dias <= 3) return 'amarelo';
  return 'verde';
}

function formatarDataBR(iso) {
  if (!iso) return '-';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

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

// O logo é salvo no Drive pelo formulário de solicitação. "uc?id=" (ou
// qualquer outro formato de link do Drive) sozinho só abre uma prévia —
// "export=download" é o que faz o Drive mandar o arquivo de verdade em
// vez de mostrar a página de visualização.
function driveIdDeUrl(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : null;
}
function linkDownloadDrive(url) {
  const id = driveIdDeUrl(url);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : url;
}

function renderizarCard(card) {
  const cor = corUrgencia(card);
  const dias = diasRestantes(card.prazo_entrega);
  const div = document.createElement('div');
  div.className = `card status-${cor}`;
  div.dataset.chave = card.chave;
  div.dataset.status = card.status;

  let tagTexto = '';
  if (card.status !== 'Finalizado') {
    if (dias !== null) {
      if (dias < 0) tagTexto = `venceu há ${Math.abs(dias)}d`;
      else if (dias === 0) tagTexto = 'vence hoje';
      else tagTexto = `${dias}d restantes`;
    }
  } else {
    tagTexto = 'concluído';
  }

  const botao = PROXIMO_STATUS[card.status]
    ? `<button class="acao" onclick="mudarStatus('${card.chave}', '${PROXIMO_STATUS[card.status]}')">${TEXTO_BOTAO[card.status]} <i class="ti ti-arrow-right" aria-hidden="true"></i></button>`
    : '';

  const seloOrigem = card.origem === 'estoque' ? `<span class="selo-origem">estoque</span>` : '';
  const { texto: obsTexto, link: obsLink } = extrairLink(card.observacoes);
  const linhaObs = obsTexto ? `<div class="card-obs">${obsTexto}</div>` : '';
  const linhaLink = obsLink
    ? `<a class="card-link-btn" href="${obsLink}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Abrir Bitrix</a>`
    : '';
  const linhaLogo = card.logo_url
    ? `<a class="card-logo-btn" href="${linkDownloadDrive(card.logo_url)}" download rel="noopener"><i class="ti ti-download" aria-hidden="true"></i> Baixar logo</a>`
    : '';

  div.innerHTML = `
    <div class="card-id">#${card.id_venda} ${card.nome_card ? '- ' + card.nome_card : ''}${seloOrigem}</div>
    <div class="card-produto">${card.produto || ''} · Qtd: ${card.quantidade || '-'}</div>
    <div class="card-linha"><span>Produção até</span><span>${formatarDataBR(card.prazo_producao)}</span></div>
    <div class="card-linha"><span>Entrega cliente</span><span>${formatarDataBR(card.prazo_entrega)}</span></div>
    ${linhaObs}
    ${linhaLink}
    ${linhaLogo}
    <span class="tag-urgencia ${cor === 'finalizado' ? 'verde' : cor}">${tagTexto}</span>
    ${botao}
  `;
  return div;
}

function renderizarBoard(cards) {
  const porColuna = { 'A chegar': [], 'Recebido': [], 'Em produção': [], 'Finalizado': [] };
  cards.forEach(c => { if (porColuna[c.status]) porColuna[c.status].push(c); });

  // "Finalizado" só cresce e nunca esvazia — sem uma busca ativa, mostra só
  // os mais recentes no board; o resto fica disponível em /wallac/historico.
  const totalFinalizados = porColuna['Finalizado'].length;
  if (!termoBusca && totalFinalizados > MAX_FINALIZADOS_NO_BOARD) {
    porColuna['Finalizado'] = porColuna['Finalizado'].slice(-MAX_FINALIZADOS_NO_BOARD);
  }

  COLUNAS.forEach(status => {
    const container = document.getElementById('col-' + status);
    container.innerHTML = '';
    if (porColuna[status].length === 0) {
      container.innerHTML = '<div class="vazio">sem pedidos</div>';
    } else {
      porColuna[status].forEach(card => container.appendChild(renderizarCard(card)));
    }
    document.getElementById('contagem-' + status).textContent = porColuna[status].length;
  });

  const avisoHistorico = document.getElementById('aviso-historico');
  if (avisoHistorico) {
    const escondidos = totalFinalizados - porColuna['Finalizado'].length;
    avisoHistorico.style.display = escondidos > 0 ? 'block' : 'none';
    if (escondidos > 0) {
      avisoHistorico.textContent = `+ ${escondidos} finalizado(s) mais antigo(s) no histórico`;
    }
  }
}

function renderizarBoardFiltrado() {
  const termo = termoBusca.trim().toLowerCase();
  const cards = !termo
    ? cardsAtuais
    : cardsAtuais.filter((c) =>
        String(c.id_venda || '').toLowerCase().includes(termo) ||
        String(c.nome_card || '').toLowerCase().includes(termo) ||
        String(c.produto || '').toLowerCase().includes(termo)
      );
  renderizarBoard(cards);
}

function buscarCards(valor) {
  termoBusca = valor;
  renderizarBoardFiltrado();
}

async function carregarDados() {
  if (arrastando) return;
  try {
    const resp = await fetch(`${API_BASE}/cards`);
    const dados = await resp.json();
    if (dados.ok) {
      cardsAtuais = dados.cards;
      renderizarBoardFiltrado();
      document.getElementById('status-conexao').textContent =
        'Atualizado às ' + new Date().toLocaleTimeString('pt-BR');
    } else {
      document.getElementById('status-conexao').textContent = 'Erro: ' + dados.erro;
    }
  } catch (err) {
    document.getElementById('status-conexao').textContent = 'Sem conexão com o servidor';
  }
}

function mudarStatus(chave, novoStatus) {
  fetch(`${API_BASE}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chave: chave, novo_status: novoStatus })
  }).finally(() => setTimeout(carregarDados, 600));
}

// Drag and drop entre colunas (desktop)
COLUNAS.forEach(status => {
  const container = document.getElementById('col-' + status);
  new Sortable(container, {
    group: 'kanban-wallac',
    animation: 150,
    onStart: () => { arrastando = true; },
    onEnd: (evt) => {
      arrastando = false;
      const novoStatus = evt.to.closest('.coluna').dataset.status;
      const chave = evt.item.dataset.chave;
      if (novoStatus !== evt.item.dataset.status) {
        mudarStatus(chave, novoStatus);
      }
    }
  });
});

// Faz as colunas ocuparem toda a altura disponível da tela (sem sobra em
// branco no fim), calculando o espaço real em vez de um valor fixo — a
// altura do nav/header pode variar (ex: quebra de linha em telas menores).
function ajustarAlturaColunas() {
  const container = document.querySelector('.wallac-container');
  const board = document.querySelector('.board');
  if (!container || !board) return;
  const topo = board.getBoundingClientRect().top;
  const paddingBaixo = parseFloat(getComputedStyle(container).paddingBottom) || 0;
  const disponivel = window.innerHeight - topo - paddingBaixo;
  document.querySelectorAll('.coluna').forEach((c) => {
    c.style.height = Math.max(disponivel, 200) + 'px';
  });
}
window.addEventListener('resize', ajustarAlturaColunas);
ajustarAlturaColunas();

carregarDados();
setInterval(carregarDados, INTERVALO_POLLING);
