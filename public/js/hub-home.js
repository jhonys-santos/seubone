// Home (visão executiva) — reúne o que antes ficava espalhado:
// KPIs/Agenda/Foco vinham do Ranking SAC (planilha "TV"), Escala/Trocas/
// Sugestão vinham do Painel SAC. Aqui os dois mundos convivem na mesma
// página; cada bloco só roda se o elemento correspondente existir (o EJS
// só desenha o bloco pra quem tem acesso ao painel de origem).

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const hoje = new Date();
const diaHoje = hoje.getDate(), mesHoje = hoje.getMonth(), anoHoje = hoje.getFullYear();

// ── RELÓGIO ──────────────────────────────────────────────────
(function () {
  const el = document.getElementById('hh-clock');
  if (!el) return;
  const tick = () => { el.textContent = new Date().toLocaleTimeString('pt-BR'); };
  tick();
  setInterval(tick, 1000);
})();

// ── UTILS DE CSV (mesmo parsing usado no Ranking SAC) ─────────
function cleanStr(v) { if (v == null) return ''; return String(v).replace(/^"|"$/g, '').trim(); }
function safeNum(v) { if (v == null || v === '' || v === '-' || v === '—') return null; const n = parseFloat(String(v).replace(/"/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
function parseCSV(text) {
  return text.split('\n').map((line) => {
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur.trim());
    return cols;
  });
}

// ── AGENDA/FOCO (Apps Script, editável por gestor) ────────────
// KPIs da equipe saíram desse bloco — moraram pro Dashboard Executivo,
// hoje fundido aqui na Home (ver IIFE "DASHBOARD EXECUTIVO" mais abaixo).
(function () {
  const agendaGrid = document.getElementById('hh-agenda-grid');
  if (!agendaGrid) return; // sem acesso a ranking-sac, nada a fazer aqui

  const usuarioLogado = window.USUARIO_SESSAO;
  const AGENDA_API = '/agenda-semana/api';
  let agendaCache = []; // últimos eventos carregados (com "linha") — usado pra editar/excluir
  let eventoEditandoLinha = null; // null = modal em modo "novo evento"

  function renderAgenda(eventos) {
    const diasOrdem = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const hojeMap = { 'segunda-feira': 'Segunda', 'terça-feira': 'Terça', 'quarta-feira': 'Quarta', 'quinta-feira': 'Quinta', 'sexta-feira': 'Sexta' };
    const diaHojeNome = hojeMap[new Date().toLocaleDateString('pt-BR', { weekday: 'long' }).toLowerCase()] || '';
    const porDia = {}; diasOrdem.forEach((d) => { porDia[d] = []; });
    eventos.forEach((ev) => { if (porDia[ev.dia]) porDia[ev.dia].push(ev); });
    diasOrdem.forEach((d) => { porDia[d].sort((a, b) => a.hora.localeCompare(b.hora)); });
    const tipoClass = { '1:1': 'tipo-11', 'Reunião': 'tipo-reuniao', 'Evento': 'tipo-evento', 'Escala': 'tipo-escala', 'Outro': 'tipo-outro' };
    const gestor = usuarioLogado.role === 'gestor';
    document.getElementById('hh-agenda-grid').innerHTML = diasOrdem.map((dia) => {
      const isHoje = dia === diaHojeNome;
      let h = `<div class="hh-agenda-col"><div class="hh-agenda-col-head${isHoje ? ' hoje' : ''}">${dia}${isHoje ? ' <span style="color:var(--gold);font-size:8px">HOJE</span>' : ''}</div>`;
      const evs = porDia[dia];
      if (!evs.length) { h += `<div class="hh-agenda-vazio">livre</div>`; }
      else {
        evs.forEach((ev) => {
          const tc = tipoClass[ev.tipo] || 'tipo-outro';
          const acoes = gestor ? `<div class="hh-evento-acoes">
            <button class="hh-evento-acao" onclick="abrirEditorEvento(${ev.linha})" title="Editar"><i class="ti ti-pencil" aria-hidden="true"></i></button>
            <button class="hh-evento-acao" onclick="excluirEvento(${ev.linha})" title="Excluir"><i class="ti ti-trash" aria-hidden="true"></i></button>
          </div>` : '';
          h += `<div class="hh-evento ${tc}">${acoes}<div class="hh-evento-hora">${ev.hora}</div><div class="hh-evento-desc">${ev.descricao}</div></div>`;
        });
      }
      h += '</div>';
      return h;
    }).join('');
  }

  let focoAtual = '';
  function renderFoco(texto) {
    focoAtual = texto || '';
    const el = document.getElementById('hh-foco-texto');
    if (texto && texto.trim()) { el.textContent = texto.trim(); el.classList.remove('placeholder'); }
    else { el.textContent = 'Sem foco definido para esta semana.'; el.classList.add('placeholder'); }
  }

  async function carregarFocoAgenda() {
    const resp = await fetch(`${AGENDA_API}/dados`, { cache: 'no-store' });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro ao buscar agenda');
    agendaCache = (json.dados && json.dados.eventos) || [];
    renderAgenda(agendaCache);
    renderFoco(json.dados && json.dados.foco);
  }

  // O Apps Script por trás disso às vezes devolve uma página de erro do
  // próprio Google (não do nosso backend) sob rajada de chamadas — some
  // sozinho numa segunda tentativa. Tenta mais 2x com espera curta antes
  // de desistir e mostrar o estado de erro pro usuário.
  async function carregarEquipe(tentativa = 1) {
    try {
      await carregarFocoAgenda();
    } catch (e) {
      if (tentativa < 3) {
        await new Promise((r) => setTimeout(r, tentativa * 1500));
        return carregarEquipe(tentativa + 1);
      }
      console.error('Erro ao carregar foco/agenda', e);
      document.getElementById('hh-agenda-grid').innerHTML = '<div class="hh-agenda-vazio">Não foi possível carregar a agenda.</div>';
    }
  }

  carregarEquipe();
  setInterval(carregarEquipe, 300000);

  // ── EDITAR FOCO DA SEMANA (gestor) ────────────────────────────
  function abrirEditorFoco() {
    document.getElementById('edit-foco-texto').value = focoAtual;
    document.getElementById('edit-foco-erro').style.display = 'none';
    document.getElementById('modal-editar-foco').classList.add('show');
  }
  window.abrirEditorFoco = abrirEditorFoco;

  function fecharEditorFoco() {
    document.getElementById('modal-editar-foco').classList.remove('show');
  }
  window.fecharEditorFoco = fecharEditorFoco;

  async function salvarFoco() {
    const texto = document.getElementById('edit-foco-texto').value.trim();
    const erroEl = document.getElementById('edit-foco-erro');
    erroEl.style.display = 'none';
    try {
      const res = await fetch(`${AGENDA_API}/foco`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }),
      });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao salvar.'; erroEl.style.display = 'block'; return; }
      renderFoco(texto);
      fecharEditorFoco();
    } catch (e) {
      erroEl.textContent = 'Erro ao salvar: ' + e.message;
      erroEl.style.display = 'block';
    }
  }
  window.salvarFoco = salvarFoco;

  // ── ADICIONAR/EDITAR/EXCLUIR EVENTO DA AGENDA (gestor) ────────
  function abrirEditorEvento(linha) {
    eventoEditandoLinha = linha || null;
    const ev = linha ? agendaCache.find((e) => e.linha === linha) : null;
    document.getElementById('edit-evento-titulo').innerHTML = ev
      ? '<i class="ti ti-pencil" style="color:var(--gold);margin-right:6px"></i>Editar evento'
      : '<i class="ti ti-calendar-plus" style="color:var(--gold);margin-right:6px"></i>Novo evento';
    document.getElementById('edit-evento-dia').value = ev ? ev.dia : 'Segunda';
    document.getElementById('edit-evento-hora').value = ev ? ev.hora : '';
    document.getElementById('edit-evento-tipo').value = ev ? ev.tipo : 'Outro';
    document.getElementById('edit-evento-descricao').value = ev ? ev.descricao : '';
    document.getElementById('edit-evento-erro').style.display = 'none';
    document.getElementById('modal-editar-evento').classList.add('show');
  }
  window.abrirEditorEvento = abrirEditorEvento;

  function fecharEditorEvento() {
    document.getElementById('modal-editar-evento').classList.remove('show');
    eventoEditandoLinha = null;
  }
  window.fecharEditorEvento = fecharEditorEvento;

  async function salvarEvento() {
    const dia = document.getElementById('edit-evento-dia').value;
    const hora = document.getElementById('edit-evento-hora').value;
    const tipo = document.getElementById('edit-evento-tipo').value;
    const descricao = document.getElementById('edit-evento-descricao').value.trim();
    const erroEl = document.getElementById('edit-evento-erro');
    erroEl.style.display = 'none';
    if (!descricao) { erroEl.textContent = 'Descreva o evento.'; erroEl.style.display = 'block'; return; }
    try {
      const url = eventoEditandoLinha ? `${AGENDA_API}/evento-editar` : `${AGENDA_API}/evento`;
      const body = eventoEditandoLinha
        ? { linha: eventoEditandoLinha, dia, hora, descricao, tipo }
        : { dia, hora, descricao, tipo };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao salvar.'; erroEl.style.display = 'block'; return; }
      fecharEditorEvento();
      await carregarFocoAgenda();
    } catch (e) {
      erroEl.textContent = 'Erro ao salvar: ' + e.message;
      erroEl.style.display = 'block';
    }
  }
  window.salvarEvento = salvarEvento;

  async function excluirEvento(linha) {
    const ok = await hubConfirm('Excluir esse evento da agenda?', { textoConfirmar: 'Excluir' });
    if (!ok) return;
    try {
      const res = await fetch(`${AGENDA_API}/evento-excluir`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linha }),
      });
      const json = await res.json();
      if (!json.ok) { await hubAlert(json.erro || 'Erro ao excluir.', 'erro'); return; }
      await carregarFocoAgenda();
    } catch (e) {
      await hubAlert('Erro ao excluir: ' + e.message, 'erro');
    }
  }
  window.excluirEvento = excluirEvento;
})();

