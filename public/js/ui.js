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

// Expande/colapsa um grupo de sub-páginas na sidebar (Produção SBP,
// Pedidos Urgentes, Registro de Demandas). Um grupo por vez fecha os
// outros, pra sidebar não crescer demais.
function alternarGrupoSidebar(botao) {
  const grupo = botao.closest('.sidebar-group');
  if (!grupo) return;
  const estavaAberto = grupo.classList.contains('open');
  document.querySelectorAll('.sidebar-group.open').forEach((g) => g.classList.remove('open'));
  if (!estavaAberto) grupo.classList.add('open');
}

// Popup genérico de aviso (banner "De: Jhonys Santos") — aberto a partir da
// home logo após o login. fecharPopup() também é usado pelo popup de
// sugestão do Painel SAC, por isso fica aqui em vez de só na home.
function tocarSom() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1046, 1318].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = f;
      const t = ctx.currentTime + i * .13;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(.15, t + .05);
      g.gain.linearRampToValueAtTime(0, t + .2);
      o.start(t); o.stop(t + .22);
    });
  } catch (e) {}
}
function fecharPopup(id) {
  const el = document.getElementById(id);
  el.style.opacity = '0';
  el.style.transition = 'opacity .18s';
  setTimeout(() => { el.classList.remove('open'); el.style.opacity = ''; el.style.transition = ''; }, 180);
}
function abrirAviso(av) {
  document.getElementById('av-titulo').textContent = av.titulo || '';
  document.getElementById('av-corpo').innerHTML = (av.corpo || '').replace(/\n/g, '<br>');
  document.getElementById('av-meta').textContent = `De: ${av.de || 'Jhonys Santos'} · ${av.data || ''}`;
  document.getElementById('popup-aviso').classList.add('open');
  setTimeout(tocarSom, 200);
}

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
