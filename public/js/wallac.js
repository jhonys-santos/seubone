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
let arrastando = false;

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

// Logo vem como link do Google Drive (ex: .../uc?id=XXX), que o Drive às
// vezes recusa exibir direto como <img> (hotlink). O endpoint /thumbnail
// funciona de verdade pra isso — mesmo padrão já usado no Pedidos Urgentes.
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
  const linhaObs = card.observacoes ? `<div class="card-obs">${card.observacoes}</div>` : '';
  const linhaLogo = card.logo_url
    ? `<img src="${thumbDrive(card.logo_url, 'w100')}" class="card-logo-thumb" alt="logo" onclick="abrirLogo('${card.logo_url}')">`
    : '';

  div.innerHTML = `
    <div class="card-id">#${card.id_venda} ${card.nome_card ? '- ' + card.nome_card : ''}${seloOrigem}</div>
    <div class="card-produto">${card.produto || ''} · Qtd: ${card.quantidade || '-'}</div>
    <div class="card-linha"><span>Produção até</span><span>${formatarDataBR(card.prazo_producao)}</span></div>
    <div class="card-linha"><span>Entrega cliente</span><span>${formatarDataBR(card.prazo_entrega)}</span></div>
    ${linhaObs}
    ${linhaLogo}
    <span class="tag-urgencia ${cor === 'finalizado' ? 'verde' : cor}">${tagTexto}</span>
    ${botao}
  `;
  return div;
}

function renderizarBoard(cards) {
  const porColuna = { 'A chegar': [], 'Recebido': [], 'Em produção': [], 'Finalizado': [] };
  cards.forEach(c => { if (porColuna[c.status]) porColuna[c.status].push(c); });

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
}

async function carregarDados() {
  if (arrastando) return;
  try {
    const resp = await fetch(`${API_BASE}/cards`);
    const dados = await resp.json();
    if (dados.ok) {
      renderizarBoard(dados.cards);
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
