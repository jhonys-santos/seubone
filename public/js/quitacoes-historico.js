// Histórico de quitações — itens já pagos, mesma regra de visibilidade da
// página de painel (colaborador vê só o que cadastrou, gestor vê tudo).

function setDefaultDatas() {
  const hoje = new Date();
  const trintaDiasAtras = new Date();
  trintaDiasAtras.setDate(hoje.getDate() - 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  document.getElementById('desde').value = fmt(trintaDiasAtras);
  document.getElementById('ate').value = fmt(hoje);
}
setDefaultDatas();

let itensCarregados = [];

async function carregar() {
  const desde = document.getElementById('desde').value;
  const ate = document.getElementById('ate').value;

  try {
    const resp = await fetch(`/quitacoes/api/historico?desde=${desde}&ate=${ate}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.erro || 'Erro desconhecido');

    itensCarregados = data.itens;
    document.getElementById('statTotal').textContent = itensCarregados.length;

    const tabela = document.getElementById('tabela');
    if (itensCarregados.length === 0) {
      tabela.innerHTML = `<div class="empty">Nenhuma quitação no período selecionado.</div>`;
      return;
    }

    tabela.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Venda Omie</th><th>Cliente</th><th>Cadastrado em</th><th>Pago em</th>${window.QT_USUARIO_ROLE === 'gestor' ? '<th>Cadastrado por</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${itensCarregados.map((it) => `
            <tr class="linha-clicavel" onclick="abrirDetalhe('${it.id}')">
              <td class="mono">${it.idVendaOmie}</td>
              <td>${it.cliente}</td>
              <td>${new Date(it.dataCadastro).toLocaleString('pt-BR')}</td>
              <td>${it.dataPagamento ? new Date(it.dataPagamento).toLocaleString('pt-BR') : '-'}</td>
              ${window.QT_USUARIO_ROLE === 'gestor' ? `<td>${it.cadastradoPorNome}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    document.getElementById('tabela').innerHTML = `<div class="empty">Erro ao carregar.</div>`;
  }
}

function abrirDetalhe(id) {
  const it = itensCarregados.find((x) => x.id === id);
  if (!it) return;

  document.getElementById('modalConteudo').innerHTML = `
    <div class="pedido-top">
      <div>
        <div class="pedido-os mono">Venda ${it.idVendaOmie}</div>
        <div class="pedido-cliente">${it.cliente}</div>
      </div>
      <span class="badge ok">Pago</span>
    </div>

    ${it.observacao ? `<div class="observacao"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${it.observacao}</div>` : ''}

    <div class="pedido-meta">
      <div><div class="k">Bitrix/Lulu 2.0</div><a href="${it.linkCrm}" target="_blank">Abrir pedido →</a></div>
      <div><div class="k">Modalidade</div>${it.modalidade}</div>
      ${it.tipoEnvioAereo ? `<div><div class="k">Envio aéreo</div>${it.tipoEnvioAereo}${it.aeroporto ? ' — ' + it.aeroporto : ''}</div>` : ''}
      ${it.freteDedicado ? `<div><div class="k">Transportadora</div>${it.transportadora}</div><div><div class="k">Entregador</div>${it.entregador}</div>` : ''}
      ${it.dataPrevista ? `<div><div class="k">Previsto p/ quitação</div>${new Date(it.dataPrevista + 'T00:00:00').toLocaleDateString('pt-BR')}</div>` : ''}
      <div><div class="k">Cadastrado por</div>${it.cadastradoPorNome} — ${new Date(it.dataCadastro).toLocaleString('pt-BR')}</div>
      ${it.dataPagamento ? `<div><div class="k">Pago em</div>${new Date(it.dataPagamento).toLocaleString('pt-BR')}</div>` : ''}
    </div>
  `;

  document.getElementById('modalOverlay').classList.add('aberto');
}

function fecharDetalhe() {
  document.getElementById('modalOverlay').classList.remove('aberto');
}

carregar();
