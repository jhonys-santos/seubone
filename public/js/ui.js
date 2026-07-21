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

// Utilitários pequenos usados em mais de uma tela (cofre de acessos,
// histórico de auditorias do Painel SAC).
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function copiarTexto(texto, btn) {
  navigator.clipboard.writeText(texto).then(() => {
    const i = btn.querySelector('i');
    if (i) { i.className = 'ti ti-check'; setTimeout(() => i.className = 'ti ti-copy', 1500); }
  });
}

// ── ACESSOS (cofre de senhas pessoal) ─────────────────────────
// Abre a partir da sidebar (item "Acessos", visível pra quem tem acesso
// ao Painel SAC) em qualquer página do hub — por isso mora aqui e não em
// painel-sac.js. Sempre opera sobre o slug da própria sessão.
(function () {
  const ACESSOS_API_BASE = '/painel-sac/api';
  let acessosCache = null;

  window.abrirAcessos = function abrirAcessos() {
    document.getElementById('modal-acessos').classList.add('show');
    cancelarFormAcesso();
    carregarAcessos();
  };
  window.fecharAcessos = function fecharAcessos() {
    document.getElementById('modal-acessos').classList.remove('show');
    cancelarFormAcesso();
  };

  async function carregarAcessos() {
    const lista = document.getElementById('acessos-lista');
    lista.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px">Carregando…</div>';
    try {
      const res = await fetch(`${ACESSOS_API_BASE}/acessos`);
      const json = await res.json();
      if (json.erro) throw new Error(json.erro);
      acessosCache = json.acessos || [];
      renderAcessos();
    } catch (e) {
      lista.innerHTML = `<div style="font-size:12px;color:var(--bad-text);padding:8px">Erro: ${e.message}</div>`;
    }
  }

  function renderAcessos() {
    const lista = document.getElementById('acessos-lista');
    if (!acessosCache || !acessosCache.length) {
      lista.innerHTML = '<div style="font-size:12px;color:var(--text-hint);text-align:center;padding:16px">Nenhum acesso cadastrado ainda.</div>';
      return;
    }
    lista.innerHTML = acessosCache.map((a, i) => `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.ferramenta)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><i class="ti ti-at" style="font-size:10px;margin-right:3px"></i>${esc(a.login)}</div>
          <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px">
            <i class="ti ti-lock" style="font-size:10px"></i>
            <span id="pw-val-${i}" style="letter-spacing:.08em">••••••••</span>
            <button onclick="togglePwItem(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:12px;padding:0;line-height:1" title="Revelar senha"><i class="ti ti-eye" id="pw-ico-${i}"></i></button>
            <button onclick="copiarTexto('${esc(a.senha).replace(/'/g, "\\'")}', this)" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:12px;padding:0;line-height:1" title="Copiar senha"><i class="ti ti-copy"></i></button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <button onclick="editarAcesso(${i})" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text-muted);cursor:pointer;font-family:inherit;white-space:nowrap"><i class="ti ti-pencil" style="font-size:11px"></i></button>
          <button onclick="excluirAcesso(${i})" style="background:none;border:1px solid rgba(212,75,75,0.3);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--bad-text);cursor:pointer;font-family:inherit"><i class="ti ti-trash" style="font-size:11px"></i></button>
        </div>
      </div>
    `).join('');
  }

  window.togglePwItem = function togglePwItem(i) {
    const span = document.getElementById(`pw-val-${i}`);
    const ico = document.getElementById(`pw-ico-${i}`);
    if (!span || !acessosCache[i]) return;
    const oculto = span.textContent === '••••••••';
    span.textContent = oculto ? acessosCache[i].senha : '••••••••';
    if (ico) ico.className = oculto ? 'ti ti-eye-off' : 'ti ti-eye';
  };

  window.mostrarFormAcesso = function mostrarFormAcesso(titulo) {
    document.getElementById('form-acesso').style.display = 'block';
    document.getElementById('btn-add-acesso').style.display = 'none';
    document.getElementById('form-acesso-titulo').textContent = titulo || 'Novo acesso';
    document.getElementById('acesso-erro').style.display = 'none';
    setTimeout(() => document.getElementById('acesso-ferramenta').focus(), 50);
  };

  function cancelarFormAcesso() {
    document.getElementById('form-acesso').style.display = 'none';
    document.getElementById('btn-add-acesso').style.display = 'flex';
    document.getElementById('acesso-edit-idx').value = '';
    document.getElementById('acesso-ferramenta').value = '';
    document.getElementById('acesso-login').value = '';
    document.getElementById('acesso-senha').value = '';
    document.getElementById('acesso-erro').style.display = 'none';
  }
  window.cancelarFormAcesso = cancelarFormAcesso;

  window.togglePwAcesso = function togglePwAcesso(btn) {
    const inp = document.getElementById('acesso-senha');
    const oculto = inp.type === 'password';
    inp.type = oculto ? 'text' : 'password';
    btn.querySelector('i').className = oculto ? 'ti ti-eye-off' : 'ti ti-eye';
  };

  window.editarAcesso = function editarAcesso(i) {
    const a = acessosCache[i];
    if (!a) return;
    document.getElementById('acesso-edit-idx').value = i;
    document.getElementById('acesso-ferramenta').value = a.ferramenta;
    document.getElementById('acesso-login').value = a.login;
    document.getElementById('acesso-senha').value = a.senha;
    mostrarFormAcesso('Editar acesso');
  };

  window.salvarAcesso = async function salvarAcesso() {
    const ferramenta = document.getElementById('acesso-ferramenta').value.trim();
    const login = document.getElementById('acesso-login').value.trim();
    const senha = document.getElementById('acesso-senha').value;
    const editIdx = document.getElementById('acesso-edit-idx').value;
    const erroEl = document.getElementById('acesso-erro');

    if (!ferramenta) { erroEl.textContent = 'Informe o nome da ferramenta.'; erroEl.style.display = 'block'; return; }
    if (!login) { erroEl.textContent = 'Informe o login.'; erroEl.style.display = 'block'; return; }
    if (!senha) { erroEl.textContent = 'Informe a senha.'; erroEl.style.display = 'block'; return; }
    erroEl.style.display = 'none';

    const payload = { ferramenta, login, senha, editIdx: editIdx !== '' ? parseInt(editIdx) : null };

    try {
      const res = await fetch(`${ACESSOS_API_BASE}/acessos/salvar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.erro || 'Erro ao salvar');
      acessosCache = json.acessos || [];
      cancelarFormAcesso();
      renderAcessos();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.style.display = 'block';
    }
  };

  window.excluirAcesso = async function excluirAcesso(i) {
    const confirmado = await hubConfirm(`Excluir o acesso "${acessosCache[i]?.ferramenta}"?`, { textoConfirmar: 'Excluir' });
    if (!confirmado) return;
    const payload = { editIdx: i };
    try {
      const res = await fetch(`${ACESSOS_API_BASE}/acessos/excluir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.erro || 'Erro ao excluir');
      acessosCache = json.acessos || [];
      renderAcessos();
    } catch (e) {
      await hubAlert('Erro: ' + e.message, 'erro');
    }
  };
})();

