// Emissão de e-Minuta LATAM Cargo — fluxo de 3 etapas (form → prévia →
// emitida), mesmo padrão de emissao-correios.js. Diferenças: só um modo de
// entrada (manual — não tem XML de NF-e aqui), sem PDF pra baixar (a
// "emitida" mostra só o AWB), e uma etapa extra de "verificar" pra quando a
// LATAM não confirma a emissão (não existe cancelamento, então não dá pra
// simplesmente reenviar sem checar antes).
(function () {
  'use strict';

  const form = document.getElementById('elForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mascaraCep = (v) => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  const mascaraChave = (v) => v.replace(/\D/g, '').slice(0, 44).replace(/(\d{4})(?=\d)/g, '$1 ');
  const mascaraDoc = (v) => v.replace(/\D/g, '').slice(0, 14);

  // ── Estado ────────────────────────────────────────────────────────────
  let volumes = [{ quantidade: '1', pesoKg: '', alturaCm: '', larguraCm: '', comprimentoCm: '' }];
  let previaAtual = null;
  let emissaoAtual = null;
  let ultimaChaveEnviada = null;

  function volumeVazio() { return { quantidade: '1', pesoKg: '', alturaCm: '', larguraCm: '', comprimentoCm: '' }; }

  $('elChave').addEventListener('input', (e) => { e.target.value = mascaraChave(e.target.value); });
  $('elDDoc').addEventListener('input', (e) => { e.target.value = mascaraDoc(e.target.value); });
  $('elDCep').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('elDUf').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); atualizarDestinoAutomatico(); });

  // ── CEP: busca o endereço automaticamente (ViaCEP) ───────────────────
  $('elDCep').addEventListener('input', async (e) => {
    const digitos = e.target.value.replace(/\D/g, '');
    if (digitos.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const dados = await res.json();
      if (dados.erro) return; // CEP não encontrado — deixa o operador preencher na mão
      $('elDRua').value = dados.logradouro || $('elDRua').value;
      $('elDBairro').value = dados.bairro || $('elDBairro').value;
      $('elDCidade').value = dados.localidade || $('elDCidade').value;
      $('elDUf').value = (dados.uf || $('elDUf').value).toUpperCase();
      atualizarDestinoAutomatico();
    } catch (err) { /* sem internet ou ViaCEP fora do ar — segue com preenchimento manual */ }
  });

  // ── Entrega: retirada no aeroporto (escolhe na lista) x domicílio
  // (a LATAM define o aeroporto pela UF do destinatário — sem escolha manual) ──
  document.querySelectorAll('input[name="tipoEntrega"]').forEach((r) => r.addEventListener('change', atualizarTipoEntrega));
  function atualizarTipoEntrega() {
    const domicilio = $('elEntregaDomicilio').checked;
    document.getElementById('elOpcaoRetirada').classList.toggle('el-ativo', !domicilio);
    document.getElementById('elOpcaoDomicilio').classList.toggle('el-ativo', domicilio);
    $('elBlocoRetirada').style.display = domicilio ? 'none' : '';
    $('elBlocoDomicilio').style.display = domicilio ? '' : 'none';
    if (domicilio) atualizarDestinoAutomatico();
  }
  function atualizarDestinoAutomatico() {
    const uf = $('elDUf').value.toUpperCase();
    const iata = (window.AEROPORTO_POR_UF || {})[uf];
    const info = (window.AEROPORTOS_INFO || []).find((a) => a.iata === iata);
    $('elDestinoAuto').textContent = iata
      ? `${iata} — ${info ? info.cidade : ''}`
      : (uf ? `UF "${uf}" sem aeroporto mapeado` : 'Preencha o CEP do destinatário');
  }

  document.querySelectorAll('input[name="servico"]').forEach((r) => r.addEventListener('change', atualizarOpcaoServico));
  function atualizarOpcaoServico() {
    document.querySelectorAll('.el-opcao').forEach((op) => op.classList.remove('el-ativo'));
    const marcado = document.querySelector('input[name="servico"]:checked');
    if (marcado) marcado.closest('.el-opcao').classList.add('el-ativo');
  }

  // ── Volumes ───────────────────────────────────────────────────────────
  function renderVolumes() {
    $('elVolumes').innerHTML = volumes.map((v, i) => `
      <div class="el-linhaItem" data-i="${i}" style="grid-template-columns:repeat(5,minmax(0,1fr)) auto">
        <label class="el-campo"><span>Qtd.</span><input class="el-v-qtd" inputmode="numeric" value="${esc(v.quantidade)}"></label>
        <label class="el-campo"><span>Peso (kg)</span><input class="el-v-peso" inputmode="decimal" value="${esc(v.pesoKg)}"></label>
        <label class="el-campo"><span>Altura (cm)</span><input class="el-v-alt" inputmode="decimal" value="${esc(v.alturaCm)}"></label>
        <label class="el-campo"><span>Largura (cm)</span><input class="el-v-larg" inputmode="decimal" value="${esc(v.larguraCm)}"></label>
        <label class="el-campo"><span>Comprim. (cm)</span><input class="el-v-comp" inputmode="decimal" value="${esc(v.comprimentoCm)}"></label>
        ${volumes.length > 1 ? `<button type="button" class="el-remover" data-i="${i}">Remover</button>` : ''}
      </div>
    `).join('');
    $('elVolumes').querySelectorAll('.el-linhaItem').forEach((linha) => {
      const i = Number(linha.dataset.i);
      linha.querySelector('.el-v-qtd').addEventListener('input', (e) => { volumes[i].quantidade = e.target.value.replace(/\D/g, ''); e.target.value = volumes[i].quantidade; });
      linha.querySelector('.el-v-peso').addEventListener('input', (e) => { volumes[i].pesoKg = e.target.value; });
      linha.querySelector('.el-v-alt').addEventListener('input', (e) => { volumes[i].alturaCm = e.target.value; });
      linha.querySelector('.el-v-larg').addEventListener('input', (e) => { volumes[i].larguraCm = e.target.value; });
      linha.querySelector('.el-v-comp').addEventListener('input', (e) => { volumes[i].comprimentoCm = e.target.value; });
      const btnRm = linha.querySelector('.el-remover');
      if (btnRm) btnRm.addEventListener('click', () => { volumes.splice(i, 1); renderVolumes(); });
    });
  }
  renderVolumes();
  $('elBtnAddVolume').addEventListener('click', () => { volumes.push(volumeVazio()); renderVolumes(); });

  // ── Montagem do corpo da requisição ──────────────────────────────────
  function corpo() {
    const servicoMarcado = document.querySelector('input[name="servico"]:checked');
    return {
      destinatario: {
        nome: $('elDNome').value, cpfCnpj: $('elDDoc').value, ie: $('elDIe').value, telefone: $('elDTel').value,
        endereco: { cep: $('elDCep').value, logradouro: $('elDRua').value, numero: $('elDNum').value, complemento: $('elDCompl').value, bairro: $('elDBairro').value, cidade: $('elDCidade').value, uf: $('elDUf').value },
      },
      nota: { numero: $('elNfNumero').value, serie: $('elNfSerie').value, emitidaEm: $('elNfData').value, chave: $('elChave').value, valor: $('elNfValor').value },
      volumes,
      destino: $('elDestino').value,
      servico: servicoMarcado ? servicoMarcado.value : 'AUTOMATICO',
      seguroTipo: $('elSeguro').value,
      pagamento: $('elPagamento').value,
      entregaDomicilio: $('elEntregaDomicilio').checked,
      observacao: $('elObservacao').value,
    };
  }

  function mostrarErro(msg) {
    const el = $('elErro');
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }

  async function chamar(url, init) {
    mostrarErro('');
    try {
      const res = await fetch(url, init);
      const json = await res.json();
      if (!res.ok) { const err = new Error(json.erro || 'Não foi possível concluir'); err.tipo = json.tipo; throw err; }
      return json;
    } catch (e) {
      if (e.tipo) { mostrarErro(e.message); throw e; }
      const err = new Error('Sem conexão com o servidor. Tente novamente.');
      mostrarErro(err.message);
      throw err;
    }
  }

  function irParaEtapa(etapa) {
    // 'verificar' não é uma etapa numerada (é uma tela de recuperação de
    // erro) — não mexe no indicador de passos nesse caso, deixa o
    // "2. Revisar" que já estava marcado.
    if (etapa !== 'verificar') {
      document.querySelectorAll('#elPassos li').forEach((li) => li.classList.toggle('el-ativo', li.dataset.passo === etapa));
    }
    form.style.display = etapa === 'form' ? '' : 'none';
    $('elCartaoPrevia').style.display = etapa === 'previa' ? '' : 'none';
    $('elCartaoEmitida').style.display = etapa === 'emitida' ? '' : 'none';
    $('elCartaoVerificar').style.display = etapa === 'verificar' ? '' : 'none';
  }

  // ── Etapa 1 → 2: revisar ─────────────────────────────────────────────
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('elBtnRevisar');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Conferindo…';
    ultimaChaveEnviada = $('elChave').value;
    try {
      const r = await chamar('/emissao-latam/api/previa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo()) });
      previaAtual = r;
      renderPrevia();
      irParaEtapa('previa');
    } catch (e) { /* erro já mostrado */ }
    btn.disabled = false;
    btn.textContent = original;
  });

  function renderPrevia() {
    const p = previaAtual;
    const d = p.destinatario;
    const n = p.notas[0] || {};
    const s = p.servico;
    $('elResumoPrevia').innerHTML = `
      <div><dt>Serviço</dt><dd><b>${esc(s.nome)}</b> <small>produto ${esc(s.produtoLatam)}${s.automatico ? ' · automático' : ' · manual'}</small></dd></div>
      <div><dt>Notas somam</dt><dd>${p.valorTotalNotas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></div>
      <div class="el-largo"><dt>Destinatário</dt><dd>
        <b>${esc(d.nome)}</b> <small>${d.cnpj ? 'CNPJ ' + esc(d.cnpj) : 'CPF ' + esc(d.cpf)}</small><br>
        ${esc(d.endereco.logradouro)}, ${esc(d.endereco.numero)}${d.endereco.complemento ? ` — ${esc(d.endereco.complemento)}` : ''}<br>
        ${esc(d.endereco.bairro || '')} · ${esc(d.endereco.cidade)}/${esc(d.endereco.uf)} · ${esc(mascaraCep(d.endereco.cep || ''))}
      </dd></div>
      <div><dt>Rota</dt><dd>${esc(p.origem || 'NAT')} → ${esc(p.destino)} <small>${p.entregaDomicilio ? '(entrega no domicílio — aeroporto automático pela UF)' : '(retirada no aeroporto)'}</small></dd></div>
      <div><dt>NF-e</dt><dd class="el-mono">${n.chave ? esc(mascaraChave(n.chave)) : '—'}</dd></div>
      <div><dt>Volumes</dt><dd>${p.volumes.map((v) => `${v.quantidade}× ${v.pesoKg}kg (${v.alturaCm}×${v.larguraCm}×${v.comprimentoCm}cm)`).join('; ')}</dd></div>
      <div><dt>Seguro</dt><dd>${p.seguroTipo === 1 ? 'LATAM' : p.seguroTipo === 2 ? 'Próprio' : 'Sem seguro'}</dd></div>
      <div><dt>Pagamento</dt><dd>${p.pagamento === 'DESTINO' ? 'A pagar no destino' : 'Pago na origem'}</dd></div>
    `;
    $('elBtnEmitir').textContent = `Emitir e-Minuta ${s.nome}`;
  }

  $('elBtnVoltar').addEventListener('click', () => irParaEtapa('form'));

  // ── Etapa 2 → 3: emitir (CRIA OBJETO REAL, SEM CANCELAMENTO) ─────────
  $('elBtnEmitir').addEventListener('click', async () => {
    const btn = $('elBtnEmitir');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Emitindo na LATAM…';
    try {
      const r = await chamar('/emissao-latam/api/emitir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo()) });
      emissaoAtual = r;
      renderEmitida();
      irParaEtapa('emitida');
    } catch (e) {
      if (e.tipo === 'INDISPONIVEL') {
        // Não dá pra saber se a minuta foi criada ou não — oferece checar antes de deixar tentar de novo.
        irParaEtapa('verificar');
      }
    }
    btn.disabled = false;
    btn.textContent = original;
  });

  function renderEmitida() {
    const e = emissaoAtual;
    $('elTituloEmitida').textContent = e.minuta;
    $('elResumoEmitida').innerHTML = `
      <div><dt>Número da e-Minuta / AWB</dt><dd class="el-mono">${esc(e.minuta)}</dd></div>
      <div><dt>Prefixo</dt><dd>${esc(e.prefixo)}</dd></div>
      <div><dt>Número</dt><dd>${esc(e.numero)}</dd></div>
    `;
    $('elAvisoEmitida').innerHTML = e.aviso ? `<p class="el-aviso"><span>${esc(e.aviso)}</span></p>` : '';
    $('elDownloads').innerHTML = `
      <div class="el-download">
        <b>Térmica 10x15</b>
        <div class="el-acoes"><button type="button" class="el-botao" id="elBtnEtiquetaTermica">Abrir para imprimir</button></div>
      </div>
      <div class="el-download">
        <b>Folha A4</b>
        <div class="el-acoes"><button type="button" class="el-secundario" id="elBtnEtiquetaA4">Abrir para imprimir</button></div>
      </div>
    `;
    $('elBtnEtiquetaTermica').addEventListener('click', () => abrirEtiqueta('termica'));
    $('elBtnEtiquetaA4').addEventListener('click', () => abrirEtiqueta('a4'));
  }

  // ── Etiqueta pra impressão (a LATAM não devolve PDF pra e-Minuta — gera
  // aqui, no mesmo espírito das duas versões que os Correios já têm) ─────
  function abrirEtiqueta(layout) {
    const p = previaAtual, e = emissaoAtual;
    if (!p || !e) return;
    const r = p.remetente, d = p.destinatario;
    const pesoTotal = p.volumes.reduce((s, v) => s + (Number(v.pesoKg) || 0) * (Number(v.quantidade) || 0), 0);
    const qtdVolumes = p.volumes.reduce((s, v) => s + (Number(v.quantidade) || 0), 0);
    const doc = d.cnpj ? `CNPJ ${d.cnpj}` : `CPF ${d.cpf || ''}`;
    const html = layout === 'termica' ? etiquetaTermicaHtml() : etiquetaA4Html();
    const w = window.open('', '_blank');
    if (!w) { mostrarErro('O navegador bloqueou a janela da etiqueta. Permita pop-ups pra este site.'); return; }
    w.document.write(html);
    w.document.close();

    function etiquetaTermicaHtml() {
      return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiqueta ${esc(e.minuta)}</title>
        <style>
          @page { size: 100mm 150mm; margin: 4mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111; margin: 0; }
          .awb { font-size: 15px; letter-spacing: .04em; text-align: center; border: 2px solid #111; border-radius: 6px; padding: 8px 4px; font-weight: 800; font-family: ui-monospace, Consolas, monospace; }
          .rota { text-align: center; font-size: 22px; font-weight: 800; margin: 8px 0; }
          .bloco { border-top: 1px solid #111; padding: 6px 0; }
          .bloco b { font-size: 12px; display: block; }
          .bloco span { font-size: 11px; }
          .rodape { font-size: 9px; color: #444; margin-top: 6px; }
          .btn-imprimir { margin: 10px auto 0; display: block; font-size: 12px; padding: 6px 14px; }
          @media print { .btn-imprimir { display: none; } }
        </style></head><body>
        <div class="awb">AWB ${esc(e.minuta)}</div>
        <div class="rota">${esc(p.origem || 'NAT')} → ${esc(p.destino)}</div>
        <div class="bloco"><b>De</b><span>${esc(r.nome)}</span></div>
        <div class="bloco"><b>Para</b><span>${esc(d.nome)} — ${esc(doc)}</span>
          <span>${esc(d.endereco.logradouro)}, ${esc(d.endereco.numero)}${d.endereco.complemento ? ' - ' + esc(d.endereco.complemento) : ''}</span>
          <span>${esc(d.endereco.bairro || '')} — ${esc(d.endereco.cidade)}/${esc(d.endereco.uf)} — ${esc(d.endereco.cep || '')}</span>
        </div>
        <div class="bloco"><b>Serviço</b><span>${esc(p.servico.nome)} · ${qtdVolumes} vol. · ${pesoTotal.toFixed(2)} kg</span></div>
        <div class="rodape">NF-e ${esc(mascaraChave(p.notas[0]?.chave || ''))}</div>
        <button class="btn-imprimir" onclick="window.print()">Imprimir</button>
        </body></html>`;
    }
    function etiquetaA4Html() {
      return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiqueta ${esc(e.minuta)}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111; }
          .caixa { border: 2px solid #111; border-radius: 10px; padding: 24px; max-width: 560px; margin: 0 auto; }
          .awb { font-size: 26px; letter-spacing: .04em; text-align: center; font-weight: 800; font-family: ui-monospace, Consolas, monospace; }
          .rota { text-align: center; font-size: 34px; font-weight: 800; margin: 14px 0 22px; }
          .grade { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 10px; }
          .bloco { border-top: 1px solid #ccc; padding-top: 10px; }
          .bloco b { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; display: block; margin-bottom: 4px; color: #555; }
          .bloco span { font-size: 15px; display: block; }
          .rodape { font-size: 11px; color: #666; margin-top: 18px; text-align: center; }
          .btn-imprimir { margin: 18px auto 0; display: block; font-size: 13px; padding: 8px 18px; }
          @media print { .btn-imprimir { display: none; } }
        </style></head><body>
        <div class="caixa">
          <div class="awb">AWB ${esc(e.minuta)}</div>
          <div class="rota">${esc(p.origem || 'NAT')} → ${esc(p.destino)}</div>
          <div class="grade">
            <div class="bloco"><b>Remetente</b><span>${esc(r.nome)}</span><span>CNPJ ${esc(r.cnpj)}</span></div>
            <div class="bloco"><b>Destinatário</b><span>${esc(d.nome)}</span><span>${esc(doc)}</span></div>
            <div class="bloco" style="grid-column:1/-1"><b>Endereço de entrega</b>
              <span>${esc(d.endereco.logradouro)}, ${esc(d.endereco.numero)}${d.endereco.complemento ? ' - ' + esc(d.endereco.complemento) : ''} — ${esc(d.endereco.bairro || '')}</span>
              <span>${esc(d.endereco.cidade)}/${esc(d.endereco.uf)} — CEP ${esc(d.endereco.cep || '')}</span>
            </div>
            <div class="bloco"><b>Serviço</b><span>${esc(p.servico.nome)}</span></div>
            <div class="bloco"><b>Volumes</b><span>${qtdVolumes} volume(s) · ${pesoTotal.toFixed(2)} kg</span></div>
          </div>
          <div class="rodape">NF-e ${esc(mascaraChave(p.notas[0]?.chave || ''))}</div>
        </div>
        <button class="btn-imprimir" onclick="window.print()">Imprimir</button>
        </body></html>`;
    }
  }

  $('elBtnNovaMinuta').addEventListener('click', () => {
    volumes = [volumeVazio()]; previaAtual = null; emissaoAtual = null;
    renderVolumes();
    form.reset();
    // form.reset() volta os radios pro "checked" declarado no HTML
    // (Automático / Retirada no aeroporto) — só falta re-sincronizar as
    // classes visuais el-ativo e o bloco retirada/domicílio com isso.
    atualizarOpcaoServico();
    atualizarTipoEntrega();
    mostrarErro('');
    irParaEtapa('form');
  });

  // ── Verificar (quando a LATAM não confirma a emissão) ────────────────
  $('elBtnVerificar').addEventListener('click', async () => {
    const btn = $('elBtnVerificar');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Verificando…';
    try {
      const r = await chamar(`/emissao-latam/api/verificar?chave=${encodeURIComponent((ultimaChaveEnviada || '').replace(/\D/g, ''))}`, { method: 'GET' });
      $('elResultadoVerificar').innerHTML = r.encontrado
        ? `<p class="el-aviso"><span><b>Encontrado!</b> AWB ${esc(r.awb)}${r.ultimoEvento ? ` — último evento: ${esc(r.ultimoEvento.descricao)} em ${esc(r.ultimoEvento.data)}` : ''}. A e-Minuta JÁ foi criada — não reenvie.</span></p>`
        : `<p class="el-aviso"><span>Nada encontrado pra essa chave ainda. Pode tentar emitir de novo, ou aguarde alguns minutos e verifique outra vez antes de reenviar.</span></p>`;
    } catch (e) { /* erro já mostrado */ }
    btn.disabled = false;
    btn.textContent = original;
  });

  $('elBtnVoltarDeVerificar').addEventListener('click', () => { $('elResultadoVerificar').innerHTML = ''; irParaEtapa('previa'); });
})();
