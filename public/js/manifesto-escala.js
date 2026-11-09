// Escala do Manifesto: calendário mensal. Gestor edita (pessoa + horário por dia, ou rodízio da Agenda); qualquer usuário pede troca a um colega.
// esc() vem do ui.js.
(function () {
  'use strict';
  const API = '/manifesto-escala/api';
  const $ = (id) => document.getElementById(id);
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const DOW_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  let ano = null, mes = null;      // mês em exibição (mes 0..11)
  let dados = null;                // última resposta de /api/mes
  let modal = null;                // { tipo: 'gestor'|'troca', data }

  const p2 = (n) => String(n).padStart(2, '0');
  const brData = (d) => d.split('-').reverse().join('/');
  const dowDe = (d) => new Date(d + 'T12:00:00Z').getUTCDay();   // 0 = domingo
  const rotuloDia = (d) => `${DOW_LONGO[dowDe(d)]} ${brData(d).slice(0, 5)}`;
  const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';

  const msg = (id, texto) => { const e = $(id); e.textContent = texto || ''; e.hidden = !texto; };
  const erro = (t) => { msg('meOk', ''); msg('meErro', t); };
  const ok = (t) => { msg('meErro', ''); msg('meOk', t); };

  async function chamar(caminho, corpo, metodo) {
    const r = await fetch(API + caminho, { method: metodo || (corpo ? 'POST' : 'GET'), headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined, cache: 'no-store' });
    let j = null;
    try { j = await r.json(); } catch (e) { /* resposta sem JSON */ }
    if (!j) throw new Error('Resposta inesperada do servidor (HTTP ' + r.status + ')');
    if (!j.ok) throw new Error(j.erro || 'Não foi possível concluir');
    return j;
  }

  async function carregar() {
    try {
      const q = ano === null ? '' : `?ano=${ano}&mes=${mes}`;
      dados = await chamar('/mes' + q);
      if (ano === null) { ano = dados.ano; mes = dados.mes; }
      render();
    } catch (e) { erro('Não consegui carregar a escala: ' + e.message); }
  }

  const doDia = (d) => (dados.escala || []).find((l) => l.data === d) || null;
  const meuSlug = () => dados.eu.slug;

  // ── Tela ──────────────────────────────────────────────────────────────────
  function render() {
    $('meMesTitulo').textContent = `${MESES[mes]} ${ano}`;
    $('meAcoesGestor').hidden = !dados.eu.gestor;
    msg('meAviso', dados.eu.gestor && !dados.ligado ? 'O alerta do Manifesto ainda lê o rodízio semanal da Agenda. Quando a escala estiver pronta, ligue MANIFESTO_ESCALA=on no Render para o alerta passar a usar esta tela.' : '');
    renderResumo();
    renderPedidos();
    renderGrade();
    $('meLegenda').textContent = dados.eu.gestor
      ? 'Clique em um dia para escolher quem faz o Manifesto e o horário (padrão 17:45; sexta 16:45). Dias sem definição seguem o rodízio semanal da Agenda.'
      : 'Seus dias aparecem em destaque. Clique em um dia seu para pedir troca a um colega.';
  }

  function renderResumo() {
    const hoje = dados.hoje;
    const l = dados.hojeLinha;
    if (l && l.slug) { $('meHoje').textContent = l.nome || l.slug; $('meHojeSub').textContent = 'às ' + l.hora; }
    else if (l) { $('meHoje').textContent = 'Sem Manifesto hoje'; $('meHojeSub').textContent = ''; }
    else { $('meHoje').textContent = 'Rodízio da Agenda'; $('meHojeSub').textContent = ''; }
    const prox = (dados.proximos || [])[0];
    if (prox) { $('meProximo').textContent = rotuloDia(prox.data); $('meProximoSub').textContent = 'às ' + prox.hora + (prox.data === hoje ? ' (hoje)' : ''); }
    else { $('meProximo').textContent = 'Nenhum marcado'; $('meProximoSub').textContent = ''; }
  }

  function renderGrade() {
    const g = $('meGrade');
    let html = DOW.map((d) => `<div class="me-dow" role="columnheader">${d}</div>`).join('');
    const primeiro = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
    const vazios = (primeiro + 6) % 7;
    for (let i = 0; i < vazios; i++) html += '<div class="me-dia me-fora" aria-hidden="true"></div>';
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    for (let dia = 1; dia <= ultimo; dia++) {
      const data = `${ano}-${p2(mes + 1)}-${p2(dia)}`;
      const l = doDia(data);
      const dow = dowDe(data);
      const futuro = data > dados.hoje;
      const meu = !!(l && l.slug && l.slug === meuSlug());
      const cls = ['me-dia', dow === 0 || dow === 6 ? 'me-fimsemana' : '', data < dados.hoje ? 'me-passado' : '', data === dados.hoje ? 'me-hoje' : '', meu ? 'me-meu' : ''];
      const clicavel = dados.eu.gestor || (meu && futuro);
      if (clicavel) cls.push('me-clicavel');
      let conteudo;
      if (l && l.slug) conteudo = `<span class="me-quem">${esc(primeiroNome(l.nome || l.slug))}</span><span class="me-hora">${esc(l.hora)}</span>`;
      else if (l) conteudo = '<span class="me-sem">Sem Manifesto</span>';
      else conteudo = dow >= 1 && dow <= 5 ? '<span class="me-vazio">rodízio</span>' : '';
      const rotulo = `${rotuloDia(data)}${l && l.slug ? ', Manifesto: ' + (l.nome || l.slug) + ' às ' + l.hora : ''}`;
      html += `<button type="button" class="${cls.filter(Boolean).join(' ')}" data-data="${data}" ${clicavel ? '' : 'tabindex="-1"'} aria-label="${esc(rotulo)}"><span class="me-num">${dia}</span>${conteudo}</button>`;
    }
    g.innerHTML = html;
    g.querySelectorAll('.me-clicavel').forEach((b) => b.addEventListener('click', () => abrirDia(b.dataset.data)));
  }

  function renderPedidos() {
    const rec = dados.trocas.recebidas || [], env = dados.trocas.enviadas || [];
    const el = $('mePedidos');
    el.hidden = !rec.length && !env.length;
    if (el.hidden) { el.innerHTML = ''; return; }
    let html = '';
    if (rec.length) {
      html += '<h3>Pedidos de troca para você</h3>' + rec.map((t) => `<div class="me-pedido">
        <p><b>${esc(t.solicitanteNome)}</b> quer trocar: ele(a) cede ${esc(rotuloDia(t.dataSol))} e você cede ${esc(rotuloDia(t.dataAlvo))}.${t.motivo ? `<small>Motivo: ${esc(t.motivo)}</small>` : ''}</p>
        <div class="me-pedido-acoes"><button type="button" class="me-btn-neg" data-recusar="${t.id}">Recusar</button><button type="button" class="me-btn" data-aceitar="${t.id}">Aceitar a troca</button></div></div>`).join('');
    }
    if (env.length) {
      html += '<h3>Seus pedidos aguardando resposta</h3>' + env.map((t) => `<div class="me-pedido me-enviado">
        <p>Você pediu a <b>${esc(t.alvoNome)}</b>: ceder ${esc(rotuloDia(t.dataSol))} e assumir ${esc(rotuloDia(t.dataAlvo))}.</p>
        <div class="me-pedido-acoes"><button type="button" class="me-btn-sec" data-cancelar="${t.id}">Cancelar pedido</button></div></div>`).join('');
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-aceitar]').forEach((b) => b.addEventListener('click', () => responder(b.dataset.aceitar, true, b)));
    el.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', () => responder(b.dataset.recusar, false, b)));
    el.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => cancelar(b.dataset.cancelar, b)));
  }

  async function responder(id, aceitar, btn) {
    btn.disabled = true;
    try { await chamar(`/trocas/${id}/responder`, { aceitar }); ok(aceitar ? 'Troca aceita. A escala já foi atualizada.' : 'Pedido recusado.'); }
    catch (e) { erro(e.message); }
    await carregar();
  }
  async function cancelar(id, btn) {
    btn.disabled = true;
    try { await chamar(`/trocas/${id}/cancelar`, {}); ok('Pedido cancelado.'); } catch (e) { erro(e.message); }
    await carregar();
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  const fecharModal = () => { $('meModal').hidden = true; modal = null; };
  function abrirModalBase(titulo, resumo, corpo, rotuloOk) {
    $('meModalTitulo').textContent = titulo; $('meModalResumo').textContent = resumo; $('meModalCorpo').innerHTML = corpo;
    msg('meModalErro', ''); const c = $('meModalConfirmar'); c.textContent = rotuloOk; c.disabled = false;
    $('meModal').hidden = false;
  }

  function abrirDia(data) {
    if (dados.eu.gestor) return abrirGestor(data);
    return abrirTroca(data);
  }

  function abrirGestor(data) {
    modal = { tipo: 'gestor', data };
    const l = doDia(data);
    const atual = l ? (l.slug || '__sem__') : '__rodizio__';
    const padrao = dowDe(data) === 5 ? dados.horaSexta : dados.horaPadrao;
    const opcoes = [`<option value="__rodizio__">Voltar ao rodízio semanal da Agenda</option>`, `<option value="__sem__">Sem Manifesto neste dia</option>`]
      .concat(dados.usuarios.map((u) => `<option value="${esc(u.slug)}">${esc(u.nome)}</option>`)).join('');
    abrirModalBase('Manifesto de ' + rotuloDia(data), 'Escolha quem faz o Manifesto neste dia e o horário do alerta.',
      `<label class="me-campo">Quem faz<select id="meSel">${opcoes}</select></label>
       <label class="me-campo">Horário<input type="time" id="meHora" value="${esc(l && l.hora ? l.hora : padrao)}"></label>
       <p class="me-dica">Se a pessoa for outra, ela recebe um aviso no sino do Hub.</p>`, 'Salvar');
    $('meSel').value = atual;
    const sync = () => { $('meHora').disabled = $('meSel').value === '__rodizio__' || $('meSel').value === '__sem__'; };
    $('meSel').addEventListener('change', sync); sync();
  }

  async function abrirTroca(data) {
    modal = { tipo: 'troca', data };
    const colegas = dados.usuarios.filter((u) => u.slug !== meuSlug());
    abrirModalBase('Pedir troca', `Você cede ${rotuloDia(data)} e assume o dia do colega. Só vale se ele(a) aceitar.`,
      `<label class="me-campo">Colega<select id="meColega"><option value="">Escolha…</option>${colegas.map((u) => `<option value="${esc(u.slug)}">${esc(u.nome)}</option>`).join('')}</select></label>
       <label class="me-campo">Dia dele(a) que você assume<select id="meDiaColega" disabled><option value="">Escolha o colega primeiro</option></select></label>
       <label class="me-campo">Motivo (opcional)<textarea id="meMotivo" rows="2" maxlength="300"></textarea></label>`, 'Enviar pedido');
    $('meColega').addEventListener('change', async () => {
      const s = $('meColega').value; const sel = $('meDiaColega');
      sel.disabled = true; sel.innerHTML = '<option value="">Carregando…</option>';
      if (!s) { sel.innerHTML = '<option value="">Escolha o colega primeiro</option>'; return; }
      try {
        const j = await chamar('/datas-colega?slug=' + encodeURIComponent(s));
        sel.innerHTML = j.datas.length ? '<option value="">Escolha o dia…</option>' + j.datas.map((d) => `<option value="${d.data}">${esc(rotuloDia(d.data))} às ${esc(d.hora)}</option>`).join('') : '<option value="">Esse colega não tem dias futuros na escala</option>';
        sel.disabled = !j.datas.length;
      } catch (e) { sel.innerHTML = '<option value="">Erro ao carregar</option>'; msg('meModalErro', e.message); }
    });
  }

  async function confirmar() {
    if (!modal) return;
    const btn = $('meModalConfirmar'); btn.disabled = true; msg('meModalErro', '');
    try {
      if (modal.tipo === 'gestor') {
        const v = $('meSel').value;
        const corpo = v === '__rodizio__' ? { data: modal.data, acao: 'remover' } : v === '__sem__' ? { data: modal.data, acao: 'sem-manifesto' } : { data: modal.data, acao: 'definir', slug: v, hora: $('meHora').value };
        await chamar('/dia', corpo);
        ok('Dia ' + brData(modal.data) + ' salvo.');
      } else {
        const alvo = $('meColega').value, dataAlvo = $('meDiaColega').value;
        if (!alvo || !dataAlvo) throw new Error('Escolha o colega e o dia que você assume.');
        await chamar('/trocas', { dataSol: modal.data, alvo, dataAlvo, motivo: $('meMotivo').value });
        ok('Pedido enviado. O colega foi avisado e a escala só muda se ele(a) aceitar.');
      }
      fecharModal();
      await carregar();
    } catch (e) { msg('meModalErro', e.message); btn.disabled = false; }
  }

  async function rodizio() {
    const b = $('meRodizio'); b.disabled = true;
    try { const j = await chamar('/rodizio', { ano, mes }); ok(j.criados ? `${j.criados} dia(s) preenchido(s) com o rodízio da Agenda. Ajuste o que precisar (feriados, folgas).` : 'Nenhum dia vazio para preencher neste mês.'); }
    catch (e) { erro(e.message); }
    b.disabled = false; await carregar();
  }

  // ── Eventos ───────────────────────────────────────────────────────────────
  const mover = (delta) => { mes += delta; if (mes < 0) { mes = 11; ano--; } if (mes > 11) { mes = 0; ano++; } carregar(); };
  $('mePrev').addEventListener('click', () => mover(-1));
  $('meNext').addEventListener('click', () => mover(1));
  $('meHojeBtn').addEventListener('click', () => { ano = null; mes = null; carregar(); });
  $('meRodizio').addEventListener('click', rodizio);
  $('meModalCancelar').addEventListener('click', fecharModal);
  $('meModalConfirmar').addEventListener('click', confirmar);
  $('meModal').addEventListener('click', (e) => { if (e.target === $('meModal')) fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('meModal').hidden) fecharModal(); });
  setInterval(() => { if (!document.hidden && $('meModal').hidden) carregar(); }, 60000);

  carregar();
})();