// Lembrete "Solicitar pagamento" (Corridas Avulsas) — toda sexta a partir
// das 16h, pra quem tem acesso ao painel (Wallac + gestores; a sidebar só
// renderiza o banner pra quem pode ver o painel). Dismissível por dia via
// localStorage, então volta a aparecer na sexta seguinte mesmo se fechado.
(function () {
  function chaveDismissHoje() {
    const hoje = new Date();
    return 'ca_lembrete_dismiss_' + hoje.getFullYear() + '-' + (hoje.getMonth() + 1) + '-' + hoje.getDate();
  }

  function inicializarLembreteCorridas() {
    const banner = document.getElementById('sidebarLembreteCorridas');
    if (!banner) return;
    const hoje = new Date();
    const ehSextaTarde = hoje.getDay() === 5 && hoje.getHours() >= 16;
    let dismissado = false;
    try { dismissado = localStorage.getItem(chaveDismissHoje()) === '1'; } catch (e) {}
    if (ehSextaTarde && !dismissado) banner.style.display = 'flex';
  }

  window.caFecharLembrete = function caFecharLembrete() {
    const banner = document.getElementById('sidebarLembreteCorridas');
    if (banner) banner.style.display = 'none';
    try { localStorage.setItem(chaveDismissHoje(), '1'); } catch (e) {}
  };

  document.addEventListener('DOMContentLoaded', inicializarLembreteCorridas);
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
