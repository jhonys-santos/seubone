// Kanban de produção Wallac — portado de Wallac/index.html original.
// Única mudança real: os endpoints agora são /wallac/api/... (proxy do hub)
// em vez do Apps Script direto, então a resposta do POST já vem legível
// (sem precisar de mode:'no-cors', que só existia por causa do fetch direto
// do navegador para o domínio do Google).

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

function renderizarCard(card) {
  const cor = corUrgencia(card);
  const dias = diasRestantes(card.prazo_entrega);
  const div = document.createElement('div');
  div.className = `card status-${cor}`;
  div.dataset.linha = card.linha_ltv;
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
    ? `<button class="acao" onclick="mudarStatus(${card.linha_ltv}, '${PROXIMO_STATUS[card.status]}')">${TEXTO_BOTAO[card.status]} <i class="ti ti-arrow-right" aria-hidden="true"></i></button>`
    : '';

  div.innerHTML = `
    <div class="card-id">#${card.id_venda} - ${card.nome_card || ''}</div>
    <div class="card-produto">${card.produto || ''} · Qtd: ${card.quantidade || '-'}</div>
    <div class="card-linha"><span>Produção até</span><span>${formatarDataBR(card.prazo_producao)}</span></div>
    <div class="card-linha"><span>Entrega cliente</span><span>${formatarDataBR(card.prazo_entrega)}</span></div>
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

function mudarStatus(linhaLtv, novoStatus) {
  fetch(`${API_BASE}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linha_ltv: linhaLtv, novo_status: novoStatus })
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
      const linha = evt.item.dataset.linha;
      if (novoStatus !== evt.item.dataset.status) {
        mudarStatus(Number(linha), novoStatus);
      }
    }
  });
});

carregarDados();
setInterval(carregarDados, INTERVALO_POLLING);
