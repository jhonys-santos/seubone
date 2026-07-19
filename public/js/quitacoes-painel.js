// Painel de quitações pendentes — lista (não kanban). Colaborador só recebe
// do servidor o que ele mesmo cadastrou; gestor recebe tudo, por isso só ele
// vê a coluna "Cadastrado por".

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Sinaliza o quão urgente é cobrar cada quitação: prioriza a data prevista
// (quando o consultor informou), senão cai para "há quantos dias está em
// aberto" — mesma lógica de sinalização por prazo já usada em Pedidos
// Urgentes, só que aqui o prazo é a quitação em vez do despacho.
function calcularUrgencia(it) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  if (it.dataPrevista) {
    const prevista = new Date(it.dataPrevista + 'T00:00:00');
    const diffDias = Math.round((prevista - hoje) / 86400000);
    if (diffDias < 0) return { nivel: 'danger', rotulo: `Atrasado ${Math.abs(diffDias)}d`, score: diffDias };
    if (diffDias <= 3) return { nivel: 'warn', rotulo: diffDias === 0 ? 'Vence hoje' : `Vence em ${diffDias}d`, score: diffDias };
    return { nivel: 'ok', rotulo: `Previsto p/ ${prevista.toLocaleDateString('pt-BR')}`, score: diffDias };
  }

  const cadastro = new Date(it.dataCadastro);
  cadastro.setHours(0, 0, 0, 0);
  const diasAberto = Math.max(0, Math.round((hoje - cadastro) / 86400000));
  const nivel = diasAberto > 7 ? 'danger' : diasAberto > 3 ? 'warn' : 'ok';
  return { nivel, rotulo: `${diasAberto}d em aberto`, score: -diasAberto };
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

    const itens = data.itens
      .map((it) => ({ ...it, urgencia: calcularUrgencia(it) }))
      .sort((a, b) => {
        const rank = { danger: 0, warn: 1, ok: 2 };
        const diffRank = rank[a.urgencia.nivel] - rank[b.urgencia.nivel];
        return diffRank !== 0 ? diffRank : a.urgencia.score - b.urgencia.score;
      });

    const comFrete = itens.filter((it) => it.freteDedicado).length;
    const atrasados = itens.filter((it) => it.urgencia.nivel === 'danger').length;
    document.getElementById('statTotal').textContent = itens.length;
    document.getElementById('statAtrasados').textContent = atrasados;
    document.getElementById('statFrete').textContent = comFrete;

    const lista = document.getElementById('lista');
    if (itens.length === 0) {
      lista.innerHTML = `<div class="empty"><div class="big"><i class="ti ti-circle-check" aria-hidden="true"></i></div>Nenhuma quitação pendente agora.</div>`;
      return;
    }

    lista.innerHTML = itens.map((it) => `
      <div class="pedido ${it.urgencia.nivel}">
        <div class="pedido-top">
          <div>
            <div class="pedido-os mono">Venda ${it.idVendaOmie}</div>
            <div class="pedido-cliente">${it.cliente}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <span class="badge ${it.urgencia.nivel}">${it.urgencia.rotulo}</span>
            ${it.freteDedicado ? '<span class="badge warn">Frete dedicado</span>' : ''}
          </div>
        </div>
        <div class="pedido-meta">
          <div><div class="k">Modalidade</div>${it.modalidade}</div>
          ${it.tipoEnvioAereo ? `<div><div class="k">Envio aéreo</div>${it.tipoEnvioAereo}${it.aeroporto ? ' — ' + it.aeroporto : ''}</div>` : ''}
          ${it.freteDedicado ? `<div><div class="k">Transportadora</div>${it.transportadora}</div><div><div class="k">Entregador</div>${it.entregador}</div>` : ''}
          <div><div class="k">Bitrix/Lulu 2.0</div><a href="${it.linkCrm}" target="_blank">Abrir pedido →</a></div>
          <div><div class="k">Cadastrado em</div>${formatarData(it.dataCadastro)}</div>
          ${it.dataPrevista ? `<div><div class="k">Previsto p/ quitação</div>${new Date(it.dataPrevista + 'T00:00:00').toLocaleDateString('pt-BR')}</div>` : ''}
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
