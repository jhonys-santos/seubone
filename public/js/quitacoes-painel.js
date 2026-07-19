// Painel de quitações pendentes — lista (não kanban). Colaborador só recebe
// do servidor o que ele mesmo cadastrou; gestor recebe tudo, por isso só ele
// vê a coluna "Cadastrado por".

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function marcarComoPago(id, idVendaOmie) {
  const ok = await hubConfirm(`Confirmar que a venda ${idVendaOmie} já foi quitada pelo cliente?`);
  if (!ok) return;
  try {
    const resp = await fetch('/quitacoes/api/marcar-pago', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await resp.json();
    if (data.ok) {
      carregar();
    } else {
      await hubAlert('Erro: ' + (data.erro || 'não foi possível marcar como pago'), 'erro');
    }
  } catch (e) {
    await hubAlert('Erro de conexão ao marcar como pago.', 'erro');
  }
}

async function carregar() {
  try {
    const resp = await fetch('/quitacoes/api/lista');
    const data = await resp.json();
    if (!data.ok) throw new Error(data.erro || 'Erro desconhecido');

    const itens = data.itens;
    const comFrete = itens.filter((it) => it.freteDedicado).length;
    document.getElementById('statTotal').textContent = itens.length;
    document.getElementById('statFrete').textContent = comFrete;

    const lista = document.getElementById('lista');
    if (itens.length === 0) {
      lista.innerHTML = `<div class="empty"><div class="big"><i class="ti ti-circle-check" aria-hidden="true"></i></div>Nenhuma quitação pendente agora.</div>`;
      return;
    }

    lista.innerHTML = itens.map((it) => `
      <div class="pedido">
        <div class="pedido-top">
          <div>
            <div class="pedido-os mono">Venda ${it.idVendaOmie}</div>
            <div class="pedido-cliente">${it.cliente}</div>
          </div>
          ${it.freteDedicado ? '<span class="badge warn">Frete dedicado</span>' : ''}
        </div>
        <div class="pedido-meta">
          <div><div class="k">Modalidade</div>${it.modalidade}</div>
          ${it.tipoEnvioAereo ? `<div><div class="k">Envio aéreo</div>${it.tipoEnvioAereo}${it.aeroporto ? ' — ' + it.aeroporto : ''}</div>` : ''}
          ${it.freteDedicado ? `<div><div class="k">Transportadora</div>${it.transportadora}</div><div><div class="k">Entregador</div>${it.entregador}</div>` : ''}
          <div><div class="k">Bitrix/Lulu 2.0</div><a href="${it.linkCrm}" target="_blank">Abrir pedido →</a></div>
          <div><div class="k">Cadastrado em</div>${formatarData(it.dataCadastro)}</div>
          ${window.QT_USUARIO_ROLE === 'gestor' ? `<div><div class="k">Cadastrado por</div>${it.cadastradoPorNome}</div>` : ''}
        </div>
        ${it.observacao ? `<div class="observacao"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${it.observacao}</div>` : ''}
        <div class="pedido-actions">
          <button class="btn-dispatch" onclick="marcarComoPago('${it.id}', '${it.idVendaOmie}')"><i class="ti ti-check" aria-hidden="true"></i> Marcar como pago</button>
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('lista').innerHTML = `<div class="empty">Erro ao carregar.</div>`;
  }
}

carregar();
