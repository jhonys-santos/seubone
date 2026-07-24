// Corridas Avulsas — cadastro de corrida (Uber parceiro) + resumo da
// semana atual (segunda a sexta), pronto pra printar e enviar ao
// financeiro. O servidor preenche registradoPorSlug/registradoPorNome a
// partir da sessão autenticada.

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CA_TAMANHO_MAX_TOTAL = 20 * 1024 * 1024;

document.getElementById('caPrint').addEventListener('change', (e) => {
  const arquivos = Array.from(e.target.files);
  const info = document.getElementById('caArquivosInfo');
  info.textContent = arquivos.length ? `${arquivos.length} arquivo(s): ${arquivos.map((f) => f.name).join(', ')}` : '';
});

function caFmtISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function caFmtDDMM(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
// Segunda-feira da semana de "d" (se "d" cair num domingo, volta 6 dias;
// senão volta até a segunda mais próxima pra trás).
function caSegunda(d) {
  const date = new Date(d);
  const dia = date.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function caFmtBRL(v) {
  return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
}
function caEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('caData').value = caFmtISO(new Date());

let caSemanaOffset = 0;

async function caEnviar() {
  const data = document.getElementById('caData').value;
  const nf = document.getElementById('caNf').value.trim();
  const endereco = document.getElementById('caEndereco').value.trim();
  const motorista = document.getElementById('caMotorista').value.trim();
  const valor = document.getElementById('caValor').value;
  const printInput = document.getElementById('caPrint');
  const arquivos = Array.from(printInput.files);

  const msg = document.getElementById('caMsg');
  msg.className = 'msg';

  if (!data || !nf || !endereco || !motorista || !valor || !arquivos.length) {
    msg.textContent = 'Preencha todos os campos obrigatórios (*), incluindo o print do motorista.';
    msg.classList.add('err');
    return;
  }

  const tamanhoTotal = arquivos.reduce((soma, f) => soma + f.size, 0);
  if (tamanhoTotal > CA_TAMANHO_MAX_TOTAL) {
    msg.textContent = 'Os prints somados passam de 20 MB. Envie arquivos menores.';
    msg.classList.add('err');
    return;
  }

  const btn = document.getElementById('caBtnEnviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const imagens = await Promise.all(arquivos.map(async (arquivo) => ({
      base64: await toBase64(arquivo),
      tipo: arquivo.type,
    })));
    const payload = {
      dataCorrida: data,
      numeroNf: nf,
      endereco,
      nomeMotorista: motorista,
      valor,
      imagens,
    };

    const resp = await fetch('/corridas-avulsas/api/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resultado = await resp.json();

    if (resultado.ok) {
      msg.textContent = 'Corrida registrada.';
      msg.classList.add('ok');
      document.getElementById('caNf').value = '';
      document.getElementById('caEndereco').value = '';
      document.getElementById('caMotorista').value = '';
      document.getElementById('caValor').value = '';
      printInput.value = '';
      document.getElementById('caArquivosInfo').textContent = '';
      document.getElementById('caData').value = caFmtISO(new Date());
      if (caSemanaOffset === 0) caCarregarSemana();
    } else {
      throw new Error(resultado.erro || 'Erro desconhecido');
    }
  } catch (err) {
    msg.textContent = 'Erro ao registrar: ' + err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Registrar corrida';
  }
}
window.caEnviar = caEnviar;

function caNavegarSemana(delta) {
  caSemanaOffset += delta;
  caCarregarSemana();
}
window.caNavegarSemana = caNavegarSemana;

let caItensSemana = [];

