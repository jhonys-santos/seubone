// Registro de Demandas Gerais — portado do index.html original.
// Endpoint agora é /registro-demandas/api/create (proxy do hub). A URL real
// do Apps Script ainda não está configurada no servidor — por enquanto só
// a parte visual; o envio vai mostrar erro até isso ser configurado.

function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
document.getElementById('f-data').value = hojeISO();

function mostrarMsg(texto, tipo) {
  const el = document.getElementById('form-msg');
  el.textContent = texto;
  el.className = 'msg ' + tipo;
  setTimeout(() => { el.className = 'msg'; }, 5000);
}

function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ nome: file.name, tipo: file.type, base64: reader.result.split(',')[1] });
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo ' + file.name));
    reader.readAsDataURL(file);
  });
}

document.getElementById('btn-registrar').addEventListener('click', async () => {
  const solicitante = document.getElementById('f-solicitante').value.trim();
  const empresa = document.getElementById('f-empresa').value;
  const numeroCorporativo = document.getElementById('f-numero').value.trim();
  const data = document.getElementById('f-data').value;
  const tipoDemanda = document.getElementById('f-tipo').value;
  const demandaSolicitada = document.getElementById('f-demanda').value;
  const observacao = document.getElementById('f-descricao').value.trim();
  const dataVencimento = document.getElementById('f-vencimento').value;
  const email = document.getElementById('f-email').value.trim();
  const idCompra = document.getElementById('f-idvenda').value.trim();
  const linkCard = document.getElementById('f-link').value.trim();
  const inputAnexos = document.getElementById('f-anexos');
  const arquivos = Array.from(inputAnexos.files);

  if (!solicitante || !empresa || !data || !tipoDemanda || !demandaSolicitada || !observacao ||
      !dataVencimento || !email || !idCompra || !linkCard) {
    mostrarMsg('Preencha todos os campos obrigatórios (marcados com *).', 'err');
    return;
  }

  const tamanhoTotal = arquivos.reduce((soma, f) => soma + f.size, 0);
  if (tamanhoTotal > 20 * 1024 * 1024) {
    mostrarMsg('Os anexos somados passam de 20 MB. Envie arquivos menores.', 'err');
    return;
  }

  const btn = document.getElementById('btn-registrar');
  btn.disabled = true;
  btn.textContent = arquivos.length ? 'Enviando anexos...' : 'Registrando...';

  try {
    const anexos = arquivos.length ? await Promise.all(arquivos.map(lerArquivoBase64)) : [];

    btn.textContent = 'Registrando...';
    const resp = await fetch('/registro-demandas/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data, idCompra, solicitante, tipoDemanda, linkCard, observacao, anexos,
        empresa, numeroCorporativo, demandaSolicitada, dataVencimento, email,
      }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.erro || 'erro ao registrar');

    mostrarMsg('Solicitação registrada!', 'ok');
    document.getElementById('f-solicitante').value = '';
    document.getElementById('f-empresa').value = '';
    document.getElementById('f-numero').value = '';
    document.getElementById('f-data').value = hojeISO();
    document.getElementById('f-tipo').value = '';
    document.getElementById('f-demanda').value = '';
    document.getElementById('f-descricao').value = '';
    document.getElementById('f-vencimento').value = '';
    document.getElementById('f-email').value = '';
    document.getElementById('f-idvenda').value = '';
    document.getElementById('f-link').value = '';
    inputAnexos.value = '';
  } catch (err) {
    mostrarMsg('Erro: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrar solicitação';
  }
});
