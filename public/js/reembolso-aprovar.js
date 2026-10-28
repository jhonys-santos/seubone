// Tela "Aprovar Reembolsos" (só gestor): lista os reembolsos aguardando decisão e os já decididos; Aprovar/Negar movem o card no finfin. esc() vem do ui.js.
(function () {
  'use strict';
  const API = '/registro-demandas/reembolso/aprovar/api';
  const $ = (id) => document.getElementById(id);

  const brl = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const dataBr = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
  const docFmt = (d) => { const n = String(d || '').replace(/\D/g, ''); return n.length === 11 ? n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : n.length === 14 ? n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : (d || '—'); };
  const PIX = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Aleatória' };

  let aba = 'pendentes';
  let itens = [];
  let decidindo = null;   // { item, decisao }

  const mostrarErro = (m) => { const e = $('raErro'); e.textContent = m || ''; e.style.display = m ? '' : 'none'; };
  const mostrarOk = (m) => { const e = $('raOk'); e.textContent = m || ''; e.style.display = m ? '' : 'none'; };

  async function carregar() {
    mostrarErro('');
    try {
      const res = await fetch(`${API}/lista?aba=${aba}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.erro || 'Não consegui carregar a lista');
      itens = json.itens;
    } catch (e) {
      mostrarErro(e.message); itens = [];
    }
    if (aba === 'pendentes') $('raContPendentes').textContent = itens.length ? String(itens.length) : '';
    render();
  }

  function cardHtml(i) {
    const dias = Math.max(0, Math.floor((Date.now() - new Date(i.criadoEm).getTime()) / 86400000));
    const esperando = aba === 'pendentes' ? ` · aguarda há ${dias === 0 ? 'menos de 1 dia' : dias + ' dia(s)'}` : '';
    const decisao = i.decisao
      ? `<p class="ra-decisao"><span class="ra-tag" data-tom="${i.decisao.decisao === 'aprovado' ? 'ok' : 'bad'}">${i.decisao.decisao === 'aprovado' ? 'Aprovado' : 'Negado'}</span> por <b>${esc(i.decisao.por || '—')}</b> em ${esc(dataHora(i.decisao.em))}${i.decisao.motivo ? `<small>${i.decisao.decisao === 'negado' ? 'Motivo' : 'Observação'}: ${esc(i.decisao.motivo)}</small>` : ''}<small>Hoje no finfin: ${esc(i.colunaNome)}</small></p>`
      : '';
    const pix = i.pixChave ? `${esc(PIX[i.pixTipo] || i.pixTipo)}: ${esc(i.pixChave)}` : '—';
    const acoes = aba === 'pendentes'
      ? `<div class="ra-acoes"><button type="button" class="ra-neg" data-neg="${esc(i.codigo)}">Negar</button><button type="button" class="ra-btn" data-apr="${esc(i.codigo)}">Aprovar</button></div>`
      : '';
    return `<article class="ra-card">
      <div class="ra-topo">
        <div><span class="ra-codigo">${esc(i.codigo)}</span> ${i.teste ? '<span class="ra-tag" data-tom="aviso">teste</span>' : ''}
          <div class="ra-sub">${esc(i.solicitante || '—')} · pedido em ${esc(dataHora(i.criadoEm))}${esperando}</div></div>
        <div class="ra-valor">${esc(brl(i.valor))}</div>
      </div>
      <p class="ra-motivo">${esc(i.motivo || '—')}</p>
      <dl class="ra-dados">
        <div><dt>ID da venda</dt><dd>${i.linkLulu ? `<a href="${esc(i.linkLulu)}" target="_blank" rel="noopener">${esc(i.idVenda || 'ver no Lulu')}</a>` : esc(i.idVenda || '—')}</dd></div>
        <div><dt>Cliente</dt><dd>${esc(i.cliente || '—')}</dd></div>
        <div><dt>CPF/CNPJ</dt><dd>${esc(docFmt(i.cpfCnpj))}</dd></div>
        <div><dt>Vencimento</dt><dd>${esc(dataBr(i.vencimento))}</dd></div>
        <div><dt>Banco / agência / conta</dt><dd>${esc(i.banco || '—')} · ${esc(i.agencia || '—')} · ${esc(i.conta || '—')}</dd></div>
        <div><dt>Chave pix</dt><dd>${pix}</dd></div>
        <div><dt>Anexos enviados</dt><dd>${i.anexos.length ? esc(i.anexos.join(', ')) + ' <span class="ra-sub">(ver no finfin)</span>' : 'nenhum'}</dd></div>
        <div><dt>Situação no finfin</dt><dd>${esc(i.colunaNome)}</dd></div>
      </dl>
      ${decisao}${acoes}
    </article>`;
  }

  function render() {
    const el = $('raLista');
    if (!itens.length) { el.innerHTML = `<p class="ra-vazio">${aba === 'pendentes' ? 'Nenhum reembolso aguardando decisão.' : 'Nenhum reembolso decidido pelo hub ainda.'}</p>`; return; }
    el.innerHTML = itens.map(cardHtml).join('');
    el.querySelectorAll('[data-apr]').forEach((b) => b.addEventListener('click', () => abrirModal(itens.find((x) => x.codigo === b.dataset.apr), 'aprovar')));
    el.querySelectorAll('[data-neg]').forEach((b) => b.addEventListener('click', () => abrirModal(itens.find((x) => x.codigo === b.dataset.neg), 'negar')));
  }

  // ── Modal de decisão ──
  function abrirModal(item, decisao) {
    if (!item) return;
    decidindo = { item, decisao };
    const neg = decisao === 'negar';
    $('raModalTitulo').textContent = neg ? 'Negar reembolso' : 'Aprovar reembolso';
    $('raModalResumo').textContent = `${item.codigo} · ${item.solicitante || ''} · ${brl(item.valor)} · ${item.cliente || ''}`;
    $('raRotuloMotivo').textContent = neg ? 'Motivo da negativa (obrigatório)' : 'Observação (opcional)';
    $('raMotivo').value = ''; $('raMotivo').placeholder = neg ? 'Explique por que o reembolso foi negado. O solicitante vê este texto.' : 'Se quiser, deixe um recado para o solicitante.';
    $('raDicaModal').textContent = neg
      ? 'O card vai para "Negado" no finfin. O motivo fica no hub e vai no aviso ao solicitante (o finfin não recebe comentário).'
      : 'O card vai para "Aprovado" no finfin e o solicitante é avisado. O pagamento continua com o financeiro.';
    const conf = $('raModalConfirmar');
    conf.textContent = neg ? 'Negar reembolso' : 'Aprovar reembolso'; conf.className = neg ? 'ra-neg' : 'ra-btn'; conf.disabled = false;
    $('raModalErro').style.display = 'none';
    $('raModal').hidden = false;
    $('raMotivo').focus();
  }
  function fecharModal() { $('raModal').hidden = true; decidindo = null; }

  async function confirmar() {
    if (!decidindo) return;
    const { item, decisao } = decidindo;
    const motivo = $('raMotivo').value.trim();
    const erroEl = $('raModalErro');
    if (decisao === 'negar' && motivo.length < 5) { erroEl.textContent = 'Informe o motivo da negativa (pelo menos 5 caracteres).'; erroEl.style.display = ''; return; }
    const conf = $('raModalConfirmar');
    conf.disabled = true; conf.textContent = 'Enviando ao finfin…'; erroEl.style.display = 'none';
    try {
      const res = await fetch(`${API}/decidir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: item.codigo, decisao, motivo }) });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        erroEl.textContent = json.erro || 'Não foi possível concluir';
        erroEl.style.display = '';
        conf.disabled = false; conf.textContent = decisao === 'negar' ? 'Negar reembolso' : 'Aprovar reembolso';
        if (res.status === 409) { setTimeout(() => { fecharModal(); carregar(); }, 2500); }   // alguém já decidiu: atualiza a lista
        return;
      }
      fecharModal();
      mostrarOk(`${item.codigo}: ${decisao === 'negar' ? 'negado' : 'aprovado'}. ${json.aviso ? json.aviso : 'O card já foi movido no finfin e o solicitante foi avisado.'}`);
      await carregar();
    } catch (e) {
      erroEl.textContent = 'Sem conexão com o servidor. Confira se o card mudou de coluna antes de tentar de novo.'; erroEl.style.display = '';
      conf.disabled = false; conf.textContent = decisao === 'negar' ? 'Negar reembolso' : 'Aprovar reembolso';
    }
  }

  // ── Eventos ──
  document.querySelectorAll('.ra-aba').forEach((b) => b.addEventListener('click', () => {
    aba = b.dataset.aba;
    document.querySelectorAll('.ra-aba').forEach((x) => x.classList.toggle('ra-ativa', x === b));
    mostrarOk(''); itens = []; render(); carregar();
  }));
  $('raAtualizar').addEventListener('click', () => { mostrarOk(''); carregar(); });
  $('raModalCancelar').addEventListener('click', fecharModal);
  $('raModal').addEventListener('click', (e) => { if (e.target === $('raModal')) fecharModal(); });
  $('raModalConfirmar').addEventListener('click', confirmar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('raModal').hidden) fecharModal(); });
  setInterval(() => { if (!document.hidden && $('raModal').hidden) carregar(); }, 60000);

  carregar();
})();
