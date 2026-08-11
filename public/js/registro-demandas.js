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

// "Link do card no Bitrix" precisa chegar como URL de verdade no n8n — tem
// gente digitando o nome do card em vez de colar o link, o que quebra a
// automação lá na frente.
function pareceUrl(valor) {
  if (!/^https?:\/\//i.test(valor)) return false;
  try {
    new URL(valor);
    return true;
  } catch (e) {
    return false;
  }
}

// O <input type="file"> nativo não acumula seleção entre aberturas do
// seletor — escolher um arquivo, depois abrir de novo e escolher outro,
// SUBSTITUI o primeiro em vez de somar. Guardamos a lista de verdade aqui
// e limpamos o input a cada mudança, senão só o último arquivo escolhido
// (por vez) chega no envio.
let anexosSelecionados = [];
function renderListaAnexos(listaEl) {
  listaEl.innerHTML = anexosSelecionados.map((f, i) => `<span class="anexo-chip"><span>${esc(f.name)}</span><button type="button" data-i="${i}" title="Remover">✕</button></span>`).join('');
  listaEl.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { anexosSelecionados.splice(Number(b.dataset.i), 1); renderListaAnexos(listaEl); });
  });
}

const inputAnexosEl = document.getElementById('f-anexos');
const listaAnexosEl = document.getElementById('f-anexos-lista');
inputAnexosEl.addEventListener('change', () => {
  anexosSelecionados.push(...Array.from(inputAnexosEl.files));
  inputAnexosEl.value = '';
  renderListaAnexos(listaAnexosEl);
});

function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ nome: file.name, tipo: file.type, base64: reader.result.split(',')[1] });
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo ' + file.name));
    reader.readAsDataURL(file);
  });
}

// Busca solicitações já registradas pra esse mesmo ID de venda — usado pra
// avisar antes de registrar de novo (ex: duplo clique, ou esqueceu que já
// tinha pedido). Não bloqueia: se a checagem falhar (rede, Apps Script fora
// do ar), deixa passar em vez de travar um registro legítimo por causa de
// um problema numa verificação secundária.
async function buscarDuplicidadeIdVenda(idCompra) {
  try {
    const resp = await fetch('/registro-demandas/api/list');
    const lista = await resp.json();
    if (!Array.isArray(lista)) return null;
    return lista.filter((r) => String(r.IDCompra || '').trim() === idCompra);
  } catch (e) {
    console.warn('Não foi possível checar duplicidade do ID da venda:', e.message);
    return null;
  }
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
  const arquivos = anexosSelecionados;

  if (!solicitante || !empresa || !data || !tipoDemanda || !demandaSolicitada || !observacao ||
      !dataVencimento || !email || !idCompra || !linkCard) {
    mostrarMsg('Preencha todos os campos obrigatórios (marcados com *).', 'err');
    return;
  }

  if (!pareceUrl(linkCard)) {
    mostrarMsg('O campo "Link do card no Bitrix" precisa ser um link (começando com http:// ou https://), não um nome ou texto.', 'err');
    return;
  }

  const tamanhoTotal = arquivos.reduce((soma, f) => soma + f.size, 0);
  if (tamanhoTotal > 20 * 1024 * 1024) {
    mostrarMsg('Os anexos somados passam de 20 MB. Envie arquivos menores.', 'err');
    return;
  }

  const btn = document.getElementById('btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  const duplicados = await buscarDuplicidadeIdVenda(idCompra);
  if (duplicados && duplicados.length) {
    const resumo = duplicados.slice(0, 3).map((r) => `${r.TipoDemanda || 'Demanda'} (${r.Status || 'Pendente'})`).join(', ');
    const confirmado = await hubConfirm(
      `Já ${duplicados.length > 1 ? `existem ${duplicados.length} solicitações` : 'existe uma solicitação'} registrada${duplicados.length > 1 ? 's' : ''} para o ID da venda ${idCompra}: ${resumo}. Registrar mesmo assim?`,
      { textoConfirmar: 'Registrar mesmo assim', textoCancelar: 'Cancelar' }
    );
    if (!confirmado) {
      btn.disabled = false;
      btn.textContent = 'Registrar solicitação';
      return;
    }
  }

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
    anexosSelecionados = [];
    renderListaAnexos(listaAnexosEl);
  } catch (err) {
    mostrarMsg('Erro: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrar solicitação';
  }
});
