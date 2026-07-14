// Ranking SAC (painel de TV) — portado de "index (1).html" original.
// Única mudança real: os 4 CSVs do Google Sheets agora são buscados via
// /ranking-sac/api/csv/:chave (proxy do hub, servidor→Google) em vez de
// fetch direto do navegador — isso elimina a necessidade do fallback
// corsproxy.io que existia no original. Toda a lógica de parsing, cálculo
// de score e animação de corrida é preservada literalmente.

const API_BASE = '/ranking-sac/api';

// ── RELÓGIO
setInterval(()=>{ document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR'); },1000);
document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR');

// ── CONFIG
const REFRESH_INTERVAL=300000;

const SHEET_KEYS = { atd: 'atd', rsl: 'rsl', kpis: 'kpi', agenda: 'agenda' };

// ── UTILS
function timeStrToMin(s){
  if(!s||s==='-'||s==='—') return 9999;
  const p=String(s).replace(/"/g,'').split(':');
  return parseInt(p[0]||0)*60+parseInt(p[1]||0);
}
function safeNum(v){
  if(v==null||v===''||v==='-'||v==='—') return null;
  const n=parseFloat(String(v).replace(/"/g,'').replace(',','.'));
  return isNaN(n)?null:n;
}
function cleanStr(v){
  if(v==null) return '';
  return String(v).replace(/^"|"$/g,'').trim();
}
function parseTime(v){
  if(v==null||v===''||v==='-'||v==='—') return null;
  const s=cleanStr(v); if(!s||s==='-'||s==='—') return null;
  const p=s.split(':'); if(p.length<2) return null;
  const h=parseInt(p[0])||0,m=parseInt(p[1])||0;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
function avgTime(arr){
  const v=arr.filter(x=>x!=null&&timeStrToMin(x)<9000).map(x=>timeStrToMin(x));
  if(!v.length) return null;
  const a=v.reduce((a,b)=>a+b,0)/v.length;
  if(isNaN(a)) return null;
  return String(Math.floor(a/60)).padStart(2,'0')+':'+String(Math.round(a%60)).padStart(2,'0');
}
function sumQtd(arr){const v=arr.filter(x=>x!=null).map(x=>parseFloat(x));return v.length?v.reduce((a,b)=>a+b,0):null;}
function avgPct(arr){const v=arr.filter(x=>x!=null).map(x=>parseFloat(x));return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null;}

// ── CSV PARSER
function parseCSV(text){
  return text.split('\n').map(line=>{
    const cols=[];let cur='',inQ=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){inQ=!inQ;}
      else if(c===','&&!inQ){cols.push(cur.trim());cur='';}
      else{cur+=c;}
    }
    cols.push(cur.trim());
    return cols;
  });
}

// ── DATA MODEL
let DATA={
  kpis:{tma:'--',csat:'--',nps:'--',refab:'--',ppf:'--'},
  atd:{
    consultores:['Iasmin','Francis','Nathalia'],dias:['Sex','Seg','Ter','Qua','Qui'],
    data:{
      'Iasmin': {tma:[null,null,null,null,null],csat:[null,null,null,null,null],contatos:[null,null,null,null,null],pesquisas:[null,null,null,null,null],tmr:[null,null,null,null,null],score:null},
      'Francis':{tma:[null,null,null,null,null],csat:[null,null,null,null,null],contatos:[null,null,null,null,null],pesquisas:[null,null,null,null,null],tmr:[null,null,null,null,null],score:null},
      'Nathalia':{tma:[null,null,null,null,null],csat:[null,null,null,null,null],contatos:[null,null,null,null,null],pesquisas:[null,null,null,null,null],tmr:[null,null,null,null,null],score:null},
    }
  },
  rsl:{
    consultores:['Gabrielle','Daniel'],dias:['Sex','Seg','Ter','Qua','Qui'],
    data:{
      'Gabrielle':{tmrppf:[null,null,null,null,null],tickets:[null,null,null,null,null],score:null},
      'Daniel':   {tmrppf:[null,null,null,null,null],tickets:[null,null,null,null,null],score:null},
    }
  },
  agenda:[],foco:''
};

// ── PARSE SHEETS
function parseATD(rows){
  ['Iasmin','Francis','Nathalia'].forEach(nome=>{
    const hi=rows.findIndex(r=>cleanStr(r[0])===nome);
    if(hi===-1) return;
    const base=hi+2;
    const keys=['tma','csat','contatos','pesquisas','tmr','score'];
    const isT=[true,false,false,false,true,false];
    keys.forEach((key,ki)=>{
      const row=rows[base+ki]; if(!row) return;
      if(key==='score'){
        DATA.atd.data[nome].score=safeNum(cleanStr(row[7]));
      } else {
        DATA.atd.data[nome][key]=[1,2,3,4,5].map(ci=>{
          const v=cleanStr(row[ci]);
          if(!v||v==='-'||v==='—') return null;
          return isT[ki]?parseTime(v):safeNum(v);
        });
        if(key==='csat'){
          DATA.atd.data[nome].csat=DATA.atd.data[nome].csat.map(v=>{
            if(v==null) return null;
            return v<=1?parseFloat((v*100).toFixed(2)):v;
          });
        }
      }
    });
  });
}

function parseRSL(rows){
  ['Gabrielle','Daniel'].forEach(nome=>{
    const hi=rows.findIndex(r=>cleanStr(r[0])===nome);
    if(hi===-1) return;
    const base=hi+2;
    const keys=['tmrppf','tickets','score'];
    const isT=[true,false,false];
    keys.forEach((key,ki)=>{
      const row=rows[base+ki]; if(!row) return;
      if(key==='score'){
        DATA.rsl.data[nome].score=safeNum(cleanStr(row[7]));
      } else {
        DATA.rsl.data[nome][key]=[1,2,3,4,5].map(ci=>{
          const v=cleanStr(row[ci]);
          if(!v||v==='-'||v==='—') return null;
          return isT[ki]?parseTime(v):safeNum(v);
        });
      }
    });
  });
}

function parseKPIs(rows){
  rows.forEach(row=>{
    const label=cleanStr(row[0]).toLowerCase();
    const val=cleanStr(row[1]);
    if(label.includes('tma da equipe'))  DATA.kpis.tma  =parseTime(val)||val;
    if(label.includes('csat da equipe')) DATA.kpis.csat =safeNum(val);
    if(label.includes('nps da equipe'))  DATA.kpis.nps  =safeNum(val);
    if(label.includes('refabrica'))      DATA.kpis.refab=parseTime(val)||val;
    if(label.includes('ppf')&&label.includes('tmr')&&!label.includes('refabri')) DATA.kpis.ppf=parseTime(val)||val;
  });
}

function parseAgenda(rows){
  DATA.agenda=[];DATA.foco='';
  const fi=rows.findIndex(r=>cleanStr(r[0]).toUpperCase().includes('FOCO DA SEMANA'));
  if(fi!==-1&&rows[fi+1]) DATA.foco=cleanStr(rows[fi+1][0]);
  const di=rows.findIndex(r=>cleanStr(r[0]).toLowerCase()==='dia');
  if(di!==-1){
    for(let i=di+1;i<rows.length;i++){
      const r=rows[i];
      if(!r||!cleanStr(r[0])||!cleanStr(r[2])) continue;
      DATA.agenda.push({dia:cleanStr(r[0]),hora:cleanStr(r[1]),desc:cleanStr(r[2]),tipo:cleanStr(r[3])||'Outro'});
    }
  }
}

// ── FETCH
async function fetchSheet(key){
  const chave = SHEET_KEYS[key];
  const resp = await fetch(`${API_BASE}/csv/${chave}`, {cache:'no-store'});
  if(!resp.ok) throw new Error(`HTTP ${resp.status} for ${key}`);
  return parseCSV(await resp.text());
}

async function loadAllData(){
  const ind=document.getElementById('refresh-ind');
  ind.textContent='● atualizando...';ind.classList.add('loading');
  try{
    const [rowsATD,rowsRSL,rowsKPI,rowsAG]=await Promise.all([
      fetchSheet('atd'),fetchSheet('rsl'),
      fetchSheet('kpis'),fetchSheet('agenda'),
    ]);
    parseATD(rowsATD);parseRSL(rowsRSL);parseKPIs(rowsKPI);parseAgenda(rowsAG);
    renderAll();
    if(window._restartRaces) window._restartRaces();
    window.dispatchEvent(new Event('dataLoaded'));
    ind.textContent=`● atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
    ind.classList.remove('loading');
  }catch(err){
    ind.textContent='● erro ao carregar';ind.classList.remove('loading');
    console.error(err);
  }
}

// ── RENDERS
function renderKPIs(k){
  const fmt=v=>v||'--';
  document.getElementById('val-tma').innerHTML=fmt(k.tma)+'<span class="kpi-unit">h</span>';
  document.getElementById('val-csat').innerHTML=fmt(k.csat)+'<span class="kpi-unit">%</span>';
  document.getElementById('val-nps').textContent=fmt(k.nps);
  document.getElementById('val-refab').innerHTML=fmt(k.refab)+'<span class="kpi-unit">h</span>';
  document.getElementById('val-ppf').innerHTML=fmt(k.ppf)+'<span class="kpi-unit">h</span>';
  function setCard(id,good){const el=document.getElementById(id);el.classList.remove('status-ok','status-danger');el.classList.add(good?'status-ok':'status-danger');const v=el.querySelector('.kpi-value');v.classList.toggle('ok',good);v.classList.toggle('danger',!good);}
  setCard('card-tma', timeStrToMin(k.tma)<=30);
  setCard('card-csat',parseFloat(k.csat)>=95);
  setCard('card-nps', parseFloat(k.nps)>=80);
  setCard('card-refab',timeStrToMin(k.refab)<=84*60);
  setCard('card-ppf', timeStrToMin(k.ppf)<=24*60);
}

function renderTrack(cid,consultores,data){
  const sorted=[...consultores].sort((a,b)=>(data[b]?.score||0)-(data[a]?.score||0));
  const mx=Math.max(...sorted.map(c=>data[c]?.score||0),1);
  const cls=['p1','p2','p3'];
  document.getElementById(cid).innerHTML=sorted.map((cod,i)=>{
    const sc=data[cod]?.score||0,pct=Math.max(8,Math.round(sc/mx*100));
    return`<div class="track-row"><div class="track-name" style="font-size:11px">${cod}</div><div class="track-bar-bg"><div class="track-bar-fill ${cls[i]||'p3'}" style="width:${pct}%">${pct>18?'#'+(i+1):''}</div></div><div class="track-score-val">${sc||'—'}</div></div>`;
  }).join('');
}

function tabelaHTML(consultores,diasArr,rdefs,dataObj){
  return consultores.map(cod=>{
    const d=dataObj[cod]||{};
    let h=`<div style="margin-bottom:6px"><div class="cons-label">${cod}</div><table class="dias-table"><thead><tr><th class="th-l">Ind.</th>`;
    diasArr.forEach(di=>{h+=`<th>${di}</th>`;});
    h+=`<th>Tot/Med</th><th>Score</th></tr></thead><tbody>`;
    rdefs.forEach(r=>{
      h+=`<tr><td class="td-ind">${r.label}</td>`;
      if(r.tipo==='score'){
        for(let i=0;i<5;i++) h+='<td class="empty">—</td>';
        h+=`<td class="empty">—</td><td class="td-score">${d.score!=null?d.score:'—'}</td>`;
      } else {
        const vals=(d[r.key]||[null,null,null,null,null]);
        vals.forEach(v=>{if(v==null){h+='<td class="empty">—</td>';return;}let cls='';if(r.metaFn)cls=r.metaFn(r.tipo==='tempo'?v:parseFloat(v))?'ok':'warn';h+=`<td class="${cls}">${v}</td>`;});
        for(let i=vals.length;i<5;i++) h+='<td class="empty">—</td>';
        let res='—';
        if(r.tipo==='tempo') res=avgTime(vals)||'—';
        else if(r.tipo==='soma'){const s=sumQtd(vals);res=s!=null?s:'—';}
        else if(r.tipo==='pct'){const a=avgPct(vals);res=a!=null?a+'%':'—';}
        h+=`<td class="td-media">${res}</td><td class="empty">—</td>`;
      }
      h+='</tr>';
    });
    h+='</tbody></table></div>';return h;
  }).join('');
}

function renderTabelaATD(data){
  document.getElementById('atd-tabela').innerHTML=tabelaHTML(DATA.atd.consultores,DATA.atd.dias,[
    {label:'TMA',key:'tma',tipo:'tempo',metaFn:v=>timeStrToMin(v)<=30},
    {label:'CSAT',key:'csat',tipo:'pct',metaFn:v=>v>=95},
    {label:'Cont.',key:'contatos',tipo:'soma'},
    {label:'Pesq.',key:'pesquisas',tipo:'soma'},
    {label:'TMR',key:'tmr',tipo:'tempo'},
    {label:'Score',key:'score',tipo:'score'},
  ],data);
}

function renderTabelaRSL(data){
  document.getElementById('rsl-tabela').innerHTML=tabelaHTML(DATA.rsl.consultores,DATA.rsl.dias,[
    {label:'TMR PPF+1',key:'tmrppf',tipo:'tempo',metaFn:v=>timeStrToMin(v)<=24*60},
    {label:'Resolvidos',key:'tickets',tipo:'soma'},
    {label:'Score',key:'score',tipo:'score'},
  ],data);
}

function renderAgenda(eventos){
  const diasOrdem=['Segunda','Terça','Quarta','Quinta','Sexta'];
  const hojeMap={'segunda-feira':'Segunda','terça-feira':'Terça','quarta-feira':'Quarta','quinta-feira':'Quinta','sexta-feira':'Sexta'};
  const diaHoje=hojeMap[new Date().toLocaleDateString('pt-BR',{weekday:'long'}).toLowerCase()]||'';
  const porDia={}; diasOrdem.forEach(d=>{porDia[d]=[];});
  eventos.forEach(ev=>{if(porDia[ev.dia])porDia[ev.dia].push(ev);});
  diasOrdem.forEach(d=>{porDia[d].sort((a,b)=>a.hora.localeCompare(b.hora));});
  const tipoClass={'1:1':'tipo-11','Reunião':'tipo-reuniao','Evento':'tipo-evento','Escala':'tipo-escala','Outro':'tipo-outro'};
  document.getElementById('agenda-grid').innerHTML=diasOrdem.map(dia=>{
    const isHoje=dia===diaHoje;
    let h=`<div class="agenda-dia-col"><div class="agenda-dia-header${isHoje?' hoje':''}">${dia}${isHoje?' <span style="color:#F5B800;font-size:8px">HOJE</span>':''}</div>`;
    const evs=porDia[dia];
    if(!evs.length){h+=`<div class="dia-vazio">livre</div>`;}
    else{evs.forEach(ev=>{const tc=tipoClass[ev.tipo]||'tipo-outro';h+=`<div class="evento-card ${tc}"><div class="evento-hora">${ev.hora}</div><div class="evento-desc">${ev.desc}</div></div>`;});}
    h+='</div>';return h;
  }).join('');
}

function renderFoco(texto){
  const el=document.getElementById('foco-texto');
  if(texto&&texto.trim()){el.textContent=texto.trim();el.classList.remove('placeholder');}
  else{el.textContent='Aguardando dados...';el.classList.add('placeholder');}
}

function renderAll(){
  renderKPIs(DATA.kpis);
  renderTrack('atd-track',DATA.atd.consultores,DATA.atd.data);
  renderTabelaATD(DATA.atd.data);
  renderTrack('rsl-track',DATA.rsl.consultores,DATA.rsl.data);
  renderTabelaRSL(DATA.rsl.data);
  renderAgenda(DATA.agenda);
  renderFoco(DATA.foco);
}

// ── AUTO-SCROLL INDICADORES
(function(){
  const panels=['atd-tabela','rsl-tabela'];
  panels.forEach(id=>{
    const container=document.getElementById(id)?.closest('.race-body');
    if(!container) return;
    let paused=false,resetting=false;
    container.addEventListener('mouseenter',()=>paused=true);
    container.addEventListener('mouseleave',()=>paused=false);
    setInterval(()=>{
      if(paused||resetting) return;
      const maxScroll=container.scrollHeight-container.clientHeight;
      if(maxScroll<=0) return;
      if(container.scrollTop>=maxScroll-1){
        resetting=true;
        setTimeout(()=>{
          container.style.scrollBehavior='auto';container.scrollTop=0;
          setTimeout(()=>{container.style.scrollBehavior='smooth';setTimeout(()=>{resetting=false;},10000);},80);
        },1800);
      } else {container.scrollTop+=1;}
    },30);
  });
})();

// ── ANIMAÇÃO DE CORRIDA ──────────────────────────────────────
(function(){
  const RACE_DURATION  = 60000; // 60s de corrida
  const RESULT_DURATION= 60000; // 60s exibindo resultado
  const SPRINT_START   = 0.78;  // sprint nos últimos 22%
  const DRAMA_END      = 0.95;  // resultado real só se confirma aqui

  const races = [
    { trackId:'atd-track', consultores:()=>DATA.atd.consultores, dataFn:()=>DATA.atd.data },
    { trackId:'rsl-track', consultores:()=>DATA.rsl.consultores, dataFn:()=>DATA.rsl.data },
  ];

  let _raceTimers = [];
  let _raceAFs = [];
  const _setTimeout = (fn, ms) => { const t = setTimeout(fn, ms); _raceTimers.push(t); return t; };
  const _rAF = (fn) => { const id = requestAnimationFrame(fn); _raceAFs.push(id); return id; };

  const rankCls = ['p1','p2','p3'];
  const medals  = ['🥇','🥈','🥉'];

  function wave(seed, t, freq, amp) {
    return Math.sin(seed * 13.7 + t * freq * Math.PI * 2) * amp;
  }

  function runRace(race) {
    const consultores = race.consultores();
    const data        = race.dataFn();
    const n           = consultores.length;
    const container   = document.getElementById(race.trackId);
    if (!container) return;

    const finalScores = {};
    consultores.forEach(c => {
      const s = data[c]?.score;
      finalScores[c] = (s != null && !isNaN(parseFloat(s))) ? parseFloat(s) : 0;
    });

    const scores = consultores.map(c => finalScores[c]);
    const mx = Math.max(...scores, 1);

    const finalPct = {};
    consultores.forEach(c => {
      finalPct[c] = finalScores[c] > 0
        ? Math.max(8, Math.round((finalScores[c] / mx) * 100))
        : 8;
    });

    const sortedFinal = [...consultores].sort((a,b) => finalScores[b] - finalScores[a]);
    const finalRank   = {};
    sortedFinal.forEach((c,i) => { finalRank[c] = i; });

    const seeds = {};
    consultores.forEach((c,i) => { seeds[c] = (i+1) * 4.3; });

    function progress(c, t) {
      const rank    = finalRank[c];
      const isWinner= rank === 0;
      const fp      = finalPct[c] / 100;

      let base;

      if (t < SPRINT_START) {
        const headStart = isWinner ? 0 : (rank / n) * 0.08;
        const slowDown  = isWinner ? 0.82 : 1.0;
        const eased     = t * t * (3 - 2*t);
        base = eased * slowDown * fp + headStart * eased;

        const w1 = wave(seeds[c],       t, 1.1, 0.030);
        const w2 = wave(seeds[c]+7,     t, 2.3, 0.018);
        const w3 = wave(seeds[c]+13,    t, 0.7, 0.022);
        base += (w1 + w2 + w3) * (1 - t * 0.6);

      } else if (t < DRAMA_END) {
        const sp   = (t - SPRINT_START) / (DRAMA_END - SPRINT_START);
        const easeS= sp * sp * (3 - 2*sp);

        const atSprint = progress(c, SPRINT_START - 0.001);
        const dramaTarget = isWinner ? fp * 0.90 : fp * (0.72 + rank * 0.06);
        base = atSprint + (dramaTarget - atSprint) * easeS;

        base += wave(seeds[c]+3, t, 4.0, 0.008) * (1 - sp);

      } else {
        const ep    = (t - DRAMA_END) / (1 - DRAMA_END);
        const easeE = ep * ep * (3 - 2*ep);
        const atDrama = progress(c, DRAMA_END - 0.001);
        base = atDrama + (fp - atDrama) * easeE;
      }

      return Math.max(0.02, Math.min(1, base));
    }

    const startTime = performance.now();

    function tick(now) {
      const t = Math.min((now - startTime) / RACE_DURATION, 1);

      const curPct = {};
      consultores.forEach(c => { curPct[c] = progress(c, t) * 100; });

      const finished = t >= 1;

      const curSorted = finished
        ? [...sortedFinal]
        : [...consultores].sort((a,b) => curPct[b] - curPct[a]);

      container.innerHTML = curSorted.map((cod, i) => {
        const pct   = finished ? finalPct[cod].toFixed(1) : curPct[cod].toFixed(1);
        const sc    = finished ? (finalScores[cod] > 0 ? finalScores[cod] : '—') : '';
        const medal = finished ? (medals[i] || '') : '';
        const label = parseFloat(pct) > 16 ? (finished ? medal : `#${i+1}`) : '';
        return `<div class="track-row">
          <div class="track-name" style="font-size:11px">${cod}</div>
          <div class="track-bar-bg">
            <div class="track-bar-fill ${rankCls[i]||'p3'}" style="width:${pct}%;transition:width 0.08s linear;">${label}</div>
          </div>
          <div class="track-score-val">${sc}</div>
        </div>`;
      }).join('');

      if (t < 1) {
        _rAF(tick);
      } else {
        _setTimeout(() => runRace(race), RESULT_DURATION);
      }
    }

    container.innerHTML = consultores.map(cod => `
      <div class="track-row">
        <div class="track-name" style="font-size:11px">${cod}</div>
        <div class="track-bar-bg"><div class="track-bar-fill p2" style="width:2%;transition:none;"></div></div>
        <div class="track-score-val"></div>
      </div>`).join('');

    _setTimeout(() => _rAF(tick), 2000);
  }

  window._restartRaces = () => {
    _raceTimers.forEach(t => clearTimeout(t));
    _raceTimers = [];
    _raceAFs.forEach(id => cancelAnimationFrame(id));
    _raceAFs = [];
    races.forEach(r => runRace(r));
  };

  setTimeout(() => { races.forEach(r => runRace(r)); }, 600);
})();

