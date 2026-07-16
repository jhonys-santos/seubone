// Alternador de tema claro/escuro — global, carregado em toda página.
// A classe fica em <html> (não <body>) e roda aqui no <head>, antes do
// <body> existir, pra aplicar o tema salvo sem dar flash da cor errada.
// Mesma classe/localStorage que o Painel SAC já usava no seu próprio botão
// (agora unificado): document.documentElement.classList + 'sb_tema'.
(function () {
  const CHAVE_TEMA = 'sb_tema';

  function estaClaro() {
    return document.documentElement.classList.contains('light');
  }

  function atualizarBotoes() {
    const claro = estaClaro();
    document.querySelectorAll('[data-tema-icon]').forEach((el) => {
      el.className = 'ti ' + (claro ? 'ti-moon' : 'ti-sun');
    });
    document.querySelectorAll('[data-tema-label]').forEach((el) => {
      el.textContent = claro ? 'Escuro' : 'Claro';
    });
  }

  function aplicarTemaSalvo() {
    try {
      if (localStorage.getItem(CHAVE_TEMA) === 'light') {
        document.documentElement.classList.add('light');
      }
    } catch (e) {}
  }

  function alternarTema() {
    const claro = document.documentElement.classList.toggle('light');
    try { localStorage.setItem(CHAVE_TEMA, claro ? 'light' : 'dark'); } catch (e) {}
    atualizarBotoes();
  }

  aplicarTemaSalvo();
  window.alternarTema = alternarTema;
  // Os botões só existem depois que o <body> é parseado — atualiza os
  // ícones/labels assim que o DOM estiver pronto.
  document.addEventListener('DOMContentLoaded', atualizarBotoes);
})();

// Substitui os alert()/confirm() nativos do navegador (que bloqueiam a
// página inteira e destoam do resto do visual) por um diálogo no mesmo
// padrão do hub. Carregado em toda página via partials/head.
(function () {
  let overlay, caixa;

  function garantirDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'hub-dialog-overlay';
    caixa = document.createElement('div');
    caixa.className = 'hub-dialog-box';
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);
  }

  const ICONES = { erro: 'ti-alert-circle', sucesso: 'ti-circle-check', info: 'ti-info-circle' };

  function hubAlert(mensagem, tipo) {
    tipo = tipo || 'info';
    garantirDom();
    return new Promise((resolve) => {
      caixa.innerHTML =
        '<div class="hub-dialog-icon ' + tipo + '"><i class="ti ' + (ICONES[tipo] || ICONES.info) + '" aria-hidden="true"></i></div>' +
        '<div class="hub-dialog-msg"></div>' +
        '<div class="hub-dialog-actions"><button class="hub-dialog-btn-primary">OK</button></div>';
      caixa.querySelector('.hub-dialog-msg').textContent = mensagem;
      const fechar = () => { overlay.classList.remove('aberto'); resolve(); };
      caixa.querySelector('.hub-dialog-btn-primary').onclick = fechar;
      overlay.onclick = (e) => { if (e.target === overlay) fechar(); };
      overlay.classList.add('aberto');
    });
  }

  function hubConfirm(mensagem, opts) {
    opts = opts || {};
    garantirDom();
    return new Promise((resolve) => {
      caixa.innerHTML =
        '<div class="hub-dialog-msg"></div>' +
        '<div class="hub-dialog-actions">' +
        '<button class="hub-dialog-btn-secondary" data-v="0">' + (opts.textoCancelar || 'Cancelar') + '</button>' +
        '<button class="hub-dialog-btn-primary" data-v="1">' + (opts.textoConfirmar || 'Confirmar') + '</button>' +
        '</div>';
      caixa.querySelector('.hub-dialog-msg').textContent = mensagem;
      const fechar = (valor) => { overlay.classList.remove('aberto'); resolve(valor); };
      caixa.querySelectorAll('button').forEach((btn) => {
        btn.onclick = () => fechar(btn.dataset.v === '1');
      });
      overlay.onclick = (e) => { if (e.target === overlay) fechar(false); };
      overlay.classList.add('aberto');
    });
  }

  function hubPrompt(mensagem, opts) {
    opts = opts || {};
    garantirDom();
    return new Promise((resolve) => {
      caixa.innerHTML =
        '<div class="hub-dialog-msg"></div>' +
        '<input type="text" class="hub-dialog-input" id="hub-dialog-input-valor">' +
        '<div class="hub-dialog-actions">' +
        '<button class="hub-dialog-btn-secondary" data-v="cancelar">Cancelar</button>' +
        '<button class="hub-dialog-btn-primary" data-v="ok">' + (opts.textoConfirmar || 'Confirmar') + '</button>' +
        '</div>';
      caixa.querySelector('.hub-dialog-msg').textContent = mensagem;
      const input = caixa.querySelector('#hub-dialog-input-valor');
      input.placeholder = opts.placeholder || '';
      input.value = opts.valorInicial || '';
      const fechar = (valor) => { overlay.classList.remove('aberto'); resolve(valor); };
      caixa.querySelector('.hub-dialog-btn-secondary').onclick = () => fechar(null);
      caixa.querySelector('.hub-dialog-btn-primary').onclick = () => fechar(input.value.trim() || null);
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fechar(input.value.trim() || null); } };
      overlay.onclick = (e) => { if (e.target === overlay) fechar(null); };
      overlay.classList.add('aberto');
      setTimeout(() => input.focus(), 50);
    });
  }

  window.hubAlert = hubAlert;
  window.hubConfirm = hubConfirm;
  window.hubPrompt = hubPrompt;
})();
