// Cadastro de quitação pendente — o servidor preenche cadastradoPorSlug/
// cadastradoPorNome a partir da sessão autenticada.

const modalidadeEl = document.getElementById('modalidade');
const blocoAereo = document.getElementById('blocoAereo');
const tipoEnvioAereoEl = document.getElementById('tipoEnvioAereo');
const blocoAeroporto = document.getElementById('blocoAeroporto');
const aeroportoEl = document.getElementById('aeroporto');
const blocoFrete = document.getElementById('blocoFrete');

modalidadeEl.addEventListener('change', () => {
  const isAereo = modalidadeEl.value === 'Aéreo';
  blocoAereo.style.display = isAereo ? 'block' : 'none';
  if (!isAereo) {
    tipoEnvioAereoEl.value = '';
    blocoAeroporto.style.display = 'none';
    aeroportoEl.value = '';
  }
});

tipoEnvioAereoEl.addEventListener('change', () => {
  const isRetirada = tipoEnvioAereoEl.value === 'Retirada';
  blocoAeroporto.style.display = isRetirada ? 'block' : 'none';
  if (!isRetirada) aeroportoEl.value = '';
});

function qtToggleFrete() {
  const ligado = document.getElementById('freteDedicado').checked;
  blocoFrete.style.display = ligado ? 'block' : 'none';
  if (!ligado) {
    document.getElementById('transportadora').value = '';
    document.getElementById('entregador').value = '';
  }
}

async function enviar() {
  const idVendaOmie = document.getElementById('idVendaOmie').value.trim();
  const cliente = document.getElementById('cliente').value.trim();
  const linkCrm = document.getElementById('linkCrm').value.trim();
  const modalidade = modalidadeEl.value;
  const tipoEnvioAereo = tipoEnvioAereoEl.value;
  const aeroporto = aeroportoEl.value.trim();
  const freteDedicado = document.getElementById('freteDedicado').checked;
  const transportadora = document.getElementById('transportadora').value.trim();
  const entregador = document.getElementById('entregador').value.trim();
  const observacao = document.getElementById('observacao').value.trim();

  const msg = document.getElementById('msg');
  msg.className = 'msg';

  if (!idVendaOmie || !cliente || !linkCrm || !modalidade) {
    msg.textContent = 'Preencha todos os campos obrigatórios (*).';
    msg.classList.add('err');
    return;
  }

  if (modalidade === 'Aéreo' && !tipoEnvioAereo) {
    msg.textContent = 'Selecione o tipo de envio aéreo (retirada ou domicílio).';
    msg.classList.add('err');
    return;
  }

  if (modalidade === 'Aéreo' && tipoEnvioAereo === 'Retirada' && !aeroporto) {
    msg.textContent = 'Informe o aeroporto de retirada.';
    msg.classList.add('err');
    return;
  }

  if (freteDedicado && (!transportadora || !entregador)) {
    msg.textContent = 'Informe a transportadora e quem vai entregar, ou desmarque o frete dedicado.';
    msg.classList.add('err');
    return;
  }

  const btn = document.getElementById('btnEnviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const payload = { idVendaOmie, cliente, linkCrm, modalidade, freteDedicado, observacao };
  if (modalidade === 'Aéreo') {
    payload.tipoEnvioAereo = tipoEnvioAereo;
    if (tipoEnvioAereo === 'Retirada') payload.aeroporto = aeroporto;
  }
  if (freteDedicado) {
    payload.transportadora = transportadora;
    payload.entregador = entregador;
  }

  try {
    const resp = await fetch('/quitacoes/api/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();

    if (data.ok) {
      msg.textContent = `Quitação da venda ${idVendaOmie} cadastrada. Já aparece no painel para acompanhamento.`;
      msg.classList.add('ok');
      ['idVendaOmie', 'cliente', 'linkCrm', 'transportadora', 'entregador', 'observacao'].forEach((id) => {
        document.getElementById(id).value = '';
      });
      modalidadeEl.value = '';
      tipoEnvioAereoEl.value = '';
      aeroportoEl.value = '';
      document.getElementById('freteDedicado').checked = false;
      blocoAereo.style.display = 'none';
      blocoAeroporto.style.display = 'none';
      blocoFrete.style.display = 'none';
    } else {
      throw new Error(data.erro || 'Erro desconhecido');
    }
  } catch (err) {
    msg.textContent = 'Erro ao cadastrar: ' + err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cadastrar quitação pendente';
  }
}