// ── ESCALA + TROCAS + SUGESTÃO (dados do Painel SAC) ──────────
(function () {
  const escGrid = document.getElementById('esc-grid');
  if (!escGrid) return; // sem acesso a painel-sac, nada a fazer aqui

  const API_BASE = '/painel-sac/api';
  const usuarioLogado = window.USUARIO_SESSAO;
  const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  let escalaMes = mesHoje, escalaAno = anoHoje;
  let trocasPendentes = [];
  let consultoresCache = [];
  let pessoasEquipeCache = []; // {slug, nome} de quem tem escala de verdade — vem pronto de /api/escala-equipe, alimenta o grid e o modal de lote
  let sabadosCache = {}; // por slug — reaproveitado tanto pro "seu sábado" quanto pro "sábado do colega"

  function atualizarLabelEscala() {
    const el = document.getElementById('escala-mes-label');
    if (el) el.textContent = MESES[escalaMes] + ' ' + escalaAno;
  }

  function mostrarBadgePendente() {
    const count = document.getElementById('trocas-count');
    const btn = document.getElementById('btn-trocas');
    if (!count || !btn) return;
    const n = (trocasPendentes || []).length;
    count.textContent = n;
    btn.style.opacity = n > 0 ? '1' : '0.5';
    btn.style.boxShadow = n > 0 ? '0 0 0 2px rgba(245,184,0,0.3)' : 'none';
  }

  function renderEscala(escala, mes, ano) {
    document.getElementById('esc-hdr').innerHTML = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d) => `<div class="hh-esc-head">${d}</div>`).join('');
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const dowPrimeiro = new Date(ano, mes, 1).getDay();
    const offset = (dowPrimeiro + 6) % 7;
    let html = '';
    for (let i = 0; i < offset; i++) html += '<div></div>';
    (escala || []).forEach((item) => {
      if (item.dia > diasNoMes) return;
      const isH = mes === mesHoje && ano === anoHoje && item.dia === diaHoje;
      html += `<div class="hh-day-cell hh-d-${item.status || 'F'} ${isH ? 'hh-d-today' : ''}"><div class="hh-day-n">${item.dia}</div><div class="hh-day-s">${item.status || 'F'}</div></div>`;
    });
    document.getElementById('esc-grid').innerHTML = html;
    escalaMes = mes; escalaAno = ano;
    // Só existe pra colaborador — na visão de gestor esse título virou um
    // texto fixo ("Minha escala"), sem id pra não ser sobrescrito aqui.
    const tituloEl = document.getElementById('escala-title');
    if (tituloEl) tituloEl.textContent = `Escala de serviço · ${MESES[mes].toUpperCase()} ${ano}`;
    atualizarLabelEscala();
    mostrarBadgePendente();
  }

  async function navEscala(dir) {
    escalaMes += dir;
    if (escalaMes > 11) { escalaMes = 0; escalaAno++; }
    if (escalaMes < 0) { escalaMes = 11; escalaAno--; }
    await carregarEscala();
  }
  window.navEscala = navEscala;

  async function carregarEscala() {
    try {
      const res = await fetch(`${API_BASE}/escala?mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      trocasPendentes = json.trocas_pendentes || [];
      const minhaEscala = json.escala || [];
      // Gestor "puro" (ex: Jhonys) não tem aba de escala própria na
      // planilha — a API sempre devolve [] pra ele. Em vez de mostrar um
      // calendário vazio (parece quebrado), esconde o bloco "minha escala"
      // só nesse caso; colaborador com mês legitimamente vazio continua
      // vendo o calendário normal (comportamento de antes).
      const wrap = document.getElementById('hh-minha-escala-wrap');
      if (wrap) wrap.style.display = usuarioLogado.role === 'gestor' && !minhaEscala.length ? 'none' : '';
      renderEscala(minhaEscala, escalaMes, escalaAno);
    } catch (e) {
      console.error('Erro ao carregar escala', e);
      document.getElementById('esc-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1">Escala ainda não disponível.</div>';
    }
    carregarEscalaEquipe(); // independente da escala pessoal — só existe a div pra gestor
  }

  // Busca com prazo máximo — nenhuma chamada da escala da equipe pode ficar
  // pendurada pra sempre (ex: Apps Script lento/instável em produção); depois
  // de "ms" sem resposta, desiste e quem chamou trata como falha.
  function fetchComPrazo(url, ms) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), ms);
    return fetch(url, { signal: controlador.signal }).finally(() => clearTimeout(timer));
  }

  // ── ESCALA DA EQUIPE (gestor) ─────────────────────────────────
  // Uma chamada só (action=escalaEquipe no Apps Script), que já lê todo
  // mundo numa única execução — bem mais rápido do que fazer 1 chamada por
  // pessoa (era isso que deixava o card lento). Roda automaticamente ao
  // carregar a página, então trata erro de forma silenciosa (nunca um
  // modal/alerta travado esperando clique de ninguém).
  async function carregarEscalaEquipe() {
    const cont = document.getElementById('hh-equipe-grid');
    if (!cont) return; // div só existe na home de quem é gestor
    try {
      const res = await fetchComPrazo(`${API_BASE}/escala-equipe?mes=${escalaMes}&ano=${escalaAno}`, 40000);
      const json = await res.json();
      if (!Array.isArray(json.pessoas)) throw new Error(json.erro || 'resposta inválida');
      pessoasEquipeCache = json.pessoas.map((p) => ({ slug: p.slug, nome: p.nome }));
      const resultados = json.pessoas.map((p) => ({ pessoa: { slug: p.slug, nome: p.nome }, escala: p.escala || [] }));
      renderEscalaEquipe(resultados, escalaMes, escalaAno);
    } catch (e) {
      console.error('Erro ao carregar escala da equipe', e);
      cont.innerHTML = '<div class="empty-state">Não foi possível carregar a escala da equipe agora. Tente atualizar a página em alguns minutos.</div>';
    }
  }

  function renderEscalaEquipe(resultados, mes, ano) {
    const cont = document.getElementById('hh-equipe-grid');
    if (!cont) return;
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();

    if (!resultados.length) {
      cont.innerHTML = '<div class="empty-state">Nenhum colaborador encontrado.</div>';
      return;
    }

    const headCells = [];
    for (let dia = 1; dia <= diasNoMes; dia++) {
      headCells.push(`<div class="hh-eq-cell">${dia}</div>`);
    }

    // Mês sem nenhuma linha ainda na planilha (ex: mês futuro nunca aberto)
    // devolve escala vazia pra todo mundo — mesmo assim desenha o calendário
    // completo, só que com células em branco: dá pra clicar e ir preenchendo
    // (ex: só os sábados, como pedido), em vez de sumir com o quadro inteiro.
    const linhas = resultados.map(({ pessoa, escala }) => {
      const porDia = {};
      escala.forEach((d) => { porDia[d.dia] = d.status; });
      const cells = [];
      for (let dia = 1; dia <= diasNoMes; dia++) {
        const status = porDia[dia] || '';
        cells.push(`<div class="hh-eq-cell st-${status || 'vazio'} editavel" data-slug="${pessoa.slug}" data-dia="${dia}" data-nome="${pessoa.nome}" onclick="excAbrirEditorEscala(this)" title="${pessoa.nome} · dia ${dia}${status ? ': ' + status : ' — sem dado ainda'} (clique pra editar)">${status}</div>`);
      }
      return `<div class="hh-eq-row"><div class="hh-eq-name">${pessoa.nome.split(' ')[0]}</div><div class="hh-eq-days">${cells.join('')}</div></div>`;
    }).join('');

    cont.innerHTML = `<div class="hh-eq-grid">
      <div class="hh-eq-row hh-eq-head"><div class="hh-eq-name"></div><div class="hh-eq-days">${headCells.join('')}</div></div>
      ${linhas}
    </div>`;
  }

  // ── EDITAR ESCALA DA EQUIPE (gestor, direto no quadro) ────────
  let editEscalaAlvo = null; // { slug, dia, nome, cellEl }

  function excAbrirEditorEscala(cellEl) {
    const statusAtual = Array.from(cellEl.classList)
      .find((c) => c.startsWith('st-') && c !== 'st-vazio');
    editEscalaAlvo = {
      slug: cellEl.dataset.slug,
      dia: parseInt(cellEl.dataset.dia),
      nome: cellEl.dataset.nome,
      cellEl,
    };
    const dataFmt = `${String(editEscalaAlvo.dia).padStart(2, '0')}/${String(escalaMes + 1).padStart(2, '0')}/${escalaAno}`;
    document.getElementById('edit-escala-quem').textContent = `${editEscalaAlvo.nome} · ${dataFmt}`;
    document.getElementById('edit-escala-status').value = statusAtual ? statusAtual.slice(3) : 'F';
    document.getElementById('edit-escala-erro').style.display = 'none';
    document.getElementById('modal-editar-escala').classList.add('show');
  }
  window.excAbrirEditorEscala = excAbrirEditorEscala;

  function fecharEditorEscala() {
    document.getElementById('modal-editar-escala').classList.remove('show');
    editEscalaAlvo = null;
  }
  window.fecharEditorEscala = fecharEditorEscala;

  async function salvarEdicaoEscala() {
    if (!editEscalaAlvo) return;
    const status = document.getElementById('edit-escala-status').value;
    const erroEl = document.getElementById('edit-escala-erro');
    erroEl.style.display = 'none';
    try {
      const res = await fetch(`${API_BASE}/escala`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: editEscalaAlvo.slug, dia: editEscalaAlvo.dia, mes: escalaMes, ano: escalaAno, status }),
      });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao salvar.'; erroEl.style.display = 'block'; return; }
      // Atualiza a célula na hora — não faz sentido esperar outra rodada
      // (lenta) no Apps Script só pra confirmar o que a gente já sabe que
      // gravou.
      const cell = editEscalaAlvo.cellEl;
      cell.className = cell.className.replace(/st-\S+/, 'st-' + status);
      cell.textContent = status;
      cell.title = `${editEscalaAlvo.nome} · dia ${editEscalaAlvo.dia}: ${status} (clique pra editar)`;
      fecharEditorEscala();
    } catch (e) {
      erroEl.textContent = 'Erro ao salvar: ' + e.message;
      erroEl.style.display = 'block';
    }
  }
  window.salvarEdicaoEscala = salvarEdicaoEscala;

  // ── CADASTRAR FÉRIAS/FERIADO EM LOTE (gestor) ─────────────────
  // "YYYY-MM-DD" (valor nativo de <input type="date">) como data local, pra
  // não cair um dia por causa de fuso horário se interpretasse como UTC —
  // mesmo cuidado que Indicadores Equipe já toma pro mesmo tipo de input.
  function excParseDataLocal(str) {
    const [ano, mes, dia] = str.split('-').map(Number);
    return new Date(ano, mes - 1, dia);
  }

  const LOTE_MAX_DIAS = 62; // ~2 meses — cada dia é uma escrita na planilha, não deixa abrir um intervalo enorme por engano

  function excAjustarLoteStatus() {
    const status = document.getElementById('lote-escala-status').value;
    // Feriado é regra geral (todo mundo); férias/folga/trabalho/troca são
    // individuais — só ajuda a marcar o padrão mais comum, não trava nada.
    const todosCheckbox = document.getElementById('lote-escala-todos');
    if (status === 'FN' || status === 'FM') {
      todosCheckbox.checked = true;
      excLoteMarcarTodos(true);
    } else {
      todosCheckbox.checked = false;
      excLoteMarcarTodos(false);
    }
  }
  window.excAjustarLoteStatus = excAjustarLoteStatus;

  function excLoteMarcarTodos(marcar) {
    document.querySelectorAll('#lote-escala-pessoas input[type="checkbox"]').forEach((cb) => { cb.checked = marcar; });
  }
  window.excLoteMarcarTodos = excLoteMarcarTodos;

  async function abrirLoteEscala() {
    const erroEl = document.getElementById('lote-escala-erro');
    const sucessoEl = document.getElementById('lote-escala-sucesso');
    erroEl.style.display = 'none';
    sucessoEl.style.display = 'none';
    document.getElementById('lote-escala-status').value = 'FE';
    document.getElementById('lote-escala-todos').checked = false;
    document.getElementById('lote-escala-de').value = '';
    document.getElementById('lote-escala-ate').value = '';

    const pessoasEl = document.getElementById('lote-escala-pessoas');
    if (!pessoasEquipeCache.length) {
      pessoasEl.innerHTML = '<div style="font-size:12px;color:var(--text-hint)">Ainda carregando a lista de consultores — abre de novo em alguns segundos.</div>';
    } else {
      pessoasEl.innerHTML = pessoasEquipeCache.map((c) => `
        <label style="font-size:12.5px;color:var(--text);display:flex;align-items:center;gap:7px;cursor:pointer">
          <input type="checkbox" value="${c.slug}"> ${c.nome}
        </label>
      `).join('');
    }
    document.getElementById('modal-lote-escala').classList.add('show');
  }
  window.abrirLoteEscala = abrirLoteEscala;

  function fecharLoteEscala() {
    document.getElementById('modal-lote-escala').classList.remove('show');
  }
  window.fecharLoteEscala = fecharLoteEscala;

  async function salvarLoteEscala() {
    const erroEl = document.getElementById('lote-escala-erro');
    const sucessoEl = document.getElementById('lote-escala-sucesso');
    erroEl.style.display = 'none';
    sucessoEl.style.display = 'none';

    const status = document.getElementById('lote-escala-status').value;
    const slugs = Array.from(document.querySelectorAll('#lote-escala-pessoas input[type="checkbox"]:checked')).map((cb) => cb.value);
    const deStr = document.getElementById('lote-escala-de').value;
    const ateStr = document.getElementById('lote-escala-ate').value;

    if (!slugs.length) { erroEl.textContent = 'Selecione ao menos uma pessoa.'; erroEl.style.display = 'block'; return; }
    if (!deStr || !ateStr) { erroEl.textContent = 'Selecione as duas datas.'; erroEl.style.display = 'block'; return; }
    if (deStr > ateStr) { erroEl.textContent = '"De" precisa vir antes de "Até".'; erroEl.style.display = 'block'; return; }

    const de = excParseDataLocal(deStr), ate = excParseDataLocal(ateStr);
    const dias = [];
    const atual = new Date(de);
    while (atual <= ate) {
      dias.push({ dia: atual.getDate(), mes: atual.getMonth(), ano: atual.getFullYear() });
      atual.setDate(atual.getDate() + 1);
    }
    if (dias.length > LOTE_MAX_DIAS) {
      erroEl.textContent = `Selecione um intervalo de até ${LOTE_MAX_DIAS} dias.`;
      erroEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('lote-escala-btn-salvar');
    btn.disabled = true;
    btn.textContent = 'Cadastrando... (pode demorar até 1 min)';
    try {
      const res = await fetch(`${API_BASE}/escala-lote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs, dias, status }),
      });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao cadastrar.'; erroEl.style.display = 'block'; return; }
      sucessoEl.textContent = `${json.gravados || 0} dia(s) gravado(s)${json.falhas ? ' — ' + json.falhas + ' falharam (mês fora do que já existe na planilha?)' : ''}.`;
      sucessoEl.style.display = 'block';
      // Muda várias células de uma vez (várias pessoas × vários dias) — mais
      // simples recarregar a escala da equipe do zero do que remendar célula
      // por célula na tela.
      carregarEscalaEquipe();
    } catch (e) {
      erroEl.textContent = 'Erro ao cadastrar: ' + e.message;
      erroEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Cadastrar';
    }
  }
  window.salvarLoteEscala = salvarLoteEscala;

  // Sábados de um slug qualquer no mês/ano atualmente exibido no calendário —
  // reaproveitado tanto pro "seu sábado" quanto pro "sábado do colega".
  // Chave inclui mês/ano pra não reaproveitar cache de um mês já navegado.
  async function fetchSabados(slug) {
    const chave = `${slug}_${escalaMes}_${escalaAno}`;
    if (!sabadosCache[chave]) {
      const res = await fetch(`${API_BASE}/sabados-consultor?alvo=${encodeURIComponent(slug)}&mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      sabadosCache[chave] = json.sabados || [];
    }
    return sabadosCache[chave];
  }

  function opcoesSabados(sabados) {
    if (!sabados.length) return '<option value="">Nenhum sábado disponível neste mês</option>';
    return '<option value="">Selecione o sábado…</option>' +
      sabados.map((s) => `<option value="${s.dia}|${escalaMes}|${escalaAno}">${s.dia} ${MESES_ABREV[escalaMes]} ${escalaAno} (${s.status})</option>`).join('');
  }

  async function carregarMeusSabados() {
    const sel = document.getElementById('troca-dia-meu-select');
    sel.innerHTML = '<option value="">Carregando…</option>';
    try {
      const sabados = await fetchSabados(usuarioLogado.slug);
      sel.innerHTML = opcoesSabados(sabados);
    } catch (e) {
      sel.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }

  async function carregarSabadosAlvo() {
    const slug = document.getElementById('troca-consultor').value;
    const sel = document.getElementById('troca-dia-alvo');
    if (!slug) { sel.innerHTML = '<option value="">Selecione o consultor primeiro…</option>'; return; }
    sel.innerHTML = '<option value="">Carregando…</option>';
    sel.innerHTML = opcoesSabados(await fetchSabados(slug));
  }
  window.carregarSabadosAlvo = carregarSabadosAlvo;

  async function carregarConsultores() {
    if (consultoresCache.length) return;
    try {
      const res = await fetch(`${API_BASE}/consultores`);
      const json = await res.json();
      if (json.erro) { await hubAlert('Erro ao carregar consultores: ' + json.erro, 'erro'); }
      consultoresCache = (json.consultores || []).filter((c) => c.slug !== usuarioLogado.slug);
    } catch (e) {
      await hubAlert('Erro ao buscar consultores: ' + e.message, 'erro');
    }
  }

  async function carregarListaPendentes() {
    const lista = document.getElementById('troca-pendente-lista');
    lista.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px">Verificando solicitações…</div>';
    try {
      const res = await fetch(`${API_BASE}/escala?mes=${escalaMes}&ano=${escalaAno}`);
      const json = await res.json();
      trocasPendentes = json.trocas_pendentes || [];
      mostrarBadgePendente();
    } catch (e) { /* usa cache local se a busca falhar */ }

    const nomes = {};
    consultoresCache.forEach((c) => (nomes[c.slug] = c.nome));

    if (!trocasPendentes.length) {
      lista.innerHTML = '<div style="font-size:12px;color:var(--text-hint);text-align:center;padding:24px"><i class="ti ti-checks" style="font-size:24px;display:block;margin-bottom:8px;color:var(--ok-text)"></i>Nenhuma troca pendente no momento.</div>';
      return;
    }

    lista.innerHTML = trocasPendentes.map((t) => `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px">
        <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:var(--text)">
          <i class="ti ti-arrows-exchange" style="color:var(--gold);margin-right:4px"></i>
          ${nomes[t.solicitante] || t.solicitante} quer trocar com você
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          Sábado deles: <strong style="color:var(--text)">${t.dia_sol} ${MESES_ABREV[t.mes_sol]} ${t.ano_sol}</strong> →
          Seu sábado: <strong style="color:var(--text)">${t.dia_alvo} ${MESES_ABREV[t.mes_alvo]} ${t.ano_alvo}</strong>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="responderTroca('${t.id}', true)" style="flex:1;background:var(--gold);color:var(--on-gold,#1A1A18);border:none;border-radius:var(--radius-sm);padding:8px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer">✓ Aceitar</button>
          <button onclick="responderTroca('${t.id}', false)" style="background:none;border:1px solid rgba(212,75,75,0.4);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;color:var(--bad-text);font-family:inherit;cursor:pointer">✕ Recusar</button>
        </div>
      </div>
    `).join('');
  }

  async function abrirTrocas() {
    document.getElementById('modal-trocas').classList.add('show');
    document.getElementById('troca-erro').style.display = 'none';
    document.getElementById('troca-consultor').innerHTML = '<option value="">Selecione o consultor…</option>';
    document.getElementById('troca-dia-alvo').innerHTML = '<option value="">Selecione o consultor primeiro…</option>';
    document.getElementById('trocas-mes-ref').textContent = `${MESES[escalaMes]} ${escalaAno}`;

    const bloqueado = new Date().getDay() === 5;
    document.getElementById('trocas-bloqueado-aviso').style.display = bloqueado ? 'block' : 'none';
    document.getElementById('trocas-form').style.display = bloqueado ? 'none' : 'block';

    if (!bloqueado) {
      carregarMeusSabados();
      await carregarConsultores();
      document.getElementById('troca-consultor').innerHTML = '<option value="">Selecione o consultor…</option>' +
        consultoresCache.map((c) => `<option value="${c.slug}">${c.nome}</option>`).join('');
    } else {
      await carregarConsultores();
    }

    await carregarListaPendentes();
  }
  window.abrirTrocas = abrirTrocas;

  function fecharTrocas() { document.getElementById('modal-trocas').classList.remove('show'); }
  window.fecharTrocas = fecharTrocas;

  async function enviarTroca() {
    const erroEl = document.getElementById('troca-erro');
    const meuVal = document.getElementById('troca-dia-meu-select').value;
    const slug = document.getElementById('troca-consultor').value;
    const alvoVal = document.getElementById('troca-dia-alvo').value;
    erroEl.style.display = 'none';
    if (!meuVal) { erroEl.textContent = 'Selecione o seu sábado.'; erroEl.style.display = 'block'; return; }
    if (!slug) { erroEl.textContent = 'Selecione o consultor.'; erroEl.style.display = 'block'; return; }
    if (!alvoVal) { erroEl.textContent = 'Selecione o sábado do colega.'; erroEl.style.display = 'block'; return; }
    const [dia_solicitante, mes_solicitante, ano_solicitante] = meuVal.split('|').map(Number);
    const [dia_alvo, mes_alvo, ano_alvo] = alvoVal.split('|').map(Number);
    const payload = { dia_solicitante, mes_solicitante, ano_solicitante, consultor_alvo: slug, dia_alvo, mes_alvo, ano_alvo };
    try {
      const res = await fetch(`${API_BASE}/solicitar-troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao solicitar.'; erroEl.style.display = 'block'; return; }
      fecharTrocas();
      await hubAlert('Solicitação enviada! O colega receberá a notificação no painel.', 'sucesso');
    } catch (e) {
      erroEl.textContent = e.message; erroEl.style.display = 'block';
    }
  }
  window.enviarTroca = enviarTroca;

  async function responderTroca(idTroca, aceitar) {
    const payload = { id_troca: idTroca, aceitar };
    try {
      const res = await fetch(`${API_BASE}/responder-troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.ok) { await hubAlert('Erro: ' + (json.erro || 'tente novamente'), 'erro'); return; }
      if (aceitar) {
        await hubAlert('Troca aceita! As escalas foram atualizadas.', 'sucesso');
        await carregarEscala();
      } else {
        await hubAlert('Troca recusada.', 'info');
      }
      await carregarListaPendentes();
    } catch (e) { await hubAlert('Erro: ' + e.message, 'erro'); }
  }
  window.responderTroca = responderTroca;

  // ── SUGESTÃO ──
  function abrirSugestao() {
    document.getElementById('sug-form').style.display = 'block';
    document.getElementById('sug-ok').style.display = 'none';
    document.getElementById('sug-titulo').value = '';
    document.getElementById('sug-texto').value = '';
    document.getElementById('popup-sugestao').classList.add('open');
  }
  window.abrirSugestao = abrirSugestao;

  async function enviarSugestao() {
    const titulo = document.getElementById('sug-titulo').value.trim();
    const texto = document.getElementById('sug-texto').value.trim();
    if (!titulo || !texto) { await hubAlert('Preencha o título e a sugestão antes de enviar.', 'erro'); return; }
    try {
      await fetch(`${API_BASE}/sugestao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo, sugestao: texto }) });
      document.getElementById('sug-nome-ok').textContent = `Obrigado pela contribuição, ${usuarioLogado.nome.split(' ')[0]}.`;
      document.getElementById('sug-form').style.display = 'none';
      document.getElementById('sug-ok').style.display = 'block';
    } catch (e) { await hubAlert('Erro ao enviar. Tente novamente.', 'erro'); }
  }
  window.enviarSugestao = enviarSugestao;

  carregarEscala();
})();

