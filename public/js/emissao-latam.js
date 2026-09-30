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
      ? `${iata} (${info ? info.cidade : ''})`
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
        ${esc(d.endereco.logradouro)}, ${esc(d.endereco.numero)}${d.endereco.complemento ? ` · ${esc(d.endereco.complemento)}` : ''}<br>
        ${esc(d.endereco.bairro || '')} · ${esc(d.endereco.cidade)}/${esc(d.endereco.uf)} · ${esc(mascaraCep(d.endereco.cep || ''))}
      </dd></div>
      <div><dt>Rota</dt><dd>${esc(p.origem || 'NAT')} → ${esc(p.destino)} <small>${p.entregaDomicilio ? '(entrega no domicílio, aeroporto automático pela UF)' : '(retirada no aeroporto)'}</small></dd></div>
      <div><dt>NF-e</dt><dd class="el-mono">${n.chave ? esc(mascaraChave(n.chave)) : '-'}</dd></div>
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
  function formatarTelefone(tel) {
    const d = (tel && tel.numero) || '';
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d || '';
  }
  function formatarDoc(d) {
    return d.cnpj ? `CNPJ ${d.cnpj}` : `CPF ${d.cpf || ''}`;
  }
  function formatarEndereco(end) {
    return `${end.logradouro}, ${end.numero} · ${end.bairro || ''} · ${end.cidade}/${end.uf} · CEP ${end.cep || ''}`;
  }
  // Nome do terminal pra "Retirada" na etiqueta — quando a cidade tem mais de
  // um aeroporto LATAM, o nome do local já vem entre parênteses na tabela
  // (ex.: GRU = "São Paulo (Guarulhos)", CGH = "São Paulo (Congonhas)") e é
  // isso que precisa aparecer, não o nome da cidade repetido; quando só tem
  // um aeroporto na cidade (ex.: NAT = "Natal"), usa o nome dele mesmo.
  function nomeAeroporto(iata) {
    const info = (window.AEROPORTOS_INFO || []).find((a) => a.iata === iata);
    const cidade = (info && info.cidade) || '';
    const local = cidade.match(/\(([^)]+)\)/);
    return (local ? local[1] : cidade) || iata || '';
  }

  /** Monta os dados da etiqueta a partir da prévia/emissão atual — cada campo já
   * com o ícone Tabler que vai usar. Campos com valor vazio saem do array (não
   * aparecem na impressão) — feito uma vez só, reaproveitado pelos dois layouts. */
  function montarBlocosEtiqueta() {
    const p = previaAtual, e = emissaoAtual;
    const r = p.remetente, d = p.destinatario, n = p.notas[0] || {};
    const pesoTotal = p.volumes.reduce((s, v) => s + (Number(v.pesoKg) || 0) * (Number(v.quantidade) || 0), 0);
    const qtdVolumes = p.volumes.reduce((s, v) => s + (Number(v.quantidade) || 0), 0);
    const campo = (icone, rotulo, valor) => (valor ? { icone, rotulo, valor } : null);

    return {
      awb: e.minuta,
      // Em cima só a sigla do estado (remetente é fixo RN; destinatário é o
      // do formulário); embaixo a cidade/UF real do endereço, não a do
      // aeroporto, que pode ser só o hub mais próximo e não a cidade de fato
      // do cliente (ex.: aeroporto de SP pra cliente em Piracicaba).
      origemUf: r.endereco.uf, destinoUf: d.endereco.uf,
      origemLabel: `${r.endereco.cidade}/${r.endereco.uf}`, destinoLabel: `${d.endereco.cidade}/${d.endereco.uf}`,
      chaveNfe: n.chave || '',
      remetente: [
        campo('building-skyscraper', 'Razão Social', r.nome),
        campo('home', 'Origem', formatarEndereco(r.endereco)),
      ].filter(Boolean),
      destinatario: [
        campo('user', 'Nome', d.nome),
        campo('home', 'Endereço', formatarEndereco(d.endereco)),
        campo('map-pin', 'Complemento', d.endereco.complemento),
        campo('phone', 'Telefone', formatarTelefone(d.telefone)),
        campo('id', 'CPF/CNPJ', formatarDoc(d)),
        campo('file-certificate', 'Inscrição estadual', d.cnpj ? d.ie : null),
      ].filter(Boolean),
      carga: [
        campo('file-text', 'NF', n.numero ? `${n.numero}/${n.serie || ''}` : null),
        campo('currency-dollar', 'Valor NF', Number.isFinite(n.valor) ? n.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null),
        campo('package', 'Volumes/Peso', `${qtdVolumes} volume(s) · ${pesoTotal.toFixed(2)} kg`),
        campo('grid-dots', 'Conteúdo', 'CONFECÇÕES/TÊXTEIS'),
        campo('settings', 'Serviço', p.servico.nome),
        campo('truck-delivery', 'Modalidade de entrega', p.entregaDomicilio ? 'Entrega' : `Retirada ${nomeAeroporto(p.destino)}`),
      ].filter(Boolean),
    };
  }

  function abrirEtiqueta(layout) {
    if (!previaAtual || !emissaoAtual) return;
    const html = layout === 'termica' ? etiquetaTermicaHtml(montarBlocosEtiqueta()) : etiquetaA4Html(montarBlocosEtiqueta());
    const w = window.open('', '_blank');
    if (!w) { mostrarErro('O navegador bloqueou a janela da etiqueta. Permita pop-ups pra este site.'); return; }
    w.document.write(html);
    w.document.close();
  }

  /** Barras de código de barras (só visual/identificação rápida — a LATAM não
   * pede que essa etiqueta seja escaneável, isso não é o rótulo oficial deles). */
  function barrasFalsas(digitos, altura, cor) {
    const seq = String(digitos || '').replace(/\D/g, '');
    if (!seq) return '';
    const corBarra = cor || '#161f2e';
    const barras = seq.split('').map((d, i) => {
      const largura = 1 + (Number(d) % 3);
      const c = i % 2 === 0 ? corBarra : 'transparent';
      return `<div style="width:${largura}px;height:100%;background:${c}"></div>`;
    }).join('');
    return `<div style="display:flex;align-items:stretch;height:${altura}px;gap:0">${barras}</div>`;
  }

  const TABLER_CSS = '/vendor/tabler-icons/tabler-icons.min.css';
  const icone = (nome, cls) => `<i class="ti ti-${nome} ${cls || ''}" aria-hidden="true"></i>`;

  // Térmica: preto sobre branco, sem nenhum fundo preenchido — impressora
  // térmica não tem meio-tom de verdade, então área escura vira mancha
  // cinza granulada e apaga o texto por cima (foi exatamente o que
  // aconteceu com a barra de fundo escuro do AWB na primeira versão).
  // Fonte grande e peso alto, separadores por linha (não por preenchimento).
  function etiquetaTermicaHtml(b) {
    const linhaCampo = (c) => `<div class="campo">${icone(c.icone, 'ic')}<span class="rotulo">${esc(c.rotulo)}:</span> <span class="valor">${esc(c.valor)}</span></div>`;
    const secao = (icone1, titulo, linhas, id) => `
      <div class="sec"${id ? ` id="${id}"` : ''}>
        <div class="sec-titulo">${icone(icone1)} ${esc(titulo)}</div>
        ${linhas.map(linhaCampo).join('')}
      </div>`;
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiqueta ${esc(b.awb)}</title>
      <link rel="stylesheet" href="${TABLER_CSS}">
      <style>
        @page { size: 100mm 150mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body { width: 100mm; height: 150mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; font-size: 11px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .cartao { border: 1.5px solid #000; width: 100%; height: 100%; padding: 2.5mm; overflow: hidden; }
        .cabecalho { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5mm; border-bottom: 1px solid #000; margin-bottom: 1.5mm; }
        .marca { display: flex; align-items: center; gap: 4px; }
        .marca .ti { font-size: 18px; }
        .marca-txt div:first-child { font-size: 7px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
        .marca-txt div:last-child { font-size: 13px; font-weight: 800; letter-spacing: .01em; }
        .cabecalho > .ti { font-size: 16px; }
        .awb-box { border: 1.5px solid #000; border-radius: 3px; padding: 2px 6px; text-align: center; margin-bottom: 1.5mm; }
        .awb-lbl { font-size: 8px; font-weight: 700; letter-spacing: .1em; }
        .awb-num { display: block; font-size: 21px; font-weight: 800; letter-spacing: .01em; font-family: ui-monospace, Consolas, monospace; line-height: 1.2; }
        .rota-bar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5mm; border-bottom: 1px solid #000; margin-bottom: 1.5mm; }
        .rota-lado { text-align: center; }
        .rota-lado .ti { font-size: 13px; }
        .rota-iata { font-size: 17px; font-weight: 800; }
        .rota-cidade { font-size: 8px; }
        .rota-seta { font-size: 14px; padding: 0 5px; }
        .sec-titulo { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 1px; }
        .sec { border-bottom: 1px solid #000; padding-bottom: 1.5mm; margin-bottom: 1.5mm; }
        .campo { display: flex; gap: 4px; align-items: baseline; font-size: 10px; line-height: 1.25; margin-bottom: 0; }
        .campo .ic { font-size: 10px; flex-shrink: 0; }
        .rotulo { font-weight: 600; flex-shrink: 0; }
        .valor { font-weight: 700; overflow-wrap: anywhere; }
        #sec-destinatario .campo { font-size: 11px; }
        .chave-lbl { display: flex; align-items: center; gap: 4px; font-size: 8px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 2px; }
        .chave-num { font-size: 9px; font-family: ui-monospace, Consolas, monospace; letter-spacing: .01em; margin-bottom: 3px; }
        .btn-imprimir { margin: 10px auto 0; display: block; font-size: 12px; padding: 6px 14px; }
        @media print { .btn-imprimir { display: none; } }
      </style></head><body>
      <div class="cartao">
        <div class="cabecalho">
          <div class="marca">${icone('box-multiple')}<div class="marca-txt"><div>e-Minuta</div><div>LATAM CARGO</div></div></div>
          ${icone('plane-departure')}
        </div>
        <div class="awb-box"><span class="awb-lbl">${icone('barcode')} AWB</span><span class="awb-num">${esc(b.awb)}</span></div>
        <div class="rota-bar">
          <div class="rota-lado">${icone('map-pin-filled')}<div class="rota-iata">${esc(b.origemUf)}</div><div class="rota-cidade">${esc(b.origemLabel)}</div></div>
          <span class="rota-seta">${icone('plane')} →</span>
          <div class="rota-lado">${icone('map-pin-filled')}<div class="rota-iata">${esc(b.destinoUf)}</div><div class="rota-cidade">${esc(b.destinoLabel)}</div></div>
        </div>
        ${secao('user', 'Remetente', b.remetente)}
        ${secao('map-pin', 'Destinatário', b.destinatario, 'sec-destinatario')}
        ${secao('package', 'Carga', b.carga)}
        <div>
          <div class="chave-lbl">${icone('barcode')} Chave NF-e</div>
          <div class="chave-num">${esc(mascaraChave(b.chaveNfe))}</div>
          ${barrasFalsas(b.chaveNfe, 26, '#000')}
        </div>
      </div>
      <button class="btn-imprimir" onclick="window.print()">Imprimir</button>
      </body></html>`;
  }

  // A4: mesmo padrão da térmica — preto sobre branco, sem nenhum fundo
  // preenchido (fica melhor pra imprimir e gasta menos tinta/toner também).
  function etiquetaA4Html(b) {
    const linhaCampo = (c) => `<div class="campo">${icone(c.icone, 'ic')}<div><span class="rotulo">${esc(c.rotulo)}:</span><br><span class="valor">${esc(c.valor)}</span></div></div>`;
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiqueta ${esc(b.awb)}</title>
      <link rel="stylesheet" href="${TABLER_CSS}">
      <style>
        @page { size: A4; margin: 16mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .cartao { border: 2px solid #000; border-radius: 10px; max-width: 700px; margin: 0 auto; padding: 20px 24px; }
        .cabecalho { display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 2px solid #000; margin-bottom: 16px; }
        .marca { display: flex; align-items: center; gap: 12px; }
        .marca .ti { font-size: 36px; }
        .marca-txt div:first-child { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .marca-txt div:last-child { font-size: 26px; font-weight: 800; letter-spacing: .01em; }
        .tagline { display: flex; align-items: center; gap: 12px; border-left: 1.5px solid #000; padding-left: 16px; }
        .tagline .ti { font-size: 26px; }
        .tagline div { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; line-height: 1.5; }
        .awb-box { border: 2px solid #000; border-radius: 6px; padding: 10px 18px; text-align: center; margin-bottom: 16px; }
        .awb-lbl { font-size: 13px; font-weight: 700; letter-spacing: .1em; }
        .awb-num { display: block; font-size: 36px; font-weight: 800; letter-spacing: .02em; font-family: ui-monospace, Consolas, monospace; }
        .rota-bar { padding-bottom: 14px; border-bottom: 2px solid #000; margin-bottom: 16px; display: flex; align-items: center; justify-content: center; gap: 32px; }
        .rota-lado { text-align: center; display: flex; align-items: center; gap: 8px; }
        .rota-lado .ti { font-size: 26px; }
        .rota-iata { font-size: 30px; font-weight: 800; }
        .rota-cidade { font-size: 13px; font-weight: 600; }
        .rota-seta { font-size: 22px; display: flex; align-items: center; }
        .sec-titulo { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 10px; }
        .sec-titulo .ti { font-size: 15px; }
        .sec { padding-bottom: 16px; border-bottom: 1.5px dashed #000; margin-bottom: 16px; }
        .campo { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 1.5; margin-bottom: 10px; }
        .campo .ic { font-size: 15px; margin-top: 2px; flex-shrink: 0; }
        .rotulo { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; font-weight: 600; }
        .valor { font-weight: 700; overflow-wrap: anywhere; }
        .carga-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 20px; }
        .chave-lbl { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 6px; }
        .chave-num { font-size: 13px; font-family: ui-monospace, Consolas, monospace; letter-spacing: .02em; margin-bottom: 8px; }
        .btn-imprimir { margin: 22px auto 0; display: block; font-size: 13px; padding: 8px 18px; }
        @media print { .btn-imprimir { display: none; } }
      </style></head><body>
      <div class="cartao">
        <div class="cabecalho">
          <div class="marca">${icone('box-multiple')}<div class="marca-txt"><div>e-Minuta</div><div>LATAM CARGO</div></div></div>
          <div class="tagline">${icone('plane-departure')}<div>Transporte aéreo<br>Carga expressa</div></div>
        </div>
        <div class="awb-box"><span class="awb-lbl">${icone('barcode')} AWB</span><span class="awb-num">${esc(b.awb)}</span></div>
        <div class="rota-bar">
          <div class="rota-lado">${icone('map-pin-filled')}<div><div class="rota-iata">${esc(b.origemUf)}</div><div class="rota-cidade">${esc(b.origemLabel)}</div></div></div>
          <span class="rota-seta">${icone('plane')} →</span>
          <div class="rota-lado">${icone('map-pin-filled')}<div><div class="rota-iata">${esc(b.destinoUf)}</div><div class="rota-cidade">${esc(b.destinoLabel)}</div></div></div>
        </div>
        <div class="sec" style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div>
            <div class="sec-titulo">${icone('user')} Remetente</div>
            ${b.remetente.map(linhaCampo).join('')}
          </div>
          <div>
            <div class="sec-titulo">${icone('map-pin')} Destinatário</div>
            ${b.destinatario.map(linhaCampo).join('')}
          </div>
        </div>
        <div class="sec-titulo">${icone('package')} Carga</div>
        <div class="carga-grid sec">${b.carga.map(linhaCampo).join('')}</div>
        <div>
          <div class="chave-lbl">${icone('barcode')} Chave NF-e</div>
          <div class="chave-num">${esc(mascaraChave(b.chaveNfe))}</div>
          ${barrasFalsas(b.chaveNfe, 34, '#000')}
        </div>
      </div>
      <button class="btn-imprimir" onclick="window.print()">Imprimir</button>
      </body></html>`;
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
        ? `<p class="el-aviso"><span><b>Encontrado!</b> AWB ${esc(r.awb)}${r.ultimoEvento ? `, último evento: ${esc(r.ultimoEvento.descricao)} em ${esc(r.ultimoEvento.data)}` : ''}. A e-Minuta JÁ foi criada, não reenvie.</span></p>`
        : `<p class="el-aviso"><span>Nada encontrado pra essa chave ainda. Pode tentar emitir de novo, ou aguarde alguns minutos e verifique outra vez antes de reenviar.</span></p>`;
    } catch (e) { /* erro já mostrado */ }
    btn.disabled = false;
    btn.textContent = original;
  });

  $('elBtnVoltarDeVerificar').addEventListener('click', () => { $('elResultadoVerificar').innerHTML = ''; irParaEtapa('previa'); });
})();
