// Emissão de etiqueta Correios — porta o fluxo de 3 etapas de
// correios-etiqueta-nextjs/src/app/etiquetas/page.tsx pra JS vanilla.
// 1. Preencher (XML da NF-e ou chave + dados)  2. Revisar (nada é criado)
// 3. Emitir (cria a pré-postagem real). Só conversa com
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
  let previaAtual = null;
  let emissaoAtual = null;
  let cancelada = false;
  let urlsAtuais = {};

  function itemVazio() { return { descricao: '', quantidade: '1', valorUnitario: '' }; }

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
    $('ecPesoDica').style.display = m === 'xml' ? '' : 'none';
  }

  $('ecXmlInput').addEventListener('change', (e) => {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      xml = { nome: arq.name, conteudo: String(leitor.result || '') };
      $('ecXmlLabel').innerHTML = `XML carregado: <b>${esc(arq.name)}</b>`;
    };
    leitor.readAsText(arq, 'utf-8');
  });

  $('ecChaveNFe').addEventListener('input', (e) => { e.target.value = mascaraChave(e.target.value); });
  $('ecDCep').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('ecDUf').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('ecPesoG').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

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

  // ── Montagem do corpo da requisição ──────────────────────────────────
  function corpo() {
    return {
      modo,
      xmlNFe: modo === 'xml' ? (xml && xml.conteudo) : undefined,
      chaveNFe: modo === 'manual' ? $('ecChaveNFe').value : undefined,
      servico: $('ecServicoSedex').checked ? 'SEDEX' : 'PAC',
      caixa: { alturaCm: $('ecAlturaCm').value, larguraCm: $('ecLarguraCm').value, comprimentoCm: $('ecComprimentoCm').value },
      pesoG: $('ecPesoG').value,
      pedido: $('ecPedido').value,
      observacao: $('ecObservacao').value,
      destinatario: modo === 'manual' ? {
        nome: $('ecDNome').value, cpfCnpj: $('ecDDoc').value, telefone: $('ecDTel').value, email: $('ecDEmail').value,
        endereco: { cep: $('ecDCep').value, logradouro: $('ecDRua').value, numero: $('ecDNum').value, complemento: $('ecDCompl').value, bairro: $('ecDBairro').value, cidade: $('ecDCidade').value, uf: $('ecDUf').value },
      } : undefined,
      itens: modo === 'manual' ? itens : undefined,
      idPrePostagem: emissaoAtual ? emissaoAtual.id : null,
    };
  }

  function mostrarErro(msg) {
    const el = $('ecErro');
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }

  async function chamar(url, init) {
    mostrarErro('');
    try {
      const res = await fetch(url, init);
      const json = await res.json();
      if (!res.ok) { mostrarErro(json.erro || 'Não foi possível concluir'); return null; }
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

  function renderPrevia() {
    const p = previaAtual;
    const d = p.destinatario;
    $('ecResumoPrevia').innerHTML = `
      <div><dt>Serviço</dt><dd><b>${esc(p.servico)}</b> <small>${esc(p.codigoServico)}</small></dd></div>
      <div><dt>NF-e</dt><dd class="ec-mono">${p.chaveNFe ? esc(mascaraChave(p.chaveNFe)) : '—'}</dd></div>
      <div class="ec-largo"><dt>Destinatário</dt><dd>
        <b>${esc(d.nome)}</b><br>
        ${esc(d.endereco.logradouro)}, ${esc(d.endereco.numero)}${d.endereco.complemento ? ` — ${esc(d.endereco.complemento)}` : ''}<br>
        ${esc(d.endereco.bairro)} · ${esc(d.endereco.cidade)}/${esc(d.endereco.uf)} · ${esc(mascaraCep(d.endereco.cep))}
        ${d.telefone ? `<br>${esc(d.telefone)}` : ''}
      </dd></div>
      <div><dt>Caixa</dt><dd>${p.caixa.alturaCm} × ${p.caixa.larguraCm} × ${p.caixa.comprimentoCm} cm</dd></div>
      <div><dt>Peso</dt><dd>${p.pesoG.toLocaleString('pt-BR')} g</dd></div>
      ${p.pedido ? `<div><dt>Pedido</dt><dd>${esc(p.pedido)}</dd></div>` : ''}
      ${p.observacao ? `<div><dt>Observação</dt><dd>${esc(p.observacao)}</dd></div>` : ''}
    `;
    $('ecItensPrevia').innerHTML = p.itens.map((it) => `<tr><td>${esc(it.descricao)}</td><td>${it.quantidade}</td><td>${brl(it.valorUnitario)}</td></tr>`).join('');
    $('ecAvisosPrevia').innerHTML = (p.avisos || []).map((a) => `<p class="ec-aviso"><span>${esc(a)}</span></p>`).join('');
    $('ecBtnEmitir').textContent = `Emitir etiqueta ${p.servico}`;
  }

  $('ecBtnVoltar').addEventListener('click', () => irParaEtapa('form'));

  // ── Etapa 2 → 3: emitir (CRIA OBJETO REAL NOS CORREIOS) ─────────────
  $('ecBtnEmitir').addEventListener('click', async () => {
    const btn = $('ecBtnEmitir');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Emitindo nos Correios…';
    const r = await chamar('/emissao-correios/api/emitir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo()) });
    btn.disabled = false;
    btn.textContent = original;
    if (r) { emissaoAtual = r; cancelada = false; renderEmitida(); irParaEtapa('emitida'); }
  });

  function liberarUrls() {
    Object.values(urlsAtuais).forEach((u) => { if (u) URL.revokeObjectURL(u); });
    urlsAtuais = {};
  }

  function renderEmitida() {
    liberarUrls();
    const e = emissaoAtual;
    $('ecStatusEmitida').textContent = cancelada ? 'Pré-postagem cancelada' : 'Etiqueta emitida';
    const titulo = $('ecTituloEmitida');
    titulo.textContent = e.codigoObjeto || '—';
    titulo.classList.toggle('ec-cancelado', cancelada);
    $('ecResumoEmitida').innerHTML = `
      <div><dt>Serviço</dt><dd>${esc(e.servico)}</dd></div>
      <div><dt>Levar à agência até</dt><dd>${e.prazoPostagem ? esc(dataCurta(e.prazoPostagem)) : '—'}</dd></div>
      <div><dt>Id da pré-postagem</dt><dd class="ec-mono">${esc(e.id)}</dd></div>
    `;

    $('ecPendenteBloco').style.display = (!cancelada && e.pendente) ? '' : 'none';
    $('ecDownloads').style.display = (!cancelada && !e.pendente) ? '' : 'none';
    if (!cancelada && !e.pendente) {
      urlsAtuais = Object.fromEntries(Object.entries(e.etiquetas || {}).map(([k, b64]) => [k, pdfUrl(b64)]));
      $('ecDownloads').innerHTML = LAYOUTS.map(({ layout, rotulo, arquivo }) => {
        const url = urlsAtuais[layout];
        if (!url) return '';
        return `<div class="ec-download">
          <b>${esc(rotulo)}</b>
          <div class="ec-acoes">
            <a class="ec-botao" href="${url}" target="_blank" rel="noreferrer">Abrir para imprimir</a>
            <a class="ec-secundario" href="${url}" download="etiqueta-${arquivo}-${esc(e.codigoObjeto || e.id)}.pdf">Baixar PDF</a>
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
    const etiquetas = {};
    for (const { layout } of LAYOUTS) {
      const res = await fetch(`/emissao-correios/api/${encodeURIComponent(emissaoAtual.id)}/pdf?layout=${layout}`);
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
    if (cancelada) { area.innerHTML = ''; return; }
    area.innerHTML = `<button type="button" class="ec-linkPerigo" id="ecBtnPedirCancelamento">Cancelar pré-postagem</button>`;
    $('ecBtnPedirCancelamento').addEventListener('click', () => {
      area.innerHTML = `<span class="ec-confirmar">
        Cancelar ${esc(emissaoAtual.codigoObjeto)}? O código deixa de valer.
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
    const r = await chamar(`/emissao-correios/api/${encodeURIComponent(emissaoAtual.id)}`, { method: 'DELETE' });
    if (r) { cancelada = true; renderEmitida(); }
    else renderAreaCancelar();
  }

  $('ecBtnNovaEtiqueta').addEventListener('click', () => {
    liberarUrls();
    modo = 'xml'; xml = null; itens = [itemVazio()]; previaAtual = null; emissaoAtual = null; cancelada = false;
    setModo('xml');
    $('ecXmlLabel').textContent = 'Escolher o arquivo XML da NF-e';
    $('ecXmlInput').value = '';
    $('ecChaveNFe').value = ''; $('ecPesoG').value = ''; $('ecPedido').value = ''; $('ecObservacao').value = '';
    $('ecDNome').value = ''; $('ecDDoc').value = ''; $('ecDTel').value = ''; $('ecDEmail').value = '';
    $('ecDCep').value = ''; $('ecDRua').value = ''; $('ecDNum').value = ''; $('ecDCompl').value = ''; $('ecDBairro').value = ''; $('ecDCidade').value = ''; $('ecDUf').value = '';
    renderItens();
    mostrarErro('');
    irParaEtapa('form');
  });
})();
