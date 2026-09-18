(function () {
  function mfEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function hojeISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtDataBR(iso) {
    if (!iso) return '—';
    const [ano, mes, dia] = String(iso).split('-');
    return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
  }

  function fmtMoeda(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtPeso(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
  }

  // Só o número, sem "R$"/"kg" — pra copiar e colar direto numa planilha
  // (vírgula decimal, ponto de milhar: formato que o Excel em pt-BR já
  // reconhece como número, sem precisar reformatar depois de colar).
  function fmtNumero(v) {
    const n = Number(v) || 0;
    return mfEsc(n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }

  function toast(msg, ok) {
    const el = document.createElement('div');
    el.className = 'mf-toast' + (ok ? ' ok' : ' bad');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4000);
  }

  const inpDe = document.getElementById('mfDe');
  const inpAte = document.getElementById('mfAte');
  const btnBuscar = document.getElementById('mfBtnBuscar');
  const conteudo = document.getElementById('mfConteudo');

  inpDe.value = hojeISO();
  inpAte.value = hojeISO();

  function renderVazio() {
    conteudo.innerHTML = `<div class="mf-vazio">Escolha o período e clique em <b>Buscar Notas</b>.</div>`;
  }

  function renderCarregando() {
    conteudo.innerHTML = `<div class="mf-vazio"><div class="mf-spinner"></div>Buscando notas…</div>`;
  }

  function renderErro(msg) {
    conteudo.innerHTML = `
      <div class="mf-erro">
        <div class="e-title">Não consegui buscar as notas</div>
        <div class="e-sub">${mfEsc(msg)}</div>
        <button class="mf-btn mf-btn-ghost" id="mfBtnRetry">Tentar de novo</button>
      </div>`;
    document.getElementById('mfBtnRetry').addEventListener('click', buscarNotas);
  }

  // Uma nota pode ter mais de um CFOP junto (ex: "2.102, 2.353") — cada um
  // vira uma chave própria pro filtro. Nota sem CFOP nenhum ganha uma
  // categoria própria "(sem CFOP)", senão ela nunca bateria com nada, nem
  // com "selecionar todos".
  function cfopsDe(nota) {
    const partes = String(nota.cfop || '').split(',').map((s) => s.trim()).filter(Boolean);
    return partes.length ? partes : ['(sem CFOP)'];
  }

  // CFOPs marcados de cara em toda busca nova — o resto do que aparecer
  // (devolução, remessa etc.) fica desmarcado, mas disponível pra marcar
  // na mão quando precisar.
  const CFOPS_PADRAO = ['6.102', '6.108', '5.102', '6.110', '6.117', '6.119', '5.117', '7.102'];

  let NOTAS_BUSCADAS = [];
  let CFOPS_SELECIONADOS = new Set();

  function renderResultado(json) {
    NOTAS_BUSCADAS = json.notas || [];

    if (!NOTAS_BUSCADAS.length) {
      conteudo.innerHTML = `<div class="mf-vazio">Nenhuma nota encontrada nesse período.</div>`;
      return;
    }

    const todosCfops = Array.from(new Set(NOTAS_BUSCADAS.flatMap(cfopsDe))).sort();
    CFOPS_SELECIONADOS = new Set(todosCfops.filter((c) => CFOPS_PADRAO.includes(c)));

    conteudo.innerHTML = `
      <div class="mf-card-filtro">
        <div class="mf-filtro-head">
          <span class="mf-filtro-titulo">Filtrar por CFOP</span>
          <div class="mf-filtro-acoes">
            <button type="button" class="mf-link-btn" id="mfCfopTodos">Selecionar todos</button>
            <button type="button" class="mf-link-btn" id="mfCfopNenhum">Limpar</button>
          </div>
        </div>
        <div class="mf-cfop-lista" id="mfCfopLista">
          ${todosCfops.map((c) => `
            <label class="mf-cfop-chip">
              <input type="checkbox" value="${mfEsc(c)}" ${CFOPS_SELECIONADOS.has(c) ? 'checked' : ''}>
              <span>${mfEsc(c)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div id="mfResultado"></div>`;

    const listaCfop = document.getElementById('mfCfopLista');
    listaCfop.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) CFOPS_SELECIONADOS.add(cb.value);
        else CFOPS_SELECIONADOS.delete(cb.value);
        renderTabela();
      });
    });
    document.getElementById('mfCfopTodos').addEventListener('click', () => {
      CFOPS_SELECIONADOS = new Set(todosCfops);
      listaCfop.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = true; });
      renderTabela();
    });
    document.getElementById('mfCfopNenhum').addEventListener('click', () => {
      CFOPS_SELECIONADOS = new Set();
      listaCfop.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
      renderTabela();
    });

    renderTabela();
  }

  function renderTabela() {
    const alvo = document.getElementById('mfResultado');
    if (!alvo) return;
    const notas = NOTAS_BUSCADAS.filter((n) => cfopsDe(n).some((c) => CFOPS_SELECIONADOS.has(c)));

    if (!notas.length) {
      alvo.innerHTML = `<div class="mf-vazio">Nenhuma nota com o CFOP selecionado.</div>`;
      return;
    }

    const totalValor = notas.reduce((s, n) => s + (Number(n.valorTotal) || 0), 0);
    const totalPeso = notas.reduce((s, n) => s + (Number(n.pesoLiquido) || 0), 0);
    const totalQtd = notas.reduce((s, n) => s + (Number(n.quantidade) || 0), 0);
    const temPesoIncompleto = notas.some((n) => n.pesoCompleto === false);

    alvo.innerHTML = `
      <div class="mf-kpis">
        <div class="mf-kpi"><div class="k-l">Notas encontradas</div><div class="k-v">${notas.length}</div></div>
        <div class="mf-kpi"><div class="k-l">Peso total</div><div class="k-v mf-copiar" title="Clique para copiar" data-copiar="${fmtNumero(totalPeso)}">${fmtPeso(totalPeso)}</div>${temPesoIncompleto ? '<div class="k-foot">⚠ algum peso ainda não confirmado</div>' : ''}</div>
        <div class="mf-kpi accent"><div class="k-l">Valor total</div><div class="k-v mf-copiar" title="Clique para copiar" data-copiar="${fmtNumero(totalValor)}">${fmtMoeda(totalValor)}</div></div>
        <div class="mf-kpi"><div class="k-l">Itens (quantidade)</div><div class="k-v">${totalQtd}</div></div>
      </div>
      <div class="mf-table-wrap">
        <table class="mf-table">
          <thead><tr>
            <th>Número</th><th>Chave NFe</th><th>CFOP</th><th>Emissão</th>
            <th class="num">Qtd</th><th class="num">Peso</th><th class="num">Valor</th>
          </tr></thead>
          <tbody>
            ${notas.map((n) => `
              <tr>
                <td class="mf-copiar" title="Clique para copiar" data-copiar="${mfEsc(n.numero)}">${mfEsc(n.numero)}</td>
                <td class="mf-copiar mf-chave-cel" title="Clique para copiar" data-copiar="${mfEsc(n.chaveNfe)}">${mfEsc(n.chaveNfe)}</td>
                <td>${mfEsc(n.cfop) || '—'}</td>
                <td>${fmtDataBR(n.dataEmissao)}</td>
                <td class="num">${mfEsc(n.quantidade)}</td>
                <td class="num mf-copiar" title="Clique para copiar" data-copiar="${fmtNumero(n.pesoLiquido)}">${fmtPeso(n.pesoLiquido)}${n.pesoCompleto === false ? ' <span class="mf-peso-parcial" title="Peso ainda não confirmado">⚠</span>' : ''}</td>
                <td class="num mf-copiar" title="Clique para copiar" data-copiar="${fmtNumero(n.valorTotal)}">${fmtMoeda(n.valorTotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    alvo.querySelectorAll('.mf-copiar').forEach((td) => {
      td.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(td.dataset.copiar);
          toast('Copiado', true);
        } catch (e) {
          toast('Não consegui copiar automaticamente', false);
        }
      });
    });
  }

  async function buscarNotas() {
    const de = inpDe.value;
    const ate = inpAte.value;
    if (de && ate && de > ate) {
      toast('A data "De" não pode ser depois da data "Até"', false);
      return;
    }
    btnBuscar.disabled = true;
    renderCarregando();
    try {
      const params = new URLSearchParams();
      if (de) params.set('de', de);
      if (ate) params.set('ate', ate);
      const resp = await fetch(`/manifesto/api/notas?${params.toString()}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
      renderResultado(json);
    } catch (err) {
      renderErro(err.message);
    } finally {
      btnBuscar.disabled = false;
    }
  }

  btnBuscar.addEventListener('click', buscarNotas);
  renderVazio();
})();
