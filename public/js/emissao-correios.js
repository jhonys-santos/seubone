// Emissão de etiqueta Correios — porta o fluxo de 3 etapas de
// correios-etiqueta-nextjs/src/app/etiquetas/page.tsx pra JS vanilla.
// 1. Preencher (XML da NF-e ou chave + dados)  2. Revisar (nada é criado)
// 3. Emitir (cria as pré-postagens reais, uma por caixa). Só conversa com
// /emissao-correios/api/* (servidor); nenhuma credencial dos Correios
// passa por aqui.
(function () {
  'use strict';

  const form = document.getElementById('ecForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const mascaraCep = (v) => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  const mascaraChave = (v) => v.replace(/\D/g, '').slice(0, 44).replace(/(\d{4})(?=\d)/g, '$1 ');
  const dataCurta = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const MAX_CAIXAS = 10; // mesmo limite do servidor
  const LAYOUTS = [
    { layout: 'LINEAR_100_150', rotulo: 'Térmica 10x15', arquivo: '10x15' },
    { layout: 'PADRAO', rotulo: 'Folha A4', arquivo: 'a4' },
  ];

  function pdfUrl(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }

  // ── Estado ────────────────────────────────────────────────────────────
  let modo = 'xml';
  let xml = null; // { nome, conteudo }
  let itens = [{ descricao: '', quantidade: '1', valorUnitario: '' }];
  let caixas = [caixaVazia()];
  let volumesDaNf = 0; // quantos volumes a NF-e informa (só no modo XML)
  let previaAtual = null;
  let emissaoAtual = null;
  let idsCriados = []; // ids das pré-postagens já criadas (uma por caixa; null onde falta) — evita duplicar ao tentar de novo
  let idsCancelados = new Set();
  let ultimoErro = null;
  let urlsAtuais = {};

  function itemVazio() { return { descricao: '', quantidade: '1', valorUnitario: '' }; }
  function caixaVazia() { return { alturaCm: '', larguraCm: '', comprimentoCm: '', pesoG: '' }; }
  const caixaEmBranco = (c) => !c.alturaCm && !c.larguraCm && !c.comprimentoCm && !c.pesoG;
  const jaCriouAlgo = () => idsCriados.some(Boolean);

  // ── Etapa 1: alternância XML/manual ──────────────────────────────────
  $('ecAbaXml').addEventListener('click', () => setModo('xml'));
  $('ecAbaManual').addEventListener('click', () => setModo('manual'));
  function setModo(m) {
    modo = m;
    $('ecAbaXml').classList.toggle('ec-ativo', m === 'xml');
    $('ecAbaManual').classList.toggle('ec-ativo', m === 'manual');
    $('ecAbaXml').setAttribute('aria-selected', String(m === 'xml'));
    $('ecAbaManual').setAttribute('aria-selected', String(m === 'manual'));
    $('ecBlocoXml').style.display = m === 'xml' ? '' : 'none';
    $('ecBlocoChave').style.display = m === 'manual' ? '' : 'none';
    $('ecBlocoManual').style.display = m === 'manual' ? '' : 'none';
    renderCaixas();
  }

  // Quantos volumes a NF-e declara: soma de <qVol>, ou o número de blocos <vol>.
  function volumesDoXml(texto) {
    const soma = [...texto.matchAll(/<(?:\w+:)?qVol>\s*(\d+)\s*<\/(?:\w+:)?qVol>/g)].reduce((s, m) => s + Number(m[1]), 0);
    return soma > 0 ? soma : (texto.match(/<(?:\w+:)?vol>/g) || []).length;
  }

  $('ecXmlInput').addEventListener('change', (e) => {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      xml = { nome: arq.name, conteudo: String(leitor.result || '') };
      $('ecXmlLabel').innerHTML = `XML carregado: <b>${esc(arq.name)}</b>`;
      volumesDaNf = Math.min(volumesDoXml(xml.conteudo), MAX_CAIXAS);
      // A NF diz que são N volumes e as caixas ainda estão vazias: já monta as N caixas.
      if (volumesDaNf > 1 && !jaCriouAlgo() && caixas.every(caixaEmBranco)) {
        caixas = Array.from({ length: volumesDaNf }, caixaVazia);
      }
      renderCaixas();
    };
    leitor.readAsText(arq, 'utf-8');
  });

  $('ecChaveNFe').addEventListener('input', (e) => { e.target.value = mascaraChave(e.target.value); });
  $('ecDCep').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('ecDUf').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

  ['ecServicoSedex', 'ecServicoPac'].forEach((id) => $(id).addEventListener('change', atualizarOpcaoServico));
  function atualizarOpcaoServico() {
    $('ecOpcaoSedex').classList.toggle('ec-ativo', $('ecServicoSedex').checked);
    $('ecOpcaoPac').classList.toggle('ec-ativo', $('ecServicoPac').checked);
  }

  // ── Itens (modo manual) ──────────────────────────────────────────────
  function renderItens() {
    $('ecItens').innerHTML = itens.map((it, i) => `
      <div class="ec-linhaItem" data-i="${i}">
        <label class="ec-campo"><span>Descrição</span><input class="ec-it-desc" value="${esc(it.descricao)}" placeholder="Boné personalizado"></label>
        <label class="ec-campo"><span>Qtd.</span><input class="ec-it-qtd" inputmode="numeric" value="${esc(it.quantidade)}"></label>
        <label class="ec-campo"><span>Valor unit. (R$)</span><input class="ec-it-val" inputmode="decimal" placeholder="0,00" value="${esc(it.valorUnitario)}"></label>
        ${itens.length > 1 ? `<button type="button" class="ec-remover" data-i="${i}">Remover</button>` : ''}
      </div>
    `).join('');
    $('ecItens').querySelectorAll('.ec-linhaItem').forEach((linha) => {
      const i = Number(linha.dataset.i);
      linha.querySelector('.ec-it-desc').addEventListener('input', (e) => { itens[i].descricao = e.target.value; });
      linha.querySelector('.ec-it-qtd').addEventListener('input', (e) => { itens[i].quantidade = e.target.value.replace(/\D/g, ''); e.target.value = itens[i].quantidade; });
      linha.querySelector('.ec-it-val').addEventListener('input', (e) => { itens[i].valorUnitario = e.target.value; });
      const btnRm = linha.querySelector('.ec-remover');
      if (btnRm) btnRm.addEventListener('click', () => { itens.splice(i, 1); renderItens(); });
    });
  }
  renderItens();
  $('ecBtnAddItem').addEventListener('click', () => { itens.push(itemVazio()); renderItens(); });

  // ── Caixas (cada uma gera uma pré-postagem, um código e uma etiqueta) ─
  function dicaCaixas() {
    const partes = [];
    if (modo === 'xml' && volumesDaNf > 1) {
      partes.push(volumesDaNf === caixas.length
        ? `A NF-e informa ${volumesDaNf} volumes.`
        : `A NF-e informa ${volumesDaNf} volumes e há ${caixas.length} caixa${caixas.length > 1 ? 's' : ''} aqui. Confira.`);
    }
    if (modo === 'xml') {
      partes.push(caixas.length > 1
        ? 'Peso em branco em todas as caixas: o peso bruto da NF é dividido igualmente entre elas.'
        : 'Peso em branco: usa o peso bruto da NF.');
    } else if (caixas.length > 1) {
      partes.push('Informe o peso de cada caixa.');
    }
    return partes.join(' ');
  }

  function bloquearSeJaCriou() {
    if (!jaCriouAlgo()) return false;
    mostrarErro('Já há etiquetas criadas nos Correios nesta emissão, então não dá para adicionar ou remover caixas agora. Volte à revisão e clique em Emitir para concluir sem duplicar.');
    return true;
  }

  function renderCaixas() {
    const varias = caixas.length > 1;
    $('ecCaixas').innerHTML = caixas.map((c, i) => `
      <div class="ec-linhaCaixa" data-i="${i}">
        ${varias ? `<span class="ec-caixaTitulo">Caixa ${i + 1} de ${caixas.length}</span>` : ''}
        <label class="ec-campo"><span>Altura (cm)</span><input class="ec-cx-alt" inputmode="decimal" value="${esc(c.alturaCm)}"></label>
        <label class="ec-campo"><span>Largura (cm)</span><input class="ec-cx-lar" inputmode="decimal" value="${esc(c.larguraCm)}"></label>
        <label class="ec-campo"><span>Comprimento (cm)</span><input class="ec-cx-com" inputmode="decimal" value="${esc(c.comprimentoCm)}"></label>
        <label class="ec-campo"><span>Peso (g)</span><input class="ec-cx-peso" inputmode="numeric" value="${esc(c.pesoG)}"></label>
        ${varias ? `<button type="button" class="ec-remover" data-i="${i}">Remover</button>` : ''}
      </div>
    `).join('');
    $('ecCaixas').querySelectorAll('.ec-linhaCaixa').forEach((linha) => {
      const i = Number(linha.dataset.i);
      linha.querySelector('.ec-cx-alt').addEventListener('input', (e) => { caixas[i].alturaCm = e.target.value; });
      linha.querySelector('.ec-cx-lar').addEventListener('input', (e) => { caixas[i].larguraCm = e.target.value; });
      linha.querySelector('.ec-cx-com').addEventListener('input', (e) => { caixas[i].comprimentoCm = e.target.value; });
      linha.querySelector('.ec-cx-peso').addEventListener('input', (e) => { caixas[i].pesoG = e.target.value.replace(/\D/g, ''); e.target.value = caixas[i].pesoG; });
      const btnRm = linha.querySelector('.ec-remover');
      if (btnRm) btnRm.addEventListener('click', () => { if (bloquearSeJaCriou()) return; caixas.splice(i, 1); renderCaixas(); });
    });
    $('ecBtnAddCaixa').disabled = caixas.length >= MAX_CAIXAS;
    $('ecBtnAddCaixa').textContent = caixas.length >= MAX_CAIXAS ? `Limite de ${MAX_CAIXAS} caixas` : 'Adicionar caixa';
    const dica = dicaCaixas();
    $('ecCaixasDica').textContent = dica;
    $('ecCaixasDica').style.display = dica ? '' : 'none';
  }
  renderCaixas();
  $('ecBtnAddCaixa').addEventListener('click', () => {
    if (bloquearSeJaCriou() || caixas.length >= MAX_CAIXAS) return;
    caixas.push(caixaVazia());
    renderCaixas();
  });

  // ── Montagem do corpo da requisição ──────────────────────────────────
  function corpo() {
    return {
      modo,
      xmlNFe: modo === 'xml' ? (xml && xml.conteudo) : undefined,
      chaveNFe: modo === 'manual' ? $('ecChaveNFe').value : undefined,
      servico: $('ecServicoSedex').checked ? 'SEDEX' : 'PAC',
      caixas: caixas.map((c) => ({ alturaCm: c.alturaCm, larguraCm: c.larguraCm, comprimentoCm: c.comprimentoCm, pesoG: c.pesoG })),
      pedido: $('ecPedido').value,
      observacao: $('ecObservacao').value,
      destinatario: modo === 'manual' ? {
        nome: $('ecDNome').value, cpfCnpj: $('ecDDoc').value, telefone: $('ecDTel').value, email: $('ecDEmail').value,
        endereco: { cep: $('ecDCep').value, logradouro: $('ecDRua').value, numero: $('ecDNum').value, complemento: $('ecDCompl').value, bairro: $('ecDBairro').value, cidade: $('ecDCidade').value, uf: $('ecDUf').value },
      } : undefined,
      itens: modo === 'manual' ? itens : undefined,
      idsPrePostagem: jaCriouAlgo() ? idsCriados : undefined,
    };
  }

  function mostrarErro(msg) {
    const el = $('ecErro');
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }

  async function chamar(url, init) {
    mostrarErro('');
    ultimoErro = null;
    try {
      const res = await fetch(url, init);
      const json = await res.json();
      if (!res.ok) { ultimoErro = json; mostrarErro(json.erro || 'Não foi possível concluir'); return null; }
      return json;
    } catch (e) {
      mostrarErro('Sem conexão com o servidor. Tente novamente.');
      return null;
    }
  }

  function irParaEtapa(etapa) {
    document.querySelectorAll('#ecPassos li').forEach((li) => li.classList.toggle('ec-ativo', li.dataset.passo === etapa));
    form.style.display = etapa === 'form' ? '' : 'none';
    $('ecCartaoPrevia').style.display = etapa === 'previa' ? '' : 'none';
    $('ecCartaoEmitida').style.display = etapa === 'emitida' ? '' : 'none';
  }

  // ── Etapa 1 → 2: revisar ─────────────────────────────────────────────
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('ecBtnRevisar');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Conferindo…';
    const r = await chamar('/emissao-correios/api/previa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo()) });
    btn.disabled = false;
    btn.textContent = original;
    if (r) { previaAtual = r; renderPrevia(); irParaEtapa('previa'); }
  });

  const nEtiquetas = (n) => (n > 1 ? `${n} etiquetas` : 'etiqueta');

  function renderPrevia() {
    const p = previaAtual;
    const d = p.destinatario;
    const n = p.volumes.length;
    $('ecResumoPrevia').innerHTML = `
      <div><dt>Serviço</dt><dd><b>${esc(p.servico)}</b> <small>${esc(p.codigoServico)}</small></dd></div>
      <div><dt>NF-e</dt><dd class="ec-mono">${p.chaveNFe ? esc(mascaraChave(p.chaveNFe)) : '—'}</dd></div>
      <div class="ec-largo"><dt>Destinatário</dt><dd>
        <b>${esc(d.nome)}</b><br>
        ${esc(d.endereco.logradouro)}, ${esc(d.endereco.numero)}${d.endereco.complemento ? `, ${esc(d.endereco.complemento)}` : ''}<br>
        ${esc(d.endereco.bairro)} · ${esc(d.endereco.cidade)}/${esc(d.endereco.uf)} · ${esc(mascaraCep(d.endereco.cep))}
        ${d.telefone ? `<br>${esc(d.telefone)}` : ''}
      </dd></div>
      <div><dt>Caixas</dt><dd>${n}${n > 1 ? ` <small>(${n} etiquetas e ${n} códigos de rastreio)</small>` : ''}</dd></div>
      <div><dt>Peso${n > 1 ? ' total' : ''}</dt><dd>${p.pesoTotalG.toLocaleString('pt-BR')} g</dd></div>
      ${p.pedido ? `<div><dt>Pedido</dt><dd>${esc(p.pedido)}</dd></div>` : ''}
      ${p.observacao ? `<div><dt>Observação</dt><dd>${esc(p.observacao)}${n > 1 ? ' <small>(cada etiqueta leva também “Vol i/N”)</small>' : ''}</dd></div>` : ''}
    `;
    $('ecVolumesPrevia').innerHTML = p.volumes.map((v, i) => `<tr><td>Caixa ${i + 1}</td><td>${v.alturaCm} × ${v.larguraCm} × ${v.comprimentoCm}</td><td>${v.pesoG.toLocaleString('pt-BR')} g</td></tr>`).join('');
    $('ecItensPrevia').innerHTML = p.itens.map((it) => `<tr><td>${esc(it.descricao)}</td><td>${it.quantidade}</td><td>${brl(it.valorUnitario)}</td></tr>`).join('');
    $('ecAvisosPrevia').innerHTML = (p.avisos || []).map((a) => `<p class="ec-aviso"><span>${esc(a)}</span></p>`).join('');
    $('ecBtnEmitir').textContent = `Emitir ${nEtiquetas(n)} ${p.servico}`;
  }

  $('ecBtnVoltar').addEventListener('click', () => irParaEtapa('form'));

  // ── Etapa 2 → 3: emitir (CRIA OBJETOS REAIS NOS CORREIOS) ───────────
  $('ecBtnEmitir').addEventListener('click', async () => {
    const btn = $('ecBtnEmitir');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Emitindo nos Correios…';
    const r = await chamar('/emissao-correios/api/emitir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo()) });
    btn.disabled = false;
    btn.textContent = original;
    if (r) {
      emissaoAtual = r;
      idsCriados = r.idsPrePostagem || r.volumes.map((v) => v.id);
      idsCancelados = new Set();
      renderEmitida();
      irParaEtapa('emitida');
    } else if (ultimoErro && Array.isArray(ultimoErro.idsPrePostagem)) {
      // Falhou no meio: o que já foi criado fica guardado; clicar de novo só cria o que falta.
      idsCriados = ultimoErro.idsPrePostagem;
      const feitas = idsCriados.filter(Boolean).length;
      if (feitas) mostrarErro(`${ultimoErro.erro} (${feitas} de ${caixas.length} já criada${feitas > 1 ? 's' : ''} nos Correios. Clique em Emitir de novo para concluir sem duplicar.)`);
    }
  });

  function liberarUrls() {
    Object.values(urlsAtuais).forEach((u) => { if (u) URL.revokeObjectURL(u); });
    urlsAtuais = {};
  }

  const todasCanceladas = () => !!emissaoAtual && idsCancelados.size >= emissaoAtual.volumes.length;

  function renderEmitida() {
    liberarUrls();
    const e = emissaoAtual;
    const n = e.volumes.length;
    const cancelada = todasCanceladas();
    $('ecStatusEmitida').textContent = cancelada
      ? (n > 1 ? 'Pré-postagens canceladas' : 'Pré-postagem cancelada')
      : (n > 1 ? `${n} etiquetas emitidas` : 'Etiqueta emitida');
    const titulo = $('ecTituloEmitida');
    titulo.textContent = n > 1 ? `${n} etiquetas` : (e.volumes[0].codigoObjeto || '—');
    titulo.classList.toggle('ec-cancelado', cancelada);
    $('ecResumoEmitida').innerHTML = `
      <div><dt>Serviço</dt><dd>${esc(e.servico)}</dd></div>
      <div><dt>Levar à agência até</dt><dd>${e.prazoPostagem ? esc(dataCurta(e.prazoPostagem)) : '—'}</dd></div>
      <div class="ec-largo ec-volumes"><dt>${n > 1 ? 'Códigos de rastreio' : 'Id da pré-postagem'}</dt><dd>${e.volumes.map((v, i) => `
        <span class="${idsCancelados.has(v.id) ? 'ec-cancelado' : ''}">${n > 1 ? `Caixa ${i + 1} · <b class="ec-mono">${esc(v.codigoObjeto || '—')}</b> ` : ''}<small class="ec-mono">${n > 1 ? 'id ' : ''}${esc(v.id)}</small></span>`).join('')}</dd></div>
    `;

    $('ecPendenteBloco').style.display = (!cancelada && e.pendente) ? '' : 'none';
    $('ecDownloads').style.display = (!cancelada && !e.pendente) ? '' : 'none';
    if (!cancelada && !e.pendente) {
      urlsAtuais = Object.fromEntries(Object.entries(e.etiquetas || {}).map(([k, b64]) => [k, pdfUrl(b64)]));
      const nome = n > 1 ? `${e.volumes[0].codigoObjeto || e.volumes[0].id}-e-mais-${n - 1}` : (e.volumes[0].codigoObjeto || e.volumes[0].id);
      $('ecDownloads').innerHTML = LAYOUTS.map(({ layout, rotulo, arquivo }) => {
        const url = urlsAtuais[layout];
        if (!url) return '';
        return `<div class="ec-download">
          <b>${esc(rotulo)}${n > 1 ? ` · todas as ${n} etiquetas` : ''}</b>
          <div class="ec-acoes">
            <a class="ec-botao" href="${url}" target="_blank" rel="noreferrer">Abrir para imprimir</a>
            <a class="ec-secundario" href="${url}" download="etiquetas-${arquivo}-${esc(nome)}.pdf">Baixar PDF</a>
          </div>
        </div>`;
      }).join('');
    } else {
      $('ecDownloads').innerHTML = '';
    }

    $('ecAvisosEmitida').innerHTML = (e.avisos || []).map((a) => `<p class="ec-aviso"><span>${esc(a)}</span></p>`).join('');
    renderAreaCancelar();
  }

  $('ecBtnBaixarDeNovo').addEventListener('click', async () => {
    const btn = $('ecBtnBaixarDeNovo');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Baixando…';
    mostrarErro('');
    const ids = emissaoAtual.volumes.map((v) => v.id).join(',');
    const etiquetas = {};
    for (const { layout } of LAYOUTS) {
      const res = await fetch(`/emissao-correios/api/pdf?ids=${encodeURIComponent(ids)}&layout=${layout}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        mostrarErro((j && j.erro) || 'Etiqueta ainda não liberada. Tente em instantes.');
        break;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      buf.forEach((x) => { bin += String.fromCharCode(x); });
      etiquetas[layout] = btoa(bin);
    }
    btn.disabled = false;
    btn.textContent = original;
    if (Object.keys(etiquetas).length === LAYOUTS.length) {
      emissaoAtual = { ...emissaoAtual, pendente: false, etiquetas };
      renderEmitida();
    }
  });

  function renderAreaCancelar() {
    const area = $('ecAreaCancelar');
    if (todasCanceladas()) { area.innerHTML = ''; return; }
    const n = emissaoAtual.volumes.length;
    area.innerHTML = `<button type="button" class="ec-linkPerigo" id="ecBtnPedirCancelamento">${n > 1 ? 'Cancelar todas as pré-postagens' : 'Cancelar pré-postagem'}</button>`;
    $('ecBtnPedirCancelamento').addEventListener('click', () => {
      area.innerHTML = `<span class="ec-confirmar">
        ${n > 1 ? `Cancelar as ${n - idsCancelados.size} pré-postagens? Os códigos deixam de valer.` : `Cancelar ${esc(emissaoAtual.volumes[0].codigoObjeto)}? O código deixa de valer.`}
        <button type="button" class="ec-perigo" id="ecBtnConfirmarCancelamento">Sim, cancelar</button>
        <button type="button" class="ec-secundario" id="ecBtnNegarCancelamento">Não</button>
      </span>`;
      $('ecBtnConfirmarCancelamento').addEventListener('click', confirmarCancelamento);
      $('ecBtnNegarCancelamento').addEventListener('click', renderAreaCancelar);
    });
  }

  async function confirmarCancelamento() {
    const btn = $('ecBtnConfirmarCancelamento');
    btn.disabled = true;
    btn.textContent = 'Cancelando…';
    const falhas = [];
    for (const v of emissaoAtual.volumes) {
      if (idsCancelados.has(v.id)) continue;
      const r = await chamar(`/emissao-correios/api/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
      if (r) idsCancelados.add(v.id);
      else falhas.push(v.codigoObjeto || v.id);
    }
    renderEmitida();
    if (falhas.length) mostrarErro(`Não consegui cancelar: ${falhas.join(', ')}. Tente de novo.`);
  }

  $('ecBtnNovaEtiqueta').addEventListener('click', () => {
    liberarUrls();
    modo = 'xml'; xml = null; itens = [itemVazio()]; caixas = [caixaVazia()]; volumesDaNf = 0;
    previaAtual = null; emissaoAtual = null; idsCriados = []; idsCancelados = new Set();
    setModo('xml');
    $('ecXmlLabel').textContent = 'Escolher o arquivo XML da NF-e';
    $('ecXmlInput').value = '';
    $('ecChaveNFe').value = ''; $('ecPedido').value = ''; $('ecObservacao').value = '';
    $('ecDNome').value = ''; $('ecDDoc').value = ''; $('ecDTel').value = ''; $('ecDEmail').value = '';
    $('ecDCep').value = ''; $('ecDRua').value = ''; $('ecDNum').value = ''; $('ecDCompl').value = ''; $('ecDBairro').value = ''; $('ecDCidade').value = ''; $('ecDUf').value = '';
    renderItens();
    mostrarErro('');
    irParaEtapa('form');
  });
})();
