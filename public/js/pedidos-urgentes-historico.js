// Histórico de pedidos urgentes — portado do historico.html original.
// Mudança: endpoint agora é /pedidos-urgentes/api/list.

function setDefaultDatas() {
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const fmt = d => d.toISOString().slice(0, 10);
  document.getElementById('desde').value = fmt(seteDiasAtras);
  document.getElementById('ate').value = fmt(hoje);
}
setDefaultDatas();

function mesmoDia(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

let pedidosCarregados = [];

async function carregar() {
  const desde = document.getElementById('desde').value;
  const ate = document.getElementById('ate').value;

  try {
    const resp = await fetch(`/pedidos-urgentes/api/list?desde=${desde}&ate=${ate}`);
    const pedidos = await resp.json();

    pedidos.sort((a, b) => new Date(b.InseridoEm) - new Date(a.InseridoEm));
    pedidosCarregados = pedidos;

    const despachados = pedidos.filter(p => p.Status === 'Despachado' && p.DespachadoEm);
    const noMesmoDia = despachados.filter(p => mesmoDia(new Date(p.InseridoEm), new Date(p.DespachadoEm)));
    const pctMesmoDia = despachados.length > 0 ? Math.round((noMesmoDia.length / despachados.length) * 100) : 0;

    let tempoMedioTxt = '-';
    if (despachados.length > 0) {
      const totalMin = despachados.reduce((acc, p) => acc + (new Date(p.DespachadoEm) - new Date(p.InseridoEm)) / 60000, 0);
      const mediaMin = Math.round(totalMin / despachados.length);
      tempoMedioTxt = mediaMin < 60 ? `${mediaMin} min` : `${(mediaMin / 60).toFixed(1)} h`;
    }

    document.getElementById('statTotal').textContent = pedidos.length;
    document.getElementById('statMesmoDia').textContent = despachados.length > 0 ? `${pctMesmoDia}%` : '-';
    document.getElementById('statTempoMedio').textContent = tempoMedioTxt;

    const tabela = document.getElementById('tabela');
    if (pedidos.length === 0) {
      tabela.innerHTML = `<div class="empty">Nenhum pedido no período selecionado.</div>`;
      return;
    }

    tabela.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>OS</th><th>Cliente</th><th>Status</th><th>Inserido em</th><th>Despachado em</th><th>Tempo</th>
          </tr>
        </thead>
        <tbody>
          ${pedidos.map(p => {
            const inserido = new Date(p.InseridoEm);
            const despachado = p.DespachadoEm ? new Date(p.DespachadoEm) : null;
            const tempo = despachado ? `${Math.round((despachado - inserido) / 60000)} min` : '-';
            const statusBadge = p.Status === 'Despachado'
              ? `<span class="badge ok">Despachado</span>`
              : `<span class="badge warn">Pendente</span>`;
            return `
              <tr class="linha-clicavel" onclick="abrirDetalhe('${p.ID}')">
                <td class="mono">${p.OS}</td>
                <td>${p.Cliente}</td>
                <td>${statusBadge}</td>
                <td>${inserido.toLocaleString('pt-BR')}</td>
                <td>${despachado ? despachado.toLocaleString('pt-BR') : '-'}</td>
                <td>${tempo}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    document.getElementById('tabela').innerHTML = `<div class="empty">Erro ao carregar.</div>`;
  }
}

function abrirDetalhe(id) {
  const p = pedidosCarregados.find(x => x.ID === id);
  if (!p) return;

  const inserido = new Date(p.InseridoEm);
  const despachado = p.DespachadoEm ? new Date(p.DespachadoEm) : null;
  const statusBadge = p.Status === 'Despachado'
    ? `<span class="badge ok">Despachado</span>`
    : `<span class="badge warn">Pendente</span>`;

  document.getElementById('modalConteudo').innerHTML = `
    <div class="pedido-top">
      <div>
        <div class="pedido-os mono">${p.OS}</div>
        <div class="pedido-cliente">${p.Cliente}</div>
      </div>
      ${statusBadge}
    </div>

    ${p.Observacao ? `<div class="observacao"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${p.Observacao}</div>` : ''}

    <div class="pedido-meta">
      <div><div class="k">Bitrix/Lulu 2.0</div><a href="${p.LinkCRM}" target="_blank">Abrir pedido →</a></div>
      <div><div class="k">Transportadora</div>${p.Transportadora}</div>
      <div><div class="k">Modalidade</div>${p.Modalidade}</div>
      ${p.TipoEnvioAereo ? `<div><div class="k">Envio aéreo</div>${p.TipoEnvioAereo}${p.AeroportoRetirada ? ' — ' + p.AeroportoRetirada : ''}</div>` : ''}
      <div><div class="k">Prazo</div>${new Date(p.Prazo).toLocaleString('pt-BR')}</div>
      <div><div class="k">Inserido por</div>${p.InseridoPor} — ${inserido.toLocaleString('pt-BR')}</div>
      ${despachado ? `<div><div class="k">Despachado por</div>${p.DespachadoPor} — ${despachado.toLocaleString('pt-BR')}</div>` : ''}
      ${p.ManifestoLink ? `<div><div class="k">Minuta</div><a href="${p.ManifestoLink}" target="_blank">Ver PDF →</a></div>` : ''}
      ${p.NotaFiscalLink ? `<div><div class="k">Nota fiscal</div><a href="${p.NotaFiscalLink}" target="_blank">Baixar PDF →</a></div>` : ''}
    </div>

    ${p.OSImagemId ? `<img class="os-thumb" src="https://drive.google.com/thumbnail?id=${p.OSImagemId}&sz=w400" alt="Foto da OS ${p.OS}" onclick="window.open('https://drive.google.com/thumbnail?id=${p.OSImagemId}&sz=w1600','_blank')">` : ''}
  `;

  document.getElementById('modalOverlay').classList.add('aberto');
}

function fecharDetalhe() {
  document.getElementById('modalOverlay').classList.remove('aberto');
}

carregar();
