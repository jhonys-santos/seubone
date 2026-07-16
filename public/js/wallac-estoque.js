// Gestão de estoque do SBP — só acessível pelo login do Wallac (checado no
// servidor). Portado de gestao_estoque.html original, com os endpoints
// trocados pelo proxy do hub e alert()/confirm() pelos diálogos padrão.

const API_BASE = '/wallac/api';

async function carregarEstoque() {
  const corpo = document.getElementById('corpo-tabela');
  try {
    const resp = await fetch(`${API_BASE}/estoque-admin`);
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro);

    if (dados.itens.length === 0) {
      corpo.innerHTML = '<tr><td colspan="3" class="vazio">Nenhum produto cadastrado</td></tr>';
      return;
    }

    corpo.innerHTML = '';
    dados.itens.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" value="${item.produto}" id="produto-${item.linha}"></td>
        <td class="col-qtd"><input type="number" min="0" value="${item.quantidade}" id="qtd-${item.linha}"></td>
        <td class="col-acoes">
          <button class="salvar" onclick="salvarProduto(${item.linha})">Salvar</button>
          <button class="remover" onclick="removerProduto(${item.linha})">Remover</button>
        </td>
      `;
      corpo.appendChild(tr);
    });
  } catch (err) {
    corpo.innerHTML = '<tr><td colspan="3" class="vazio">Erro ao carregar estoque</td></tr>';
  }
}

function mostrarMensagem(texto, tipo) {
  const mensagem = document.getElementById('mensagem');
  mensagem.textContent = texto;
  mensagem.className = tipo;
  setTimeout(() => { mensagem.style.display = 'none'; mensagem.className = ''; }, 4000);
}

async function enviar(caminho, payload) {
  const resp = await fetch(`${API_BASE}/${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

async function adicionarProduto() {
  const produto = document.getElementById('novo-produto').value.trim();
  const quantidade = document.getElementById('nova-quantidade').value;

  if (!produto) {
    mostrarMensagem('Digite o nome do produto.', 'erro');
    return;
  }

  const dados = await enviar('estoque/adicionar', { produto, quantidade });
  if (dados.ok) {
    mostrarMensagem('Produto adicionado.', 'sucesso');
    document.getElementById('novo-produto').value = '';
    document.getElementById('nova-quantidade').value = '0';
    carregarEstoque();
  } else {
    mostrarMensagem(dados.erro, 'erro');
  }
}

async function salvarProduto(linha) {
  const produto = document.getElementById('produto-' + linha).value.trim();
  const quantidade = document.getElementById('qtd-' + linha).value;

  const dados = await enviar('estoque/editar', { linha, produto, quantidade });
  if (dados.ok) {
    mostrarMensagem('Alterações salvas.', 'sucesso');
    carregarEstoque();
  } else {
    mostrarMensagem(dados.erro, 'erro');
  }
}

async function removerProduto(linha) {
  const confirmado = await hubConfirm('Remover esse produto do estoque? Essa ação não pode ser desfeita.', { textoConfirmar: 'Remover' });
  if (!confirmado) return;

  const dados = await enviar('estoque/remover', { linha });
  if (dados.ok) {
    mostrarMensagem('Produto removido.', 'sucesso');
    carregarEstoque();
  } else {
    mostrarMensagem(dados.erro, 'erro');
  }
}

carregarEstoque();
