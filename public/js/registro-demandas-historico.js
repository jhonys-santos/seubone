// Histórico — Registro de Demandas Gerais — portado do historico.html original.
// Endpoint agora é /registro-demandas/api/list (proxy do hub). O filtro por
// data/status/empresa/demanda continua sendo feito no cliente, igual antes
// (o Apps Script devolve a lista inteira via action=list).

let solicitacoes = [];

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
    return `<a class="link-btn" href="${href}" target="_blank" rel="noopener" title="${nomeArquivo}"><i class="ti ti-download" aria-hidden="true"></i> ${rotulo}</a>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;gap:6px;">${botoes}</div>`;
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

  lista = lista.slice().sort((a, b) => new Date(b.InseridoEm) - new Date(a.InseridoEm));

  if (lista.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = lista.map((s) => `
    <tr>
      <td>${formatarData(s.Data)}</td>
      <td>${escapeHtml(s.IDCompra)}</td>
      <td>${s.LinkCard ? `<a class="link-btn" href="${escapeHtml(s.LinkCard)}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Abrir</a>` : '—'}</td>
      <td>${escapeHtml(s.Solicitante)}</td>
      <td>${escapeHtml(s.DemandaSolicitada) || '—'}</td>
      <td>${escapeHtml(s.Observacao) || '—'}</td>
      <td>${renderizarAnexos(s.Anexos)}</td>
      <td><span class="badge ${s.Status === 'Feito' ? 'ok' : 'warn'}">${s.Status}</span></td>
      <td>${escapeHtml(s.FeitoPor) || '—'}</td>
    </tr>
  `).join('');
}

document.getElementById('btn-filtrar').addEventListener('click', renderizar);
document.getElementById('ft-status').addEventListener('change', renderizar);
document.getElementById('ft-empresa').addEventListener('change', renderizar);
document.getElementById('ft-demanda').addEventListener('change', renderizar);
document.getElementById('ft-busca').addEventListener('input', renderizar);

carregar();
setInterval(carregar, 20000);
