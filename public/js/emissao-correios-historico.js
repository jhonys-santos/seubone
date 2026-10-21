// Histórico de emissões e consulta (Emissão Correios). Lista as pré-postagens do contrato + o registro do hub (/emissao-correios/api/historico),
// reimprime (10x15 / A4), cancela, consulta (situação, postagem e rastreio) e exporta CSV. esc() vem do ui.js.
(function () {
  'use strict';
  const API = '/emissao-correios/api';
  const $ = (id) => document.getElementById(id);
  const DIA = 86400000;

  const STATUS = [
    { valor: 'PREPOSTADO', rotulo: 'Aguardando postagem', tom: 'info' },
    { valor: 'POSTADO', rotulo: 'Postado', tom: 'ok' },
    { valor: 'PENDENTE', rotulo: 'Pendente', tom: 'aviso' },
    { valor: 'EXPIRADO', rotulo: 'Expirado', tom: 'erro' },
    { valor: 'CANCELADO', rotulo: 'Cancelado', tom: 'neutro' },
    { valor: 'ESTORNADO', rotulo: 'Estornado', tom: 'neutro' },
  ];
  const rotuloStatus = (v) => STATUS.find((x) => x.valor === v) || { valor: v, rotulo: v || '—', tom: 'neutro' };

  const SITUACAO = { ENTREGUE: 'Entregue', DEVOLVIDO: 'Devolvido ao remetente', COM_PROBLEMA: 'Com alerta', AGUARDANDO_RETIRADA: 'Aguardando retirada', EM_TRANSITO: 'Em trânsito' };
  const hojeBr = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const diasAtras = (n) => new Date(Date.now() - 3 * 3600000 - n * DIA).toISOString().slice(0, 10);
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
  const kg = (g) => (g == null ? '—' : `${(g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`);
  const brl = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

  let linhas = null;
  let filtroStatus = [];
  let carregando = false;

  function mostrarErro(msg) { const el = $('ecHErro'); el.textContent = msg || ''; el.style.display = msg ? '' : 'none'; }
  function mostrarAviso(msg) { const el = $('ecHAviso'); el.textContent = msg || ''; el.style.display = msg ? '' : 'none'; }

  async function carregar() {
    const de = $('ecHDe').value, ate = $('ecHAte').value;
    if (!de || !ate) return mostrarErro('Informe o período.');
    if (de > ate) return mostrarErro('A data inicial é depois da final.');
    carregando = true; mostrarErro(''); mostrarAviso('');
    $('ecHBuscar').disabled = true; $('ecHBuscar').textContent = 'Buscando…';
    if (!linhas || !linhas.length) $('ecHCorpo').innerHTML = '<tr><td colspan="9" class="ec-vazio">Consultando os Correios…</td></tr>';
    try {
      const res = await fetch(`${API}/historico?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) { mostrarErro(json.erro || 'Não foi possível carregar o histórico'); linhas = []; }
      else {
        linhas = json.itens;
        const avisos = [];
        if (json.aviso) avisos.push(json.aviso);
        if (json.limitadoA120Dias) avisos.push('O período começou antes de 120 dias atrás. Os Correios só guardam os últimos 120 dias: antes disso aparecem só as emissões feitas pelo hub.');
        mostrarAviso(avisos.join(' '));
      }
    } catch (e) {
      mostrarErro('Sem conexão com o servidor. Tente novamente.');
    } finally {
      carregando = false;
      $('ecHBuscar').disabled = false; $('ecHBuscar').textContent = 'Buscar';
    }
    render();
  }

  function visiveis() {
    const t = $('ecHBusca').value.trim().toLowerCase();
    const dig = t.replace(/\D/g, '');
    return (linhas || []).filter((l) => (!filtroStatus.length || filtroStatus.includes(l.status)) && (!t
      || [l.codigoObjeto, l.pedido, l.destinatario, l.cidadeUf, l.observacao, l.servico, l.emitidoPor, l.criadoPor].some((v) => v && String(v).toLowerCase().includes(t))
      || (dig.length >= 4 && [l.chaveNFe, l.cep].some((v) => v && String(v).includes(dig)))));
  }

  function renderChips() {
    const cont = new Map();
    (linhas || []).forEach((l) => cont.set(l.status, (cont.get(l.status) || 0) + 1));
    $('ecHChips').innerHTML = STATUS.filter((x) => cont.get(x.valor) || filtroStatus.includes(x.valor)).map((x) =>
      `<button type="button" class="ec-chip" data-status="${x.valor}" aria-pressed="${filtroStatus.includes(x.valor)}">${esc(x.rotulo)} <b>${cont.get(x.valor) || 0}</b></button>`).join('');
    $('ecHChips').querySelectorAll('.ec-chip').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.status;
      filtroStatus = filtroStatus.includes(v) ? filtroStatus.filter((x) => x !== v) : filtroStatus.concat(v);
      render();
    }));
  }

  function render() {
    renderChips();
    const lista = visiveis();
    $('ecHContador').textContent = linhas ? `${lista.length} de ${linhas.length}` : '';
    $('ecHCsv').disabled = !lista.length;
    const corpo = $('ecHCorpo');
    if (carregando && !(linhas && linhas.length)) return;
    if (!lista.length) { corpo.innerHTML = '<tr><td colspan="9" class="ec-vazio">Nenhuma etiqueta neste filtro.</td></tr>'; return; }
    corpo.innerHTML = lista.map((l) => {
      const st = rotuloStatus(l.status);
      const divergente = l.pesoG && l.pesoAferidoG && l.pesoAferidoG > l.pesoG * 1.1;
      const vencendo = l.status === 'PREPOSTADO' && l.prazoPostagem && new Date(l.prazoPostagem).getTime() - Date.now() < 4 * DIA;
      const quem = l.emitidoPor ? `${esc(l.emitidoPor)} (hub)` : l.criadoPor ? esc(l.criadoPor) : '';
      const id = esc(l.id);
      return `<tr>
        <td class="ec-num">${esc(dataHora(l.criadoEm))}<small>${quem}</small></td>
        <td class="ec-codigoCel">${esc(l.codigoObjeto || '—')}</td>
        <td>${esc(l.servico || '—')}${l.volume ? ` <small>vol. ${esc(l.volume)}</small>` : `<small>${esc(l.codigoServico || '')}</small>`}</td>
        <td><span class="ec-status" data-tom="${st.tom}">${esc(st.rotulo)}</span>${l.canceladoPor ? `<small>por ${esc(l.canceladoPor)}</small>` : ''}</td>
        <td class="ec-dest">${esc(l.destinatario || '—')}<small>${esc(l.cidadeUf || '')}</small></td>
        <td>${esc(l.pedido || '—')}</td>
        <td class="ec-num"${divergente ? ' data-alerta="1"' : ''}>${esc(kg(l.pesoG))}${l.pesoAferidoG != null ? `<small title="Peso medido na agência">aferido ${esc(kg(l.pesoAferidoG))}</small>` : ''}</td>
        <td class="ec-num"${vencendo ? ' data-alerta="1"' : ''}>${l.status === 'PREPOSTADO' ? esc(data(l.prazoPostagem)) : '—'}</td>
        <td><div class="ec-celAcoes">
          ${l.podeReimprimir ? `<a class="ec-acao" href="${API}/${encodeURIComponent(l.id)}/pdf?layout=LINEAR_100_150" target="_blank" rel="noopener">10x15</a><a class="ec-acao" href="${API}/${encodeURIComponent(l.id)}/pdf?layout=PADRAO" target="_blank" rel="noopener">A4</a>` : ''}
          <button type="button" class="ec-acao" data-consultar="${id}">Consultar</button>
          ${l.podeCancelar ? `<button type="button" class="ec-acao ec-acaoPerigo" data-cancelar="${id}">Cancelar</button>` : ''}
        </div></td>
      </tr>`;
    }).join('');
    corpo.querySelectorAll('[data-consultar]').forEach((b) => b.addEventListener('click', () => consultar(linhas.find((l) => l.id === b.dataset.consultar))));
    corpo.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => cancelar(linhas.find((l) => l.id === b.dataset.cancelar), b)));
  }

  // ── Cancelar ──
  async function cancelar(l, btn) {
    if (!l) return;
    const ok = await hubConfirm(`Cancelar a pré-postagem${l.codigoObjeto ? ' ' + l.codigoObjeto : ''}? Só dá para cancelar antes de postar na agência.`, { textoConfirmar: 'Cancelar etiqueta', textoCancelar: 'Voltar' });
    if (!ok) return;
    btn.disabled = true; btn.textContent = 'Cancelando…'; mostrarErro('');
    try {
      const res = await fetch(`${API}/${encodeURIComponent(l.id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { mostrarErro(json.erro || 'Não foi possível cancelar'); }
      else { Object.assign(l, { status: json.status || 'CANCELADO', podeCancelar: false, podeReimprimir: false }); }
    } catch (e) {
      mostrarErro('Sem conexão com o servidor. Tente novamente.');
    }
    render();
  }

  // ── Consultar (situação, postagem e rastreio) ──
  function fecharModal() { $('ecHModal').hidden = true; }
  async function consultar(l) {
    if (!l) return;
    $('ecHModalTitulo').textContent = l.codigoObjeto ? `Consulta ${l.codigoObjeto}` : 'Consulta';
    $('ecHModalCorpo').innerHTML = '<p class="ec-vazio">Consultando os Correios…</p>';
    $('ecHModal').hidden = false;
    try {
      const q = new URLSearchParams();
      if (!l.somenteLocal) q.set('id', l.id);
      if (l.codigoObjeto) q.set('codigo', l.codigoObjeto);
      const res = await fetch(`${API}/consulta?${q}`, { cache: 'no-store' });
      const c = await res.json();
      if (!res.ok) throw new Error(c.erro || 'Não foi possível consultar');
      $('ecHModalCorpo').innerHTML = renderConsulta(l, c);
      // O status pode ter mudado desde a lista (ex.: postado): atualiza a linha
      if (c.status && c.status !== l.status) { l.status = c.status; l.podeCancelar = c.status === 'PREPOSTADO' || c.status === 'PENDENTE'; l.podeReimprimir = c.status === 'PREPOSTADO'; render(); }
    } catch (e) {
      $('ecHModalCorpo').innerHTML = `<p class="ec-erro">${esc(e.message)}</p>`;
    }
  }

  function renderConsulta(l, c) {
    const st = rotuloStatus(c.status || l.status);
    const r = c.rastreio;
    const campos = [
      ['Situação da etiqueta', `<span class="ec-status" data-tom="${st.tom}">${esc(st.rotulo)}</span>`],
      ['Serviço', esc(c.servico || l.servico || '—')],
      ['Destinatário', esc(l.destinatario || '—') + (l.cidadeUf ? ` · ${esc(l.cidadeUf)}` : '')],
      ['Pedido', esc(l.pedido || '—')],
      ['Emitido por', esc(l.emitidoPor ? `${l.emitidoPor} (hub)` : l.criadoPor || '—')],
      ['Criado em', esc(dataHora(l.criadoEm))],
    ];
    if (c.status === 'PREPOSTADO' && c.prazoPostagem) campos.push(['Levar à agência até', esc(data(c.prazoPostagem))]);
    if (c.postagem) {
      if (c.postagem.postadoEm) campos.push(['Postado em', esc(dataHora(c.postagem.postadoEm))]);
      if (c.postagem.valor != null) campos.push(['Valor cobrado', esc(brl(c.postagem.valor))]);
      if (c.postagem.pesoTarifadoG != null) campos.push(['Peso tarifado', esc(kg(c.postagem.pesoTarifadoG))]);
    }
    if (r) {
      // Evento que o catálogo dos Correios não conhece conta como alerta no rastreio do CRM; aqui só vale alerta de evento catalogado
      const alertaReal = (r.ocorrencias || []).some((o) => o.alerta && o.catalogado);
      const situacao = r.situacao === 'COM_PROBLEMA' && !alertaReal ? 'EM_TRANSITO' : r.situacao;
      campos.push(['Situação do rastreio', esc(SITUACAO[situacao] || situacao || '—')]);
      if (r.entregueEm) campos.push(['Entregue em', esc(dataHora(r.entregueEm))]);
      else if (r.previsaoEntrega) campos.push(['Previsão de entrega', esc(data(r.previsaoEntrega)) + (r.previsaoVencida ? ' (vencida)' : '')]);
    }
    const dl = '<dl>' + campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('') + '</dl>';
    let eventos = '';
    if (r && r.ocorrencias && r.ocorrencias.length) {
      eventos = '<h3>Rastreio</h3><ul class="ec-linhaTempo">' + r.ocorrencias.slice().sort((a, b) => String(b.dataHora).localeCompare(String(a.dataHora))).map((o) =>
        `<li${o.alerta && o.catalogado ? ' data-alerta="1"' : ''}><b>${esc(o.descricao)}</b><small>${esc(dataHora(o.dataHora))}${o.municipio ? ' · ' + esc(o.municipio) + (o.uf ? '/' + esc(o.uf) : '') : ''}${o.detalhe ? ' · ' + esc(o.detalhe) : ''}</small></li>`).join('') + '</ul>';
    } else if (l.codigoObjeto && !c.erros.length) {
      eventos = '<p class="ec-dica" style="margin:0">Sem movimentação de rastreio ainda (o objeto só aparece depois de postado na agência).</p>';
    }
    const notas = (c.erros || []).map((e) => `<p class="ec-notaConsulta">${esc(e)}</p>`).join('');
    return `<div class="ec-consulta">${dl}${eventos}${notas}</div>`;
  }

  // ── Exportar CSV ──
  function exportarCsv(lista) {
    const cab = ['Criado em', 'Código', 'Serviço', 'Código serviço', 'Volume', 'Status', 'Pedido', 'Destinatário', 'Cidade/UF', 'CEP', 'Chave NF-e',
      'Peso informado (g)', 'Peso aferido (g)', 'Medidas (cm)', 'Levar até', 'Emitido por (hub)', 'Login Correios', 'Observação', 'Id pré-postagem'];
    const cel = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const linhasCsv = lista.map((l) => [dataHora(l.criadoEm), l.codigoObjeto, l.servico, l.codigoServico, l.volume, rotuloStatus(l.status).rotulo, l.pedido, l.destinatario, l.cidadeUf, l.cep,
      l.chaveNFe ? `'${l.chaveNFe}` : '', l.pesoG, l.pesoAferidoG, l.medidas, l.status === 'PREPOSTADO' ? data(l.prazoPostagem) : '', l.emitidoPor, l.criadoPor, l.observacao, l.id].map(cel).join(';'));
    const csv = '﻿' + [cab.join(';'), ...linhasCsv].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `etiquetas-correios-${hojeBr()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Eventos ──
  $('ecHDe').value = diasAtras(30);
  $('ecHAte').value = hojeBr();
  $('ecHAte').max = hojeBr();
  $('ecHBuscar').addEventListener('click', carregar);
  document.querySelectorAll('.ec-atalho').forEach((b) => b.addEventListener('click', () => {
    $('ecHDe').value = diasAtras(Number(b.dataset.dias)); $('ecHAte').value = hojeBr(); carregar();
  }));
  $('ecHBusca').addEventListener('input', render);
  $('ecHCsv').addEventListener('click', () => exportarCsv(visiveis()));
  $('ecHModalFechar').addEventListener('click', fecharModal);
  $('ecHModal').addEventListener('click', (e) => { if (e.target === $('ecHModal')) fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ecHModal').hidden) fecharModal(); });

  carregar();
})();
