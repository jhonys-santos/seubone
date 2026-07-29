// Histórico de Pagamentos — mesma planilha "Pagamentos" usada pelo
// "Solicitar pagamento" de Corridas Avulsas e por esse formulário geral;
// aqui aparecem os dois juntos. Endpoint: /registro-demandas/api/list-pagamento.

let pagamentos = [];

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

async function carregar() {
  try {
    const resp = await fetch('/registro-demandas/api/list-pagamento');
    const data = await resp.json();
    if (data.erro) throw new Error(data.erro);
    pagamentos = Array.isArray(data) ? data : [];
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

  lista = lista.slice().sort((a, b) => new Date(b.InseridoEm) - new Date(a.InseridoEm));

  if (lista.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = lista.map((p) => `
    <tr>
      <td>${formatarData(p.DataVencimento) || '—'}</td>
      <td>${escapeHtml(p.Solicitante)}</td>
      <td>${escapeHtml(p.RazaoSocial)}</td>
      <td>${escapeHtml(p.CPFCNPJ)}</td>
      <td>${escapeHtml(p.Motivo)}</td>
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
}

document.getElementById('btn-filtrar').addEventListener('click', renderizar);
document.getElementById('ft-status').addEventListener('change', renderizar);
document.getElementById('ft-banco').addEventListener('change', renderizar);
document.getElementById('ft-busca').addEventListener('input', renderizar);

carregar();
setInterval(carregar, 20000);
