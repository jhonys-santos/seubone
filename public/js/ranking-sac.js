// Ranking SAC — só as corridas (Time Atendimento + Time Resolução).
// KPIs/Agenda/Foco/relógio migraram pra Home (hub-home.js). O alerta de Manifesto
// agora é global (public/js/manifesto-alerta.js, carregado pelo menu lateral).

const API_BASE = '/ranking-sac/api';
const REFRESH_INTERVAL = 300000;
const SHEET_KEYS = { atd: 'atd' };

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
  const v=arr.filter(x=>x!=null).map(x=>timeStrToMin(x));
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
        // A planilha traz os pontos de cada indicador na coluna "Score" (col 7)
        (DATA.atd.data[nome].scoreInd=DATA.atd.data[nome].scoreInd||{})[key]=safeNum(cleanStr(row[7]));
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

// ── FETCH
async function fetchSheet(key){
  const chave = SHEET_KEYS[key];
  const resp = await fetch(`${API_BASE}/csv/${chave}`, {cache:'no-store'});
  if(!resp.ok) throw new Error(`HTTP ${resp.status} for ${key}`);
  return parseCSV(await resp.text());
}

// Time Resolução não vem mais de planilha manual — TMR PPF+1 e Resolvidos
// são calculados no servidor direto dos tickets reais.
// rslOffset: quantas semanas voltar no filtro (0 = semana atual).
let rslOffset=0;
async function fetchResolucao(offset){
  const resp = await fetch(`${API_BASE}/resolucao?semana=${offset||0}`, {cache:'no-store'});
  if(!resp.ok) throw new Error(`HTTP ${resp.status} for resolucao`);
  const json = await resp.json();
  if(!json.ok) throw new Error(json.error||'Falha ao calcular Time Resolução');
  return json;
}

function updateRslWeekNav(periodo){
  const label=document.getElementById('rsl-week-label');
  const nextBtn=document.getElementById('rsl-week-next');
  if(label) label.textContent = periodo ? `${periodo.inicio} → ${periodo.fim}` : '—';
  if(nextBtn) nextBtn.disabled = rslOffset<=0;
}

async function loadAllData(){
  const ind=document.getElementById('refresh-ind');
  ind.textContent='● atualizando...';ind.classList.add('loading');
  try{
    const [rowsATD,resolucao]=await Promise.all([
      fetchSheet('atd'),fetchResolucao(rslOffset),
    ]);
    parseATD(rowsATD);
    DATA.rsl.consultores=resolucao.consultores;
    DATA.rsl.dias=resolucao.dias;
    DATA.rsl.data=resolucao.data;
    updateRslWeekNav(resolucao.periodo);
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

// Troca de semana só re-busca o Time Resolução (ATD/agenda ficam como
// estão) — usado pelos botões ‹ › do filtro de semana.
async function loadResolucaoOnly(){
  const ind=document.getElementById('refresh-ind');
  ind.textContent='● atualizando...';ind.classList.add('loading');
  try{
    const resolucao=await fetchResolucao(rslOffset);
    DATA.rsl.consultores=resolucao.consultores;
    DATA.rsl.dias=resolucao.dias;
    DATA.rsl.data=resolucao.data;
    updateRslWeekNav(resolucao.periodo);
    renderTrack('rsl-track',DATA.rsl.consultores,DATA.rsl.data);
    renderTabelaRSL(DATA.rsl.data);
    if(window._restartRaces) window._restartRaces();
    ind.textContent=`● atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
    ind.classList.remove('loading');
  }catch(err){
    ind.textContent='● erro ao carregar';ind.classList.remove('loading');
    console.error(err);
  }
}

// ── RENDERS
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
        const pts=d.scoreInd&&d.scoreInd[r.key];
        h+=`<td class="td-media">${res}</td>${pts!=null?`<td class="td-score-ind">${pts.toFixed(1)}</td>`:'<td class="empty">—</td>'}`;
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
    {label:'TMR Erro Envio',key:'tmree',tipo:'tempo',metaFn:v=>timeStrToMin(v)<=24*60},
    {label:'Resolvidos',key:'tickets',tipo:'soma'},
    {label:'Score',key:'score',tipo:'score'},
  ],data);
}

function renderAll(){
  renderTrack('atd-track',DATA.atd.consultores,DATA.atd.data);
  renderTabelaATD(DATA.atd.data);
  renderTrack('rsl-track',DATA.rsl.consultores,DATA.rsl.data);
  renderTabelaRSL(DATA.rsl.data);
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

// ── FILTRO DE SEMANA (Time Resolução)
document.getElementById('rsl-week-prev')?.addEventListener('click', ()=>{
  rslOffset++;
  loadResolucaoOnly();
});
document.getElementById('rsl-week-next')?.addEventListener('click', ()=>{
  if(rslOffset<=0) return;
  rslOffset--;
  loadResolucaoOnly();
});

// ── INIT
loadAllData();
setInterval(loadAllData, REFRESH_INTERVAL);
