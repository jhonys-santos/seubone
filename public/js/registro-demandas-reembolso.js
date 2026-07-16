// Reembolso — portado do reembolso.html original.
// Endpoint agora é /registro-demandas/api/create-reembolso (proxy do hub).

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

function limparValor(txt) {
  // aceita "1.234,56", "1234,56" ou "1234.56" e devolve número
  const limpo = txt.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const numero = parseFloat(limpo);
  return isNaN(numero) ? null : numero;
}

document.getElementById('btn-registrar').addEventListener('click', async () => {
  const id = document.getElementById('r-id').value.trim();
  const dataVencimento = document.getElementById('r-vencimento').value;
  const cpfCnpj = document.getElementById('r-cpfcnpj').value.trim();
  const email = document.getElementById('r-email').value.trim();
  const motivo = document.getElementById('r-motivo').value.trim();
  const razaoSocial = document.getElementById('r-razaosocial').value.trim();
  const banco = document.getElementById('r-banco').value;
  const agencia = document.getElementById('r-agencia').value.trim();
  const conta = document.getElementById('r-conta').value.trim();
  const chavePix = document.getElementById('r-chavepix').value.trim();
  const tipoChave = document.getElementById('r-tipochave').value;
  const valorTexto = document.getElementById('r-valor').value.trim();
  const empresaResponsavel = document.getElementById('r-empresa').value;
  const inputAnexos = document.getElementById('r-anexos');
  const arquivos = Array.from(inputAnexos.files);

  if (!id || !dataVencimento || !cpfCnpj || !email || !motivo || !razaoSocial ||
      !banco || !agencia || !conta || !chavePix || !valorTexto || !empresaResponsavel) {
    mostrarMsg('Preencha todos os campos obrigatórios (marcados com *).', 'err');
    return;
  }

  const valor = limparValor(valorTexto);
  if (valor === null) {
    mostrarMsg('Valor inválido. Use um número, ex: 150,00.', 'err');
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
    const resp = await fetch('/registro-demandas/api/create-reembolso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, dataVencimento, cpfCnpj, email, motivo, razaoSocial,
        banco, agencia, conta, chavePix, tipoChave, valor, empresaResponsavel, anexos,
      }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.erro || 'erro ao registrar');

    mostrarMsg('Solicitação de reembolso registrada!', 'ok');
    document.getElementById('r-id').value = '';
    document.getElementById('r-vencimento').value = '';
    document.getElementById('r-cpfcnpj').value = '';
    document.getElementById('r-email').value = '';
    document.getElementById('r-motivo').value = '';
    document.getElementById('r-razaosocial').value = '';
    document.getElementById('r-banco').value = '';
    document.getElementById('r-agencia').value = '';
    document.getElementById('r-conta').value = '';
    document.getElementById('r-chavepix').value = '';
    document.getElementById('r-tipochave').value = '';
    document.getElementById('r-valor').value = '';
    document.getElementById('r-empresa').value = '';
    inputAnexos.value = '';
  } catch (err) {
    mostrarMsg('Erro: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrar solicitação';
  }
});
