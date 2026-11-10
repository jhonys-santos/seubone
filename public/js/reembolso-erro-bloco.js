// Bloco "Erro deste pedido" do Reembolso: para cada ID de venda, a pessoa diz se já registrou o erro (conferido no Painel de Erros), registra o erro ali mesmo
// (formulário compacto, já preenchido com os dados do reembolso) ou marca que não será necessário (com motivo). Usado no formulário de Reembolso e no "Resolver"
// do Histórico de Reembolsos. esc() vem do ui.js.
window.ReembolsoErro = (function () {
  'use strict';
  const API = '/registro-demandas/reembolso/erro/api';
  const MAX_ARQUIVOS = 10;
  const MAX_BYTES = 18 * 1024 * 1024;
  const $$ = (el, sel) => Array.from(el.querySelectorAll(sel));
  const idsDe = (v) => Array.from(new Set(String(v || '').split(/[^0-9]+/).filter(Boolean)));
  const semZeros = (s) => String(s).replace(/^0+/, '');
  const OUTRO = '__outro__';

  async function chamar(caminho, corpo) {
    const r = await fetch(API + caminho, { method: corpo ? 'POST' : 'GET', headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined, cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch (e) { /* sem JSON */ }
    if (!j) throw new Error('Resposta inesperada do servidor (HTTP ' + r.status + ')');
    if (!j.ok) throw new Error(j.erro || 'Não foi possível concluir');
    return j;
  }
  const configCache = { p: null };
  const carregarConfig = () => (configCache.p = configCache.p || chamar('/config').catch((e) => { configCache.p = null; throw e; }));

  // Foto grande de celular vira JPEG de até 1600px (o resto — vídeo, áudio, imagem pequena — vai como veio).
  function lerArquivo(file) {
    const crua = () => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(new Error('Não consegui ler ' + file.name)); f.readAsDataURL(file); });
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type) || file.size < 600 * 1024) return crua();
    return new Promise((res) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const fator = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
        c.width = Math.round(img.width * fator); c.height = Math.round(img.height * fator); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); crua().then(res); };
      img.src = url;
    });
  }

  /**
   * opcoes: { container, contexto: () => ({ idVenda, cliente, link, motivo, codigo? }), aoMudar?: () => void }
   * Devolve { atualizarIds(), validar(), executar(onProgresso), resumo() }.
   */
  function criar(opcoes) {
    const box = opcoes.container;
    let config = null;
    const estados = new Map();   // semZeros(id) -> { id, escolha: 'sim'|'nao'|'dispensa'|null, conferencia: null|{registrado,caso}, motivoSel, motivoTxt, campos, arquivos: File[] }
    let idsAtuais = [];

    const estado = (id) => {
      const k = semZeros(id);
      if (!estados.has(k)) estados.set(k, { id, escolha: null, conferencia: null, conferindo: false, motivoSel: '', motivoTxt: '', campos: {}, arquivos: [] });
      return estados.get(k);
    };
    const precisaForm = (s) => s.escolha === 'nao' || (s.escolha === 'sim' && s.conferencia && !s.conferencia.registrado);

    function contexto() { return opcoes.contexto() || {}; }
    function valorCampo(s, k) {
      if (s.campos[k] !== undefined) return s.campos[k];
      const c = contexto();
      if (k === 'nomeCard') return c.cliente || '';
      if (k === 'linkPedido') return c.link || '';
      if (k === 'descricao') return c.motivo || '';
      if (k === 'tipoResolucao') return 'Reembolso total';
      return '';
    }

    function html() {
      if (!config) return '<p class="rb-dica">Carregando…</p>';
      if (!idsAtuais.length) return '<p class="rb-dica">Informe o ID da venda acima para registrar ou conferir o erro deste pedido.</p>';
      return idsAtuais.map((id) => cartao(estado(id))).join('');
    }

    function cartao(s) {
      const op = (v, rot, cls) => `<button type="button" class="rb-op ${s.escolha === v ? 'rb-ativo' : ''} ${cls || ''}" data-op="${v}" data-id="${esc(s.id)}" aria-pressed="${s.escolha === v}">${rot}</button>`;
      let corpo = '';
      if (s.escolha === 'sim') {
        if (s.conferindo) corpo = '<p class="rb-dica">Conferindo no Painel de Erros…</p>';
        else if (s.conferencia && s.conferencia.registrado) {
          const c = s.conferencia.caso;
          corpo = `<p class="rb-ok"><i class="ti ti-circle-check" aria-hidden="true"></i> Erro encontrado: <b>${esc(c.tipoResolucao || 'sem resolução definida')}</b>${c.quemCadastrou ? ' · registrado por ' + esc(c.quemCadastrou) : ''}${c.data ? ' em ' + esc(c.data) : ''}.</p>`;
        } else if (s.conferencia) corpo = `<p class="rb-aviso"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não encontrei nenhum erro registrado com o ID <b>${esc(s.id)}</b>. Registre o erro abaixo, junto com o reembolso.</p>`;
      }
      if (s.escolha === 'nao') corpo = '<p class="rb-dica">Preencha abaixo: o erro é registrado no Painel de Erros ao mesmo tempo que o reembolso.</p>';
      if (precisaForm(s)) corpo += formulario(s);
      if (s.escolha === 'dispensa') corpo = dispensa(s);
      return `<fieldset class="rb-cartao" data-id="${esc(s.id)}"><legend>Venda ${esc(s.id)}</legend>
        <p class="rb-pergunta">Você já registrou o erro desta venda?</p>
        <div class="rb-ops" role="group" aria-label="Erro da venda ${esc(s.id)}">${op('sim', 'Sim, já registrei')}${op('nao', 'Não, vou registrar agora')}${op('dispensa', 'Não será necessário registrar erro', 'rb-op-sec')}</div>
        <div class="rb-corpo">${corpo}</div></fieldset>`;
    }

    function dispensa(s) {
      const lista = config.opcoes.motivosDispensa || [];
      return `<div class="rb-campo"><label>Motivo *<select data-f="motivoSel" data-id="${esc(s.id)}"><option value="">Escolha…</option>${lista.map((m) => `<option value="${esc(m)}" ${s.motivoSel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}<option value="${OUTRO}" ${s.motivoSel === OUTRO ? 'selected' : ''}>Outro (digitar)</option></select></label></div>
        ${s.motivoSel === OUTRO ? `<div class="rb-campo"><label>Qual o motivo? *<input type="text" data-f="motivoTxt" data-id="${esc(s.id)}" maxlength="200" value="${esc(s.motivoTxt)}" placeholder="Explique por que não é preciso registrar erro"></label></div>` : ''}
        <p class="rb-dica">Fica registrado quem dispensou e quando. O gestor vê o motivo na aprovação.</p>`;
    }

    function formulario(s) {
      const o = config.opcoes; const v = (k) => esc(valorCampo(s, k));
      const dl = (id, arr) => `<datalist id="${id}-${esc(s.id)}">${arr.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
      const campo = (rot, k, extra, tipo) => `<div class="rb-campo"><label>${rot}<input type="${tipo || 'text'}" data-c="${k}" data-id="${esc(s.id)}" value="${v(k)}" ${extra || ''}></label></div>`;
      return `<div class="rb-form">
        <div class="rb-grade">
          <div class="rb-campo"><label>Setor do problema *<select data-c="setor" data-id="${esc(s.id)}"><option value="">Escolha…</option>${o.setores.map((x) => `<option ${valorCampo(s, 'setor') === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label></div>
          ${campo('Responsável *', 'responsavel', `list="rbResp-${esc(s.id)}" placeholder="Fábrica, consultor ou 'Expectativa do Cliente'"`)}
          ${campo('Tipo de problema (causa) *', 'tipoProblema', `list="rbCausa-${esc(s.id)}" placeholder="Ex.: Alinhamento, Qualidade do bordado"`)}
          ${campo('Subproblema (detalhe)', 'subproblema', `list="rbDet-${esc(s.id)}"`)}
          ${campo('Quantidade de produtos errados', 'qtd', 'min="0"', 'number')}
          <div class="rb-campo"><label>Tipo de resolução<select data-c="tipoResolucao" data-id="${esc(s.id)}">${o.resolucoes.map((x) => `<option ${valorCampo(s, 'tipoResolucao') === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label></div>
        </div>
        ${campo('Nome do card / cliente *', 'nomeCard')}
        ${campo('Link do pedido *', 'linkPedido', 'placeholder="https://..."', 'url')}
        <div class="rb-campo"><label>Descrição e solução do erro *<textarea data-c="descricao" data-id="${esc(s.id)}" rows="3" placeholder="O que aconteceu e como foi/será resolvido.">${v('descricao')}</textarea></label></div>
        <div class="rb-campo"><label>Fotos, áudios ou vídeos do erro *<input type="file" data-arq="${esc(s.id)}" accept="image/*,video/*,audio/*" multiple></label>
          <div class="rb-chips">${s.arquivos.map((f, i) => `<span class="rb-chip">${esc(f.name)}<button type="button" data-rm="${i}" data-id="${esc(s.id)}" aria-label="Remover ${esc(f.name)}">✕</button></span>`).join('')}</div>
          <p class="rb-dica">Pelo menos 1 arquivo mostrando o erro (até ${MAX_ARQUIVOS}, ${MAX_BYTES / 1048576} MB somados).</p></div>
        ${dl('rbResp', o.responsaveis)}${dl('rbCausa', o.causas)}${dl('rbDet', o.detalhes)}
      </div>`;
    }

    function render() { box.innerHTML = html(); ligar(); }

    function ligar() {
      $$(box, '[data-op]').forEach((b) => b.addEventListener('click', () => escolher(b.dataset.id, b.dataset.op)));
      $$(box, '[data-c]').forEach((el) => el.addEventListener('input', () => { estado(el.dataset.id).campos[el.dataset.c] = el.value; mudou(); }));
      $$(box, '[data-f]').forEach((el) => el.addEventListener('input', () => { const s = estado(el.dataset.id); s[el.dataset.f] = el.value; if (el.dataset.f === 'motivoSel') render(); mudou(); }));
      $$(box, '[data-arq]').forEach((el) => el.addEventListener('change', () => { const s = estado(el.dataset.arq); s.arquivos = s.arquivos.concat(Array.from(el.files)); render(); mudou(); }));
      $$(box, '[data-rm]').forEach((b) => b.addEventListener('click', () => { const s = estado(b.dataset.id); s.arquivos.splice(Number(b.dataset.rm), 1); render(); mudou(); }));
    }
    const mudou = () => { if (opcoes.aoMudar) opcoes.aoMudar(); };

    async function escolher(id, op) {
      const s = estado(id); s.escolha = op;
      if (op === 'sim') {
        s.conferindo = true; s.conferencia = null; render();
        try { const r = await chamar('/conferir?ids=' + encodeURIComponent(id)); s.conferencia = r.ids[0] || { registrado: false }; }
        catch (e) { s.conferencia = { registrado: false, erroConferir: e.message }; }
        s.conferindo = false;
      }
      render(); mudou();
    }

    async function atualizarIds() {
      if (!config) { try { config = await carregarConfig(); } catch (e) { box.innerHTML = '<p class="rb-aviso">Não consegui carregar o bloco do erro: ' + esc(e.message) + '</p>'; return; } }
      const novos = idsDe(contexto().idVenda);
      if (novos.join(',') === idsAtuais.join(',') && box.innerHTML) return;
      idsAtuais = novos; render(); mudou();
    }

    /** { ok, mensagem } — cada ID precisa estar resolvido. */
    function validar() {
      if (!idsAtuais.length) return { ok: false, mensagem: 'Informe o ID da venda para resolver o erro deste pedido.' };
      for (const id of idsAtuais) {
        const s = estado(id);
        if (!s.escolha) return { ok: false, mensagem: `Venda ${id}: diga se o erro já foi registrado, se vai registrar agora ou se não será necessário.`, id };
        if (s.escolha === 'sim' && s.conferindo) return { ok: false, mensagem: `Venda ${id}: aguarde a conferência no Painel de Erros.`, id };
        if (s.escolha === 'dispensa') {
          const m = s.motivoSel === OUTRO ? s.motivoTxt.trim() : s.motivoSel;
          if (!m || m.length < 3) return { ok: false, mensagem: `Venda ${id}: informe o motivo de não registrar o erro.`, id };
        }
        if (precisaForm(s)) {
          for (const [k, rot] of [['setor', 'o setor'], ['responsavel', 'o responsável'], ['tipoProblema', 'o tipo de problema'], ['nomeCard', 'o nome do card'], ['linkPedido', 'o link do pedido'], ['descricao', 'a descrição']]) {
            if (!String(valorCampo(s, k)).trim()) return { ok: false, mensagem: `Venda ${id}: informe ${rot} do erro.`, id };
          }
          if (!s.arquivos.length) return { ok: false, mensagem: `Venda ${id}: anexe ao menos 1 foto, áudio ou vídeo mostrando o erro.`, id };
          if (s.arquivos.length > MAX_ARQUIVOS) return { ok: false, mensagem: `Venda ${id}: máximo de ${MAX_ARQUIVOS} arquivos.`, id };
          if (s.arquivos.reduce((t, f) => t + f.size, 0) > MAX_BYTES) return { ok: false, mensagem: `Venda ${id}: os arquivos passam de ${MAX_BYTES / 1048576} MB somados.`, id };
        }
      }
      return { ok: true };
    }

    /**
     * Registra os erros que faltam (um por vez, subindo os arquivos) e devolve as dispensas para enviar junto do reembolso.
     * Quem chama só envia o reembolso depois que isto termina sem erro.
     */
    async function executar(onProgresso) {
      const dispensas = [];
      for (const id of idsAtuais) {
        const s = estado(id);
        if (s.escolha === 'dispensa') { dispensas.push({ idVenda: id, motivo: s.motivoSel === OUTRO ? s.motivoTxt.trim() : s.motivoSel }); continue; }
        if (!precisaForm(s)) continue;
        if (onProgresso) onProgresso(`Registrando o erro da venda ${id} (enviando arquivos)…`);
        const arquivos = await Promise.all(s.arquivos.map(lerArquivo));
        const campos = { idVenda: id };
        ['nomeCard', 'linkPedido', 'descricao', 'setor', 'responsavel', 'tipoProblema', 'subproblema', 'qtd', 'tipoResolucao'].forEach((k) => { campos[k] = valorCampo(s, k); });
        await chamar('/registrar', { campos, arquivos });
        s.escolha = 'sim'; s.conferencia = { registrado: true, caso: { tipoResolucao: campos.tipoResolucao, quemCadastrou: 'você', data: 'agora' } }; s.arquivos = [];
      }
      render();
      return { dispensas };
    }

    // Campos vindos do reembolso (cliente, link, motivo) acompanham o que a pessoa digita lá em cima, enquanto ela não editar aqui.
    function sincronizar() {
      $$(box, '[data-c="nomeCard"],[data-c="linkPedido"],[data-c="descricao"]').forEach((el) => { const s = estado(el.dataset.id); if (s.campos[el.dataset.c] === undefined && el !== document.activeElement) el.value = valorCampo(s, el.dataset.c); });
    }

    function reiniciar() { estados.clear(); idsAtuais = []; box.innerHTML = ''; }

    return { atualizarIds, validar, executar, reiniciar, sincronizar, ids: () => idsAtuais.slice() };
  }

  /**
   * "Resolver" um reembolso que já existe e está sem erro: abre o mesmo bloco numa janela. r: { codigo, ids: [{ idVenda, estado }], cliente, link, motivo }.
   * Ao confirmar, registra os erros que faltam e grava as dispensas; aoConcluir() recarrega a lista.
   */
  function abrirResolver(r, aoConcluir) {
    const pend = (r.ids || []).filter((x) => x.estado === 'pendente').map((x) => x.idVenda);
    const ov = document.createElement('div'); ov.className = 'rb-modal';
    ov.innerHTML = `<div class="rb-modal-caixa" role="dialog" aria-modal="true" aria-label="Erro do reembolso ${esc(r.codigo)}">
      <h2>Erro do reembolso ${esc(r.codigo)}</h2>
      <p class="rb-modal-resumo">${esc(r.cliente || '')}${pend.length ? ' · venda ' + esc(pend.join(', ')) : ''}. Registre o erro no Painel de Erros ou marque que não será necessário.</p>
      <div id="rbResolverBloco"></div><p class="rb-erro" id="rbResolverErro" hidden></p>
      <div class="rb-modal-acoes"><button type="button" class="rb-btn-sec" id="rbResolverCancelar">Cancelar</button><button type="button" class="rb-btn" id="rbResolverConfirmar">Confirmar</button></div></div>`;
    document.body.appendChild(ov);
    const fechar = () => { document.removeEventListener('keydown', tecla, true); ov.remove(); };
    const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); fechar(); } };
    document.addEventListener('keydown', tecla, true);
    const erroEl = ov.querySelector('#rbResolverErro'); const conf = ov.querySelector('#rbResolverConfirmar');
    const mostrarErro = (m) => { erroEl.textContent = m || ''; erroEl.hidden = !m; };
    const bloco = criar({ container: ov.querySelector('#rbResolverBloco'), contexto: () => ({ idVenda: pend.join(' '), cliente: r.cliente, link: r.link, motivo: r.motivo }) });
    bloco.atualizarIds();
    ov.querySelector('#rbResolverCancelar').addEventListener('click', fechar);
    conf.addEventListener('click', async () => {
      mostrarErro('');
      const v = bloco.validar(); if (!v.ok) return mostrarErro(v.mensagem);
      conf.disabled = true; const rotulo = conf.textContent;
      try {
        const { dispensas } = await bloco.executar((m) => { conf.textContent = m; });
        for (const d of dispensas) await chamar('/dispensar', { codigo: r.codigo, idVenda: d.idVenda, motivo: d.motivo });
        fechar(); if (aoConcluir) aoConcluir();
      } catch (e) { mostrarErro(e.message); conf.disabled = false; conf.textContent = rotulo; }
    });
  }

  return { criar, chamar, idsDe, abrirResolver };
})();
