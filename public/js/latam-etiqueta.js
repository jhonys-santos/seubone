// Etiqueta interna da e-Minuta LATAM (térmica 10x15 e A4), gerada no navegador a partir da prévia da emissão. Usada pela tela de Emissão e pelo
// Histórico (reimpressão). A LATAM não devolve PDF para e-Minuta.
(function () {
  'use strict';

  const mascaraChave = (v) => v.replace(/\D/g, '').slice(0, 44).replace(/(\d{4})(?=\d)/g, '$1 ');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  function montarBlocosEtiqueta(p, minuta) {
    const r = p.remetente, d = p.destinatario, n = p.notas[0] || {};
    const pesoTotal = p.volumes.reduce((s, v) => s + (Number(v.pesoKg) || 0) * (Number(v.quantidade) || 0), 0);
    const qtdVolumes = p.volumes.reduce((s, v) => s + (Number(v.quantidade) || 0), 0);
    const campo = (icone, rotulo, valor) => (valor ? { icone, rotulo, valor } : null);

    return {
      awb: minuta,
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

  /** Abre a etiqueta numa janela pra imprimir. p = prévia (o que previa() devolveu); devolve false se o navegador bloqueou a janela. */
  function abrir(layout, p, minuta) {
    const html = layout === 'termica' ? etiquetaTermicaHtml(montarBlocosEtiqueta(p, minuta)) : etiquetaA4Html(montarBlocosEtiqueta(p, minuta));
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    return true;
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

  window.LatamEtiqueta = { abrir };
})();
