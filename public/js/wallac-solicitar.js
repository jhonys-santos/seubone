// Solicitar personalização — página pública (sem login), pode ser
// compartilhada com gente de fora do hub. Portado de formulario_estoque.html
// original, com os endpoints trocados pelo proxy do hub (o navegador nunca
// fala direto com o Apps Script).

const API_BASE = '/wallac/api';

let produtosDisponiveis = [];
let logoBase64 = null;
let logoNome = null;

function paraISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Soma dias úteis (pula sábado e domingo) a uma data — usada pro mínimo de
// prazo de produção/entrega, que precisa ser pelo menos 2 dias úteis à frente.
function somarDiasUteis(data, dias) {
  const d = new Date(data);
  let somados = 0;
  while (somados < dias) {
    d.setDate(d.getDate() + 1);
    const diaSemana = d.getDay(); // 0 = domingo, 6 = sábado
    if (diaSemana !== 0 && diaSemana !== 6) somados++;
  }
  return d;
}

const DIAS_UTEIS_MINIMOS = 2;
// Nem prazo já vencido, nem prazo tão em cima que a produção/entrega não dê
// tempo — mínimo de 2 dias úteis a partir de hoje, pra produção e entrega.
const prazoMinimo = somarDiasUteis(new Date(), DIAS_UTEIS_MINIMOS);
const prazoMinimoISO = paraISO(prazoMinimo);
document.getElementById('prazo-producao').min = prazoMinimoISO;
document.getElementById('prazo-entrega').min = prazoMinimoISO;
const prazoMinimoBR = prazoMinimoISO.split('-').reverse().join('/');
['prazo-producao', 'prazo-entrega'].forEach((id) => {
  const input = document.getElementById(id);
  const dica = document.createElement('div');
  dica.id = 'dica-' + id;
  dica.textContent = `Mínimo ${DIAS_UTEIS_MINIMOS} dias úteis a partir de hoje (${prazoMinimoBR}).`;
  input.insertAdjacentElement('afterend', dica);
});

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

  const solicitante = document.getElementById('solicitante').value.trim();
  const produtoSelecionado = document.getElementById('produto').value;
  const ehOutro = produtoSelecionado === '__outros__';
  let nomeProdutoFinal = produtoSelecionado;

  if (!solicitante) {
    mensagem.textContent = 'Informe o nome de quem está solicitando.';
    mensagem.className = 'erro';
    return;
  }
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
  const prazoProducaoVal = document.getElementById('prazo-producao').value;
  const prazoEntregaVal = document.getElementById('prazo-entrega').value;
  if (!prazoProducaoVal || prazoProducaoVal < prazoMinimoISO) {
    mensagem.textContent = 'Prazo de produção selecionado é inferior ao permitido, caso necessário fale diretamente com Wallac.';
    mensagem.className = 'erro';
    return;
  }
  if (!prazoEntregaVal || prazoEntregaVal < prazoMinimoISO) {
    mensagem.textContent = 'Prazo de entrega selecionado é inferior ao permitido, caso necessário fale diretamente com Wallac.';
    mensagem.className = 'erro';
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Enviando...';

  const payload = {
    solicitante,
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
