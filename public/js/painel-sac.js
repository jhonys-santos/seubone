// Painel SAC — portado de painel-sac/index.html original.
// A lógica de renderização (KPIs, evolução, pico, auditoria, RV, escala) é
// preservada quase que literalmente; o que muda é: (1) não existe mais tela
// de login própria — a sessão já vem autenticada pelo hub; (2) todas as
// chamadas vão para /painel-sac/api/... em vez de direto no Apps Script;
// (3) o cofre de senhas ("acessos") opera sempre sobre o slug da sessão,
// nunca sobre o "ver como" — são credenciais pessoais de quem está logado;
// (4) gestor pode escolher "ver como" outro colaborador via slugAtivo.

const API_BASE = '/painel-sac/api';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const hoje = new Date();
const diaHoje = hoje.getDate(), mesHoje = hoje.getMonth(), anoHoje = hoje.getFullYear();
const nomeDiaHoje = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][hoje.getDay()];
let periodo = 'semana', mesAtual = mesHoje;
let semanaIdx = 0;
let escalaMes = mesHoje, escalaAno = anoHoje;

const usuarioLogado = window.USUARIO_SESSAO;
const outrosColaboradores = window.OUTROS_COLABORADORES || [];
let slugAtivo = usuarioLogado.slug; // muda quando gestor usa "ver como"
let tipoAtivo = usuarioLogado.tipo; // tipo de QUEM está sendo visualizado (não de quem está logado)
let indicadoresPendentesAtivo = !!usuarioLogado.indicadoresPendentes; // true = ainda não tem KPIs mapeados na planilha
let dadosCache = {};

function nomeDoSlug(slug) {
  if (slug === usuarioLogado.slug) return usuarioLogado.nome;
  const c = outrosColaboradores.find((c) => c.slug === slug);
  return c ? c.nome : slug;
}

function trocarVerComo(slug) {
  slugAtivo = slug || usuarioLogado.slug;
  if (slugAtivo === usuarioLogado.slug) {
    tipoAtivo = usuarioLogado.tipo;
    indicadoresPendentesAtivo = !!usuarioLogado.indicadoresPendentes;
  } else {
    const c = outrosColaboradores.find((c) => c.slug === slugAtivo);
    tipoAtivo = c ? c.tipo : usuarioLogado.tipo;
    indicadoresPendentesAtivo = c ? !!c.indicadoresPendentes : false;
  }
  carregarPainel();
}

async function navEscala(dir) {
  escalaMes += dir;
  if (escalaMes > 11) { escalaMes = 0; escalaAno++; }
  if (escalaMes < 0)  { escalaMes = 11; escalaAno--; }
  const url = `${API_BASE}/escala?slug=${encodeURIComponent(slugAtivo)}&mes=${escalaMes}&ano=${escalaAno}`;
  try {
    const res  = await fetch(url);
    const json = await res.json();
    trocasPendentes = json.trocas_pendentes || [];
    renderEscala(json.escala || [], escalaMes, escalaAno);
    document.getElementById('escala-title').textContent = `Escala de serviço · ${MESES[escalaMes].toUpperCase()} ${escalaAno}`;
  } catch(e) { console.error('navEscala', e); }
}

function atualizarLabelEscala() {
  const el = document.getElementById('escala-mes-label');
  if (el) el.textContent = MESES[escalaMes] + ' ' + escalaAno;
}

// Gera semanas sex-qui que tocam o mês
function semanasDoMes(mes, ano) {
  const meses = [31,28+(ano%4===0&&(ano%100!==0||ano%400===0)?1:0),31,30,31,30,31,31,30,31,30,31];
  const primeiro = new Date(ano, mes, 1);
  const ultimo   = new Date(ano, mes, meses[mes]);
  const dow = primeiro.getDay();
  const offsetMap = {5:0,6:1,0:2,1:3,2:4,3:5,4:6};
  const offset = offsetMap[dow];
  let sexAtual = new Date(primeiro);
  sexAtual.setDate(sexAtual.getDate() - offset);

  const semanas = [];
  let i = 0;
  while (true) {
    const quiFim = new Date(sexAtual);
    quiFim.setDate(quiFim.getDate() + 6);
    if (sexAtual > ultimo) break;
    const iniMes = sexAtual <= primeiro ? primeiro : sexAtual;
    const fimMes = quiFim >= ultimo    ? ultimo   : quiFim;
    if (iniMes <= fimMes) {
      i++;
      semanas.push({
        num:   i,
        inicio: new Date(sexAtual),
        fim:    new Date(quiFim),
        label: 'Sex ' + fmtDD_MM(sexAtual) + ' – Qui ' + fmtDD_MM(quiFim)
      });
    }
    sexAtual = new Date(quiFim);
    sexAtual.setDate(sexAtual.getDate() + 1);
    if (i > 6) break;
  }
  return semanas;
}

function fmtDD_MM(d) {
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
}

function semanaAtualIdx(mes, ano) {
  const semanas = semanasDoMes(mes, ano);
  const agora   = new Date();
  const hojeN = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  for (let i = semanas.length - 1; i >= 0; i--) {
    const ini = new Date(semanas[i].inicio.getFullYear(), semanas[i].inicio.getMonth(), semanas[i].inicio.getDate());
    const fim = new Date(semanas[i].fim.getFullYear(),    semanas[i].fim.getMonth(),    semanas[i].fim.getDate());
    if (hojeN >= ini && hojeN <= fim) return i;
  }
  return semanas.length - 1;
}

function popularSeletorSemanas(mes, ano, idxParaManter) {
  const sel     = document.getElementById('week-select');
  const semanas = semanasDoMes(mes, ano);
  sel.innerHTML = semanas.map((s,i) =>
    `<option value="${i}">${s.label}</option>`
  ).join('');
  let idx = idxParaManter !== undefined ? idxParaManter : semanaAtualIdx(mes, ano);
  if (idx >= semanas.length) idx = semanas.length - 1;
  sel.value  = idx;
  semanaIdx  = idx;
  return semanas[idx];
}

document.getElementById('month-select').value = mesHoje;

