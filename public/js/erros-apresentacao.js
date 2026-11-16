// Apresentação (.pptx) da Reunião de Fábrica/Vendas do Painel de Erros para a diretoria: capa, resumo, custo mês a mês, causas, responsáveis, resoluções e UM SLIDE
// POR CASO com TODOS os anexos (fotos e miniaturas de vídeo; cada imagem abre o arquivo original no Drive). Gerada no navegador com o PptxGenJS (carregado sob
// demanda); as imagens vêm do servidor (/erros/api/anexo-img), que busca a miniatura no Drive.
// Chamada por erros.js: ErrosApresentacao.gerar({ d, cfg, periodoLabel, filtroTxt }).
window.ErrosApresentacao = (function () {
  'use strict';
  const PPTX_URL = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const IMG_API = '/erros/api/anexo-img';
  const SIMULTANEAS = 6;
  const FONTE = 'Calibri';
  const COR = { escuro: '1B1B1B', dourado: 'F5B800', douradoEscuro: '8A6A00', texto: '1F2328', muted: '5B6470', fundo: 'F3F4F6', linha: 'D9DCE1', ruim: 'B42318', bom: '1B7A46', branco: 'FFFFFF' };
  const W = 13.333, H = 7.5;

  // ── Utilidades ──
  const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brlCurto = (n) => 'R$ ' + Math.round(Number(n || 0)).toLocaleString('pt-BR');
  const corta = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
  const dmY = (d) => { const x = new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); };
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  function parseFotos(v) {
    return String(v || '').split(/\n+/).flatMap((l) => (/^\s*data:/.test(l) ? [l.trim()] : l.split(',').map((s) => s.trim()))).filter(Boolean);
  }
  const idDrive = (u) => { const m = /drive\.google|docs\.google|googleusercontent/.test(u) ? String(u).match(/[-\w]{25,}/) : null; return m ? m[0] : ''; };
  const urlOriginal = (u) => (/^https?:/i.test(u) ? u : '');

  function carregarPptx() {
    if (window.PptxGenJS) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement('script'); s.src = PPTX_URL; s.async = true;
      s.onload = () => (window.PptxGenJS ? ok() : falha(new Error('biblioteca de apresentação não carregou')));
      s.onerror = () => falha(new Error('não consegui baixar a biblioteca de apresentação (sem internet?)'));
      document.head.appendChild(s);
    });
  }

  const blobParaDataUrl = (blob) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => falha(new Error('leitura')); r.readAsDataURL(blob); });
  const medir = (dataUrl) => new Promise((ok) => { const im = new Image(); im.onload = () => ok({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 }); im.onerror = () => ok(null); im.src = dataUrl; });

  /** Baixa a miniatura de um anexo pelo servidor. Devolve { data, w, h } ou null (vídeo sem miniatura, áudio, arquivo indisponível). */
  async function buscarImagem(url) {
    try {
      if (/^data:image\//.test(url)) { const m = await medir(url); return m ? { data: url, ...m } : null; }
      const id = idDrive(url); if (!id) return null;
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
      const r = await fetch(`${IMG_API}?id=${encodeURIComponent(id)}&w=1000`, { signal: ctl.signal, credentials: 'same-origin' }); clearTimeout(t);
      if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return null;
      const data = await blobParaDataUrl(await r.blob()); const m = await medir(data);
      return m ? { data, ...m } : null;
    } catch (e) { return null; }
  }

  // ── Janela de progresso ──
  function abrirProgresso(titulo) {
    const ov = document.createElement('div'); ov.className = 'er-overlay'; ov.style.zIndex = '1200';
    ov.innerHTML = `<div class="er-modal" role="dialog" aria-modal="true" aria-label="${titulo}" style="max-width:460px"><div class="er-modal-head"><div style="flex:1"><div class="title">${titulo}</div><div class="sub" id="eaTexto">Preparando…</div></div></div>
      <div class="er-modal-body"><div style="height:10px;border-radius:6px;background:var(--surface-3,#2a2a2a);overflow:hidden"><div id="eaBarra" style="height:100%;width:0;background:var(--gold,#F5B800);transition:width .2s"></div></div>
      <p style="margin:12px 0 0;font-size:12px;color:var(--text-muted)">Não feche esta janela: o arquivo baixa sozinho quando terminar.</p></div>
      <div class="er-modal-foot"><button class="er-btn er-btn-ghost" id="eaCancelar" type="button">Cancelar</button></div></div>`;
    document.body.appendChild(ov);
    const estado = { cancelado: false };
    ov.querySelector('#eaCancelar').addEventListener('click', () => { estado.cancelado = true; ov.querySelector('#eaTexto').textContent = 'Cancelando…'; });
    return {
      estado, texto: (t) => { const e = ov.querySelector('#eaTexto'); if (e) e.textContent = t; }, pct: (p) => { const b = ov.querySelector('#eaBarra'); if (b) b.style.width = Math.max(0, Math.min(100, p)) + '%'; },
      fechar: () => ov.remove(),
    };
  }

  // ── Construção dos slides ──
  function montarMestres(pres, rodape) {
    pres.defineSlideMaster({
      title: 'CONTEUDO', background: { color: COR.branco },
      objects: [
        { rect: { x: 0, y: 0, w: W, h: 0.12, fill: { color: COR.dourado } } },
        { text: { text: rodape, options: { x: 0.6, y: 7.05, w: 10, h: 0.3, fontFace: FONTE, fontSize: 10, color: COR.muted } } },
      ],
      slideNumber: { x: 12.2, y: 7.05, w: 0.6, h: 0.3, fontFace: FONTE, fontSize: 10, color: COR.muted, align: 'right' },
    });
  }

  const titulo = (s, t, sub) => {
    s.addText(t, { x: 0.6, y: 0.4, w: 12.1, h: 0.7, fontFace: FONTE, fontSize: 28, bold: true, color: COR.texto, fit: 'shrink' });
    if (sub) s.addText(sub, { x: 0.6, y: 1.08, w: 12.1, h: 0.4, fontFace: FONTE, fontSize: 14, color: COR.muted });
  };

  function slideCapa(pres, ctx) {
    const s = pres.addSlide(); s.background = { color: COR.escuro };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: COR.dourado }, line: { color: COR.dourado, width: 0 } });
    if (ctx.logo) s.addImage({ data: ctx.logo, x: 0.9, y: 0.7, w: 1.1, h: 1.1, altText: 'SeuBoné' });
    s.addText('PAINEL DE ERROS', { x: 0.9, y: 2.5, w: 11, h: 0.4, fontFace: FONTE, fontSize: 16, bold: true, color: COR.dourado, charSpacing: 4 });
    s.addText(ctx.cfg.nome, { x: 0.9, y: 2.95, w: 11.5, h: 1.2, fontFace: FONTE, fontSize: 54, bold: true, color: COR.branco, fit: 'shrink' });
    s.addText(`Erros auditados · ${ctx.periodoLabel}`, { x: 0.9, y: 4.25, w: 11.5, h: 0.5, fontFace: FONTE, fontSize: 22, color: 'D8DBE0' });
    if (ctx.filtroTxt) s.addText(ctx.filtroTxt, { x: 0.9, y: 4.8, w: 11.5, h: 0.4, fontFace: FONTE, fontSize: 14, color: 'AEB4BD' });
    s.addText(`SeuBoné · gerado em ${dmY(new Date())}`, { x: 0.9, y: 6.7, w: 11, h: 0.35, fontFace: FONTE, fontSize: 12, color: '8F96A1' });
  }

  function delta(v, rotulo) {
    if (v == null) return { t: 'sem período anterior para comparar', c: COR.muted };
    if (v === 0) return { t: 'igual ao ' + rotulo, c: COR.muted };
    return { t: (v > 0 ? '▲ ' : '▼ ') + Math.abs(v) + '% vs ' + rotulo, c: v > 0 ? COR.ruim : COR.bom };   // para erros, subir é ruim
  }

  function slideResumo(pres, ctx) {
    const { d } = ctx; const s = pres.addSlide({ masterName: 'CONTEUDO' });
    titulo(s, 'Resumo do período', `${ctx.periodoLabel} · ${d.n} erro(s) auditado(s)`);
    const causa = d.causasTop[0] || { nome: '—', n: 0, custo: 0 };
    const comAnexo = d.casosOrdenados.filter((r) => parseFotos(r.foto).length).length;
    const rot = ctx.comparacao;
    const dn = delta(d.deltaN, rot), dc = delta(d.deltaCusto, rot);
    const cards = [
      { l: 'ERROS AUDITADOS', v: String(d.n), f: dn.t, fc: dn.c, tam: 44 },
      { l: 'CUSTO TOTAL', v: brl(d.custoTotal), f: dc.t, fc: dc.c, tam: 26 },
      { l: 'CAUSA EM DESTAQUE', v: corta(causa.nome, 26), f: `${causa.n} caso(s) · ${brl(causa.custo)}`, fc: COR.muted, tam: 20 },
      { l: 'CASOS COM ANEXO', v: `${comAnexo} de ${d.n}`, f: 'fotos e vídeos nos slides a seguir', fc: COR.muted, tam: 32 },
    ];
    const cw = 2.9, gap = 0.17, x0 = 0.6;
    cards.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      s.addShape(pres.ShapeType.roundRect, { x, y: 1.9, w: cw, h: 2.6, fill: { color: COR.fundo }, line: { color: COR.linha, width: 0.75 }, rectRadius: 0.08 });
      s.addShape(pres.ShapeType.rect, { x, y: 1.9, w: cw, h: 0.07, fill: { color: COR.dourado }, line: { color: COR.dourado, width: 0 } });
      s.addText(c.l, { x: x + 0.25, y: 2.15, w: cw - 0.5, h: 0.3, fontFace: FONTE, fontSize: 11, bold: true, color: COR.muted, charSpacing: 2 });
      s.addText(c.v, { x: x + 0.25, y: 2.55, w: cw - 0.5, h: 1.0, fontFace: FONTE, fontSize: c.tam || 28, bold: true, color: COR.texto, valign: 'middle', fit: 'shrink' });
      s.addText(c.f, { x: x + 0.25, y: 3.65, w: cw - 0.5, h: 0.7, fontFace: FONTE, fontSize: 13, color: c.fc, valign: 'top' });
    });
    const linhas = [];
    if (d.pendentesPeriodo > 0) linhas.push(`${d.pendentesPeriodo} caso(s) do período ainda aguardam auditoria e não entram nestes números.`);
    linhas.push(ctx.cfg.foco.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim());
    s.addText(linhas.map((t, i) => ({ text: t, options: { breakLine: i < linhas.length - 1 } })), { x: 0.6, y: 4.9, w: 12.1, h: 1.6, fontFace: FONTE, fontSize: 16, color: COR.texto, valign: 'top', paraSpaceAfter: 8 });
    s.addNotes(`Resumo: ${d.n} erros auditados, ${brl(d.custoTotal)} de custo. ${dn.t}. Custo: ${dc.t}.`);
  }

  function graficoBarras(pres, s, itens, opts) {
    const top = itens.slice(0, opts.max || 8);
    const labels = top.map((i) => `${corta(i.nome, 34)} (${i.n})`);
    s.addChart(pres.charts.BAR, [{ name: 'Custo', labels, values: top.map((i) => Math.round(i.custo * 100) / 100) }], {
      x: 0.6, y: 1.65, w: 12.1, h: 5.2, barDir: 'bar', chartColors: [COR.dourado], barGapWidthPct: 45,
      catAxisOrientation: 'maxMin', catAxisLabelFontFace: FONTE, catAxisLabelFontSize: 13, catAxisLabelColor: COR.texto,
      valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      showValue: true, dataLabelFormatCode: '"R$ "#,##0', dataLabelFontFace: FONTE, dataLabelFontSize: 13, dataLabelColor: COR.texto, dataLabelPosition: 'outEnd',
      showLegend: false, showTitle: false,
    });
  }

  function slideLista(pres, ctx, tit, sub, itens, nota) {
    if (!itens.length) return;
    const s = pres.addSlide({ masterName: 'CONTEUDO' });
    titulo(s, tit, sub);
    graficoBarras(pres, s, itens, {});
    s.addNotes(nota + '\n' + itens.slice(0, 12).map((i) => `${i.nome}: ${i.n} caso(s), ${brl(i.custo)}`).join('\n'));
  }

  function slideCustoMes(pres, ctx) {
    const pm = ctx.d.porMes; if (!pm || pm.length < 2) return;
    const s = pres.addSlide({ masterName: 'CONTEUDO' });
    titulo(s, 'Custo mês a mês', 'Do primeiro ao último mês do período, com o acumulado');
    const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const nomeMes = (ym) => { const [y, m] = ym.split('-').map(Number); return MESES_CURTOS[m - 1] + '/' + String(y).slice(2); };
    s.addChart(pres.charts.BAR, [{ name: 'Custo', labels: pm.map((m) => nomeMes(m.ym)), values: pm.map((m) => Math.round(m.custo * 100) / 100) }], {
      x: 0.6, y: 1.65, w: 7.3, h: 5.2, barDir: 'col', chartColors: [COR.dourado], barGapWidthPct: 40, catAxisLabelFontFace: FONTE, catAxisLabelFontSize: 12,
      valAxisHidden: true, valGridLine: { style: 'none' }, showValue: true, dataLabelFormatCode: '"R$ "#,##0', dataLabelFontFace: FONTE, dataLabelFontSize: 12, dataLabelPosition: 'outEnd', showLegend: false,
    });
    const cab = (t) => ({ text: t, options: { bold: true, color: COR.branco, fill: { color: COR.escuro }, fontFace: FONTE, fontSize: 12, align: 'center' } });
    const cel = (t, o) => ({ text: t, options: { fontFace: FONTE, fontSize: 12, color: COR.texto, align: 'center', ...(o || {}) } });
    s.addTable([[cab('Mês'), cab('Casos'), cab('Custo'), cab('Acumulado')]].concat(pm.map((m) => [cel(nomeMes(m.ym)), cel(String(m.n)), cel(brlCurto(m.custo)), cel(brlCurto(m.acumulado), { bold: true })])),
      { x: 8.2, y: 1.75, w: 4.5, colW: [1.0, 0.8, 1.3, 1.4], rowH: 0.36, border: { type: 'solid', color: COR.linha, pt: 0.75 }, valign: 'middle' });
    s.addNotes('Custo por mês: ' + pm.map((m) => `${m.ym}: ${m.n} casos, ${brl(m.custo)} (acumulado ${brl(m.acumulado)})`).join('; '));
  }

  function slideDivisor(pres, ctx) {
    const s = pres.addSlide(); s.background = { color: COR.escuro };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: COR.dourado }, line: { color: COR.dourado, width: 0 } });
    s.addText('Casos do período', { x: 0.9, y: 2.7, w: 11.5, h: 1.0, fontFace: FONTE, fontSize: 48, bold: true, color: COR.branco });
    s.addText(`${ctx.d.n} caso(s), do maior para o menor custo, com todos os anexos`, { x: 0.9, y: 3.8, w: 11.5, h: 0.6, fontFace: FONTE, fontSize: 20, color: 'D8DBE0' });
  }

  // Grade de anexos numa área (x,y,w,h): 1 a 4 itens. Cada célula guarda a imagem inteira (sem cortar) e abre o original no Drive ao clicar.
  function celulas(k, x, y, w, h) {
    const g = 0.2;
    if (k <= 1) return [{ x, y, w, h }];
    if (k === 2) { const cw = (w - g) / 2; return [{ x, y, w: cw, h }, { x: x + cw + g, y, w: cw, h }]; }
    const cw = (w - g) / 2, ch = (h - g) / 2;
    if (k === 3) return [{ x, y, w: cw, h }, { x: x + cw + g, y, w: cw, h: ch }, { x: x + cw + g, y: y + ch + g, w: cw, h: ch }];
    return [{ x, y, w: cw, h: ch }, { x: x + cw + g, y, w: cw, h: ch }, { x, y: y + ch + g, w: cw, h: ch }, { x: x + cw + g, y: y + ch + g, w: cw, h: ch }];
  }

  function colocarAnexos(pres, s, anexos, area, rotulo) {
    const cels = celulas(anexos.length, area.x, area.y, area.w, area.h);
    anexos.forEach((a, i) => {
      const c = cels[i];
      s.addShape(pres.ShapeType.rect, { x: c.x, y: c.y, w: c.w, h: c.h, fill: { color: COR.fundo }, line: { color: COR.linha, width: 0.75 } });
      const link = urlOriginal(a.url) ? { url: a.url, tooltip: 'Abrir o arquivo original no Drive' } : undefined;
      if (a.img) {
        const pad = 0.08, aw = c.w - 2 * pad, ah = c.h - 2 * pad; const esc = Math.min(aw / a.img.w, ah / a.img.h);
        const iw = a.img.w * esc, ih = a.img.h * esc;
        s.addImage({ data: a.img.data, x: c.x + (c.w - iw) / 2, y: c.y + (c.h - ih) / 2, w: iw, h: ih, hyperlink: link, altText: `${rotulo} · anexo ${a.n}` });
      } else {
        s.addText([{ text: `Anexo ${a.n}`, options: { bold: true, breakLine: true } }, { text: 'vídeo, áudio ou arquivo sem miniatura', options: { breakLine: true } }, { text: link ? 'clique para abrir no Drive' : 'indisponível', options: { color: COR.douradoEscuro, hyperlink: link } }],
          { x: c.x, y: c.y, w: c.w, h: c.h, fontFace: FONTE, fontSize: 14, color: COR.muted, align: 'center', valign: 'middle' });
      }
    });
  }

  function slideCaso(pres, ctx, r, idx, total, anexos, parte, partes) {
    const s = pres.addSlide({ masterName: 'CONTEUDO' });
    const rotulo = `#${r.idVenda} ${r.nomeCard || ''}`.trim();
    const kicker = `CASO ${idx} DE ${total} · ${String(r.tipoResolucao || 'Sem classificação').toUpperCase()}${partes > 1 ? ` · ANEXOS ${parte}/${partes}` : ''}`;
    s.addText(kicker, { x: 0.6, y: 0.4, w: 4.7, h: 0.4, fontFace: FONTE, fontSize: 11, bold: true, color: COR.douradoEscuro, charSpacing: 1, fit: 'shrink' });
    s.addText(corta(r.subproblema || 'Não classificado', 70), { x: 0.6, y: 0.85, w: 4.7, h: 1.15, fontFace: FONTE, fontSize: 24, bold: true, color: COR.texto, valign: 'top', fit: 'shrink' });
    s.addText(corta(`${r.nomeCard || 'Sem nome'} · #${r.idVenda}`, 80), { x: 0.6, y: 2.05, w: 4.7, h: 0.7, fontFace: FONTE, fontSize: 15, color: COR.muted, valign: 'top', fit: 'shrink' });
    const tag = (rot, val) => [{ text: rot + '  ', options: { color: COR.muted } }, { text: val || '—', options: { bold: true, color: COR.texto, breakLine: true } }];
    s.addText([].concat(tag('Responsável', r.responsavel), tag('Setor', r.setor), r.tipoProduto ? tag('Produto', r.tipoProduto) : [], r.empresa ? tag('Linha', r.empresa) : [], tag('Data', r.date ? dmY(r.date) : '')),
      { x: 0.6, y: 2.8, w: 4.7, h: 1.35, fontFace: FONTE, fontSize: 13, valign: 'top', paraSpaceAfter: 3 });
    s.addText(brl(r.custo), { x: 0.6, y: 4.25, w: 4.7, h: 0.75, fontFace: FONTE, fontSize: 32, bold: true, color: COR.texto, valign: 'middle', fit: 'shrink' });
    s.addText('de custo do erro', { x: 0.6, y: 4.95, w: 4.7, h: 0.3, fontFace: FONTE, fontSize: 12, color: COR.muted });
    const texto = r.comentarioFinal || r.descricao || '';
    if (parte === 1 && texto) s.addText(corta(texto, 360), { x: 0.6, y: 5.35, w: 4.7, h: 1.55, fontFace: FONTE, fontSize: 12, color: COR.texto, valign: 'top', fit: 'shrink' });
    if (anexos.length) colocarAnexos(pres, s, anexos, { x: 5.6, y: 0.4, w: 7.15, h: 6.5 }, rotulo);
    else s.addText('Sem anexo neste caso', { x: 5.6, y: 0.4, w: 7.15, h: 6.5, fontFace: FONTE, fontSize: 18, color: COR.muted, align: 'center', valign: 'middle' });
    s.addNotes([`Caso ${idx} de ${total}: ${rotulo}`, `Resolução: ${r.tipoResolucao || '—'} · Responsável: ${r.responsavel || '—'} · Custo: ${brl(r.custo)}`, texto, r.descricao && r.comentarioFinal ? 'Descrição original: ' + r.descricao : ''].filter(Boolean).join('\n'));
  }

  function slideFinal(pres, ctx) {
    const s = pres.addSlide(); s.background = { color: COR.escuro };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: COR.dourado }, line: { color: COR.dourado, width: 0 } });
    s.addText(`${ctx.d.n} erro(s) · ${brl(ctx.d.custoTotal)}`, { x: 0.9, y: 2.6, w: 11.5, h: 1.0, fontFace: FONTE, fontSize: 44, bold: true, color: COR.branco, fit: 'shrink' });
    s.addText(ctx.periodoLabel, { x: 0.9, y: 3.65, w: 11.5, h: 0.5, fontFace: FONTE, fontSize: 20, color: 'D8DBE0' });
    s.addText(ctx.cfg.foco.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim(), { x: 0.9, y: 4.5, w: 11.5, h: 1.0, fontFace: FONTE, fontSize: 18, color: COR.dourado, valign: 'top' });
  }

  /** Por tipo de resolução (para a diretoria ver onde o custo se concentra). */
  function porResolucao(casos) {
    const m = {};
    casos.forEach((r) => { const k = r.tipoResolucao || 'Sem classificação'; if (!m[k]) m[k] = { nome: k, n: 0, custo: 0 }; m[k].n++; m[k].custo += r.custo || 0; });
    return Object.values(m).sort((a, b) => b.custo - a.custo);
  }

  // ── Principal ──
  async function gerar({ d, cfg, periodoLabel, filtroTxt, comparacao }) {
    if (!d || !d.n) { return { ok: false, erro: 'Sem casos auditados neste período.' }; }
    const prog = abrirProgresso('Gerando a apresentação');
    try {
      prog.texto('Carregando a biblioteca de apresentação…'); await carregarPptx();
      const casos = d.casosOrdenados;
      const anexosDe = casos.map((r) => parseFotos(r.foto).map((u, i) => ({ url: u, n: i + 1 })));
      const totalAnexos = anexosDe.reduce((t, l) => t + l.length, 0);

      // 1) imagens (miniaturas) de todos os anexos, algumas por vez
      const fila = []; anexosDe.forEach((l) => l.forEach((a) => fila.push(a)));
      let feitos = 0, falhas = 0, prox = 0;
      const trabalhador = async () => {
        while (prox < fila.length && !prog.estado.cancelado) {
          const a = fila[prox++]; a.img = await buscarImagem(a.url); if (!a.img) falhas++;
          feitos++; prog.texto(`Buscando fotos e vídeos: ${feitos} de ${totalAnexos}`); prog.pct(totalAnexos ? (feitos / totalAnexos) * 80 : 80);
        }
      };
      if (totalAnexos) await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, totalAnexos) }, trabalhador));
      if (prog.estado.cancelado) { prog.fechar(); return { ok: false, cancelado: true }; }

      // 2) slides
      prog.texto('Montando os slides…'); prog.pct(85);
      let logo = null; try { logo = (await buscarLogo()); } catch (e) { /* sem logo */ }
      const pres = new window.PptxGenJS();
      pres.layout = 'LAYOUT_WIDE'; pres.title = `${cfg.nome} · ${periodoLabel}`; pres.author = 'SeuBoné Hub'; pres.company = 'SeuBoné';
      montarMestres(pres, `SeuBoné · ${cfg.nome} · ${periodoLabel}`);
      const ctx = { d, cfg, periodoLabel, filtroTxt, comparacao: comparacao || 'período anterior', logo };
      slideCapa(pres, ctx);
      slideResumo(pres, ctx);
      slideCustoMes(pres, ctx);
      slideLista(pres, ctx, 'Onde o custo se concentra: causas', 'Custo por causa do erro (número de casos entre parênteses)', d.causasTop, 'Principais causas do período.');
      slideLista(pres, ctx, cfg.respLabel || 'Por responsável', 'Quem concentra o custo no período. Use como mapa para melhorar o processo, não como julgamento isolado.', d.respTop, 'Custo por responsável.');
      slideLista(pres, ctx, 'Como os erros foram resolvidos', 'Custo por tipo de resolução (número de casos entre parênteses)', porResolucao(casos), 'Custo por tipo de resolução.');
      slideDivisor(pres, ctx);
      casos.forEach((r, i) => {
        const todos = anexosDe[i]; const partes = Math.max(1, Math.ceil(todos.length / 4));
        for (let p = 0; p < partes; p++) slideCaso(pres, ctx, r, i + 1, casos.length, todos.slice(p * 4, p * 4 + 4), p + 1, partes);
      });
      slideFinal(pres, ctx);

      prog.texto('Gerando o arquivo…'); prog.pct(92);
      const blob = await pres.write({ outputType: 'blob' });
      const nome = `${semAcento(cfg.nome)}_${semAcento(periodoLabel)}.pptx`;
      baixar(blob, nome);
      prog.pct(100); prog.fechar();
      return { ok: true, nome, slides: pres.slides.length, anexos: totalAnexos, semMiniatura: falhas };
    } catch (e) {
      prog.fechar();
      return { ok: false, erro: e.message || String(e) };
    }
  }

  async function buscarLogo() {
    const r = await fetch('/img/logo-seubone.png'); if (!r.ok) return null;
    return blobParaDataUrl(await r.blob());
  }

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return { gerar, parseFotos };
})();