async function caCarregarSemana() {
  const hoje = new Date();
  const segunda = caSegunda(hoje);
  segunda.setDate(segunda.getDate() + caSemanaOffset * 7);
  const sexta = new Date(segunda);
  sexta.setDate(segunda.getDate() + 4);

  document.getElementById('caSemanaLabel').textContent = `Semana de ${caFmtDDMM(segunda)} a ${caFmtDDMM(sexta)}`;

  const lista = document.getElementById('caLista');
  lista.innerHTML = '<div class="ca-empty"><i class="ti ti-loader-2" aria-hidden="true"></i> Carregando...</div>';
  document.getElementById('caTotal').textContent = caFmtBRL(0);

  try {
    const resp = await fetch(`/corridas-avulsas/api/lista?desde=${caFmtISO(segunda)}&ate=${caFmtISO(sexta)}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');

    caItensSemana = json.itens || [];
    caAtualizarFiltroMotorista();
    caRenderLista();
  } catch (err) {
    caItensSemana = [];
    lista.innerHTML = `<div class="ca-empty"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar: ${err.message}</div>`;
  }
}

// Opções do filtro vêm de quem já foi cadastrado nessa semana (não da
// lista de sugestão do formulário) — reseta pra "Todos" a cada semana.
function caAtualizarFiltroMotorista() {
  const select = document.getElementById('caFiltroMotorista');
  const nomes = [...new Set(caItensSemana.map((it) => it.nomeMotorista).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  select.innerHTML = '<option value="">Todos</option>' + nomes.map((n) => `<option value="${caEsc(n)}">${caEsc(n)}</option>`).join('');
}

let caTotalAtual = 0;

function caRenderLista() {
  const lista = document.getElementById('caLista');
  const filtro = document.getElementById('caFiltroMotorista').value;
  const itens = filtro ? caItensSemana.filter((it) => it.nomeMotorista === filtro) : caItensSemana;

  const total = itens.reduce((soma, it) => soma + (Number(it.valor) || 0), 0);
  caTotalAtual = total;
  document.getElementById('caTotal').textContent = caFmtBRL(total);

  // Só mostra "Solicitar pagamento" quando um motorista específico está
  // selecionado — pedir reembolso de "Todos" junto não faz sentido (cada
  // motorista recebe separado).
  document.getElementById('caBtnSolicitarPagamento').style.display = filtro ? 'flex' : 'none';

  if (!itens.length) {
    lista.innerHTML = `<div class="ca-empty">${filtro ? 'Nenhuma corrida desse motorista nessa semana.' : 'Nenhuma corrida registrada nessa semana.'}</div>`;
    return;
  }

  const linhas = itens.map((it) => `
    <tr>
      <td>${caFmtDDMM(new Date(it.dataCorrida + 'T12:00:00'))}</td>
      <td>${caEsc(it.numeroNf)}</td>
      <td>${caEsc(it.endereco)}</td>
      <td>${caEsc(it.nomeMotorista)}</td>
      <td class="ca-td-valor">${caFmtBRL(it.valor)}</td>
      <td class="ca-td-print">${(it.printUrls && it.printUrls.length) ? it.printUrls.map((url, i) => `<a href="${url}" target="_blank" rel="noopener"><i class="ti ti-photo" aria-hidden="true"></i> ${it.printUrls.length > 1 ? i + 1 : 'Ver'}</a>`).join(' ') : '—'}</td>
    </tr>
  `).join('');

  lista.innerHTML = `
    <div class="ca-table-wrap">
      <table class="ca-table">
        <thead><tr><th>Data</th><th>NF</th><th>Endereço</th><th>Motorista</th><th>Valor</th><th>Print</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}
window.caRenderLista = caRenderLista;

function limparValor(txt) {
  // aceita "1.234,56", "1234,56" ou "1234.56" e devolve número
  const limpo = txt.trim().replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const numero = parseFloat(limpo);
  return isNaN(numero) ? null : numero;
}

// ── SOLICITAR PAGAMENTO ── vira uma solicitação de Reembolso de verdade
// (mesmo endpoint/planilha/caminho pro financeiro do Registro de Demandas).
function caAbrirPagamento() {
  const filtro = document.getElementById('caFiltroMotorista').value;
  document.getElementById('pgRazaoSocial').value = filtro;
  document.getElementById('pgMotivo').value = `Pagamento de corridas avulsas — ${document.getElementById('caSemanaLabel').textContent}`;
  document.getElementById('pgValor').value = caTotalAtual.toFixed(2).replace('.', ',');
  document.getElementById('modal-pagamento').classList.add('show');
}
window.caAbrirPagamento = caAbrirPagamento;

function caFecharPagamento() {
  document.getElementById('modal-pagamento').classList.remove('show');
  ['pgRazaoSocial', 'pgSolicitante', 'pgVencimento', 'pgCpfCnpj', 'pgEmail', 'pgMotivo', 'pgBanco', 'pgAgencia', 'pgConta', 'pgChavePix', 'pgTipoChave', 'pgValor', 'pgNumeroNf', 'pgEmpresa'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('pgAnexos').value = '';
  const msg = document.getElementById('pgMsg');
  msg.className = 'msg';
  msg.textContent = '';
}
window.caFecharPagamento = caFecharPagamento;

async function caEnviarPagamento() {
  const razaoSocial = document.getElementById('pgRazaoSocial').value.trim();
  const solicitante = document.getElementById('pgSolicitante').value.trim();
  const dataVencimento = document.getElementById('pgVencimento').value;
  const cpfCnpj = document.getElementById('pgCpfCnpj').value.trim();
  const email = document.getElementById('pgEmail').value.trim();
  const motivo = document.getElementById('pgMotivo').value.trim();
  const banco = document.getElementById('pgBanco').value;
  const agencia = document.getElementById('pgAgencia').value.trim();
  const conta = document.getElementById('pgConta').value.trim();
  const chavePix = document.getElementById('pgChavePix').value.trim();
  const tipoChave = document.getElementById('pgTipoChave').value;
  const valorTexto = document.getElementById('pgValor').value.trim();
  const numeroNotaFiscal = document.getElementById('pgNumeroNf').value.trim();
  const empresaResponsavel = document.getElementById('pgEmpresa').value;
  const inputAnexos = document.getElementById('pgAnexos');
  const arquivos = Array.from(inputAnexos.files);

  const msg = document.getElementById('pgMsg');
  msg.className = 'msg';

  if (!razaoSocial || !solicitante || !dataVencimento || !cpfCnpj || !email || !motivo ||
      !banco || !agencia || !conta || !chavePix || !valorTexto || !empresaResponsavel) {
    msg.textContent = 'Preencha todos os campos obrigatórios (*).';
    msg.classList.add('err');
    return;
  }

  const valor = limparValor(valorTexto);
  if (valor === null) {
    msg.textContent = 'Valor inválido. Use um número, ex: 150,00.';
    msg.classList.add('err');
    return;
  }

  const tamanhoTotal = arquivos.reduce((soma, f) => soma + f.size, 0);
  if (tamanhoTotal > CA_TAMANHO_MAX_TOTAL) {
    msg.textContent = 'Os anexos somados passam de 20 MB. Envie arquivos menores.';
    msg.classList.add('err');
    return;
  }

  const btn = document.getElementById('pgBtnEnviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const anexos = arquivos.length ? await Promise.all(arquivos.map((arquivo) => toBase64(arquivo).then((base64) => ({ base64, tipo: arquivo.type, nome: arquivo.name })))) : [];

    const resp = await fetch('/corridas-avulsas/api/solicitar-pagamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataVencimento, cpfCnpj, email, motivo, razaoSocial, banco, agencia, conta,
        chavePix, tipoChave, valor, empresaResponsavel, solicitante, numeroNotaFiscal, anexos,
      }),
    });
    const resultado = await resp.json();
    if (!resultado.ok) throw new Error(resultado.erro || 'erro ao registrar');

    await hubAlert('Solicitação de pagamento enviada pro financeiro!', 'sucesso');
    caFecharPagamento();
  } catch (err) {
    msg.textContent = 'Erro: ' + err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar solicitação';
  }
}
window.caEnviarPagamento = caEnviarPagamento;

caCarregarSemana();