// ── EM CONSTRUÇÃO (colaborador ainda sem KPIs mapeados na planilha) ──
function mostrarEmConstrucao() {
  document.getElementById('loading-screen').classList.remove('show');
  document.getElementById('error-banner').style.display = 'none';
  document.getElementById('dash').classList.add('show');
  document.getElementById('fab-btn').classList.remove('show');

  const nome = slugAtivo === usuarioLogado.slug ? usuarioLogado.nome.split(' ')[0] : nomeDoSlug(slugAtivo);
  const sufixo = slugAtivo !== usuarioLogado.slug ? ` de ${nome}` : '';
  document.getElementById('kpi-label').textContent = 'Indicadores principais';
  document.getElementById('kpi-grid').innerHTML = `
    <div class="empty-state" style="grid-column:1/-1;padding:3rem 1rem">
      <i class="ti ti-tools" style="font-size:32px;color:var(--gold);display:block;margin-bottom:12px"></i>
      <strong style="color:var(--text);font-size:14px;display:block;margin-bottom:6px">Indicadores${sufixo} em construção</strong>
      Ainda estamos configurando os indicadores dessa pessoa na planilha. Volte em breve.
    </div>`;
  document.getElementById('evolucao-block').innerHTML = '';
  document.getElementById('pico-label').style.display = 'none';
  document.getElementById('pico-card').style.display = 'none';
  document.getElementById('audit-block').style.display = 'none';
  document.getElementById('audit-section-label').style.display = 'none';
  document.getElementById('btn-ver-auditorias').style.display = 'none';
  document.getElementById('detrat-label').style.display = 'none';
  document.getElementById('detrat-block').style.display = 'none';
  document.getElementById('rv-label').style.display = 'none';
  document.getElementById('rv-block').style.display = 'none';
  document.getElementById('escala-title').textContent = 'Escala de serviço';
  document.getElementById('esc-hdr').innerHTML = '';
  document.getElementById('esc-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1">Escala ainda não disponível.</div>';
}

// ── CARREGAR PAINEL ───────────────────────────────────────────
async function carregarPainel() {
  if (indicadoresPendentesAtivo) {
    mostrarEmConstrucao();
    return;
  }
  const ls = document.getElementById('loading-screen');
  ls.classList.add('show');
  setLoadingTxt('Carregando indicadores...');
  document.getElementById('error-banner').style.display = 'none';
  try {
    const dados = await fetchDados();
    ls.classList.remove('show');
    document.getElementById('dash').classList.add('show');
    document.getElementById('fab-btn').classList.add('show');
    // Desfaz o que a tela "em construção" possa ter escondido numa troca de "ver como" anterior.
    ['pico-label','pico-card','audit-block','audit-section-label','detrat-label','detrat-block'].forEach((id) => {
      document.getElementById(id).style.display = '';
    });
    renderTudo(dados);
    if (dados.aviso && dados.aviso.ativo) {
      setTimeout(() => abrirAviso(dados.aviso), 700);
    }
  } catch(e) {
    ls.classList.remove('show');
    document.getElementById('dash').classList.add('show');
    document.getElementById('fab-btn').classList.add('show');
    const b = document.getElementById('error-banner');
    b.style.display = 'block';
    b.innerHTML = `<i class="ti ti-alert-circle"></i> Erro ao carregar dados: ${e.message}`;
  }
}

async function fetchDados() {
  let semIni = '', semFim = '';
  if (periodo === 'semana') {
    const semanas = semanasDoMes(mesAtual, anoHoje);
    const idx = Math.min(semanaIdx, semanas.length - 1);
    const s   = semanas[idx];
    const fmt = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
    semIni = fmt(s.inicio);
    semFim = fmt(s.fim);
  }
  const key = `${slugAtivo}_${periodo}_${mesAtual}_${semanaIdx}`;
  if (dadosCache[key]) return dadosCache[key];
  setLoadingTxt('Buscando os dados...');
  let url = `${API_BASE}/dados?slug=${encodeURIComponent(slugAtivo)}&periodo=${periodo}&mes=${mesAtual}&ano=${anoHoje}`;
  if (semIni) url += `&sem_ini=${encodeURIComponent(semIni)}&sem_fim=${encodeURIComponent(semFim)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('Erro HTTP ' + res.status);
  const json = await res.json();
  if (json.erro) throw new Error(json.erro);
  dadosCache[key] = json;
  return json;
}

function setLoadingTxt(t) { document.getElementById('loading-txt').textContent = t; }

// ── RENDERS ──────────────────────────────────────────────────
function fmtHoras(mins) {
  if (!mins || mins === 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? (h + 'h' + (m > 0 ? ' ' + m + 'min' : '')) : (m + 'min');
}
function stTMA(v){if(!v||v<=0)return'neutral';return v<=30?'ok':v<=35?'warn':'bad';}
function stCSAT(v){if(!v||v<=0)return'neutral';return v>=95?'ok':v>=90?'warn':'bad';}
function stTMR(v){if(!v||v<=0)return'neutral';return v<=5040?'ok':v<=6720?'warn':'bad';}
function stAudit(v){if(!v||v<=0)return'neutral';return v>=90?'ok':v>=80?'warn':'bad';}
function bdg(s,t){const tx=t||(s==='ok'?'dentro da meta':s==='warn'?'atenção':s==='neutral'?'sem dados':'acima da meta');return `<span class="badge b-${s}"><i class="ti ${s==='ok'?'ti-check':s==='warn'?'ti-alert-triangle':s==='neutral'?'ti-minus':'ti-x'}" style="font-size:9px"></i>${tx}</span>`;}
function kpiCard(icon,lbl,val,s,badge,meta){return `<div class="kpi-card"><div class="kpi-top"><i class="ti ${icon} kpi-ic"></i><span class="kpi-lbl">${lbl}</span></div><div class="kpi-val ${s}">${val}</div>${badge}<div class="kpi-meta">${meta}</div></div>`;}

function renderTudo(dados) {
  const ind = dados.indicadores || {};
  const lbl = periodo==='semana'?'esta semana':'este mês';
  const sufixoVerComo = slugAtivo !== usuarioLogado.slug ? ` · vendo como ${nomeDoSlug(slugAtivo)}` : '';
  document.getElementById('kpi-label').textContent = `Indicadores principais · ${MESES[mesAtual]} · ${periodo==='semana'?'Semana':'Mês'}${sufixoVerComo}`;
  document.getElementById('detrat-label').textContent = `Insatisfeitos · CSAT · ${MESES[mesAtual]}`;
  document.getElementById('pico-label').textContent = periodo==='mes'?`Pico de demanda · ${MESES[mesAtual]}`:'Pico de demanda · semana';
  document.getElementById('escala-horario').textContent = '08:00 às 18:00 · 5×2';

  if (tipoAtivo === 'sac') {
    const s1=stTMA(ind.tma||0), s2=stCSAT(ind.csat||0), s3=stTMR(ind.tmr_refab||0);
    const tmaStr = (ind.tma !== null && ind.tma !== undefined && ind.tma > 0) ? ind.tma + ' min' : '—';
    const csatStr2 = (ind.csat !== null && ind.csat !== undefined) ? ind.csat + '%' : '—';
    document.getElementById('kpi-grid').innerHTML =
      kpiCard('ti-clock','TMA',tmaStr,s1,bdg(s1),'Meta: &lt; 30 min') +
      kpiCard('ti-star','CSAT',csatStr2,s2,bdg(s2),'Meta: ≥ 95%') +
      kpiCard('ti-refresh','TMR Refab.',fmtHoras(ind.tmr_refab||0),s3,bdg(s3),'Meta: &lt; 84h') +
      kpiCard('ti-headset','Atendimentos',ind.atendimentos||0,'neutral','',lbl) +
      kpiCard('ti-chart-bar','Pesquisas',ind.pesquisas||0,'neutral','',lbl) +
      kpiCard('ti-ticket','Tickets',ind.tickets||0,'neutral','','resolvidos');
  } else {
    const sp = (ind.tmr_ppf||0) > 0 && (ind.tmr_ppf||0) <= 480 ? 'ok' : (ind.tmr_ppf||0) > 480 ? 'bad' : 'neutral';
    if (slugAtivo === 'daniel') {
      const csat      = ind.csat;
      const csatSp    = csat !== null && csat !== undefined ? (csat >= 95 ? 'ok' : 'bad') : 'neutral';
      const csatStr   = csat !== null && csat !== undefined ? csat + '%' : '—';
      const tmaLogo    = ind.tma_logo;
      const tmaLogoSp  = tmaLogo > 0 && tmaLogo <= 30 ? 'ok' : tmaLogo > 30 ? 'bad' : 'neutral';
      const tmaLogoStr = tmaLogo > 0 ? tmaLogo + ' min' : '—';
      const tmrPPFStr  = ind.tmr_ppf > 0 ? fmtHoras(ind.tmr_ppf) : '—';
      const tmrPPFSp   = ind.tmr_ppf > 0 && ind.tmr_ppf <= 1440 ? 'ok' : ind.tmr_ppf > 1440 ? 'bad' : 'neutral';
      const testesStr  = ind.testes_aprovados !== null && ind.testes_aprovados !== undefined ? ind.testes_aprovados : '—';
      document.getElementById('kpi-grid').innerHTML =
        kpiCard('ti-clock',     'TMT Ped. Atrasados', tmrPPFStr,              tmrPPFSp,  bdg(tmrPPFSp),  'Meta: &lt; 24h') +
        kpiCard('ti-clock',     'TMA Aprov. Logo',    tmaLogoStr,             tmaLogoSp, bdg(tmaLogoSp), 'Meta: &lt; 30 min') +
        kpiCard('ti-star',      'CSAT',               csatStr,                csatSp,    bdg(csatSp),    'Meta: ≥ 95%') +
        kpiCard('ti-chart-bar', 'Pesquisas',          ind.pesquisas || 0,     'neutral', '',             'esta semana') +
        kpiCard('ti-check',     'Testes Aprov.',      testesStr,              'neutral', '',             'aprovados') +
        kpiCard('ti-ticket',    'Tickets',            ind.tickets   || 0,     'neutral', '',             'resolvidos');
    } else if (slugAtivo === 'gabrielle') {
      const csat      = ind.csat;
      const csatSp    = csat !== null && csat !== undefined ? (csat >= 95 ? 'ok' : 'bad') : 'neutral';
      const csatStr   = csat !== null && csat !== undefined ? csat + '%' : '—';
      const tmrPPFStr = ind.tmr_ppf > 0 ? fmtHoras(ind.tmr_ppf) : '—';
      const tmrPPFSp  = ind.tmr_ppf > 0 && ind.tmr_ppf <= 1440 ? 'ok' : ind.tmr_ppf > 1440 ? 'bad' : 'neutral';
      const meta      = ind.meta_auditoria || (periodo === 'semana' ? 30 : 120);
      const auditSp   = (ind.auditorias||0) >= meta ? 'ok' : 'bad';
      document.getElementById('kpi-grid').innerHTML =
        kpiCard('ti-clock',     'TMT Ped. Atrasados', tmrPPFStr,        tmrPPFSp,  bdg(tmrPPFSp), 'Meta: &lt; 24h') +
        kpiCard('ti-star',      'CSAT',        csatStr,                csatSp,    bdg(csatSp),   'Meta: ≥ 95%') +
        kpiCard('ti-chart-bar', 'Pesquisas',   ind.pesquisas || 0,     'neutral', '',            'esta semana') +
        kpiCard('ti-clipboard-check','Auditorias', (ind.auditorias||0) + ' / ' + meta, auditSp, bdg(auditSp), 'Meta: ' + meta + (periodo==='semana'?'/semana':'/mês')) +
        kpiCard('ti-ticket',    'Tickets',     ind.tickets || 0,       'neutral', '',            'resolvidos');
    } else {
      document.getElementById('kpi-grid').innerHTML =
        kpiCard('ti-clock','TMR PPF+1',(ind.tmr_ppf||0) > 0 ? fmtHoras(ind.tmr_ppf) : '—', sp, bdg(sp),'Meta: &lt; 480 min') +
        kpiCard('ti-ticket','Tickets',ind.tickets||0,'neutral','','resolvidos');
    }
  }

  renderEvolucao(ind.tendencia_tma||[], ind.tendencia_csat||[]);
  renderPico(ind.pico||[]);
  renderAudit(ind.audit||{pct:0,ok:0,total:0});
  const histAudit = dados.auditorias_historico || { nota: null, itens: [] };
  atualizarBotaoAuditorias(histAudit);
  renderDetratores(ind.insatisfeitos||[]);
  trocasPendentes = dados.trocas_pendentes || [];
  if (escalaMes === mesAtual && escalaAno === anoHoje) {
    renderEscala(dados.escala||[], escalaMes, escalaAno);
  } else {
    atualizarLabelEscala();
    mostrarBadgePendente();
  }
  document.getElementById('escala-title').textContent = `Escala de serviço · ${MESES[escalaMes].toUpperCase()} ${escalaAno}`;
  renderRV(dados.indicadores||{});
}

function renderEvolucao(tmaDados, csatDados) {
  const isMes = periodo==='mes';
  const hojeLeg = `<div class="tleg gold-leg"><div class="tleg-dot" style="background:var(--gold)"></div>Hoje</div>`;
  const block = document.getElementById('evolucao-block');

  if (isMes) {
    block.innerHTML = `<div class="one-col">
      <div class="card"><div class="slabel">Evolução diária · TMA (min) · ${MESES[mesAtual]}</div><div class="trend-mes" id="trend-tma"></div>
        <div class="trend-legend"><div class="tleg"><div class="tleg-dot" style="background:#3DAF72"></div>Dentro da meta</div><div class="tleg"><div class="tleg-dot" style="background:#D44B4B"></div>Acima (30 min)</div>${mesAtual===mesHoje?hojeLeg:''}</div></div>
      <div class="card"><div class="slabel">Evolução diária · CSAT (%) · ${MESES[mesAtual]}</div><div class="trend-mes" id="trend-csat"></div>
        <div class="trend-legend"><div class="tleg"><div class="tleg-dot" style="background:#F5C300"></div>Dentro da meta</div><div class="tleg"><div class="tleg-dot" style="background:#D44B4B"></div>Abaixo (95%)</div>${mesAtual===mesHoje?hojeLeg:''}</div></div>
    </div>`;
    renderBarsMes('trend-tma',  tmaDados,  30, '#3DAF72','#D44B4B', false);
    renderBarsMes('trend-csat', csatDados, 95, '#F5C300','#D44B4B', true);
  } else {
    block.innerHTML = `<div class="two-col">
      <div class="card"><div class="slabel">Evolução semanal · TMA (min)</div><div class="trend-sem" id="trend-tma"></div>
        <div class="trend-legend"><div class="tleg"><div class="tleg-dot" style="background:#3DAF72"></div>Dentro da meta</div><div class="tleg"><div class="tleg-dot" style="background:#D44B4B"></div>Acima (30 min)</div>${hojeLeg}</div></div>
      <div class="card"><div class="slabel">Evolução semanal · CSAT (%)</div><div class="trend-sem" id="trend-csat"></div>
        <div class="trend-legend"><div class="tleg"><div class="tleg-dot" style="background:#F5C300"></div>Dentro da meta</div><div class="tleg"><div class="tleg-dot" style="background:#D44B4B"></div>Abaixo (95%)</div>${hojeLeg}</div></div>
    </div>`;
    renderBarsSem('trend-tma',  tmaDados,  30, '#3DAF72','#D44B4B', false);
    renderBarsSem('trend-csat', csatDados, 95, '#F5C300','#D44B4B', true);
  }

  if (tipoAtivo === 'ppf') {
    document.getElementById('evolucao-block').innerHTML = '';
  }
}

function calcTrend(dados) {
  const pontos = dados.map((d,i) => d.val!==null ? {x:i,y:d.val} : null).filter(Boolean);
  if (pontos.length < 2) return null;
  const n=pontos.length, sx=pontos.reduce((a,p)=>a+p.x,0), sy=pontos.reduce((a,p)=>a+p.y,0);
  const sxy=pontos.reduce((a,p)=>a+p.x*p.y,0), sxx=pontos.reduce((a,p)=>a+p.x*p.x,0);
  const denom = n*sxx - sx*sx;
  if (!denom) return null;
  const m2=(n*sxy-sx*sy)/denom, b2=(sy-m2*sx)/n;
  return x => m2*x + b2;
}

function drawTrendLine(cont, dados, min, rng, barH) {
  const trendFn = calcTrend(dados);
  if (!trendFn) return;
  setTimeout(() => {
    const cols = cont.querySelectorAll('.t-col, .tm-col, .pc-col');
    if (!cols.length) return;
    const cW = cols[0].offsetWidth || 20;
    const cH = cont.offsetHeight  || barH + 20;
    const pts = dados.map((item,i) => {
      const yVal = trendFn(i);
      const xPx  = i * cW + cW / 2;
      const yPx  = cH - Math.round(((yVal - min) / (rng||1)) * barH) - 14;
      return xPx + ',' + Math.max(2, Math.min(cH - 2, yPx));
    });
    const svg  = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'rgba(255,255,255,0.4)');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4 3');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    cont.style.position = 'relative';
    cont.appendChild(svg);
  }, 60);
}

function renderBarsSem(id, dados, meta, cOk, cBad, inv) {
  const vals = dados.filter(d=>d.val!==null).map(d=>d.val);
  if (!vals.length) { document.getElementById(id).innerHTML='<div style="font-size:11px;color:var(--text-hint);padding:1rem 0">Sem dados esta semana.</div>'; return; }
  const max=inv?100:Math.max(...vals)*1.12, min=inv?Math.min(...vals)*.97:0, rng=(max-min)||1;
  const cont = document.getElementById(id);
  cont.innerHTML = dados.map(item => {
    if (item.val===null) return '<div class="t-col"><div class="t-bar" style="height:4px;background:var(--surface2)"></div><div class="t-day">' + item.dia + '</div></div>';
    const v=item.val, ok=inv?v>=meta:v<=meta, h=Math.round(((v-min)/rng)*58);
    const isH=item.dia===nomeDiaHoje&&mesAtual===mesHoje;
    const cor=isH?'var(--gold)':(ok?cOk:cBad);
    return '<div class="t-col"><span class="t-tooltip">' + v + (inv?' %':' min') + '</span><div class="t-bar" style="height:' + Math.max(h,6) + 'px;background:' + cor + ';' + (isH?'outline:1.5px solid var(--gold-dark);outline-offset:1px':'') + '"></div><div class="t-day ' + (isH?'hoje-lbl':'') + '">' + item.dia + (isH?' ●':'') + '</div></div>';
  }).join('');
  drawTrendLine(cont, dados, min, rng, 58);
}

function renderBarsMes(id, dados, meta, cOk, cBad, inv) {
  const vals = dados.filter(d=>d.val!==null).map(d=>d.val);
  if (!vals.length) { document.getElementById(id).innerHTML='<div style="font-size:11px;color:var(--text-hint);padding:1rem 0">Sem dados este mês.</div>'; return; }
  const max=inv?100:Math.max(...vals)*1.12, min=inv?Math.min(...vals)*.97:0, rng=(max-min)||1;
  const cont = document.getElementById(id);
  cont.innerHTML = dados.map(item => {
    const isH=item.dia===diaHoje&&mesAtual===mesHoje;
    if (item.val===null) return '<div class="tm-col"><div class="tm-bar" style="height:3px;background:transparent"></div><div class="tm-day ' + (isH?'hoje-lbl':'') + '">' + item.dia + '</div></div>';
    const v=item.val, ok=inv?v>=meta:v<=meta, h=Math.round(((v-min)/rng)*62);
    const cor=isH?'var(--gold)':(ok?cOk:cBad);
    return '<div class="tm-col"><span class="tm-tooltip">' + v + (inv?' %':' min') + '</span><div class="tm-bar" style="height:' + Math.max(h,4) + 'px;background:' + cor + ';' + (isH?'outline:1.5px solid var(--gold-dark);outline-offset:1px':'') + '"></div><div class="tm-day ' + (isH?'hoje-lbl':'') + '">' + item.dia + (isH?'●':'') + '</div></div>';
  }).join('');
  drawTrendLine(cont, dados, min, rng, 62);
}

function renderPico(pico) {
  const isMes = periodo==='mes';
  if (!pico.length) { document.getElementById('pico-card').innerHTML='<div class="empty-state">Sem dados de pico.</div>'; return; }
  const picoUnidade = tipoAtivo === 'ppf' ? 'tickets' : 'atendimentos';
  if (isMes) {
    const maxV=Math.max(...pico.map(d=>d.v),1), pk=pico.reduce((a,b)=>b.v>a.v?b:a,pico[0]);
    document.getElementById('pico-card').innerHTML=`<div class="pico-inner">
      <div class="pico-hl"><div class="pico-day">Dia ${pk.n}</div><div class="pico-sub">maior pico</div></div>
      <div class="pico-bars" id="pico-bars-mes">${pico.map(d=>{const isH=d.n===diaHoje&&mesAtual===mesHoje;const h=d.v>0?Math.round((d.v/maxV)*46):3;const cor=isH?'var(--gold)':d.n===pk.n?'rgba(245,195,0,.65)':d.v===0?'rgba(255,255,255,.05)':'rgba(245,195,0,.2)';return `<div class="pc-col"><span class="t-tooltip">${d.v} ${picoUnidade}</span><div class="pc-bar" style="height:${Math.max(h,3)}px;background:${cor};${isH?'outline:1.5px solid var(--gold-dark);outline-offset:1px':''}"></div><div class="pc-lbl" style="${isH||d.n===pk.n?'color:var(--gold)':''}">${d.n}</div></div>`;}).join('')}</div>
      <div class="pico-info"><strong>${pk.v} ${picoUnidade}</strong> no dia ${pk.n} — maior do mês.</div></div>`;
    const picoBarsMesCont = document.getElementById('pico-bars-mes');
    if (picoBarsMesCont) {
      const dadosTrendMes = pico.map(d => ({val: d.v > 0 ? d.v : null}));
      const minM=0, maxM=maxV*1.1, rngM=(maxM-minM)||1;
      drawTrendLine(picoBarsMesCont, dadosTrendMes, minM, rngM, 46);
    }
  } else {
    const maxV=Math.max(...pico.map(d=>d.v),1), pk=pico.reduce((a,b)=>b.v>a.v?b:a,pico[0]);
    const picoCard = document.getElementById('pico-card');
    const nomesDia = {Sex:'Sexta',Seg:'Segunda',Ter:'Terça',Qua:'Quarta',Qui:'Quinta'};
    picoCard.innerHTML='<div class="pico-inner"><div class="pico-hl"><div class="pico-day">' + pk.d + '</div><div class="pico-sub">maior pico</div></div><div class="pico-bars" id="pico-bars-sem">' + pico.map(d=>{const isH=d.d===nomeDiaHoje&&mesAtual===mesHoje;const h=maxV>0?Math.round((d.v/maxV)*46):0;const cor=isH?'var(--gold)':d.d===pk.d&&pk.v>0?'rgba(245,195,0,.65)':'rgba(245,195,0,.2)';return '<div class="pc-col"><span class="t-tooltip">'+d.v+' '+picoUnidade+'</span><div class="pc-bar" style="height:'+Math.max(h,4)+'px;background:'+cor+';'+(isH?'outline:1.5px solid var(--gold-dark);outline-offset:1px':'')+'"></div><div class="pc-lbl" style="'+(isH?'color:var(--gold);font-weight:700':'')+'">'+d.d+(isH?' ●':'')+'</div></div>';}).join('') + '</div><div class="pico-info"><strong>' + pk.v + ' ' + picoUnidade + '</strong> na ' + (nomesDia[pk.d]||pk.d) + '-feira — maior da semana.</div></div>';
    const picoBarsCont = document.getElementById('pico-bars-sem');
    if (picoBarsCont) {
      const dadosTrend = pico.map(d => ({val: d.v > 0 ? d.v : null}));
      const minP=0, maxP=maxV*1.1, rngP=(maxP-minP)||1;
      drawTrendLine(picoBarsCont, dadosTrend, minP, rngP, 46);
    }
  }
}

function renderAudit(a) {
  if (slugAtivo === 'gabrielle') {
    document.getElementById('audit-block').innerHTML = '';
    document.getElementById('audit-block').style.display = 'none';
    return;
  }
  document.getElementById('audit-block').style.display = '';
  const pct=a.pct||0, s=stAudit(pct);
  const cor=s==='ok'?'#3DAF72':s==='warn'?'#D49628':'#D44B4B';
  const corT=s==='ok'?'var(--ok-text)':s==='warn'?'var(--warn-text)':'var(--bad-text)';
  const corB=s==='ok'?'var(--ok-bg)':s==='warn'?'var(--warn-bg)':'var(--bad-bg)';
  const r=36, circ=2*Math.PI*r, dash=Math.round((pct/100)*circ*10)/10;
  const temContagem = a.ok !== null && a.ok !== undefined && a.total !== null && a.total !== undefined;
  const statsHtml = temContagem
    ? `<div class="audit-stat"><strong>${a.ok||0}</strong> aprovadas</div>
       <div class="audit-stat"><strong>${(a.total||0)-(a.ok||0)}</strong> com ressalva</div>
       <div class="audit-stat"><strong>${a.total||0}</strong> avaliadas</div>
       <div class="audit-stat">Meta: <strong>&gt; 90%</strong></div>`
    : `<div class="audit-stat">Meta: <strong>&gt; 90%</strong></div>`;
  document.getElementById('audit-block').innerHTML=`<div class="audit-inner">
    <div class="audit-circle"><svg width="84" height="84" viewBox="0 0 84 84" style="transform:rotate(-90deg)">
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="${cor}" stroke-width="7" stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/></svg>
      <div class="audit-label"><div class="audit-pct" style="color:${cor}">${pct}%</div><div class="audit-slbl">score</div></div>
    </div>
    <div class="audit-info">
      <div class="audit-title">Auditoria de processos <span class="badge" style="background:${corB};color:${corT}">${s==='ok'?'dentro da meta':s==='warn'?'atenção':'abaixo da meta'}</span></div>
      <div class="audit-track"><div class="audit-fill" style="width:${pct}%;background:${cor}"></div></div>
      <div class="audit-stats">
        ${statsHtml}
      </div>
    </div></div>`;
}

function renderDetratores(lista) {
  const lbl = periodo==='semana'?'esta semana':'este mês';
  const el = document.getElementById('detrat-block');
  if (!lista.length) { el.innerHTML=`<div class="empty-state"><i class="ti ti-mood-happy" style="font-size:26px;color:var(--ok-text)"></i><br><br>Nenhum insatisfeito ${lbl}. Continue assim!</div>`; return; }
  el.innerHTML=`<div class="detrat-hdr">
    <div style="display:flex;align-items:center;gap:8px"><span class="detrat-badge">${lista.length} insatisfeito${lista.length>1?'s':''}</span><span style="font-size:11px;color:var(--text-hint)">${lbl}</span></div>
    <span style="font-size:11px;color:var(--text-hint)">Clique em Copiar para pegar o ID</span>
  </div>
  <table class="dt-table">
    <thead><tr><th>ID da conversa</th><th>Data</th><th>Feedback</th></tr></thead>
    <tbody>${lista.map((item,i)=>`<tr>
      <td><div class="id-wrap"><span class="id-code">${item.id||'—'}</span>
        <button class="copy-btn" id="cbtn-${i}" onclick="copiarID('${item.id}',${i})"><i class="ti ti-copy" style="font-size:11px"></i> Copiar</button>
      </div></td>
      <td>${item.data||'—'}</td>
      <td><span class="obs-tag" title="${item.obs||''}">${item.obs||'—'}</span></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function copiarID(id, idx) {
  navigator.clipboard.writeText(id).then(()=>{
    const btn=document.getElementById('cbtn-'+idx);
    btn.classList.add('copied'); btn.innerHTML='<i class="ti ti-check" style="font-size:11px"></i> Copiado';
    setTimeout(()=>{btn.classList.remove('copied');btn.innerHTML='<i class="ti ti-copy" style="font-size:11px"></i> Copiar';},2000);
  });
}

function renderEscala(escala, mes, ano) {
  document.getElementById('esc-hdr').innerHTML=['S','T','Q','Q','S','S','D'].map(d=>`<div class="esc-head">${d}</div>`).join('');
  const dowPrimeiro = new Date(ano, mes, 1).getDay();
  const offset = (dowPrimeiro + 6) % 7;
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const bloqueado = new Date().getDay() === 5;
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div></div>';
  (escala||[]).forEach(item => {
    if (item.dia > diasNoMes) return;
    const isH    = mes === mesHoje && ano === anoHoje && item.dia === diaHoje;
    const dow    = new Date(ano, mes, item.dia).getDay();
    const isSab  = dow === 6;
    const podeClicar = isSab && !bloqueado && slugAtivo === usuarioLogado.slug;
    const clique = podeClicar ? `onclick="abrirTroca(${item.dia},${mes},${ano},'${item.status}')" style="cursor:pointer"` : '';
    const trocaBadge = podeClicar ? `<div style="position:absolute;top:3px;right:3px;font-size:8px;color:var(--gold);opacity:0.7"><i class="ti ti-arrows-exchange"></i></div>` : '';
    html += `<div class="day-cell d-${item.status||'F'} ${isH?'d-today':''}" ${clique} style="position:relative">${trocaBadge}<div class="day-n">${item.dia}</div><div class="day-s">${item.status||'F'}</div></div>`;
  });
  document.getElementById('esc-grid').innerHTML = html;
  escalaMes = mes; escalaAno = ano;
  document.getElementById('escala-title').textContent = `Escala de serviço · ${MESES[mes].toUpperCase()} ${ano}`;
  atualizarLabelEscala();
  mostrarBadgePendente();
}

function renderRV(ind) {
  const label = document.getElementById('rv-label');
  const block = document.getElementById('rv-block');
  if (periodo !== 'mes') {
    label.style.display = 'none'; block.style.display = 'none'; return;
  }
  label.style.display = 'block'; block.style.display = 'block';

  if (slugAtivo === 'daniel') { renderRV_Daniel(ind, block); return; }
  if (slugAtivo === 'gabrielle') { renderRV_Gabrielle(ind, block); return; }
  if (tipoAtivo === 'sac') { renderRV_SAC(ind, block); return; }
  block.innerHTML = '<div style="font-size:12px;color:var(--text-hint);padding:1rem">RV não configurada.</div>';
}

// ── RV SAC (Nathalia, Francis, Iasmin) ───────────────────────
// TMA <15→R$150 | 15-30→R$100 | >30→R$0
// CSAT >95%→R$75 | Auditoria >90%→R$50 | TMR Refab <84h→R$50 | Máx R$325
function renderRV_SAC(ind, block) {
  const tma      = ind.tma       || 0;
  const csat     = ind.csat      || 0;
  const tmrRefab = ind.tmr_refab || 0;
  const auditPct = (ind.audit || {}).pct || 0;

  let tmaVal = 0, tmaS = 'bad', tmaLbl = tma > 0 ? tma + ' min' : 'Sem dados';
  if (tma > 0 && tma < 15)       { tmaVal = 150; tmaS = 'ok';   tmaLbl = tma + ' min  (< 15 min)'; }
  else if (tma >= 15 && tma <= 30){ tmaVal = 100; tmaS = 'ok';  tmaLbl = tma + ' min  (15–30 min)'; }
  else if (tma > 30)             { tmaVal = 0;   tmaS = 'bad';  tmaLbl = tma + ' min  (> 30 min)'; }

  let csatVal = 0, csatS = csat >= 95 ? 'ok' : 'bad';
  if (csat >= 95) csatVal = 75;

  let audVal = 0, audS = auditPct >= 90 ? 'ok' : (auditPct > 0 ? 'bad' : 'bad');
  const audLbl = auditPct > 0 ? auditPct + '%' : 'Sem avaliação';
  if (auditPct >= 90) audVal = 50;

  let tmrVal = 0, tmrS = 'bad';
  const tmrLbl = tmrRefab > 0 ? fmtHoras(tmrRefab) : 'Sem dados';
  if (tmrRefab > 0 && tmrRefab <= 84 * 60) { tmrVal = 50; tmrS = 'ok'; }
  else if (tmrRefab > 84 * 60) tmrS = 'bad';

  const total = tmaVal + csatVal + audVal + tmrVal;
  const max   = 325;
  rvRender(block, total, max, MESES[mesAtual], [
    rvItem('TMA',        tmaLbl,                        tmaVal,  tmaS,  'Meta: < 30 min'),
    rvItem('CSAT',       csat + '%',                    csatVal, csatS, 'Meta: ≥ 95%'),
    rvItem('Auditoria',  audLbl,                        audVal,  audS,  'Meta: ≥ 90%'),
    rvItem('TMR Refab.', tmrLbl,                        tmrVal,  tmrS,  'Meta: < 84h'),
  ]);
}

// ── RV Daniel — Auxiliar Adm. ─────────────────────────────────
function renderRV_Daniel(ind, block) {
  const tmrPPF  = ind.tmr_ppf  || 0;
  const tmaLogo = ind.tma_logo || 0;
  const csat    = ind.csat     || 0;

  let pedVal = 0, pedS = 'bad';
  const pedLbl = tmrPPF > 0 ? fmtHoras(tmrPPF) : 'Sem dados';
  if (tmrPPF > 0 && tmrPPF <= 1440) { pedVal = 150; pedS = 'ok'; }
  else if (tmrPPF > 1440) pedS = 'bad';

  let csatVal = 0, csatS = csat >= 95 ? 'ok' : 'bad';
  if (csat >= 95) csatVal = 75;
  const csatLbl = csat > 0 ? csat + '%' : 'Sem dados';

  let logoVal = 0, logoS = 'bad';
  const logoLbl = tmaLogo > 0 ? tmaLogo + ' min' : 'Sem dados';
  if (tmaLogo > 0 && tmaLogo <= 30) { logoVal = 50; logoS = 'ok'; }
  else if (tmaLogo > 30) logoS = 'bad';

  const total = pedVal + csatVal + logoVal;
  const max   = 275;
  rvRender(block, total, max, MESES[mesAtual], [
    rvItem('TMT Ped. Atrasados', pedLbl,  pedVal,  pedS,  'Meta: < 24h'),
    rvItem('CSAT',               csatLbl, csatVal, csatS, 'Meta: ≥ 95%'),
    rvItem('TMA Aprov. Logo',    logoLbl, logoVal, logoS, 'Meta: ≤ 30 min'),
  ]);
}

// ── RV Gabrielle ───────────────────────────────────────────────
function renderRV_Gabrielle(ind, block) {
  const tmrPPF = ind.tmr_ppf || 0;

  let pedVal = 0, pedS = 'bad';
  const pedLbl = tmrPPF > 0 ? fmtHoras(tmrPPF) : 'Sem dados';
  if (tmrPPF > 0 && tmrPPF <= 24 * 60) { pedVal = 150; pedS = 'ok'; }
  else if (tmrPPF > 24 * 60) pedS = 'bad';

  const auditorias    = ind.auditorias || 0;
  const metaAuditoria = ind.meta_auditoria || 120;
  let audVal = 0, audS = 'bad';
  const audLbl = auditorias + ' / ' + metaAuditoria;
  if (auditorias >= metaAuditoria) { audVal = 50; audS = 'ok'; }

  const total = pedVal + audVal;
  const max   = 200;
  rvRender(block, total, max, MESES[mesAtual], [
    rvItem('TMT Ped. Atrasados', pedLbl, pedVal, pedS, 'Meta: < 24h'),
    rvItem('Auditorias',         audLbl, audVal, audS, 'Meta: ' + metaAuditoria + '/mês'),
  ]);
}

function rvRender(block, total, max, mesLabel, itens) {
  const pct      = Math.round((total / max) * 100);
  const totalCor = total >= max ? '#3DAF72' : total >= max * 0.6 ? '#F5C300' : total > 0 ? '#F0BC5A' : '#8A8A84';
  block.innerHTML =
    '<div class="rv-header">' +
      '<div class="rv-title"><i class="ti ti-cash" style="font-size:16px;color:var(--gold)"></i>Remuneração variável · ' + mesLabel + '</div>' +
      '<div class="rv-total"><div class="rv-total-val" style="color:' + totalCor + '">' + (total > 0 ? 'R$ ' + total : '—') + '</div><div class="rv-total-max">de R$ ' + max + ' possíveis</div></div>' +
    '</div>' +
    '<div class="rv-progress"><div class="rv-progress-fill" style="width:' + pct + '%;background:' + totalCor + '"></div></div>' +
    '<div class="rv-items">' + itens.join('') + '</div>';
}

function rvItem(lbl, valStr, prizeNum, status, meta) {
  const prizeStr = prizeNum > 0 ? 'R$ ' + prizeNum : '—';
  return '<div class="rv-item ' + status + '">' +
    '<div class="rv-item-left">' +
      '<div class="rv-item-lbl">' + lbl + '</div>' +
      '<div class="rv-item-val">' + valStr + '<span>' + meta + '</span></div>' +
    '</div>' +
    '<div style="text-align:right">' +
      '<div class="rv-item-prize ' + status + '">' + prizeStr + '</div>' +
      '<div class="rv-item-status ' + status + '">' + (status==='ok'?'✓ atingiu':'✗ não atingiu') + '</div>' +
    '</div>' +
  '</div>';
}

// ── POP-UPS ───────────────────────────────────────────────────
function tocarSom(){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();[880,1046,1318].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type='sine';o.frequency.value=f;const t=ctx.currentTime+i*.13;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.15,t+.05);g.gain.linearRampToValueAtTime(0,t+.2);o.start(t);o.stop(t+.22);});}catch(e){}}
function fecharPopup(id){const el=document.getElementById(id);el.style.opacity='0';el.style.transition='opacity .18s';setTimeout(()=>{el.classList.remove('open');el.style.opacity='';el.style.transition='';},180);}
function abrirAviso(av){document.getElementById('av-titulo').textContent=av.titulo||'';document.getElementById('av-corpo').innerHTML=(av.corpo||'').replace(/\n/g,'<br>');document.getElementById('av-meta').textContent=`De: ${av.de||'Jhonys Santos'} · ${av.data||''}`;document.getElementById('popup-aviso').classList.add('open');setTimeout(tocarSom,200);}
function abrirSugestao(){document.getElementById('sug-form').style.display='block';document.getElementById('sug-ok').style.display='none';document.getElementById('sug-titulo').value='';document.getElementById('sug-texto').value='';document.getElementById('popup-sugestao').classList.add('open');}

async function enviarSugestao() {
  const titulo=document.getElementById('sug-titulo').value.trim();
  const texto=document.getElementById('sug-texto').value.trim();
  if(!titulo||!texto){await hubAlert('Preencha o título e a sugestão antes de enviar.', 'erro');return;}
  try {
    await fetch(`${API_BASE}/sugestao`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ titulo, sugestao: texto }) });
    document.getElementById('sug-nome-ok').textContent=`Obrigado pela contribuição, ${usuarioLogado.nome.split(' ')[0]}.`;
    document.getElementById('sug-form').style.display='none';
    document.getElementById('sug-ok').style.display='block';
  } catch(e) { await hubAlert('Erro ao enviar. Tente novamente.', 'erro'); }
}

// ── FILTROS ───────────────────────────────────────────────────
function mostrarAtualizando() {
  document.getElementById('dash-refresh-bar').classList.add('show');
  document.getElementById('dash-content').classList.add('refreshing');
}
function esconderAtualizando() {
  document.getElementById('dash-refresh-bar').classList.remove('show');
  document.getElementById('dash-content').classList.remove('refreshing');
}

async function atualizarComLoading() {
  mostrarAtualizando();
  try {
    const dados = await fetchDados();
    renderTudo(dados);
  } catch (e) {
    await hubAlert('Erro ao atualizar indicadores: ' + e.message, 'erro');
  } finally {
    esconderAtualizando();
  }
}

async function setPeriodo(p, btn) {
  periodo = p;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const wrap = document.getElementById('week-select-wrap');
  if (p === 'semana') {
    wrap.classList.add('show');
    popularSeletorSemanas(mesAtual, anoHoje, semanaIdx);
  } else {
    wrap.classList.remove('show');
  }
  await atualizarComLoading();
}

async function setMes(m) {
  mesAtual = parseInt(m);
  if (periodo === 'semana') {
    popularSeletorSemanas(mesAtual, anoHoje, semanaIdx);
  }
  await atualizarComLoading();
}

async function setSemana(idx) {
  semanaIdx = idx;
  await atualizarComLoading();
}

// ── TROCAS DE ESCALA ─────────────────────────────────────────
let trocasPendentes  = [];
let trocaDiaMeu = null, trocaMesMeu = null, trocaAnoMeu = null;
let consultoresCache = [];
let sabadosAlvoCache = {};

async function abrirTroca(dia, mes, ano, status) {
  const dataSabado = new Date(ano, mes, dia);
  const hojeD = new Date(); hojeD.setHours(0,0,0,0);
  if (dataSabado < hojeD) {
    await hubAlert('Não é possível solicitar troca para um sábado que já passou.', 'erro');
    return;
  }

  trocaDiaMeu = dia; trocaMesMeu = mes; trocaAnoMeu = ano;
  document.getElementById('troca-dia-meu').textContent = `${dia} de ${MESES[mes]} de ${ano} (${status})`;
  document.getElementById('troca-erro').style.display = 'none';
  document.getElementById('troca-dia-alvo').innerHTML = '<option value="">Selecione o consultor primeiro…</option>';

  if (!consultoresCache.length) {
    try {
      const res  = await fetch(`${API_BASE}/consultores`);
      const json = await res.json();
      if (json.erro) { await hubAlert('Erro ao carregar consultores: ' + json.erro, 'erro'); }
      consultoresCache = (json.consultores || []).filter(c => c.slug !== usuarioLogado.slug);
      if (!consultoresCache.length) console.warn('Nenhum consultor retornado pela API', json);
    } catch(e) {
      await hubAlert('Erro ao buscar consultores: ' + e.message, 'erro');
    }
  }
  const sel = document.getElementById('troca-consultor');
  sel.innerHTML = '<option value="">Selecione o consultor…</option>' +
    consultoresCache.map(c => `<option value="${c.slug}">${c.nome}</option>`).join('');

  document.getElementById('modal-troca').classList.add('show');
}

function fecharTroca() {
  document.getElementById('modal-troca').classList.remove('show');
}

async function carregarSabadosAlvo() {
  const slug = document.getElementById('troca-consultor').value;
  if (!slug) return;
  const sel = document.getElementById('troca-dia-alvo');
  sel.innerHTML = '<option value="">Carregando…</option>';

  if (!sabadosAlvoCache[slug]) {
    const url  = `${API_BASE}/sabados-consultor?alvo=${encodeURIComponent(slug)}&mes=${escalaMes}&ano=${escalaAno}`;
    const res  = await fetch(url);
    const json = await res.json();
    sabadosAlvoCache[slug] = (json.sabados || []);
  }

  const sabados = sabadosAlvoCache[slug];
  if (!sabados.length) {
    sel.innerHTML = '<option value="">Nenhum sábado disponível neste mês</option>';
    return;
  }
  const mesesAbrev = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  sel.innerHTML = '<option value="">Selecione o sábado…</option>' +
    sabados.map(s => `<option value="${s.dia}|${escalaMes}|${escalaAno}">${s.dia} ${mesesAbrev[escalaMes]} ${escalaAno} (${s.status})</option>`).join('');
}

async function enviarTroca() {
  const erroEl  = document.getElementById('troca-erro');
  const slug    = document.getElementById('troca-consultor').value;
  const alvoVal = document.getElementById('troca-dia-alvo').value;
  erroEl.style.display = 'none';

  if (!slug)    { erroEl.textContent = 'Selecione o consultor.'; erroEl.style.display = 'block'; return; }
  if (!alvoVal) { erroEl.textContent = 'Selecione o sábado do colega.'; erroEl.style.display = 'block'; return; }

  const [dia_alvo, mes_alvo, ano_alvo] = alvoVal.split('|').map(Number);

  const payload = {
    dia_solicitante: trocaDiaMeu, mes_solicitante: trocaMesMeu, ano_solicitante: trocaAnoMeu,
    consultor_alvo: slug,
    dia_alvo, mes_alvo, ano_alvo,
  };
  try {
    const res  = await fetch(`${API_BASE}/solicitar-troca`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!json.ok) { erroEl.textContent = json.erro || 'Erro ao solicitar.'; erroEl.style.display = 'block'; return; }
    fecharTroca();
    await hubAlert('Solicitação enviada! O colega receberá a notificação no painel.', 'sucesso');
  } catch(e) {
    erroEl.textContent = e.message; erroEl.style.display = 'block';
  }
}

function mostrarBadgePendente() {
  const count = document.getElementById('trocas-count');
  const btn   = document.getElementById('btn-trocas');
  if (!count || !btn) return;
  const n = (trocasPendentes || []).length;
  count.textContent = n;
  btn.style.opacity = n > 0 ? '1' : '0.5';
  btn.style.boxShadow = n > 0 ? '0 0 0 2px rgba(245,195,0,0.3)' : 'none';
}

async function abrirTrocasPendentes() {
  const lista = document.getElementById('troca-pendente-lista');
  lista.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:16px">Verificando solicitações…</div>';
  document.getElementById('modal-troca-pendente').classList.add('show');

  try {
    const url  = `${API_BASE}/escala?slug=${encodeURIComponent(usuarioLogado.slug)}&mes=${escalaMes}&ano=${escalaAno}`;
    const res  = await fetch(url);
    const json = await res.json();
    trocasPendentes = json.trocas_pendentes || [];
    mostrarBadgePendente();
  } catch(e) { /* usa cache local se a busca falhar */ }

  if (!consultoresCache.length) {
    try {
      const res2  = await fetch(`${API_BASE}/consultores`);
      const json2 = await res2.json();
      consultoresCache = json2.consultores || [];
    } catch(e) {}
  }

  const mesesAbrev = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const nomes = {};
  consultoresCache.forEach(c => nomes[c.slug] = c.nome);

  if (!trocasPendentes.length) {
    lista.innerHTML = '<div style="font-size:12px;color:var(--text-hint);text-align:center;padding:24px"><i class="ti ti-checks" style="font-size:24px;display:block;margin-bottom:8px;color:var(--ok-text)"></i>Nenhuma troca pendente no momento.</div>';
    return;
  }

  lista.innerHTML = trocasPendentes.map(t => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--rs);padding:14px">
      <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:var(--text)">
        <i class="ti ti-arrows-exchange" style="color:var(--gold);margin-right:4px"></i>
        ${nomes[t.solicitante] || t.solicitante} quer trocar com você
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
        Sábado deles: <strong style="color:var(--text)">${t.dia_sol} ${mesesAbrev[t.mes_sol]} ${t.ano_sol}</strong> →
        Seu sábado: <strong style="color:var(--text)">${t.dia_alvo} ${mesesAbrev[t.mes_alvo]} ${t.ano_alvo}</strong>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="responderTroca('${t.id}', true)" style="flex:1;background:var(--gold);color:#1A1A18;border:none;border-radius:var(--rs);padding:8px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer">✓ Aceitar</button>
        <button onclick="responderTroca('${t.id}', false)" style="background:none;border:1px solid rgba(212,75,75,0.4);border-radius:var(--rs);padding:8px 14px;font-size:12px;color:var(--bad-text);font-family:inherit;cursor:pointer">✕ Recusar</button>
      </div>
    </div>
  `).join('');
}

function fecharTrocaPendente() {
  document.getElementById('modal-troca-pendente').classList.remove('show');
}

async function responderTroca(idTroca, aceitar) {
  const payload = { id_troca: idTroca, aceitar };
  try {
    const res  = await fetch(`${API_BASE}/responder-troca`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!json.ok) { await hubAlert('Erro: ' + (json.erro||'tente novamente'), 'erro'); return; }
    trocasPendentes = trocasPendentes.filter(t => t.id !== idTroca);
    fecharTrocaPendente();
    if (aceitar) {
      await hubAlert('Troca aceita! As escalas foram atualizadas.', 'sucesso');
      await navEscala(0);
    } else {
      await hubAlert('Troca recusada.', 'info');
    }
  } catch(e) { await hubAlert('Erro: ' + e.message, 'erro'); }
}

// ── HISTÓRICO DE AUDITORIAS ───────────────────────────────────
let auditoriasCache = { nota: null, itens: [] };

function atualizarBotaoAuditorias(hist) {
  auditoriasCache = hist || { nota: null, itens: [] };
  const btn = document.getElementById('btn-ver-auditorias');
  if (!btn) return;
  if (slugAtivo === 'gabrielle') { btn.style.display = 'none'; return; }
  btn.style.display = 'flex';
  const count = (auditoriasCache.itens || []).length;
  btn.innerHTML = count > 0
    ? `<i class="ti ti-clipboard-list" style="font-size:12px"></i> Ver auditorias <span style="background:var(--gold);color:#1A1A18;border-radius:10px;padding:1px 6px;font-size:10px">${count}</span>`
    : `<i class="ti ti-clipboard-list" style="font-size:12px"></i> Ver auditorias`;
}

function abrirHistoricoAuditoria() {
  const hist  = auditoriasCache;
  const nota  = hist.nota;
  const itens = hist.itens || [];
  const metaOk = nota !== null && nota >= 90;
  const periodoLabel = periodo === 'semana'
    ? (document.getElementById('week-select')?.options[document.getElementById('week-select')?.selectedIndex]?.text || 'Semana atual')
    : (MESES[mesAtual] || '') + ' ' + anoHoje;
  document.getElementById('audit-modal-periodo').textContent = periodoLabel;
  const notaEl = document.getElementById('audit-modal-nota');
  if (nota !== null && nota !== undefined) {
    notaEl.textContent = nota + '%';
    notaEl.style.color = metaOk ? 'var(--ok-text)' : 'var(--bad-text)';
  } else { notaEl.textContent = '—'; notaEl.style.color = 'var(--text-muted)'; }
  const lista = document.getElementById('audit-modal-lista');
  if (!itens.length) {
    lista.innerHTML = '<div style="font-size:12px;color:var(--text-hint);text-align:center;padding:28px 16px"><i class="ti ti-mood-smile" style="font-size:28px;display:block;margin-bottom:10px;color:var(--gold)"></i><strong style="color:var(--text);font-size:13px">Nenhuma auditoria por aqui ainda!</strong><br><span style="color:var(--text-muted)">Parece que esse período tá de folga das auditorias. 😄<br>Volta mais tarde quando tiver registros novos!</span></div>';
  } else {
    lista.innerHTML = itens.map((a, i) => {
      const temId = a.id && a.id.trim(), temObs = a.obs && a.obs.trim();
      const score = a.score !== null && a.score !== undefined ? a.score : null;
      const scoreColor = score !== null ? (score >= 90 ? 'var(--ok-text)' : 'var(--bad-text)') : 'var(--text-muted)';
      const scoreStr  = score !== null ? score + '%' : '—';
      return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--rs);padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${temObs?'8px':'0'}">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
            <span style="font-size:11px;color:var(--text-muted);font-weight:600;flex-shrink:0">#${i+1}</span>
            ${temId ? `<span style="font-size:12px;font-weight:700;color:var(--text);font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.id)}</span>` : `<span style="font-size:11px;color:var(--text-hint);font-style:italic">Sem ID</span>`}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">
            <span style="font-size:14px;font-weight:800;color:${scoreColor}">${scoreStr}</span>
            ${temId ? `<button onclick="copiarTexto('${esc(a.id).replace(/'/g,"\\'")}', this)" title="Copiar ID" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer;color:var(--text-muted);font-size:11px;font-family:inherit;display:flex;align-items:center;gap:4px"><i class="ti ti-copy" style="font-size:11px"></i> Copiar</button>` : ''}
          </div>
        </div>
        ${temObs ? `<div style="font-size:11px;color:var(--text-muted);line-height:1.5;padding-top:8px;border-top:1px solid var(--border)">${esc(a.obs)}</div>` : ''}
      </div>`;
    }).join('');
  }
  document.getElementById('modal-auditorias').classList.add('show');
}

function fecharHistoricoAuditoria() {
  document.getElementById('modal-auditorias').classList.remove('show');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function copiarTexto(texto, btn) {
  navigator.clipboard.writeText(texto).then(() => {
    const i = btn.querySelector('i');
    if (i) { i.className = 'ti ti-check'; setTimeout(() => i.className = 'ti ti-copy', 1500); }
  });
}

// ── ACESSOS (cofre de senhas pessoal) ─────────────────────────
let acessosCache = null;

function abrirAcessos() {
  document.getElementById('modal-acessos').classList.add('show');
  cancelarFormAcesso();
  carregarAcessos();
}
function fecharAcessos() {
  document.getElementById('modal-acessos').classList.remove('show');
  cancelarFormAcesso();
}

async function carregarAcessos() {
  const lista = document.getElementById('acessos-lista');
  lista.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px">Carregando…</div>';
  try {
    const res  = await fetch(`${API_BASE}/acessos`);
    const json = await res.json();
    if (json.erro) throw new Error(json.erro);
    acessosCache = json.acessos || [];
    renderAcessos();
  } catch(e) {
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
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--rs);padding:12px 14px;display:flex;align-items:flex-start;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.ferramenta)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><i class="ti ti-at" style="font-size:10px;margin-right:3px"></i>${esc(a.login)}</div>
        <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px">
          <i class="ti ti-lock" style="font-size:10px"></i>
          <span id="pw-val-${i}" style="letter-spacing:.08em">••••••••</span>
          <button onclick="togglePwItem(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:12px;padding:0;line-height:1" title="Revelar senha"><i class="ti ti-eye" id="pw-ico-${i}"></i></button>
          <button onclick="copiarTexto('${esc(a.senha).replace(/'/g,"\\'")}', this)" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:12px;padding:0;line-height:1" title="Copiar senha"><i class="ti ti-copy"></i></button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button onclick="editarAcesso(${i})" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text-muted);cursor:pointer;font-family:inherit;white-space:nowrap"><i class="ti ti-pencil" style="font-size:11px"></i></button>
        <button onclick="excluirAcesso(${i})" style="background:none;border:1px solid rgba(212,75,75,0.3);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--bad-text);cursor:pointer;font-family:inherit"><i class="ti ti-trash" style="font-size:11px"></i></button>
      </div>
    </div>
  `).join('');
}

function togglePwItem(i) {
  const span = document.getElementById(`pw-val-${i}`);
  const ico  = document.getElementById(`pw-ico-${i}`);
  if (!span || !acessosCache[i]) return;
  const oculto = span.textContent === '••••••••';
  span.textContent = oculto ? acessosCache[i].senha : '••••••••';
  if (ico) ico.className = oculto ? 'ti ti-eye-off' : 'ti ti-eye';
}

function mostrarFormAcesso(titulo) {
  document.getElementById('form-acesso').style.display = 'block';
  document.getElementById('btn-add-acesso').style.display = 'none';
  document.getElementById('form-acesso-titulo').textContent = titulo || 'Novo acesso';
  document.getElementById('acesso-erro').style.display = 'none';
  setTimeout(() => document.getElementById('acesso-ferramenta').focus(), 50);
}

function cancelarFormAcesso() {
  document.getElementById('form-acesso').style.display = 'none';
  document.getElementById('btn-add-acesso').style.display = 'flex';
  document.getElementById('acesso-edit-idx').value = '';
  document.getElementById('acesso-ferramenta').value = '';
  document.getElementById('acesso-login').value = '';
  document.getElementById('acesso-senha').value = '';
  document.getElementById('acesso-erro').style.display = 'none';
}

function togglePwAcesso(btn) {
  const inp = document.getElementById('acesso-senha');
  const oculto = inp.type === 'password';
  inp.type = oculto ? 'text' : 'password';
  btn.querySelector('i').className = oculto ? 'ti ti-eye-off' : 'ti ti-eye';
}

function editarAcesso(i) {
  const a = acessosCache[i];
  if (!a) return;
  document.getElementById('acesso-edit-idx').value = i;
  document.getElementById('acesso-ferramenta').value = a.ferramenta;
  document.getElementById('acesso-login').value = a.login;
  document.getElementById('acesso-senha').value = a.senha;
  mostrarFormAcesso('Editar acesso');
}

async function salvarAcesso() {
  const ferramenta = document.getElementById('acesso-ferramenta').value.trim();
  const login      = document.getElementById('acesso-login').value.trim();
  const senha      = document.getElementById('acesso-senha').value;
  const editIdx    = document.getElementById('acesso-edit-idx').value;
  const erroEl     = document.getElementById('acesso-erro');

  if (!ferramenta) { erroEl.textContent = 'Informe o nome da ferramenta.'; erroEl.style.display = 'block'; return; }
  if (!login)      { erroEl.textContent = 'Informe o login.'; erroEl.style.display = 'block'; return; }
  if (!senha)      { erroEl.textContent = 'Informe a senha.'; erroEl.style.display = 'block'; return; }
  erroEl.style.display = 'none';

  const payload = {
    ferramenta, login, senha,
    editIdx: editIdx !== '' ? parseInt(editIdx) : null,
  };

  try {
    const res  = await fetch(`${API_BASE}/acessos/salvar`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.erro || 'Erro ao salvar');
    acessosCache = json.acessos || [];
    cancelarFormAcesso();
    renderAcessos();
  } catch(e) {
    erroEl.textContent = e.message;
    erroEl.style.display = 'block';
  }
}

async function excluirAcesso(i) {
  const confirmado = await hubConfirm(`Excluir o acesso "${acessosCache[i]?.ferramenta}"?`, { textoConfirmar: 'Excluir' });
  if (!confirmado) return;
  const payload = { editIdx: i };
  try {
    const res  = await fetch(`${API_BASE}/acessos/excluir`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.erro || 'Erro ao excluir');
    acessosCache = json.acessos || [];
    renderAcessos();
  } catch(e) {
    await hubAlert('Erro: ' + e.message, 'erro');
  }
}

// ── Init ───────────────────────────────────────────────────────
// O tema claro/escuro agora é aplicado globalmente por /js/ui.js (mesma
// chave 'sb_tema'), antes deste script rodar — nada a fazer aqui.
popularSeletorSemanas(mesAtual, anoHoje);
document.getElementById('week-select-wrap').classList.add('show');

// Gestor sem indicadores próprios (cargo administrativo, sem KPIs mapeados
// na planilha) já abre vendo um colaborador de verdade, em vez de uma tela
// "em construção" vazia — ele não tem indicadores pessoais pra ver mesmo.
if (indicadoresPendentesAtivo && usuarioLogado.role === 'gestor' && outrosColaboradores.length) {
  const primeiro = outrosColaboradores.find((c) => !c.indicadoresPendentes) || outrosColaboradores[0];
  const select = document.getElementById('ver-como-select');
  if (select) select.value = primeiro.slug;
  trocarVerComo(primeiro.slug);
} else {
  carregarPainel();
}