// ALERTA MANIFESTO
(function(){
  var ALERT_BEFORE_MIN = 5;
  var ALERT_DURATION   = 30;
  var alertShown = {};

  var mensagens = [
    "Hoje e seu dia de Manifesto — bora agir com tudo! ✅ 🚀",
    "Chegou a sua vez de brilhar! Manifesto hoje — foco e energia! 🔥",
    "O time conta com voce hoje. Manifesto — vamos juntos! 💥",
    "E hora do Manifesto! Mostra o que voce vale! ⚡ 🏆",
    "Hoje voce representa o time. Vai com forca total! 💪 ✅",
  ];

  function checkManifesto() {
    var now = new Date();
    var diaSemana = now.toLocaleDateString('pt-BR', {weekday:'long'}).toLowerCase();
    var diaMapFull = {'segunda-feira':'Segunda','terça-feira':'Terça','quarta-feira':'Quarta','quinta-feira':'Quinta','sexta-feira':'Sexta'};
    var diaHoje = diaMapFull[diaSemana] || '';
    if(!diaHoje) return;

    DATA.agenda.forEach(function(ev) {
      if(ev.tipo !== 'Escala') return;
      if(ev.dia !== diaHoje) return;
      var parts = ev.hora.split(':');
      var h = parseInt(parts[0])||0, m = parseInt(parts[1])||0;
      var evTime = new Date(now); evTime.setHours(h,m,0,0);
      var alertTime = new Date(evTime.getTime() - ALERT_BEFORE_MIN*60000);
      var diffMs = alertTime - now;
      var key = ev.dia+'-'+ev.hora+'-'+ev.desc;
      if(diffMs >= 0 && diffMs <= 60000 && !alertShown[key]) {
        alertShown[key] = true;
        var nome = ev.desc.replace(/manifesto/i,'').replace(/[-–]/,'').trim();
        showAlert(nome, ev.hora);
      }
    });
  }

  function showAlert(nome, horario) {
    var msg = mensagens[Math.floor(Math.random()*mensagens.length)];
    document.getElementById('m-nome').textContent = nome;
    document.getElementById('m-msg').textContent = msg;
    document.getElementById('m-horario').textContent = 'Manifesto as ' + horario;
    document.getElementById('m-bar').style.width = '100%';
    var overlay = document.getElementById('manifesto-overlay');
    overlay.classList.add('show');
    var audio = document.getElementById('manifesto-audio');
    if(audio){ audio.currentTime=0; audio.volume=0.8; audio.play().catch(function(){}); }
    var remaining = ALERT_DURATION;
    document.getElementById('m-countdown').textContent = 'fechando em '+remaining+'s';
    var timer = setInterval(function(){
      remaining--;
      document.getElementById('m-countdown').textContent = 'fechando em '+remaining+'s';
      document.getElementById('m-bar').style.width = ((remaining/ALERT_DURATION)*100)+'%';
      if(remaining<=0){ clearInterval(timer); overlay.classList.remove('show');
        var audio=document.getElementById('manifesto-audio'); if(audio){audio.pause();audio.currentTime=0;} }
    },1000);
    overlay.onclick = function(){
      clearInterval(timer); overlay.classList.remove('show');
      var audio=document.getElementById('manifesto-audio'); if(audio){audio.pause();audio.currentTime=0;}
    };
  }

  setInterval(checkManifesto, 30000);
  window.addEventListener('dataLoaded', checkManifesto);

  window.showAlert = showAlert;

  document.addEventListener('keydown', function(e){
    if(e.key==='t'||e.key==='T'){
      var nomes = ['Iasmin','Francis','Nathalia','Gabrielle','Daniel'];
      var nome = nomes[Math.floor(Math.random()*nomes.length)];
      showAlert(nome, '17:45');
    }
  });
})();

// ── INIT
loadAllData();
setInterval(loadAllData, REFRESH_INTERVAL);
