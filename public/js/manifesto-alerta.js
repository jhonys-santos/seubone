// Alerta do Manifesto do dia — aparece em QUALQUER tela do hub, com som.
// Lê a Agenda da Semana (a mesma da Home): eventos do tipo "Escala" com "Manifesto" na descrição (ex.: "Manifesto - Nathalia").
// O alerta abre 5 minutos antes do horário e fecha sozinho em 30 s (ou ao clicar). Só abre uma vez por evento por navegador,
// mesmo com várias abas abertas (a aba que está à vista tem prioridade). Carregado pelo menu lateral (partials/sidebar.ejs).
(function () {
  if (window.top !== window.self) return;            // dentro de iframe não
  if (window.__manifestoAlertaCarregado) return;
  window.__manifestoAlertaCarregado = true;

  const ANTES_MIN = 5;                               // começa 5 min antes do horário do evento
  const DURACAO_S = 30;                              // fecha sozinho
  const BUSCA_A_CADA_MS = 5 * 60 * 1000;             // relê a agenda
  const CONFERE_A_CADA_MS = 15 * 1000;
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
  const ID_ABA = Math.random().toString(36).slice(2) + Date.now().toString(36);

  let eventos = [];
  let parouDeBuscar = false;
  let ultimaBusca = 0;
  let aberto = null;          // { timer, tocando, somBloqueado }
  let overlay = null, audio = null, usouReserva = false;

  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

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

  // ── Quando disparar ────────────────────────────────────────────────────────
  function chaveDoEvento(ev, data) { return 'mfa:' + data + '|' + semAcento(ev.dia) + '|' + String(ev.hora || '').trim() + '|' + semAcento(ev.descricao); }

  function limparChavesAntigas(dataHoje) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf('mfa:') === 0 && k.indexOf('mfa:' + dataHoje) !== 0) localStorage.removeItem(k);
      }
    } catch (e) { /* sem localStorage: tudo bem */ }
  }

  /** Só uma aba abre o alerta de cada evento (a primeira que conseguir gravar a marca). */
  function reivindicar(chave) {
    try {
      if (localStorage.getItem(chave)) return false;
      localStorage.setItem(chave, ID_ABA + ':' + Date.now());
      return (localStorage.getItem(chave) || '').indexOf(ID_ABA) === 0;
    } catch (e) {
      if (!reivindicar.local) reivindicar.local = {};
      if (reivindicar.local[chave]) return false;
      reivindicar.local[chave] = true;
      return true;
    }
  }

  function conferir() {
    if (aberto || !eventos.length) return;
    const agora = agoraBrasilia();
    limparChavesAntigas(agora.data);
    for (const ev of eventos) {
      if (!ehManifesto(ev)) continue;
      if (!semAcento(ev.dia).startsWith(DIAS[agora.diaSemana])) continue;
      const alvo = minutosDoHorario(ev.hora);
      if (alvo == null) continue;
      if (agora.min < alvo - ANTES_MIN || agora.min >= alvo) continue;   // só na janela dos 5 min antes do horário
      const chave = chaveDoEvento(ev, agora.data);
      const abrir = () => { if (!aberto && reivindicar(chave)) mostrar(nomeDoManifesto(ev), String(ev.hora).trim()); };
      // Aba em segundo plano espera um pouco: se houver uma aba à vista, ela abre primeiro.
      if (document.hidden) setTimeout(abrir, 2500); else abrir();
      return;
    }
  }

  // ── Tela ───────────────────────────────────────────────────────────────────
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
        '<div class="mfa-som" id="mfa-som">🔊 Clique aqui para ouvir o som</div>' +
        '<div class="mfa-countdown" id="mfa-countdown">fechando em 30s</div>' +
        '<div class="mfa-bar-bg"><div class="mfa-bar-fill" id="mfa-bar" style="width:100%"></div></div>' +
        '<div class="mfa-close">clique para fechar · Esc</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', aoClicar);
    document.addEventListener('keydown', aoTeclar);

    audio = new Audio(SOM_PRINCIPAL);
    audio.loop = true;
    audio.preload = 'auto';
    audio.addEventListener('error', () => {
      if (usouReserva) return;
      usouReserva = true;                       // arquivo do manifesto ausente: usa o som de alerta que já existe
      audio.src = SOM_RESERVA;
      if (aberto) tocar();
    });
  }

  const el = (id) => document.getElementById(id);

  function tocar() {
    if (!audio) return;
    try { audio.currentTime = 0; } catch (e) { /* ainda sem metadados */ }
    audio.volume = 0.8;
    const p = audio.play();
    if (p && p.catch) {
      p.catch((e) => {
        // O navegador só deixa tocar som depois de um clique/tecla na página: pede um toque e toca no primeiro.
        if (e && e.name === 'AbortError') return;
        if (aberto) { aberto.somBloqueado = true; el('mfa-som').classList.add('show'); }
      });
    }
  }

  function pararSom() { if (audio) { audio.pause(); try { audio.currentTime = 0; } catch (e) { /* ok */ } } }

  function fechar() {
    if (!aberto) return;
    clearInterval(aberto.timer);
    aberto = null;
    overlay.classList.remove('show');
    pararSom();
  }

  function aoClicar() {
    if (aberto && aberto.somBloqueado) {            // primeiro clique libera o som; o segundo fecha
      aberto.somBloqueado = false;
      el('mfa-som').classList.remove('show');
      tocar();
      return;
    }
    fechar();
  }

  function aoTeclar(e) {
    if (!aberto) return;
    if (e.key === 'Escape') { fechar(); return; }
    if (aberto.somBloqueado && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) { aberto.somBloqueado = false; el('mfa-som').classList.remove('show'); tocar(); }
  }

  function mostrar(nome, horario) {
    montar();
    if (aberto) return;
    const eu = usuario.nome && primeiroNome(usuario.nome) === primeiroNome(nome);
    const lista = eu ? MENSAGENS_DO_DIA : MENSAGENS_DOS_OUTROS;
    el('mfa-nome').textContent = nome;
    el('mfa-msg').textContent = lista[Math.floor(Math.random() * lista.length)].replace('{nome}', nome);
    el('mfa-horario').textContent = 'Manifesto às ' + horario;
    el('mfa-bar').style.width = '100%';
    el('mfa-som').classList.remove('show');
    overlay.classList.add('show');
    aberto = { timer: null, somBloqueado: false };
    tocar();
    let restante = DURACAO_S;
    el('mfa-countdown').textContent = 'fechando em ' + restante + 's';
    aberto.timer = setInterval(() => {
      restante--;
      el('mfa-countdown').textContent = 'fechando em ' + restante + 's';
      el('mfa-bar').style.width = ((restante / DURACAO_S) * 100) + '%';
      if (restante <= 0) fechar();
    }, 1000);
  }

  // Teste rápido (Ctrl+Alt+M, ou no console: testarManifesto('Nome')) — não grava marca nenhuma.
  window.testarManifesto = function (nome) { mostrar(nome || 'Nathalia', '17:45'); };
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