// ── DASHBOARD EXECUTIVO (fundido na Home, gestor) ─────────────
// Veio do rascunho /executivo (removido) — 100% client-side, chamando os
// mesmos endpoints que os painéis originais já expõem (nenhum Apps Script
// novo). Reaproveita IE_TIMES/ieDiasSemana/ieDiasMes/ieFmtISO/ieAgregar/
// ieAtingeMeta/ieFormatValor, definidos em indicadores-equipe.js (carregado
// antes deste script só pra quem é gestor).
(function () {
  const kpisChart = document.getElementById('exec-kpis-chart');
  if (!kpisChart) return; // só existe na Home de quem é gestor

  const EXEC_METRICAS = [
    { time: 'atendimento', key: 'tma' },
    { time: 'atendimento', key: 'csat' },
    { time: 'atendimento', key: 'tmt_refab' },
    { time: 'resolucao', key: 'tempo_ppf' },
  ];

  let excDiasAtuais = ieDiasSemana();

  function excSetPeriodo(periodo, btn) {
    document.querySelectorAll('.ie-tabs .ie-tab').forEach((t) => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    excDiasAtuais = periodo === 'mes' ? ieDiasMes() : ieDiasSemana();
    excCarregarKpis();
  }
  window.excSetPeriodo = excSetPeriodo;

  async function excCarregarKpis() {
    const cont = document.getElementById('exec-kpis-chart');
    cont.innerHTML = '<div class="ie-carregando"><i class="ti ti-loader-2" aria-hidden="true"></i> Carregando indicadores...</div>';

    const desde = ieFmtISO(excDiasAtuais[0].data);
    const ate = ieFmtISO(excDiasAtuais[excDiasAtuais.length - 1].data);

    try {
      const [atendimento, resolucao] = await Promise.all([
        fetch(`/indicadores-equipe/api/dados?time=atendimento&desde=${desde}&ate=${ate}`).then((r) => r.json()),
        fetch(`/indicadores-equipe/api/dados?time=resolucao&desde=${desde}&ate=${ate}`).then((r) => r.json()),
      ]);
      if (!atendimento.ok) throw new Error(atendimento.erro || 'Falha ao buscar Time Atendimento');
      if (!resolucao.ok) throw new Error(resolucao.erro || 'Falha ao buscar Time Resolução');
      excRenderKpisChart({ atendimento: atendimento.porEquipe || {}, resolucao: resolucao.porEquipe || {} });
    } catch (err) {
      cont.innerHTML = `<div class="ie-erro"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar os indicadores: ${err.message}</div>`;
    }
  }

  // Só o valor agregado do período + meta — sem gráfico diário, pra dar uma
  // leitura rápida da equipe no período (semana/mês), no mesmo estilo de
  // card usado no NPS e no resto do dashboard (verde dentro da meta, vermelho
  // fora dela).
  function excRenderKpisChart(porEquipe) {
    const cont = document.getElementById('exec-kpis-chart');

    cont.innerHTML = EXEC_METRICAS.map(({ time, key }) => {
      const m = IE_TIMES[time].metricas.find((mm) => mm.key === key);
      const serie = porEquipe[time][key] || [];
      const totalPeriodo = ieAgregar(serie, m.agregacao);
      const atinge = ieAtingeMeta(totalPeriodo, m.meta);
      const cardCls = atinge === null ? '' : atinge ? 'status-ok' : 'status-danger';
      const valCls = atinge === null ? '' : atinge ? 'ok' : 'danger';
      const metaTxt = m.meta ? (m.meta.direcao === 'menor' ? '&lt;' : '&gt;') + ' ' + ieFormatValor(m.meta.valor, m.unidade) : '';

      return `<div class="hh-kpi-card ${cardCls}">
        <div class="hh-kpi-label">${m.label}</div>
        <div class="hh-kpi-value ${valCls}">${ieFormatValor(totalPeriodo, m.unidade)}</div>
        <div class="hh-kpi-meta">Meta: <span>${metaTxt}</span></div>
      </div>`;
    }).join('');
  }

  async function excCarregarNps() {
    const el = document.getElementById('exec-val-nps');
    try {
      const resp = await fetch('/ranking-sac/api/csv/kpi', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rows = parseCSV(await resp.text());
      let nps = '--';
      rows.forEach((row) => {
        if (cleanStr(row[0]).toLowerCase().includes('nps da equipe')) {
          const v = safeNum(cleanStr(row[1]));
          nps = v != null ? v : '--';
        }
      });
      el.textContent = nps;
    } catch (err) {
      el.textContent = '--';
    }
  }

  // ── SOLICITAÇÕES AO FINANCEIRO (Registro/Reembolso/Pagamento pendentes) ──
  async function excCarregarFinanceiro() {
    const cont = document.getElementById('exec-financeiro');
    try {
      const [registro, reembolso, pagamento] = await Promise.all([
        fetch('/registro-demandas/api/list').then((r) => r.json()),
        fetch('/registro-demandas/api/list-reembolso').then((r) => r.json()),
        fetch('/registro-demandas/api/list-pagamento').then((r) => r.json()),
      ]);
      const contarPendentes = (lista) => (Array.isArray(lista) ? lista : []).filter((it) => it.Status === 'Pendente').length;
      const cards = [
        { label: 'Registro pendentes', valor: contarPendentes(registro) },
        { label: 'Reembolso pendentes', valor: contarPendentes(reembolso) },
        { label: 'Pagamento pendentes', valor: contarPendentes(pagamento) },
      ];
      cont.innerHTML = cards.map((c) => `<div class="hh-kpi-card"><div class="hh-kpi-label">${c.label}</div><div class="hh-kpi-value">${c.valor}</div></div>`).join('');
    } catch (err) {
      cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar as solicitações ao financeiro.</div>`;
    }
  }

  // ── QUITAÇÕES PENDENTES (total + atrasados) ──────────────────────────
  // Réplica de calcularUrgencia() em quitacoes-painel.js: sem "dataPrevista"
  // válida vencida, cai pro fallback de dias em aberto — aqui só importa se
  // está atrasado ou não, não o rótulo completo.
  function excParseDataPrevista(str) {
    if (!str) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + 'T00:00:00' : str);
    return isNaN(d.getTime()) ? null : d;
  }
  function excQuitacaoAtrasada(it) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const prevista = excParseDataPrevista(it.dataPrevista);
    if (prevista) return prevista < hoje;
    const cadastro = new Date(it.dataCadastro);
    cadastro.setHours(0, 0, 0, 0);
    const diasAberto = Math.max(0, Math.round((hoje - cadastro) / 86400000));
    return diasAberto > 7;
  }

  async function excCarregarQuitacoes() {
    const cont = document.getElementById('exec-quitacoes');
    try {
      const resp = await fetch('/quitacoes/api/lista');
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('sem-acesso');
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');
      const itens = json.itens || [];
      const atrasados = itens.filter(excQuitacaoAtrasada).length;
      cont.innerHTML = `
        <div class="hh-kpi-card"><div class="hh-kpi-label">Pendentes</div><div class="hh-kpi-value">${itens.length}</div></div>
        <div class="hh-kpi-card ${atrasados > 0 ? 'status-danger' : 'status-ok'}"><div class="hh-kpi-label">Atrasadas</div><div class="hh-kpi-value ${atrasados > 0 ? 'danger' : 'ok'}">${atrasados}</div></div>
      `;
    } catch (err) {
      cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-lock" aria-hidden="true"></i> Sem acesso ao painel de Quitações nesta conta.</div>`;
    }
  }

  // ── PRODUÇÃO (WALLAC) — contagem de cards por coluna do kanban ───────
  async function excCarregarWallac() {
    const cont = document.getElementById('exec-wallac');
    try {
      const resp = await fetch('/wallac/api/cards');
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('sem-acesso');
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');
      const cards = json.cards || [];
      const colunas = ['A chegar', 'Recebido', 'Em produção', 'Finalizado'];
      const porColuna = {};
      colunas.forEach((c) => (porColuna[c] = 0));
      cards.forEach((c) => { if (porColuna[c.status] != null) porColuna[c.status]++; });
      cont.innerHTML = colunas.map((c) => `<div class="hh-kpi-card"><div class="hh-kpi-label">${c}</div><div class="hh-kpi-value">${porColuna[c]}</div></div>`).join('');
    } catch (err) {
      cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-lock" aria-hidden="true"></i> Sem acesso ao painel Wallac nesta conta.</div>`;
    }
  }

  // ── CORRIDAS AVULSAS — total da semana atual (segunda a domingo) ─────
  function excSemanaAtual() {
    const hoje = new Date();
    const dow = hoje.getDay(); // 0=domingo
    const offsetSegunda = dow === 0 ? -6 : 1 - dow;
    const segunda = new Date(hoje); segunda.setDate(hoje.getDate() + offsetSegunda);
    const domingo = new Date(segunda); domingo.setDate(segunda.getDate() + 6);
    return { desde: ieFmtISO(segunda), ate: ieFmtISO(domingo) };
  }

  async function excCarregarCorridas() {
    const cont = document.getElementById('exec-corridas');
    try {
      const { desde, ate } = excSemanaAtual();
      const resp = await fetch(`/corridas-avulsas/api/lista?desde=${desde}&ate=${ate}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');
      const total = (json.itens || []).reduce((soma, it) => soma + (Number(it.valor) || 0), 0);
      const totalFmt = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      cont.innerHTML = `<div class="hh-kpi-card"><div class="hh-kpi-label">Total da semana</div><div class="hh-kpi-value" style="font-size:20px">${totalFmt}</div></div>`;
    } catch (err) {
      cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar as corridas avulsas.</div>`;
    }
  }

  // ── AUDITORIA DE QUALIDADE — totais do período todo + ranking por agente ──
  // Mesmos números da aba Dashboard de /auditoria (sem filtro de período —
  // lá também é o total acumulado), só resumido pra Home: 4 KPIs + um
  // ranking de score médio por agente, pra dar o pulso do time sem precisar
  // abrir o painel completo.
  async function excCarregarAuditoria() {
    const cont = document.getElementById('exec-auditoria');
    const rankCont = document.getElementById('exec-auditoria-ranking');
    if (!cont) return;
    try {
      const resp = await fetch('/auditoria/api/list');
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('resposta inesperada');
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Erro desconhecido');
      const registros = json.data || [];

      const total = registros.length;
      const somaScores = registros.reduce((s, r) => s + Number(r.Total || 0), 0);
      const scoreMedio = total ? Math.round(somaScores / total) : 0;
      const falhasGraves = registros.filter((r) => r.FalhaGrave === 'Sim').length;

      const porAgente = new Map();
      registros.forEach((r) => {
        const nome = r.Agente || '—';
        const cur = porAgente.get(nome) || { soma: 0, count: 0 };
        cur.soma += Number(r.Total || 0);
        cur.count += 1;
        porAgente.set(nome, cur);
      });

      cont.innerHTML = `
        <div class="hh-kpi-card"><div class="hh-kpi-label">Total de auditorias</div><div class="hh-kpi-value">${total}</div></div>
        <div class="hh-kpi-card"><div class="hh-kpi-label">Score médio</div><div class="hh-kpi-value">${scoreMedio}</div></div>
        <div class="hh-kpi-card"><div class="hh-kpi-label">Agentes avaliados</div><div class="hh-kpi-value">${porAgente.size}</div></div>
        <div class="hh-kpi-card ${falhasGraves > 0 ? 'status-danger' : ''}"><div class="hh-kpi-label">Falhas graves</div><div class="hh-kpi-value ${falhasGraves > 0 ? 'danger' : ''}">${falhasGraves}</div></div>
      `;

      if (rankCont) {
        const ranking = Array.from(porAgente.entries())
          .map(([agente, v]) => ({ agente, media: Math.round((v.soma / v.count) * 10) / 10 }))
          .sort((a, b) => b.media - a.media);
        rankCont.innerHTML = ranking.length
          ? ranking.map((r) => {
              const cor = r.media >= 90 ? 'var(--ok)' : r.media >= 75 ? '#4C8DFF' : r.media >= 60 ? 'var(--warn)' : 'var(--bad)';
              return `<div class="hh-audit-rank-row">
                <span class="hh-audit-rank-nome">${r.agente}</span>
                <div class="hh-audit-rank-track"><div class="hh-audit-rank-fill" style="width:${Math.min(100, r.media)}%;background:${cor}"></div></div>
                <span class="hh-audit-rank-valor">${r.media}</span>
              </div>`;
            }).join('')
          : `<div class="hh-audit-rank-empty">Nenhuma auditoria registrada ainda.</div>`;
      }
    } catch (err) {
      cont.innerHTML = `<div class="exec-sem-acesso"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar a Auditoria de Qualidade.</div>`;
      if (rankCont) rankCont.innerHTML = '';
    }
  }

  excCarregarKpis();
  excCarregarNps();
  excCarregarAuditoria();
  excCarregarFinanceiro();
  excCarregarQuitacoes();
  excCarregarWallac();
  excCarregarCorridas();
})();
