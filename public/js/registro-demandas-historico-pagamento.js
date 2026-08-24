// Histórico de Pagamentos — mesma planilha "Pagamentos" usada pelo
// "Solicitar pagamento" de Corridas Avulsas e por esse formulário geral;
// aqui aparecem os dois juntos. Endpoint: /registro-demandas/api/list-pagamento.

let pagamentos = [];
let paginaAtual = 1;
const ITENS_POR_PAGINA = 15;

function formatarData(iso) {
  if (!iso) return '';
  const partes = String(iso).slice(0, 10).split('-');
  return partes[2] + '/' + partes[1] + '/' + partes[0];
}

function formatarValor(valor) {
  const numero = Number(valor);
  if (isNaN(numero)) return valor || '—';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderizarAnexos(anexosJson) {
  if (!anexosJson) return '—';
  let anexos;
  try {
    anexos = JSON.parse(anexosJson);
  } catch (e) {
    return '—';
  }
  if (!anexos || !anexos.length) return '—';
  const botoes = anexos.map((a, i) => {
    const rotulo = 'Anexo ' + (i + 1);
    const nomeArquivo = escapeHtml(a.nome) || rotulo;
    const href = escapeHtml(a.downloadUrl || a.url);
    return `<a class="anexo-btn" href="${href}" target="_blank" rel="noopener" title="${nomeArquivo}"><i class="ti ti-download" aria-hidden="true"></i> ${rotulo}</a>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;">${botoes}</div>`;
}

// Texto original do estado vazio (guardado uma vez, no boot) — precisa ser
// restaurado depois de um erro, senão a mensagem de erro fica presa ali
// mesmo depois que a lista volta a carregar normalmente.
const textoVazioPadrao = document.getElementById('empty').innerHTML;

async function carregar() {
  try {
    const resp = await fetch('/registro-demandas/api/list-pagamento');
    const data = await resp.json();
    if (data.erro) throw new Error(data.erro);
    pagamentos = Array.isArray(data) ? data : [];
    document.getElementById('empty').innerHTML = textoVazioPadrao;
    renderizar();
  } catch (err) {
    console.error(err);
    document.getElementById('tbody').innerHTML = '';
    document.getElementById('paginacao').innerHTML = '';
    const empty = document.getElementById('empty');
    empty.innerHTML = `Não consegui carregar os dados agora (${escapeHtml(err.message || 'erro desconhecido')}).<br><button id="btn-tentar-de-novo" class="btn-primary" style="width:auto;display:inline-flex;margin:14px auto 0;">Tentar de novo</button>`;
    empty.style.display = 'block';
    document.getElementById('btn-tentar-de-novo').addEventListener('click', carregar);
  }
}

function renderizar() {
  const de = document.getElementById('ft-de').value;
  const ate = document.getElementById('ft-ate').value;
  const statusFiltro = document.getElementById('ft-status').value;
  const bancoFiltro = document.getElementById('ft-banco').value;
  const busca = document.getElementById('ft-busca').value.trim().toLowerCase();

  let lista = pagamentos.filter((p) => {
    const dataInserido = (p.InseridoEm || '').slice(0, 10);
    if (de && dataInserido < de) return false;
    if (ate && dataInserido > ate) return false;
    if (statusFiltro && p.Status !== statusFiltro) return false;
    if (bancoFiltro && p.Banco !== bancoFiltro) return false;
    if (busca) {
      const alvo = ((p.RazaoSocial || '') + ' ' + (p.Solicitante || '') + ' ' + (p.CPFCNPJ || '')).toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('empty');
  const paginacao = document.getElementById('paginacao');

  lista = lista.slice().sort((a, b) => new Date(b.InseridoEm) - new Date(a.InseridoEm));

  if (lista.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    paginacao.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  const totalPaginas = Math.max(1, Math.ceil(lista.length / ITENS_POR_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  if (paginaAtual < 1) paginaAtual = 1;
  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const paginaLista = lista.slice(inicio, inicio + ITENS_POR_PAGINA);

  tbody.innerHTML = paginaLista.map((p) => `
    <tr>
      <td>${formatarData(p.DataVencimento) || '—'}</td>
      <td>${escapeHtml(p.Solicitante)}</td>
      <td>${escapeHtml(p.RazaoSocial)}</td>
      <td>${escapeHtml(p.CPFCNPJ)}</td>
      <td class="td-truncar" title="${escapeHtml(p.Motivo)}">${escapeHtml(p.Motivo)}</td>
      <td>${escapeHtml(p.Banco)}</td>
      <td>${escapeHtml(p.Agencia)}</td>
      <td>${escapeHtml(p.Conta)}</td>
      <td>${escapeHtml(p.ChavePix)}${p.TipoChave ? ' (' + escapeHtml(p.TipoChave) + ')' : ''}</td>
      <td>${formatarValor(p.Valor)}</td>
      <td>${escapeHtml(p.NumeroNotaFiscal) || '—'}</td>
      <td>${renderizarAnexos(p.Anexos)}</td>
      <td><span class="badge ${p.Status === 'Feito' ? 'ok' : 'warn'}">${p.Status}</span></td>
      <td>${escapeHtml(p.FeitoPor) || '—'}</td>
    </tr>
  `).join('');

  renderizarPaginacao(paginacao, lista.length, totalPaginas);
}

function renderizarPaginacao(el, total, totalPaginas) {
  if (totalPaginas <= 1) {
    el.innerHTML = `<span class="pg-info">${total} registro(s)</span>`;
    return;
  }
  el.innerHTML = `
    <button id="pg-anterior" ${paginaAtual === 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="pg-info">Página ${paginaAtual} de ${totalPaginas} · ${total} registro(s)</span>
    <button id="pg-proxima" ${paginaAtual === totalPaginas ? 'disabled' : ''}>Próxima ›</button>
  `;
  document.getElementById('pg-anterior').addEventListener('click', () => { paginaAtual--; renderizar(); });
  document.getElementById('pg-proxima').addEventListener('click', () => { paginaAtual++; renderizar(); });
}

function aplicarFiltros() {
  paginaAtual = 1;
  renderizar();
}

document.getElementById('btn-filtrar').addEventListener('click', aplicarFiltros);
document.getElementById('ft-status').addEventListener('change', aplicarFiltros);
document.getElementById('ft-banco').addEventListener('change', aplicarFiltros);
document.getElementById('ft-busca').addEventListener('input', aplicarFiltros);

carregar();
setInterval(carregar, 60000);
