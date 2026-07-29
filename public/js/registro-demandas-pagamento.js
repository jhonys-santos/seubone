// Pagamento (geral) — mesmo backend/planilha/webhook do "Solicitar
// pagamento" de Corridas Avulsas (é o mesmo Apps Script "Pagamentos"), só
// que como página própria dentro de Solicitações Financeiro, pra pedidos
// de pagamento que não são de corrida avulsa. Endpoint:
// /registro-demandas/api/create-pagamento (proxy do hub).

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
  const razaoSocial = document.getElementById('pg-razaosocial').value.trim();
  const solicitante = document.getElementById('pg-solicitante').value.trim();
  const dataVencimento = document.getElementById('pg-vencimento').value;
  const cpfCnpj = document.getElementById('pg-cpfcnpj').value.trim();
  const email = document.getElementById('pg-email').value.trim();
  const motivo = document.getElementById('pg-motivo').value.trim();
  const banco = document.getElementById('pg-banco').value;
  const agencia = document.getElementById('pg-agencia').value.trim();
  const conta = document.getElementById('pg-conta').value.trim();
  const chavePix = document.getElementById('pg-chavepix').value.trim();
  const tipoChave = document.getElementById('pg-tipochave').value;
  const valorTexto = document.getElementById('pg-valor').value.trim();
  const numeroNotaFiscal = document.getElementById('pg-numeronf').value.trim();
  const empresaResponsavel = document.getElementById('pg-empresa').value;
  const inputAnexos = document.getElementById('pg-anexos');
  const arquivos = Array.from(inputAnexos.files);

  if (!razaoSocial || !solicitante || !dataVencimento || !cpfCnpj || !email || !motivo ||
      !banco || !agencia || !conta || !chavePix || !tipoChave || !valorTexto ||
      !numeroNotaFiscal || !empresaResponsavel || !arquivos.length) {
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
  btn.textContent = 'Enviando...';

  try {
    const anexos = await Promise.all(arquivos.map(lerArquivoBase64));

    const resp = await fetch('/registro-demandas/api/create-pagamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataVencimento, cpfCnpj, email, motivo, razaoSocial, banco, agencia, conta,
        chavePix, tipoChave, valor, empresaResponsavel, solicitante, numeroNotaFiscal, anexos,
      }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(result.erro || 'erro ao registrar');

    mostrarMsg('Solicitação de pagamento enviada!', 'ok');
    document.getElementById('pg-razaosocial').value = '';
    document.getElementById('pg-solicitante').value = '';
    document.getElementById('pg-vencimento').value = '';
    document.getElementById('pg-cpfcnpj').value = '';
    document.getElementById('pg-email').value = '';
    document.getElementById('pg-motivo').value = '';
    document.getElementById('pg-banco').value = '';
    document.getElementById('pg-agencia').value = '';
    document.getElementById('pg-conta').value = '';
    document.getElementById('pg-chavepix').value = '';
    document.getElementById('pg-tipochave').value = '';
    document.getElementById('pg-valor').value = '';
    document.getElementById('pg-numeronf').value = '';
    document.getElementById('pg-empresa').value = '';
    inputAnexos.value = '';
  } catch (err) {
    mostrarMsg('Erro: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar';
  }
});
