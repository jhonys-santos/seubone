// Cotações · Azul — porta a lógica de public/js (vanilla) de
// azul-cotacao-nextjs/src/app/cotacoes/page.tsx. Só conversa com
// /cotacoes/api/azul/cotar (servidor); nenhum dado da Azul/token passa por
// aqui.
(function () {
  'use strict';

  const form = document.getElementById('ctForm');
  if (!form) return; // não é a tela da Azul (ex: Correios, sem formulário)

  const $ = (id) => document.getElementById(id);
  const btn = $('ctBtnCotar');
  const erroEl = $('ctErro');
  const resultadoEl = $('ctResultado');

  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const kg = (n) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
  const mascaraCep = (v) => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  const rotuloTaxa = (t) => t.charAt(0) + t.slice(1).toLowerCase();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  $('ctCepOrigem').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('ctCepDestino').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('ctQuantidade').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

  const CAMPO_POR_TIPO_ENTREGA = ['ctTipoDomicilio', 'ctTipoAeroporto'];
  CAMPO_POR_TIPO_ENTREGA.forEach((id) => {
    $(id).addEventListener('change', atualizarOpcaoAtiva);
  });
  function atualizarOpcaoAtiva() {
    $('ctOpcaoDomicilio').classList.toggle('ct-opcao-ativa', $('ctTipoDomicilio').checked);
    $('ctOpcaoAeroporto').classList.toggle('ct-opcao-ativa', $('ctTipoAeroporto').checked);
  }
  atualizarOpcaoAtiva();

  // Mapa campo do form <-> id do erro devolvido pela API (ex: "volumes.0.alturaCm").
  const CAMPO_ID = {
    cepOrigem: 'ctCampoCepOrigem', cepDestino: 'ctCampoCepDestino',
    valorMercadoria: 'ctCampoValor',
    quantidade: 'ctCampoQuantidade', pesoUnitarioKg: 'ctCampoPeso',
    alturaCm: 'ctCampoAltura', larguraCm: 'ctCampoLargura', comprimentoCm: 'ctCampoComprimento',
  };
  function limparErrosCampo() {
    Object.values(CAMPO_ID).forEach((id) => $(id).classList.remove('ct-campo-erro'));
  }
  function marcarErroCampo(campo) {
    if (!campo) return;
    const nome = campo.startsWith('volumes.') ? campo.split('.')[2] : campo;
    const id = CAMPO_ID[nome];
    if (id) $(id).classList.add('ct-campo-erro');
  }

  function renderVazio(texto) {
    resultadoEl.innerHTML = `<div class="ct-vazio"><p>${esc(texto)}</p></div>`;
  }

  function renderResultado(r) {
    const servicos = r.servicos.map((sv) => `
      <article class="ct-servico">
        <div class="ct-servico-topo">
          <span class="ct-servico-nome">${esc(sv.servico.replace(/_/g, ' '))}</span>
          <span class="ct-prazo">${sv.prazoDias} ${sv.prazoDias === 1 ? 'dia' : 'dias'}</span>
        </div>
        <p class="ct-total">${brl(sv.total)}</p>
        <table class="ct-composicao">
          <tbody>
            <tr><td>Frete</td><td>${brl(sv.frete)}</td></tr>
            ${sv.taxas.map((t) => `<tr><td>${esc(rotuloTaxa(t.tipo))}</td><td>${brl(t.valor)}</td></tr>`).join('')}
          </tbody>
        </table>
      </article>
    `).join('');

    const pesos = `
      <dl class="ct-pesos">
        <div><dt>Volumes</dt><dd>${r.totalVolumes}</dd></div>
        <div><dt>Peso real</dt><dd>${kg(r.pesoRealKg)}</dd></div>
        <div><dt>Peso cubado</dt><dd>${kg(r.pesoCubadoKg)}</dd></div>
        <div><dt>Peso cobrado</dt><dd><strong>${kg(r.pesoTaxadoKg)}</strong></dd></div>
      </dl>`;

    const avisos = (r.avisos || []).map((a) => `<p class="ct-aviso">${esc(a)}</p>`).join('');
    const rodape = `<p class="ct-rodape">Cotado em ${esc(new Date(r.cotadoEm).toLocaleString('pt-BR'))}. Valores sujeitos à conferência da carga pela Azul.</p>`;

    resultadoEl.innerHTML = servicos + pesos + avisos + rodape;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErrosCampo();
    erroEl.style.display = 'none';
    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = 'Cotando…';
    renderVazio('Consultando a Azul…');

    const corpo = {
      cepOrigem: $('ctCepOrigem').value,
      cepDestino: $('ctCepDestino').value,
      valorMercadoria: $('ctValorMercadoria').value,
      tipoEntrega: $('ctTipoAeroporto').checked ? 'AEROPORTO' : 'DOMICILIO',
      coleta: $('ctColeta').checked,
      volumes: [{
        quantidade: $('ctQuantidade').value,
        alturaCm: $('ctAlturaCm').value,
        larguraCm: $('ctLarguraCm').value,
        comprimentoCm: $('ctComprimentoCm').value,
        pesoUnitarioKg: $('ctPesoUnitarioKg').value,
      }],
    };

    try {
      const res = await fetch('/cotacoes/api/azul/cotar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const json = await res.json();
      if (!res.ok) {
        erroEl.textContent = json.erro || 'Não foi possível cotar';
        erroEl.style.display = '';
        marcarErroCampo(json.campo);
        renderVazio('Preencha a rota, os volumes e o valor da mercadoria para ver preço e prazo.');
      } else {
        renderResultado(json);
      }
    } catch (err) {
      erroEl.textContent = 'Sem conexão com o servidor. Tente novamente.';
      erroEl.style.display = '';
      renderVazio('Preencha a rota, os volumes e o valor da mercadoria para ver preço e prazo.');
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
})();

// Cotações · Correios — porta a lógica de correios-cotacao-nextjs/src/app/
// cotacoes/page.tsx. Só conversa com /cotacoes/api/correios/cotar
// (servidor); nenhuma credencial dos Correios passa por aqui. IIFE
// separada da Azul acima: telas diferentes, nunca as duas no ar juntas.
(function () {
  'use strict';

  const form = document.getElementById('ctFormCorreios');
  if (!form) return; // não é a tela dos Correios

  const $ = (id) => document.getElementById(id);
  const btn = $('ccBtnCotar');
  const erroEl = $('ccErro');
  const resultadoEl = $('ccResultado');

  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const kg = (n) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;
  const mascaraCep = (v) => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataCurta = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

  $('ccCepOrigem').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('ccCepDestino').addEventListener('input', (e) => { e.target.value = mascaraCep(e.target.value); });
  $('ccQuantidade').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

  const campoValor = $('ccCampoValor');
  $('ccDeclararValor').addEventListener('change', (e) => {
    campoValor.style.display = e.target.checked ? '' : 'none';
  });

  // Mapa campo do form <-> id do erro devolvido pela API (ex: "volumes.0.alturaCm").
  const CAMPO_ID = {
    cepOrigem: 'ccCampoCepOrigem', cepDestino: 'ccCampoCepDestino',
    valorMercadoria: 'ccCampoValor',
    quantidade: 'ccCampoQuantidade', pesoUnitarioKg: 'ccCampoPeso',
    alturaCm: 'ccCampoAltura', larguraCm: 'ccCampoLargura', comprimentoCm: 'ccCampoComprimento',
  };
  function limparErrosCampo() {
    Object.values(CAMPO_ID).forEach((id) => $(id).classList.remove('ct-campo-erro'));
  }
  function marcarErroCampo(campo) {
    if (!campo) return;
    const nome = campo.startsWith('volumes.') ? campo.split('.')[2] : campo;
    const id = CAMPO_ID[nome];
    if (id) $(id).classList.add('ct-campo-erro');
  }

  function renderVazio(texto) {
    resultadoEl.innerHTML = `<div class="ct-vazio"><p>${esc(texto)}</p></div>`;
  }

  function renderResultado(r) {
    const servicos = `<div class="ct-servicos">${r.servicos.map((sv) => `
      <article class="ct-servico" ${sv.erro ? 'data-indisponivel="true"' : ''}>
        <div class="ct-servico-topo">
          <span class="ct-servico-nome">${esc(sv.servico)} <small>${esc(sv.codigo)}</small></span>
          ${sv.prazoDias != null ? `<span class="ct-prazo">${sv.prazoDias} ${sv.prazoDias === 1 ? 'dia útil' : 'dias úteis'}</span>` : ''}
        </div>
        ${sv.erro ? `<p class="ct-indisponivel">${esc(sv.erro)}</p>` : `
          <p class="ct-total">${brl(sv.total)}</p>
          <div class="ct-selos">
            ${sv.maisBarato ? '<span class="ct-selo">Mais barato</span>' : ''}
            ${sv.maisRapido ? '<span class="ct-selo">Mais rápido</span>' : ''}
          </div>
          <table class="ct-composicao">
            <tbody>
              ${sv.volumes.map((v) => `<tr><td>${v.quantidade} × volume${v.cubico ? ' (peso cúbico)' : ''}</td><td>${v.quantidade > 1 ? brl(v.valorUnitario) + ' cada' : brl(v.valorUnitario)}</td></tr>`).join('')}
              ${sv.valorDeclarado > 0 ? `<tr><td>Inclui valor declarado</td><td>${brl(sv.valorDeclarado)}</td></tr>` : ''}
              ${sv.entregaAte ? `<tr><td>Entrega até</td><td>${esc(dataCurta(sv.entregaAte))}</td></tr>` : ''}
            </tbody>
          </table>
        `}
      </article>
    `).join('')}</div>`;

    const pesoCobrado = r.servicos.find((sv) => sv.volumes && sv.volumes.length);
    const pesos = `
      <dl class="ct-pesos">
        <div><dt>Volumes</dt><dd>${r.totalVolumes}</dd></div>
        <div><dt>Peso real</dt><dd>${kg(r.pesoRealKg)}</dd></div>
        <div><dt>Cobrado por volume</dt><dd><strong>${pesoCobrado ? kg(pesoCobrado.volumes[0].pesoCobradoKg) : '—'}</strong></dd></div>
      </dl>`;

    const avisos = (r.avisos || []).map((a) => `<p class="ct-aviso">${esc(a)}</p>`).join('');
    const rodape = `<p class="ct-rodape">Cotado em ${esc(new Date(r.cotadoEm).toLocaleString('pt-BR'))}. Prazo em dias úteis a partir da postagem. Valores sujeitos à conferência na agência.</p>`;

    resultadoEl.innerHTML = servicos + pesos + avisos + rodape;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limparErrosCampo();
    erroEl.style.display = 'none';
    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = 'Cotando…';
    renderVazio('Consultando os Correios…');

    const corpo = {
      cepOrigem: $('ccCepOrigem').value,
      cepDestino: $('ccCepDestino').value,
      valorMercadoria: $('ccValorMercadoria').value,
      declararValor: $('ccDeclararValor').checked,
      volumes: [{
        quantidade: $('ccQuantidade').value,
        alturaCm: $('ccAlturaCm').value,
        larguraCm: $('ccLarguraCm').value,
        comprimentoCm: $('ccComprimentoCm').value,
        pesoUnitarioKg: $('ccPesoUnitarioKg').value,
      }],
    };

    try {
      const res = await fetch('/cotacoes/api/correios/cotar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const json = await res.json();
      if (!res.ok) {
        erroEl.textContent = json.erro || 'Não foi possível cotar';
        erroEl.style.display = '';
        marcarErroCampo(json.campo);
        renderVazio('Preencha a rota e os volumes para ver preço e prazo de SEDEX e PAC.');
      } else {
        renderResultado(json);
      }
    } catch (err) {
      erroEl.textContent = 'Sem conexão com o servidor. Tente novamente.';
      erroEl.style.display = '';
      renderVazio('Preencha a rota e os volumes para ver preço e prazo de SEDEX e PAC.');
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
})();
