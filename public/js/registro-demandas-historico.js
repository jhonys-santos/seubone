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
  return anexos.map((a, i) => {
    const nome = escapeHtml(a.nome) || ('anexo ' + (i + 1));
    const abrir = `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${nome}</a>`;
    const download = a.downloadUrl
      ? ` <a href="${escapeHtml(a.downloadUrl)}" target="_blank" rel="noopener" title="Baixar ${nome}">(baixar)</a>`
      : '';
    return abrir + download;
  }).join('<br>');
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
      <td>${formatarData(s.DataVencimento) || '—'}</td>
      <td>${escapeHtml(s.IDCompra)}</td>
      <td>${s.LinkCard ? `<a class="link-btn" href="${escapeHtml(s.LinkCard)}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Abrir</a>` : '—'}</td>
      <td>${escapeHtml(s.Solicitante)}</td>
      <td>${escapeHtml(s.Empresa) || '—'}</td>
      <td>${escapeHtml(s.DemandaSolicitada) || '—'}</td>
      <td>${escapeHtml(s.Observacao) || '—'}</td>
      <td>${renderizarAnexos(s.Anexos)}</td>
      <td><span class="badge ${s.Status === 'Feito' ? 'ok' : 'warn'}">${s.Status}</span></td>
      <td>${escapeHtml(s.FeitoPor) || '—'}</td>
      <td><button class="btn-secondary" style="width:auto;padding:7px 12px;font-size:12px;" onclick="alternarStatus('${s.ID}', '${s.Status}')">
        ${s.Status === 'Feito' ? 'Marcar pendente' : 'Marcar feito'}
      </button></td>
    </tr>
  `).join('');
}

async function alternarStatus(id, statusAtual) {
  const novoStatus = statusAtual === 'Feito' ? 'Pendente' : 'Feito';
  let marcadoPor = '';
  if (novoStatus === 'Feito') {
    marcadoPor = await hubPrompt('Seu nome (quem está marcando como feito):', { textoConfirmar: 'Marcar feito' });
    if (!marcadoPor) return;
  }
  try {
    const resp = await fetch('/registro-demandas/api/marcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, status: novoStatus, marcadoPor: marcadoPor }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.erro || 'erro ao atualizar');
    carregar();
  } catch (err) {
    await hubAlert('Erro ao atualizar status: ' + err.message, 'erro');
  }
}

document.getElementById('btn-filtrar').addEventListener('click', renderizar);
document.getElementById('ft-status').addEventListener('change', renderizar);
document.getElementById('ft-empresa').addEventListener('change', renderizar);
document.getElementById('ft-demanda').addEventListener('change', renderizar);
document.getElementById('ft-busca').addEventListener('input', renderizar);

carregar();
setInterval(carregar, 20000);
