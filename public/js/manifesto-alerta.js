// Alerta do Manifesto do dia — aparece em QUALQUER tela do hub, com som, e fica até a pessoa clicar em "OK".
// Lê a Agenda da Semana (a mesma da Home): eventos do tipo "Escala" com "Manifesto" na descrição (ex.: "Manifesto - Nathalia").
// Abre 5 minutos antes do horário e continua em qualquer tela que a pessoa abrir, tocando, até ela confirmar (ou até 1 h depois
// do horário). A confirmação vale para o LOGIN: cada usuário confirma o seu, e o aviso não volta nesse navegador depois do OK.
// Com várias abas abertas, o som toca em uma só e o OK de uma aba fecha o aviso nas outras.
// Carregado pelo menu lateral (partials/sidebar.ejs).
(function () {
  if (window.top !== window.self) return;            // dentro de iframe não
  if (window.__manifestoAlertaCarregado) return;
  window.__manifestoAlertaCarregado = true;

  const ANTES_MIN = 5;                               // começa 5 min antes do horário do evento
  const EXPIRA_DEPOIS_MIN = 60;                      // se ninguém confirmar, para de insistir 1 h depois do horário
  const BUSCA_A_CADA_MS = 5 * 60 * 1000;             // relê a agenda
  const CONFERE_A_CADA_MS = 5 * 1000;
  const LIDER_VALE_MS = 4000;                        // a aba "líder" (a que toca o som) renova a cada 1 s
  const SOM_PRINCIPAL = '/audio/manifesto.mp3';
  const SOM_RESERVA = '/audio/alerta.mp3';           // toca se o arquivo do manifesto não existir
  const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const MENSAGENS_DO_DIA = [
    'Hoje é seu dia de Manifesto, bora agir com tudo! ✅ 🚀',
    'Chegou a sua vez de brilhar! Manifesto hoje, foco e energia! 🔥',
    'O time conta com você hoje. Manifesto, vamos juntos! 💥',
    'É hora do Manifesto! Mostra o que você vale! ⚡ 🏆',
    'Hoje você representa o time. Vai com força total! 💪 ✅',
  ];
  const MENSAGENS_DOS_OUTROS = [
    'Quem representa o time hoje é {nome}. Vamos torcer! 🙌',
    'É a vez de {nome} no Manifesto. Boa sorte! 🍀',
    'Manifesto de hoje com {nome}. Vamos juntos! 💥',
  ];

  const script = document.currentScript;
  const usuario = {
    nome: (script && script.dataset.nome) || '',
    slug: (script && script.dataset.slug) || '',
  };
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const idUsuario = semAcento(usuario.slug || usuario.nome).replace(/\s+/g, '-') || 'anonimo';
  const ID_ABA = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const CHAVE_LIDER = 'mfa-lider:' + idUsuario;

  let eventos = [];
  let parouDeBuscar = false;
  let ultimaBusca = 0;
  let atual = null;           // { chave, nome, hora, teste, somBloqueado, tocando, relogio, piscar }
  let overlay = null, audio = null, usouReserva = false;
  const tituloOriginal = document.title;

  /** Hora de Brasília (UTC-3 fixo): dia da semana, minutos desde 00:00 e data AAAA-MM-DD. */
  function agoraBrasilia() {
    const d = new Date(Date.now() - 3 * 3600000);
    return { diaSemana: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), data: d.toISOString().slice(0, 10) };
  }

  function minutosDoHorario(texto) {
    const m = /(\d{1,2})\s*[:hH]\s*(\d{2})/.exec(String(texto || ''));
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return h > 23 || mi > 59 ? null : h * 60 + mi;
  }

  const ehManifesto = (ev) => semAcento(ev.tipo) === 'escala' && /manifesto/i.test(String(ev.descricao || ''));
  const nomeDoManifesto = (ev) => String(ev.descricao || '').replace(/manifesto/i, '').replace(/^[\s\-–—:]+/, '').trim() || String(ev.descricao || '').trim();
  const primeiroNome = (s) => semAcento(s).split(/\s+/)[0] || '';

  // ── Busca da agenda ────────────────────────────────────────────────────────
  async function buscarAgenda() {
    if (parouDeBuscar) return;
    ultimaBusca = Date.now();
    try {
      const r = await fetch('/agenda-semana/api/dados', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) { parouDeBuscar = true; return; } // sem acesso à agenda (ou sessão expirada): fica quieto
      if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) return;
      const json = await r.json();
      if (json && json.ok && json.dados && Array.isArray(json.dados.eventos)) eventos = json.dados.eventos;
    } catch (e) { /* tenta de novo na próxima */ }
  }

  // ── Confirmação (por login, neste navegador) ──────────────────────────────
  const chaveConfirmacao = (ev, data) => 'mfa-ok:' + idUsuario + '|' + data + '|' + semAcento(ev.dia) + '|' + String(ev.hora || '').trim() + '|' + semAcento(ev.descricao);

  function jaConfirmou(chave) { try { return !!localStorage.getItem(chave); } catch (e) { return !!(jaConfirmou.local && jaConfirmou.local[chave]); } }
  function gravarConfirmacao(chave) {
    try { localStorage.setItem(chave, String(Date.now())); } catch (e) { (jaConfirmou.local = jaConfirmou.local || {})[chave] = true; }
  }
  function limparConfirmacoesAntigas(dataHoje) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('mfa-ok:') !== 0) continue;
        if (k.split('|')[1] !== dataHoje) localStorage.removeItem(k);
      }
      localStorage.removeItem('mfa:' + dataHoje); // formato antigo, sem uso
    } catch (e) { /* sem localStorage: tudo bem */ }
  }

  // ── Quando mostrar ─────────────────────────────────────────────────────────
  /** O evento de Manifesto que está valendo agora (5 min antes até 1 h depois) e que este login ainda não confirmou. */
  function eventoPendente() {
    const agora = agoraBrasilia();
    limparConfirmacoesAntigas(agora.data);
    for (const ev of eventos) {
      if (!ehManifesto(ev)) continue;
      if (!semAcento(ev.dia).startsWith(DIAS[agora.diaSemana])) continue;
      const alvo = minutosDoHorario(ev.hora);
      if (alvo == null) continue;
      if (agora.min < alvo - ANTES_MIN || agora.min > alvo + EXPIRA_DEPOIS_MIN) continue;
      const chave = chaveConfirmacao(ev, agora.data);
      if (jaConfirmou(chave)) continue;
      return { chave, nome: nomeDoManifesto(ev), hora: String(ev.hora).trim() };
    }
    return null;
  }

  function conferir() {
    if (atual && atual.teste) return;                 // teste manual em andamento
    const pend = eventoPendente();
    if (atual && (!pend || pend.chave !== atual.chave)) { encerrar(); }   // confirmado em outra aba, ou passou da hora
    if (!atual && pend) mostrar(pend, false);
  }

  // ── Som: só uma aba toca (a "líder"); as outras mostram o aviso em silêncio ─
  function souLider() {
    try {
      const agora = Date.now();
      const v = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null');
      if (!v || v.id === ID_ABA || agora - v.t > LIDER_VALE_MS) {
        localStorage.setItem(CHAVE_LIDER, JSON.stringify({ id: ID_ABA, t: agora }));
        const lido = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null');
        return !!lido && lido.id === ID_ABA;
      }
      return false;
    } catch (e) { return true; }
  }
  function largarLideranca() {
    try { const v = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null'); if (v && v.id === ID_ABA) localStorage.removeItem(CHAVE_LIDER); } catch (e) { /* ok */ }
  }
  window.addEventListener('pagehide', largarLideranca);

  function montar() {
    if (overlay) return;
    if (!document.querySelector('link[data-mfa]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/css/manifesto-alerta.css'; css.setAttribute('data-mfa', '1');
      document.head.appendChild(css);
    }
    overlay = document.createElement('div');
    overlay.id = 'mfa-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.setAttribute('aria-label', 'Manifesto do dia');
    overlay.innerHTML =
      '<div class="mfa-card">' +
        '<span class="mfa-icon" aria-hidden="true">📣</span>' +
        '<div class="mfa-atencao">⚡ Manifesto do Dia</div>' +
        '<div class="mfa-nome" id="mfa-nome">—</div>' +
        '<div class="mfa-msg" id="mfa-msg">—</div>' +
        '<div class="mfa-horario" id="mfa-horario">—</div>' +
        '<div class="mfa-som" id="mfa-som">🔊 Clique em qualquer lugar para ouvir o som</div>' +
        '<button type="button" class="mfa-ok" id="mfa-ok">OK</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', aoClicarNoAviso);
    el('mfa-ok').addEventListener('click', (e) => { e.stopPropagation(); confirmar(); });

    audio = new Audio(SOM_PRINCIPAL);
    audio.loop = true;
    audio.preload = 'auto';
    audio.addEventListener('error', () => {
      if (usouReserva) return;
      usouReserva = true;                       // arquivo do manifesto ausente: usa o som de alerta que já existe
      audio.src = SOM_RESERVA;
      if (atual && atual.tocando) { atual.tocando = false; tocar(); }
    });
  }

  const el = (id) => document.getElementById(id);

  function tocar() {
    if (!audio || !atual || atual.tocando) return;
    atual.tocando = true;
    try { audio.currentTime = 0; } catch (e) { /* ainda sem metadados */ }
    audio.volume = 0.8;
    const p = audio.play();
    if (p && p.catch) {
      p.catch((e) => {
        if (e && e.name === 'AbortError') return;
        // O navegador só deixa tocar som depois de um clique/tecla na página: pede um toque e toca no primeiro.
        if (atual) { atual.tocando = false; atual.somBloqueado = true; el('mfa-som').classList.add('show'); }
      });
    }
  }
  function pararSom() { if (audio) { audio.pause(); } if (atual) atual.tocando = false; }

  function aoClicarNoAviso() {
    if (!atual) return;
    if (atual.somBloqueado || !atual.tocando) {     // qualquer clique libera o som; só o botão OK fecha
      atual.somBloqueado = false;
      el('mfa-som').classList.remove('show');
      if (souLider()) tocar();
    }
  }

  function mostrar(pend, teste) {
    montar();
    if (atual) return;
    const eu = usuario.nome && primeiroNome(usuario.nome) === primeiroNome(pend.nome);
    const lista = eu ? MENSAGENS_DO_DIA : MENSAGENS_DOS_OUTROS;
    el('mfa-nome').textContent = pend.nome;
    el('mfa-msg').textContent = lista[Math.floor(Math.random() * lista.length)].replace('{nome}', pend.nome);
    el('mfa-horario').textContent = 'Manifesto às ' + pend.hora;
    el('mfa-som').classList.remove('show');
    overlay.classList.add('show');
    atual = { chave: pend.chave, nome: pend.nome, hora: pend.hora, teste: !!teste, somBloqueado: false, tocando: false, relogio: null, piscar: null };
    if (souLider()) tocar();
    // A cada segundo: renova/assume a liderança do som (se a aba que tocava fechou, outra assume) e mantém só uma tocando.
    atual.relogio = setInterval(() => {
      if (!atual) return;
      if (souLider()) { if (!atual.tocando && !atual.somBloqueado) tocar(); } else if (atual.tocando) pararSom();
    }, 1000);
    // Pisca o título da aba, para chamar atenção mesmo com a aba em segundo plano.
    let ligado = false;
    atual.piscar = setInterval(() => { ligado = !ligado; document.title = ligado ? '📣 MANIFESTO: ' + pend.nome : tituloOriginal; }, 1000);
  }

  /** Fecha o aviso nesta aba (sem registrar confirmação). */
  function encerrar() {
    if (!atual) return;
    clearInterval(atual.relogio); clearInterval(atual.piscar);
    document.title = tituloOriginal;
    pararSom();
    overlay.classList.remove('show');
    largarLideranca();
    atual = null;
  }

  /** Botão OK: registra a confirmação deste login e fecha (as outras abas fecham pelo evento "storage"). */
  function confirmar() {
    if (!atual) return;
    if (!atual.teste) gravarConfirmacao(atual.chave);
    encerrar();
  }

  // O OK em outra aba do mesmo login fecha o aviso nesta.
  window.addEventListener('storage', (e) => { if (atual && !atual.teste && e.key === atual.chave && e.newValue) encerrar(); });

  // Teste rápido (Ctrl+Alt+M, ou no console: testarManifesto('Nome')) — não grava confirmação nenhuma.
  window.testarManifesto = function (nome) { mostrar({ chave: 'teste', nome: nome || 'Nathalia', hora: '17:45' }, true); };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'm' || e.key === 'M')) window.testarManifesto(usuario.nome.split(/\s+/)[0] || 'Nathalia');
  });

  // ── Início ─────────────────────────────────────────────────────────────────
  function iniciar() {
    setTimeout(async () => { await buscarAgenda(); conferir(); }, 1500);
    setInterval(buscarAgenda, BUSCA_A_CADA_MS);
    setInterval(conferir, CONFERE_A_CADA_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (Date.now() - ultimaBusca > 60000) buscarAgenda().then(conferir); else conferir();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
