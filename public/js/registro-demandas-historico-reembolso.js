// Histórico de Reembolsos — portado do historico-reembolso.html original.
// Endpoint agora é /registro-demandas/api/list-reembolso (proxy do hub).

let reembolsos = [];

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
    const resp = await fetch('/registro-demandas/api/list-reembolso');
    const data = await resp.json();
    if (data.erro) throw new Error(data.erro);
    reembolsos = Array.isArray(data) ? data : [];
    renderizar();
  } catch (err) {
    console.error(err);
  }
}

function renderizar() {
  const de = document.getElementById('ft-de').value;
  const ate = document.getElementById('ft-ate').value;
  const statusFiltro = document.getElementById('ft-status').value;
  const bancoFiltro = document.getElementById('ft-banco').value;
  const empresaFiltro = document.getElementById('ft-empresa').value;
  const busca = document.getElementById('ft-busca').value.trim().toLowerCase();

  let lista = reembolsos.filter((r) => {
    const dataInserido = (r.InseridoEm || '').slice(0, 10);
    if (de && dataInserido < de) return false;
    if (ate && dataInserido > ate) return false;
    if (statusFiltro && r.Status !== statusFiltro) return false;
    if (bancoFiltro && r.Banco !== bancoFiltro) return false;
    if (empresaFiltro && r.EmpresaResponsavel !== empresaFiltro) return false;
    if (busca) {
      const alvo = ((r.IDReferencia || '') + ' ' + (r.RazaoSocialCliente || '') + ' ' + (r.CPFCNPJ || '')).toLowerCase();
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

  tbody.innerHTML = lista.map((r) => `
    <tr>
      <td>${formatarData(r.DataVencimento) || '—'}</td>
      <td>${escapeHtml(r.IDReferencia)}</td>
      <td>${escapeHtml(r.CPFCNPJ)}</td>
      <td>${escapeHtml(r.RazaoSocialCliente)}</td>
      <td>${escapeHtml(r.MotivoReembolso)}</td>
      <td>${escapeHtml(r.Banco)}</td>
      <td>${escapeHtml(r.Agencia)}</td>
      <td>${escapeHtml(r.Conta)}</td>
      <td>${escapeHtml(r.ChavePix)}${r.TipoChave ? ' (' + escapeHtml(r.TipoChave) + ')' : ''}</td>
      <td>${formatarValor(r.Valor)}</td>
      <td>${escapeHtml(r.EmpresaResponsavel) || '—'}</td>
      <td>${renderizarAnexos(r.Anexos)}</td>
      <td><span class="badge ${r.Status === 'Feito' ? 'ok' : 'warn'}">${r.Status}</span></td>
      <td>${escapeHtml(r.FeitoPor) || '—'}</td>
      <td><button class="btn-secondary" style="width:auto;padding:7px 12px;font-size:12px;" onclick="alternarStatus('${r.ID}', '${r.Status}')">
        ${r.Status === 'Feito' ? 'Marcar pendente' : 'Marcar feito'}
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
    const resp = await fetch('/registro-demandas/api/marcar-reembolso', {
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
document.getElementById('ft-banco').addEventListener('change', renderizar);
document.getElementById('ft-empresa').addEventListener('change', renderizar);
document.getElementById('ft-busca').addEventListener('input', renderizar);

carregar();
setInterval(carregar, 20000);
