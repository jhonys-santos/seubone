// Cadastro de pedido urgente — portado do cadastro.html original.
// Mudança: não pede mais "seu nome" em texto livre — o servidor preenche
// inseridoPor a partir da sessão autenticada. O endpoint agora é
// /pedidos-urgentes/api/create (proxy do hub) em vez do Apps Script direto.

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setDefaultPrazo() {
  const now = new Date();
  now.setHours(17, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  const local = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  document.getElementById('prazo').value = local;
}
setDefaultPrazo();

const modalidadeEl = document.getElementById('modalidade');
const blocoAereo = document.getElementById('blocoAereo');
const tipoEnvioAereoEl = document.getElementById('tipoEnvioAereo');
const blocoAeroporto = document.getElementById('blocoAeroporto');
const aeroportoEl = document.getElementById('aeroporto');

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

function previewOsImagem() {
  const file = document.getElementById('osImagem').files[0];
  const img = document.getElementById('previewOsImagem');
  if (file) {
    img.src = URL.createObjectURL(file);
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
}

async function enviar() {
  const os = document.getElementById('os').value.trim();
  const cliente = document.getElementById('cliente').value.trim();
  const linkCrm = document.getElementById('linkCrm').value.trim();
  const transportadora = document.getElementById('transportadora').value.trim();
  const modalidade = document.getElementById('modalidade').value;
  const prazo = document.getElementById('prazo').value;
  const fileInput = document.getElementById('manifesto');
  const notaFiscalInput = document.getElementById('notaFiscal');
  const osImagemInput = document.getElementById('osImagem');
  const tipoEnvioAereo = tipoEnvioAereoEl.value;
  const aeroporto = aeroportoEl.value.trim();
  const observacao = document.getElementById('observacao').value.trim();

  const msg = document.getElementById('msg');
  msg.className = 'msg';

  if (!os || !cliente || !linkCrm || !transportadora || !modalidade || !prazo) {
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

  const btn = document.getElementById('btnEnviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const payload = {
    os, cliente, linkCrm, transportadora, modalidade,
    prazo: new Date(prazo).toISOString(),
    observacao
  };

  if (modalidade === 'Aéreo') {
    payload.tipoEnvioAereo = tipoEnvioAereo;
    if (tipoEnvioAereo === 'Retirada') payload.aeroporto = aeroporto;
  }

  try {
    if (osImagemInput.files.length > 0) {
      payload.osImagemBase64 = await toBase64(osImagemInput.files[0]);
      payload.osImagemNome = osImagemInput.files[0].name;
      payload.osImagemTipo = osImagemInput.files[0].type;
    }
    if (fileInput.files.length > 0) {
      payload.manifestoBase64 = await toBase64(fileInput.files[0]);
      payload.manifestoNome = fileInput.files[0].name;
    }
    if (notaFiscalInput.files.length > 0) {
      payload.notaFiscalBase64 = await toBase64(notaFiscalInput.files[0]);
      payload.notaFiscalNome = notaFiscalInput.files[0].name;
    }

    const resp = await fetch('/pedidos-urgentes/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();

    if (data.ok) {
      msg.textContent = `Pedido ${os} cadastrado. O estoque já está vendo na fila.`;
      msg.classList.add('ok');
      ['os','cliente','linkCrm','transportadora'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('modalidade').value = '';
      blocoAereo.style.display = 'none';
      blocoAeroporto.style.display = 'none';
      fileInput.value = '';
      notaFiscalInput.value = '';
      osImagemInput.value = '';
      document.getElementById('previewOsImagem').style.display = 'none';
      document.getElementById('observacao').value = '';
      setDefaultPrazo();
    } else {
      throw new Error(data.erro || 'Erro desconhecido');
    }
  } catch (err) {
    msg.textContent = 'Erro ao cadastrar: ' + err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cadastrar pedido';
  }
}
