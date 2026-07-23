// Solicitar personalização — página pública (sem login), pode ser
// compartilhada com gente de fora do hub. Portado de formulario_estoque.html
// original, com os endpoints trocados pelo proxy do hub (o navegador nunca
// fala direto com o Apps Script).

const API_BASE = '/wallac/api';

let produtosDisponiveis = [];
let logoBase64 = null;
let logoNome = null;

// Não deixa escolher prazo já vencido (usa data local, não UTC, pra não
// cair um dia antes perto da meia-noite).
(function bloquearDatasPassadas() {
  const hoje = new Date();
  const hojeISO = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
  document.getElementById('prazo-producao').min = hojeISO;
  document.getElementById('prazo-entrega').min = hojeISO;
})();

async function carregarProdutos() {
  const select = document.getElementById('produto');
  try {
    const resp = await fetch(`${API_BASE}/estoque-publico`);
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro);

    produtosDisponiveis = dados.produtos;
    select.innerHTML = '<option value="">Selecione um produto</option>';
    produtosDisponiveis.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.produto;
      opt.textContent = `${p.produto} (${p.quantidade_disponivel} disponível)`;
      select.appendChild(opt);
    });

    if (produtosDisponiveis.length === 0) {
      select.innerHTML = '<option value="">Nenhum produto em estoque</option>';
    }

    const optOutros = document.createElement('option');
    optOutros.value = '__outros__';
    optOutros.textContent = 'Outros (não está na lista)';
    select.appendChild(optOutros);
  } catch (err) {
    select.innerHTML = '<option value="">Erro ao carregar estoque</option>';
  }
}

document.getElementById('produto').addEventListener('change', (e) => {
  const grupoOutros = document.getElementById('grupo-outros');
  const inputOutros = document.getElementById('produto-outros');
  const info = document.getElementById('qtd-disponivel');
  const inputQtd = document.getElementById('quantidade');

  if (e.target.value === '__outros__') {
    grupoOutros.style.display = 'block';
    inputOutros.setAttribute('required', 'required');
    info.textContent = '';
    inputQtd.removeAttribute('max');
    return;
  }

  grupoOutros.style.display = 'none';
  inputOutros.removeAttribute('required');
  inputOutros.value = '';

  const produto = produtosDisponiveis.find((p) => p.produto === e.target.value);
  if (produto) {
    info.textContent = `Disponível: ${produto.quantidade_disponivel} un.`;
    inputQtd.max = produto.quantidade_disponivel;
  } else {
    info.textContent = '';
    inputQtd.removeAttribute('max');
  }
});

document.getElementById('logo').addEventListener('change', (e) => {
  const arquivo = e.target.files[0];
  const preview = document.getElementById('preview-logo');
  if (!arquivo) { logoBase64 = null; logoNome = null; preview.style.display = 'none'; return; }
  logoNome = arquivo.name;
  const reader = new FileReader();
  reader.onload = () => {
    logoBase64 = reader.result;
    preview.querySelector('span').textContent = logoNome;
    preview.style.display = 'flex';
  };
  reader.readAsDataURL(arquivo);
});

document.getElementById('form-solicitacao').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = document.getElementById('botao-enviar');
  const mensagem = document.getElementById('mensagem');
  mensagem.className = '';
  mensagem.style.display = 'none';

  const produtoSelecionado = document.getElementById('produto').value;
  const ehOutro = produtoSelecionado === '__outros__';
  let nomeProdutoFinal = produtoSelecionado;

  if (!produtoSelecionado) {
    mensagem.textContent = 'Selecione um produto.';
    mensagem.className = 'erro';
    return;
  }
  if (ehOutro) {
    nomeProdutoFinal = document.getElementById('produto-outros').value.trim();
    if (!nomeProdutoFinal) {
      mensagem.textContent = 'Digite o nome do produto em "Outros".';
      mensagem.className = 'erro';
      return;
    }
  }
  if (!logoBase64) {
    mensagem.textContent = 'O arquivo DXF do logo é obrigatório.';
    mensagem.className = 'erro';
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Enviando...';

  const payload = {
    produto: nomeProdutoFinal,
    eh_outro: ehOutro,
    quantidade: document.getElementById('quantidade').value,
    id_venda_cliente: document.getElementById('id-venda-cliente').value,
    prazo_producao: document.getElementById('prazo-producao').value,
    prazo_entrega: document.getElementById('prazo-entrega').value,
    observacoes: document.getElementById('observacoes').value,
    logo_base64: logoBase64,
    logo_nome: logoNome,
  };

  try {
    const resp = await fetch(`${API_BASE}/solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const dados = await resp.json();

    if (dados.ok) {
      mensagem.textContent = 'Solicitação enviada! O card já está no painel.';
      mensagem.className = 'sucesso';
      document.getElementById('form-solicitacao').reset();
      document.getElementById('grupo-outros').style.display = 'none';
      document.getElementById('preview-logo').style.display = 'none';
      logoBase64 = null;
      logoNome = null;
      await carregarProdutos();
    } else {
      mensagem.textContent = dados.erro || 'Erro ao enviar solicitação.';
      mensagem.className = 'erro';
    }
  } catch (err) {
    mensagem.textContent = 'Falha de conexão. Tente novamente.';
    mensagem.className = 'erro';
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar solicitação';
  }
});

carregarProdutos();
