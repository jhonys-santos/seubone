// Peças comuns dos formulários novos que criam card direto no finfin (Pagamento, Reembolso, Análise de termo).
// Carregar antes do script de cada formulário. esc() vem do ui.js (global).
window.FinfinForm = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const soDigitos = (v) => String(v || '').replace(/\D/g, '');

  // ── CPF/CNPJ (mesma conferência do servidor) ──
  function cpfValido(v) {
    const d = soDigitos(v);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  function cnpjValido(v) {
    const d = soDigitos(v);
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const dv = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, x, i) => a + Number(d[i]) * x, 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  const docValido = (v) => cpfValido(v) || cnpjValido(v);

  // "1.234,56" / "1234,56" / "1234.56" → número (ou NaN). Com vírgula, ponto é milhar; "1.500" (grupos de 3) também.
  function numeroBr(txt) {
    const t = String(txt || '').trim().replace(/[^\d.,-]/g, '');
    if (!t) return NaN;
    const norm = t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
    return Number(norm);
  }

  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pareceUrl = (v) => { try { return /^https?:\/\//i.test(v) && !!new URL(v); } catch (e) { return false; } };
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Confere a chave pix pelo tipo; devolve a mensagem de erro ou ''. (Telefone/aleatória: quem confere é o finfin.) */
  function erroDaChavePix(tipo, chave) {
    if (tipo === 'cpf' && !cpfValido(chave)) return 'A chave pix não é um CPF válido.';
    if (tipo === 'cnpj' && !cnpjValido(chave)) return 'A chave pix não é um CNPJ válido.';
    if (tipo === 'email' && !EMAIL_OK.test(chave)) return 'A chave pix não é um e-mail válido.';
    return '';
  }

  function criarMensagens(elId, ms = 9000) {
    let t = null;
    return function mostrarMsg(texto, tipo) {
      const el = $(elId);
      el.textContent = texto;
      el.className = 'msg ' + tipo;
      el.style.display = 'block';
      clearTimeout(t);
      t = setTimeout(() => { el.className = 'msg'; el.style.display = ''; }, ms);
    };
  }

  const lerBase64 = (file, extra) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ nome: file.name, tipo: file.type, base64: reader.result.split(',')[1], ...(extra || {}) });
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo ' + file.name));
    reader.readAsDataURL(file);
  });

  /** Lista de anexos de verdade (o seletor nativo não soma seleções). "unico": só um arquivo (escolher outro substitui). Devolve { arquivos(), limpar() }. */
  function criarAnexos(inputId, listaId, { unico = false } = {}) {
    let arquivos = [];
    const render = () => {
      $(listaId).innerHTML = arquivos.map((f, i) => `<span class="anexo-chip"><span>${esc(f.name)}</span><button type="button" data-i="${i}" title="Remover">✕</button></span>`).join('');
      $(listaId).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { arquivos.splice(Number(b.dataset.i), 1); render(); }));
    };
    $(inputId).addEventListener('change', () => { const novos = Array.from($(inputId).files); arquivos = unico ? novos.slice(-1) : arquivos.concat(novos); $(inputId).value = ''; render(); });
    return { arquivos: () => arquivos, limpar: () => { arquivos = []; render(); } };
  }

  /** Mostra os anexos que o financeiro devolveu (comprovante etc.) como botões de download, iguais aos do Histórico. */
  function anexosDoFinanceiro(i, rotuloFim) {
    let a = i.anexos_retorno;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = []; } }
    a = Array.isArray(a) ? a.filter((x) => x && (x.downloadUrl || x.url)) : [];
    const quem = i.concluido_por ? ' por ' + esc(i.concluido_por) : '';
    const quando = i.concluido_em ? ' em ' + esc(i.concluido_em) : '';
    const linha = i.concluido_em ? `<br><small>${esc(rotuloFim(i))}${quem}${quando}</small>` : '';
    const coment = i.comentario_retorno ? '<br><small>' + esc(i.comentario_retorno) + '</small>' : '';
    const botoes = a.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + a.map((x, n) => '<a class="anexo-btn" href="' + esc(x.downloadUrl || x.url) + '" target="_blank" rel="noopener" title="' + esc(x.nome) + '"><i class="ti ti-download" aria-hidden="true"></i> ' + esc(x.nome || ('Anexo ' + (n + 1))) + '</a>').join('') + '</div>'
      : '';
    return linha + coment + botoes;
  }

  /**
   * Lista "meus últimos pedidos" com atualização automática. opcoes: { api, nomesColuna, colunasOk: ['pago'], titulo(i, d), rotuloFim(i), vazio, erroCarregar, aoErro(msg) }
   */
  function criarMinhas(opcoes) {
    const box = $('minhas');
    async function carregar() {
      try {
        const r = await (await fetch(opcoes.api + '/minhas', { cache: 'no-store' })).json();
        if (!r.ok) throw new Error(r.erro);
        box.innerHTML = r.itens.length ? r.itens.map((i) => {
          let d = i.dados; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } } d = d || {};
          const ok = (opcoes.colunasOk || []).includes(i.coluna);
          return `
      <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--border)">
        <span><b style="color:var(--text)">${esc(i.codigo || '—')}</b> · ${opcoes.titulo(i, d)}${i.modo === 'teste' ? ' <i>(teste)</i>' : ''}<br><small>${esc(i.criado_em)}</small>${anexosDoFinanceiro(i, opcoes.rotuloFim)}</span>
        <span><span data-status="${esc(i.codigo)}" style="${ok ? 'color:var(--ok-text,#3fb950);font-weight:700' : ''}">${esc(opcoes.nomesColuna[i.coluna] || i.coluna)}</span> <button type="button" class="btn-link" data-atualizar="${esc(i.codigo)}" style="background:none;border:0;color:var(--gold);cursor:pointer">atualizar</button></span>
      </div>`;
        }).join('') : (opcoes.vazio || 'Nenhum ainda.');
        box.querySelectorAll('[data-atualizar]').forEach((b) => b.addEventListener('click', async () => {
          b.textContent = '...';
          try {
            const s = await (await fetch(opcoes.api + '/status?codigo=' + encodeURIComponent(b.dataset.atualizar), { cache: 'no-store' })).json();
            if (!s.ok) throw new Error(s.erro);
            box.querySelector(`[data-status="${CSS.escape(b.dataset.atualizar)}"]`).textContent = (s.coluna && s.coluna.nome) || '—';
          } catch (e) { if (opcoes.aoErro) opcoes.aoErro('Não consegui consultar: ' + e.message); }
          b.textContent = 'atualizar';
        }));
      } catch (e) { box.textContent = opcoes.erroCarregar || 'Não consegui carregar a lista.'; }
    }
    carregar();
    // Atualiza sozinho a cada 15 s (só com a aba à vista); ao voltar para a aba, atualiza na hora.
    setInterval(() => { if (!document.hidden) carregar(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
    return { carregar };
  }

  /** Mensagem de erro do servidor: com mais de um erro por campo, junta todos. */
  function textoDoErro(r) {
    const lista = r.erros && typeof r.erros === 'object' ? (Array.isArray(r.erros) ? r.erros : Object.values(r.erros)) : [];
    return lista.length > 1 ? lista.join(' ') : (r.erro || 'erro ao enviar');
  }

  return { $, soDigitos, cpfValido, cnpjValido, docValido, numeroBr, brl, pareceUrl, EMAIL_OK, erroDaChavePix, criarMensagens, lerBase64, criarAnexos, criarMinhas, textoDoErro };
})();
