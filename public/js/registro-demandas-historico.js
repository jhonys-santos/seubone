// Histórico — Registro de Demandas Gerais — portado do historico.html original.
// Endpoint agora é /registro-demandas/api/list (proxy do hub). O filtro por
// data/status/empresa/demanda continua sendo feito no cliente, igual antes
// (o Apps Script devolve a lista inteira via action=list).

let solicitacoes = [];
let paginaAtual = 1;
const ITENS_POR_PAGINA = 15;

function formatarData(iso) {
  if (!iso) return '';
  const partes = String(iso).slice(0, 10).split('-');
  return partes[2] + '/' + partes[1] + '/' + partes[0];
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

async function carregar() {
  try {
    const resp = await fetch('/registro-demandas/api/list');
    const data = await resp.json();
    if (data.erro) throw new Error(data.erro);
    solicitacoes = Array.isArray(data) ? data : [];
    renderizar();
  } catch (err) {
    console.error(err);
  }
}

function renderizar() {
  const de = document.getElementById('ft-de').value;
  const ate = document.getElementById('ft-ate').value;
  const statusFiltro = document.getElementById('ft-status').value;
  const empresaFiltro = document.getElementById('ft-empresa').value;
  const demandaFiltro = document.getElementById('ft-demanda').value;
  const busca = document.getElementById('ft-busca').value.trim().toLowerCase();

  let lista = solicitacoes.filter((s) => {
    const dataSol = (s.Data || '').slice(0, 10);
    if (de && dataSol < de) return false;
    if (ate && dataSol > ate) return false;
    if (statusFiltro && s.Status !== statusFiltro) return false;
    if (empresaFiltro && s.Empresa !== empresaFiltro) return false;
    if (demandaFiltro && s.DemandaSolicitada !== demandaFiltro) return false;
    if (busca) {
      const alvo = ((s.Solicitante || '') + ' ' + (s.IDCompra || '')).toLowerCase();
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

  tbody.innerHTML = paginaLista.map((s) => `
    <tr>
      <td>${formatarData(s.Data)}</td>
      <td>${escapeHtml(s.IDCompra)}</td>
      <td>${s.LinkCard ? `<a class="link-btn" href="${escapeHtml(s.LinkCard)}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Abrir</a>` : '—'}</td>
      <td>${escapeHtml(s.Solicitante)}</td>
      <td class="td-truncar" title="${escapeHtml(s.DemandaSolicitada)}">${escapeHtml(s.DemandaSolicitada) || '—'}</td>
      <td class="td-truncar" title="${escapeHtml(s.Observacao)}">${escapeHtml(s.Observacao) || '—'}</td>
      <td>${renderizarAnexos(s.Anexos)}</td>
      <td><span class="badge ${s.Status === 'Feito' ? 'ok' : 'warn'}">${s.Status}</span></td>
      <td>${escapeHtml(s.FeitoPor) || '—'}</td>
    </tr>
  `).join('');

  renderizarPaginacao(paginacao, lista.length, totalPaginas);
}

// Botões Anterior/Próxima — só troca a página exibida, nunca refiltra (o
// filtro já foi aplicado antes de chegar em "lista"). Mostra o total mesmo
// com 1 página só, pra sempre dar a noção de quantos registros existem.
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

// Mudar filtro sempre volta pra página 1 — senão o usuário pode ficar "preso"
// numa página 6 que não existe mais no recorte filtrado.
function aplicarFiltros() {
  paginaAtual = 1;
  renderizar();
}

document.getElementById('btn-filtrar').addEventListener('click', aplicarFiltros);
document.getElementById('ft-status').addEventListener('change', aplicarFiltros);
document.getElementById('ft-empresa').addEventListener('change', aplicarFiltros);
document.getElementById('ft-demanda').addEventListener('change', aplicarFiltros);
document.getElementById('ft-busca').addEventListener('input', aplicarFiltros);

carregar();
setInterval(carregar, 20000);
