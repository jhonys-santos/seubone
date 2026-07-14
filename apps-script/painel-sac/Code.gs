// ATENÇÃO: este arquivo é só uma cópia de referência (pra você comparar/reaplicar
// mudanças). O código que realmente roda vive dentro do editor do Apps Script,
// na própria planilha. NUNCA preencha os dois valores abaixo com os reais aqui
// — deixe só no Apps Script (ambiente do Google, fora deste repositório) e no
// .env do hub (que já é ignorado pelo Git). Se este arquivo for versionado/
// compartilhado, os valores reais nunca devem aparecer nele.
const SHEET_ID = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

// Precisa ser IDÊNTICO ao APPS_SCRIPT_SHARED_SECRET no .env do hub.
const SEGREDO_HUB = 'PREENCHA_APENAS_NO_APPS_SCRIPT_REAL';

function doGet(e) {
  const p = e.parameter;
  const action = p.action || 'dados';
  let resp = {};
  try {
    if (action === 'login') {
      resp = login(p.usuario, p.senha);
    } else if (action === 'dados') {
      const u = validarUsuario(p.usuario, p.senha || '', p.segredo || '');
      if (!u) { resp = { erro: 'Nao autorizado' }; }
      else {
        const mes    = parseInt(p.mes !== undefined ? p.mes : new Date().getMonth());
        const ano    = parseInt(p.ano || new Date().getFullYear());
        const semIni = p.sem_ini || null;
        const semFim = p.sem_fim || null;
        resp = {
          indicadores:        buscarIndicadores(p.usuario, p.periodo || 'semana', mes, ano, semIni, semFim),
          escala:             buscarEscala(p.usuario, mes, ano),
          agenda:             buscarAgenda(p.usuario),
          aviso:              buscarAviso(p.usuario),
          trocas_pendentes:   listarTrocasPendentes(p.usuario),
          auditorias_historico: buscarHistoricoAuditoria(p.usuario, p.periodo || 'semana', mes, ano, semIni, semFim),
        };
      }
    } else if (action === 'acessos') {
      const u = validarUsuario(p.usuario, p.senha || '', p.segredo || '');
      if (!u) { resp = { erro: 'Nao autorizado' }; }
      else { resp = { acessos: listarAcessos(p.usuario) }; }
    } else if (action === 'escala') {
      const u = validarUsuario(p.usuario, p.senha || '', p.segredo || '');
      if (!u) { resp = { erro: 'Nao autorizado' }; }
      else {
        const mes = parseInt(p.mes);
        const ano = parseInt(p.ano);
        resp = {
          escala:          buscarEscala(p.usuario, mes, ano),
          trocas_pendentes: listarTrocasPendentes(p.usuario),
          sabados:          listarSabados(p.usuario, mes, ano),
        };
      }
    } else if (action === 'consultores') {
      const u = validarUsuario(p.usuario, p.senha || '', p.segredo || '');
      if (!u) { resp = { erro: 'Nao autorizado' }; }
      else { resp = { consultores: listarConsultores(p.usuario) }; }
    } else if (action === 'sabadosConsultor') {
      const u = validarUsuario(p.usuario, p.senha || '', p.segredo || '');
      if (!u) { resp = { erro: 'Nao autorizado' }; }
      else {
        const mes = parseInt(p.mes);
        const ano = parseInt(p.ano);
        resp = { sabados: listarSabados(p.alvo, mes, ano) };
      }
    }
  } catch(err) {
    resp = { erro: err.message };
  }
  return out(resp);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'sugestao') {
      const ss  = SpreadsheetApp.openById(SHEET_ID);
      const aba = ss.getSheetByName('Sugestoes');
      if (!aba) throw new Error('Aba Sugestoes nao encontrada');
      aba.appendRow([
        Utilities.formatDate(new Date(), 'America/Recife', 'dd/MM/yyyy HH:mm'),
        body.consultor || '',
        body.titulo    || '',
        body.sugestao  || ''
      ]);
      return out({ ok: true });
    }
    if (body.action === 'salvarAcesso' || body.action === 'excluirAcesso') {
      const u = validarUsuario(body.usuario, body.senha_auth || '', body.segredo || '');
      if (!u) return out({ ok: false, erro: 'Nao autorizado' });
      if (body.action === 'salvarAcesso') {
        salvarAcessoSheet(body.usuario, body.ferramenta, body.login, body.senha, body.editIdx);
      } else {
        excluirAcessoSheet(body.usuario, body.editIdx);
      }
      return out({ ok: true, acessos: listarAcessos(body.usuario) });
    }
    if (body.action === 'solicitarTroca') {
      const u = validarUsuario(body.usuario, body.senha_auth || '', body.segredo || '');
      if (!u) return out({ ok: false, erro: 'Nao autorizado' });
      return out(solicitarTroca(body.usuario, body.dia_solicitante, body.mes_solicitante, body.ano_solicitante, body.consultor_alvo, body.dia_alvo, body.mes_alvo, body.ano_alvo));
    }
    if (body.action === 'responderTroca') {
      const u = validarUsuario(body.usuario, body.senha_auth || '', body.segredo || '');
      if (!u) return out({ ok: false, erro: 'Nao autorizado' });
      return out(responderTroca(body.id_troca, body.aceitar, body.usuario));
    }
  } catch(err) {
    return out({ ok: false, erro: err.message });
  }
  return out({ ok: false });
}

function login(usuario, senha) {
  const u = validarUsuario(usuario, senha, '');
  if (!u) return { ok: false };
  return { ok: true, usuario: u };
}

function validarUsuario(slug, senha, segredo) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName('Usuarios');
  if (!aba) throw new Error('Aba Usuarios nao encontrada');
  const rows = aba.getDataRange().getValues().slice(1);
  const confiavel = segredo && segredo === SEGREDO_HUB;
  const row = rows.find(r =>
    String(r[0]).toLowerCase().trim() === slug &&
    (confiavel || String(r[1]).trim() === String(senha).trim())
  );
  if (!row) return null;
  const tipo = ['gabrielle','daniel'].includes(slug) ? 'ppf' : 'sac';
  const masculino = slug === 'daniel';
  return {
    slug:    String(row[0]).toLowerCase().trim(),
    nome:    String(row[2] || row[0]),
    role:    tipo === 'sac' ? 'Consultora de SAC' : (masculino ? 'Consultor de PPF' : 'Consultora de PPF'),
    iniciais: String(row[2] || row[0]).split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(),
    tipo:    tipo,
  };
}

const ABAS_MAP = {
  nathalia:  { atend:'Atendimento_Nathalia', csat:'CSAT_Nathalia',    refab:'Refabricacao_Nathalia', audit:'Auditoria_Nathalia', escala:'Escala_Nathalia' },
  francis:   { atend:'Atendimento_Francis',  csat:'CSAT_Francis',     refab:'Refabricacao_Francis',  audit:'Auditoria_Francis',  escala:'Escala_Francis'  },
  iasmin:    { atend:'Atendimento_Iasmin',   csat:'CSAT_Iasmin',      refab:'Refabricacao_Iasmin',   audit:'Auditoria_Iasmin',   escala:'Escala_Iasmin'   },
  gabrielle: { ppf:'PPF_Gabrielle', audit:'Auditoria_Gabrielle', escala:'Escala_Gabrielle', csat:'CSAT_Gabrielle' },
  daniel:    { ppf:'PPF_Daniel', audit:'Auditoria_Daniel', escala:'Escala_Daniel', csat:'CSAT_Daniel', teste:'Teste_Daniel' },
};

function getRangeSemana() {
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  const dow = hoje.getDay();
  const diasMap = { 5:0, 6:1, 0:2, 1:3, 2:4, 3:5, 4:6 };
  const offset  = diasMap[dow];
  const ini = new Date(hoje);
  ini.setDate(ini.getDate() - offset);
  ini.setHours(0, 0, 0, 0);
  return { inicio: ini, fim: hoje };
}

function filtraPeriodo(val, periodo, mes, ano, rangeIni, rangeFim) {
  const d = parseDate(val);
  if (!d) return false;
  if (periodo === 'semana') {
    const ini = rangeIni || getRangeSemana().inicio;
    const fim = rangeFim || getRangeSemana().fim;
    return d >= ini && d <= fim;
  }
  return d.getFullYear() === ano && d.getMonth() === mes;
}

function parseDateBR(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function parseDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return new Date(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate());
  }
  if (typeof val === 'number') {
    if (val > 40000 && val < 100000) {
      const d = new Date((val - 25569) * 86400000);
      if (isNaN(d.getTime())) return null;
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return null;
  }
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2])-1, parseInt(m2[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toMinutos(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    const BASE_MS = -2209161600000;
    const totalMs = val.getTime() - BASE_MS;
    if (totalMs <= 0) return null;
    return Math.round(totalMs / 60000);
  }
  if (typeof val === 'number') {
    if (val === 0) return null;
    if (val >= 1000) return null;
    return Math.round(val * 24 * 60);
  }
  const str = String(val).trim();
  if (!str || str === '0') return null;
  const partes = str.split(':');
  if (partes.length >= 2) {
    const h   = parseInt(partes[0]) || 0;
    const min = parseInt(partes[1]) || 0;
    const seg = partes[2] ? parseInt(partes[2]) : 0;
    const total = h * 60 + min + seg / 60;
    return total > 0 ? Math.round(total) : null;
  }
  return null;
}

function mediaPonderada(rows, colTma, colQtd) {
  const vals = rows.map(r => toMinutos(r[colTma])).filter(v => v !== null && v > 0);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function mediaSimples(rows, col) {
  const vals = rows.map(r => toMinutos(r[col])).filter(v => v !== null && v > 0);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
}

function somaInt(rows, col) {
  return rows.reduce((a, r) => {
    const v = parseInt(r[col]);
    return a + (isNaN(v) ? 0 : v);
  }, 0);
}

function fmtDateBR(v) {
  const d = parseDate(v);
  if (!d) return '';
  return String(d.getDate()).padStart(2,'0') + '/' +
         String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}

function lookupMediaSemana(rows, colIni, colFim, colMedia, semIniStr, semFimStr) {
  for (const r of rows) {
    const ini = fmtDateBR(r[colIni]);
    const fim = fmtDateBR(r[colFim]);
    if (ini === semIniStr && fim === semFimStr) {
      return toMinutos(r[colMedia]);
    }
  }
  return null;
}

function lookupMediaMes(rows, colIni, colMedia, mes, ano) {
  for (const r of rows) {
    const d = parseDate(r[colIni]);
    if (!d) continue;
    if (d.getMonth() === mes && d.getFullYear() === ano) {
      return toMinutos(r[colMedia]);
    }
  }
  return null;
}

function parsePct(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace('%','').replace(',','.'));
  if (isNaN(n)) return null;
  return n > 1 ? Math.round(n) : Math.round(n * 100);
}

function lookupPctSemana(rows, colIni, colFim, colMedia, semIniStr, semFimStr) {
  for (const r of rows) {
    const ini = fmtDateBR(r[colIni]);
    const fim = fmtDateBR(r[colFim]);
    if (ini === semIniStr && fim === semFimStr) {
      return parsePct(r[colMedia]);
    }
  }
  return null;
}

function lookupPctMes(rows, colIni, colMedia, mes, ano) {
  for (const r of rows) {
    const d = parseDate(r[colIni]);
    if (!d) continue;
    if (d.getMonth() === mes && d.getFullYear() === ano) {
      return parsePct(r[colMedia]);
    }
  }
  return null;
}

function lookupMediaSemanaCSAT(rows, colIni, colFim, colMedia, semIniStr, semFimStr) {
  return lookupPctSemana(rows, colIni, colFim, colMedia, semIniStr, semFimStr);
}

function lookupMediaMesCSAT(rows, colIni, colMedia, mes, ano) {
  return lookupPctMes(rows, colIni, colMedia, mes, ano);
}

function lookupInt(rows, colIni, colFim, colVal, semIniStr, semFimStr) {
  for (const r of rows) {
    const ini = fmtDateBR(r[colIni]);
    const fim = fmtDateBR(r[colFim]);
    if (ini === semIniStr && fim === semFimStr) {
      const v = parseInt(r[colVal]);
      return isNaN(v) ? null : v;
    }
  }
  return null;
}

function lookupIntMes(rows, colIni, colVal, mes, ano) {
  for (const r of rows) {
    const d = parseDate(r[colIni]);
    if (!d) continue;
    if (d.getMonth() === mes && d.getFullYear() === ano) {
      const v = parseInt(r[colVal]);
      return isNaN(v) ? null : v;
    }
  }
  return null;
}

function buscarIndicadores(slug, periodo, mes, ano, semIniStr, semFimStr) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const cfg = ABAS_MAP[slug];
  if (!cfg) throw new Error('Consultor nao mapeado: ' + slug);

  let rangeIni = null, rangeFim = null;
  if (periodo === 'semana' && semIniStr && semFimStr) {
    rangeIni = parseDateBR(semIniStr);
    rangeFim = parseDateBR(semFimStr);
    if (rangeFim) rangeFim.setHours(23, 59, 59, 999);
  }
  const filtro = r => filtraPeriodo(r[0], periodo, mes, ano, rangeIni, rangeFim);

  if (cfg.ppf) {
    const todasPPF   = lerAbaComPeriodos(ss, cfg.ppf);
    const rowsAudit  = lerAba(ss, cfg.audit).filter(filtro);
    const rowsPPFfilt = todasPPF.filter(filtro);

    const pico = calcPico(rowsPPFfilt, periodo, mes, ano, rangeIni, rangeFim, true);

    if (slug === 'gabrielle') {
      const tmr_ppf = periodo === 'semana'
        ? lookupMediaSemana(todasPPF, 5, 6, 7, semIniStr, semFimStr)
        : lookupMediaMes(todasPPF, 9, 11, mes, ano);
      const tickets = periodo === 'semana'
        ? lookupInt(todasPPF, 13, 14, 15, semIniStr, semFimStr)
        : lookupIntMes(todasPPF, 17, 19, mes, ano);

      const todasCsatGab = cfg.csat ? lerAbaComPeriodos(ss, cfg.csat) : [];
      const csat_pct = periodo === 'semana'
        ? lookupPctSemana(todasCsatGab, 7, 8, 9, semIniStr, semFimStr)
        : lookupPctMes(todasCsatGab, 12, 14, mes, ano);
      const pesquisas = periodo === 'semana'
        ? lookupInt(todasCsatGab, 16, 17, 18, semIniStr, semFimStr)
        : lookupIntMes(todasCsatGab, 20, 22, mes, ano);

      const todasAuditGab = lerAbaComPeriodos(ss, cfg.audit);
      const auditoriasSemana = lookupInt(todasAuditGab, 4, 5, 6, semIniStr, semFimStr);
      const auditoriasMes    = lookupIntMes(todasAuditGab, 8, 10, mes, ano);
      const auditorias = periodo === 'semana' ? (auditoriasSemana != null ? auditoriasSemana : 0) : (auditoriasMes != null ? auditoriasMes : 0);
      const metaAuditoria = periodo === 'semana' ? 30 : 30 * 4;

      const csatBrutoGab = todasCsatGab.filter(filtro).filter(r => {
        const cons = String(r[2] || '').toLowerCase().trim();
        return cons.includes('gabrielle');
      });
      const insatisfeitosGab = csatBrutoGab
        .filter(r => String(r[4]).trim() === 'Insatisfeito')
        .map(r => ({ data: fmtData(r[0]), id: String(r[3]||'').trim(), obs: String(r[5]||'').trim() }))
        .filter(r => r.id);

      return {
        tipo: 'ppf',
        tmr_ppf: tmr_ppf,
        tickets: tickets != null ? tickets : 0,
        csat: csat_pct,
        pesquisas: pesquisas != null ? pesquisas : 0,
        auditorias: auditorias,
        meta_auditoria: metaAuditoria,
        insatisfeitos: insatisfeitosGab,
        pico: pico,
      };
    }

    const todasCsat  = cfg.csat  ? lerAbaComPeriodos(ss, cfg.csat)  : [];
    const todasTeste = cfg.teste ? lerAbaComPeriodos(ss, cfg.teste) : [];

    const tmr_ppf = periodo === 'semana'
      ? lookupMediaSemana(todasPPF, 5, 6, 7, semIniStr, semFimStr)
      : lookupMediaMes(todasPPF, 9, 11, mes, ano);

    const tickets = periodo === 'semana'
      ? lookupInt(todasPPF, 13, 14, 15, semIniStr, semFimStr)
      : lookupIntMes(todasPPF, 17, 19, mes, ano);

    const csat_pct = periodo === 'semana'
      ? lookupPctSemana(todasCsat, 7, 8, 9, semIniStr, semFimStr)
      : lookupPctMes(todasCsat, 12, 14, mes, ano);

    const pesquisas = periodo === 'semana'
      ? lookupInt(todasCsat, 16, 17, 18, semIniStr, semFimStr)
      : lookupIntMes(todasCsat, 20, 22, mes, ano);

    const tma_logo = periodo === 'semana'
      ? lookupMediaSemana(todasTeste, 4, 5, 6, semIniStr, semFimStr)
      : lookupMediaMes(todasTeste, 8, 10, mes, ano);

    const testes_aprovados = periodo === 'semana'
      ? lookupInt(todasTeste, 12, 13, 14, semIniStr, semFimStr)
      : lookupIntMes(todasTeste, 16, 18, mes, ano);

    const csatBruto = todasCsat.filter(filtro).filter(r => {
      const cons = String(r[2] || '').toLowerCase().trim();
      return cons.includes('daniel');
    });
    const insatisfeitos = csatBruto
      .filter(r => String(r[4]).trim() === 'Insatisfeito')
      .map(r => ({ data: fmtData(r[0]), id: String(r[3]||'').trim(), obs: String(r[5]||'').trim() }))
      .filter(r => r.id);

    return {
      tipo: 'ppf',
      tmr_ppf: tmr_ppf,
      tma_logo: tma_logo,
      csat:            csat_pct,
      pesquisas:       pesquisas   != null ? pesquisas : 0,
      tickets:         tickets     != null ? tickets : 0,
      testes_aprovados: testes_aprovados != null ? testes_aprovados : null,
      audit:           calcAudit(rowsAudit),
      insatisfeitos: insatisfeitos,
      pico: pico,
    };
  }

  const todasAtend = lerAbaComPeriodos(ss, cfg.atend);
  const todasRefab = lerAbaComPeriodos(ss, cfg.refab);
  const todasCsat  = lerAbaComPeriodos(ss, cfg.csat);
  const todasAudit = lerAbaComPeriodos(ss, cfg.audit);

  let tma, tmr_refab, csat_pct, audit_pct;

  if (periodo === 'semana') {
    tma       = lookupMediaSemana(todasAtend, 5, 6, 7, semIniStr, semFimStr);
    tmr_refab = lookupMediaSemana(todasRefab, 5, 6, 7, semIniStr, semFimStr);
    csat_pct  = lookupPctSemana(todasCsat, 7, 8, 9, semIniStr, semFimStr);
    audit_pct = lookupPctSemana(todasAudit, 3, 4, 5, semIniStr, semFimStr);
  } else {
    tma       = lookupMediaMes(todasAtend, 9, 11, mes, ano);
    tmr_refab = lookupMediaMes(todasRefab, 9, 11, mes, ano);
    csat_pct  = lookupPctMes(todasCsat, 12, 14, mes, ano);
    audit_pct = lookupPctMes(todasAudit, 7, 9, mes, ano);
  }

  let atendimentos, pesquisas, tickets;
  if (periodo === 'semana') {
    atendimentos = lookupInt(todasAtend, 13, 14, 15, semIniStr, semFimStr);
    pesquisas    = lookupInt(todasCsat,  16, 17, 18, semIniStr, semFimStr);
    tickets      = lookupInt(todasRefab, 13, 14, 15, semIniStr, semFimStr);
  } else {
    atendimentos = lookupIntMes(todasAtend, 17, 19, mes, ano);
    pesquisas    = lookupIntMes(todasCsat,  20, 22, mes, ano);
    tickets      = lookupIntMes(todasRefab, 17, 19, mes, ano);
  }

  const rowsAtend = todasAtend.filter(filtro);
  const csatRows  = todasCsat.filter(filtro).filter(r => {
    const cons = String(r[2] || '').toLowerCase().trim();
    return cons.includes(slug);
  });

  const insatisfeitos = csatRows
    .filter(r => String(r[4]).trim() === 'Insatisfeito')
    .map(r => ({ data: fmtData(r[0]), id: String(r[3]||'').trim(), obs: String(r[5]||'').trim() }))
    .filter(r => r.id);

  const audit = audit_pct !== null
    ? { pct: audit_pct, ok: null, total: null }
    : calcAudit(todasAudit.filter(filtro));

  return {
    tipo:         'sac',
    tma: tma,
    csat:         csat_pct,
    tmr_refab: tmr_refab,
    atendimentos: atendimentos != null ? atendimentos : 0,
    pesquisas:    pesquisas    != null ? pesquisas : 0,
    tickets:      tickets      != null ? tickets : 0,
    audit: audit,
    insatisfeitos: insatisfeitos,
    tendencia_tma:  calcTendenciaTMA(rowsAtend, periodo, mes, ano, rangeIni, rangeFim),
    tendencia_csat: calcTendenciaCSAT(csatRows, periodo, mes, ano, rangeIni, rangeFim),
    pico:           calcPico(rowsAtend, periodo, mes, ano, rangeIni, rangeFim),
  };
}

function lerAbaComPeriodos(ss, nome) {
  const aba = ss.getSheetByName(nome);
  if (!aba) return [];
  return aba.getDataRange().getValues().slice(1);
}

function calcTendenciaTMA(rows, periodo, mes, ano, rangeIni, rangeFim) {
  if (periodo === 'semana') {
    const dias   = ['Sex','Sab','Dom','Seg','Ter','Qua','Qui'];
    const dowMap = {5:'Sex',6:'Sab',0:'Dom',1:'Seg',2:'Ter',3:'Qua',4:'Qui'};
    const mapa   = {};
    rows.forEach(r => {
      const d = parseDate(r[0]); if (!d) return;
      const key = dowMap[d.getDay()]; if (!key) return;
      const tma = toMinutos(r[1]);
      if (tma && tma > 0) {
        if (!mapa[key]) mapa[key] = [];
        mapa[key].push(tma);
      }
    });
    return dias.map(d => ({
      dia: d,
      val: mapa[d] && mapa[d].length ? Math.round(mapa[d].reduce((a,b)=>a+b,0)/mapa[d].length) : null
    }));
  } else {
    const dm   = new Date(ano, mes+1, 0).getDate();
    const mapa = {};
    rows.forEach(r => {
      const d = parseDate(r[0]); if (!d || d.getMonth()!==mes || d.getFullYear()!==ano) return;
      const dia = d.getDate();
      const tma = toMinutos(r[1]);
      if (tma && tma > 0) {
        if (!mapa[dia]) mapa[dia] = [];
        mapa[dia].push(tma);
      }
    });
    return Array.from({length:dm},(_,i) => {
      const dia = i+1;
      return { dia: dia, val: mapa[dia] && mapa[dia].length ? Math.round(mapa[dia].reduce((a,b)=>a+b,0)/mapa[dia].length) : null };
    });
  }
}

function calcTendenciaCSAT(rows, periodo, mes, ano, rangeIni, rangeFim) {
  if (periodo === 'semana') {
    const dias   = ['Sex','Sab','Dom','Seg','Ter','Qua','Qui'];
    const dowMap = {5:'Sex',6:'Sab',0:'Dom',1:'Seg',2:'Ter',3:'Qua',4:'Qui'};
    const mapa   = {};
    rows.forEach(r => {
      const d = parseDate(r[0]); if (!d) return;
      const key = dowMap[d.getDay()]; if (!key) return;
      if (!mapa[key]) mapa[key] = {sat:0,tot:0};
      mapa[key].tot++;
      if (String(r[4]).trim()==='Satisfeito') mapa[key].sat++;
    });
    return dias.map(d => ({
      dia: d,
      val: mapa[d] && mapa[d].tot>0 ? Math.round((mapa[d].sat/mapa[d].tot)*100) : null
    }));
  } else {
    const dm   = new Date(ano, mes+1, 0).getDate();
    const mapa = {};
    rows.forEach(r => {
      const d = parseDate(r[0]); if (!d || d.getMonth()!==mes || d.getFullYear()!==ano) return;
      const dia = d.getDate();
      if (!mapa[dia]) mapa[dia] = {sat:0,tot:0};
      mapa[dia].tot++;
      if (String(r[4]).trim()==='Satisfeito') mapa[dia].sat++;
    });
    return Array.from({length:dm},(_,i) => {
      const dia = i+1;
      return { dia: dia, val: mapa[dia]&&mapa[dia].tot>0 ? Math.round((mapa[dia].sat/mapa[dia].tot)*100) : null };
    });
  }
}

function calcPico(rows, periodo, mes, ano, rangeIni, rangeFim, useTickets) {
  const col = 2;
  const diaSemana = v => {
    const d = parseDate(v); if (!d) return null;
    return d.getDay();
  };
  const diaMes = v => {
    const d = parseDate(v); if (!d) return null;
    return { m: d.getMonth(), y: d.getFullYear(), n: d.getDate() };
  };
  if (periodo === 'semana') {
    const dias   = ['Sex','Seg','Ter','Qua','Qui'];
    const dowMap = {5:'Sex',1:'Seg',2:'Ter',3:'Qua',4:'Qui'};
    const mapa   = {};
    dias.forEach(d => mapa[d] = 0);
    rows.forEach(r => {
      const dow = diaSemana(r[0]); if (dow === null) return;
      const key = dowMap[dow]; if (!key) return;
      mapa[key] += parseInt(r[col]) || 0;
    });
    return dias.map(d => ({ d: d, v: mapa[d] }));
  } else {
    const dm   = new Date(ano, mes+1, 0).getDate();
    const mapa = {};
    rows.forEach(r => {
      const info = diaMes(r[0]); if (!info) return;
      if (info.m !== mes || info.y !== ano) return;
      mapa[info.n] = (mapa[info.n]||0) + (parseInt(r[col])||0);
    });
    return Array.from({length:dm},(_,i) => ({ n:i+1, v:mapa[i+1]||0 }));
  }
}

function calcAudit(rows) {
  let ok=0, tot=0;
  rows.forEach(r => {
    const aprov = r[1]; const total = parseInt(r[2])||0;
    if (typeof aprov === 'number') { ok+=aprov; tot+=total||aprov; }
    else {
      const s = String(aprov||'').trim().toUpperCase();
      if (s==='SIM'||s==='APROVADO') ok++;
      tot += total||1;
    }
  });
  return { pct: tot>0 ? Math.round((ok/tot)*100) : 0, ok: ok, total: tot };
}

function buscarEscala(slug, mes, ano) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const cfg = ABAS_MAP[slug];
  if (!cfg || !cfg.escala) return [];
  const aba = ss.getSheetByName(cfg.escala);
  if (!aba) return [];
  const rows = aba.getDataRange().getValues();
  if (rows.length < 2) return [];

  const mesesPT = {
    'jan':0,'fev':1,'mar':2,'abr':3,'mai':4,'jun':5,
    'jul':6,'ago':7,'set':8,'out':9,'nov':10,'dez':11
  };

  function parseMesAno(val) {
    if (!val) return null;
    if (val instanceof Date) {
      return { mes: val.getUTCMonth(), ano: val.getUTCFullYear() };
    }
    if (typeof val === 'number' && val > 40000) {
      const d = new Date((val - 25569) * 86400000);
      return { mes: d.getUTCMonth(), ano: d.getUTCFullYear() };
    }
    const s = String(val).toLowerCase().trim();
    const m = s.match(/([a-z]{3})[^0-9]*(\d{4})/);
    if (!m) return null;
    const mesNum = mesesPT[m[1].slice(0,3)];
    if (mesNum === undefined) return null;
    return { mes: mesNum, ano: parseInt(m[2]) };
  }

  const linha = rows.slice(1).find(r => {
    const parsed = parseMesAno(r[0]);
    if (!parsed) return false;
    return parsed.mes === mes && parsed.ano === ano;
  });

  if (!linha) return [];

  const cabecalho = rows[0];
  const result = [];
  for (let i = 1; i < cabecalho.length; i++) {
    const dia = parseInt(cabecalho[i]);
    if (!dia || dia < 1 || dia > 31) continue;
    const status = String(linha[i] || 'F').trim().toUpperCase();
    result.push({ dia: dia, status: status });
  }
  return result;
}

function buscarAgenda(slug) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName('Agenda'); if (!aba) return [];
  const agora = new Date(); agora.setHours(0,0,0,0);
  return aba.getDataRange().getValues().slice(1)
    .filter(r => { const p=String(r[2]||'').toLowerCase().trim(); return p==='todos'||p===slug; })
    .filter(r => { const d=r[0] instanceof Date?r[0]:new Date(r[0]); return !isNaN(d)&&d>=agora; })
    .sort((a,b)=>new Date(a[0])-new Date(b[0]))
    .slice(0,5)
    .map(r => ({
      data:   Utilities.formatDate(r[0] instanceof Date?r[0]:new Date(r[0]),'America/Recife','dd/MM HH:mm'),
      titulo: String(r[1]||''),
      cor:    r[3]?(String(r[3]).startsWith('#')?String(r[3]):'#'+String(r[3])):'#F5C300'
    }));
}

function buscarAviso(slug) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const aba = ss.getSheetByName('Avisos'); if (!aba) return null;
  const av  = aba.getDataRange().getValues().slice(1).find(r =>
    String(r[2]||'').toLowerCase().trim()==='sim' &&
    ['todos',slug].includes(String(r[3]||'').toLowerCase().trim())
  );
  if (!av) return null;
  return {
    ativo:  true,
    titulo: String(av[0]||''),
    corpo:  String(av[1]||''),
    data:   av[4]?Utilities.formatDate(av[4] instanceof Date?av[4]:new Date(av[4]),'America/Recife','dd/MM/yyyy'):'',
    de:     String(av[5]||'Jhonys Santos'),
  };
}

function lerAba(ss, nome) {
  const aba = ss.getSheetByName(nome); if (!aba) return [];
  return aba.getDataRange().getValues().slice(1)
    .filter(r => r[0]!==''&&r[0]!==null&&r[0]!==undefined);
}

function fmtData(val) {
  try { const d=parseDate(val); if(!d) return ''; return Utilities.formatDate(d,'America/Recife','dd/MM'); } catch(e){return '';}
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getAbaAcessos(ss) {
  let aba = ss.getSheetByName('Acessos');
  if (!aba) {
    aba = ss.insertSheet('Acessos');
    aba.appendRow(['consultor','ferramenta','login','senha']);
  }
  return aba;
}

function listarAcessos(usuario) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaAcessos(ss);
  const rows = aba.getDataRange().getValues().slice(1);
  return rows
    .filter(r => String(r[0]).toLowerCase().trim() === usuario)
    .map(r => ({ ferramenta: String(r[1]), login: String(r[2]), senha: String(r[3]) }));
}

function salvarAcessoSheet(usuario, ferramenta, login, senha, editIdx) {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const aba  = getAbaAcessos(ss);
  const rows = aba.getDataRange().getValues();
  const userRows = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === usuario) userRows.push(i + 1);
  }
  if (editIdx !== null && editIdx !== undefined && editIdx >= 0 && editIdx < userRows.length) {
    const sheetRow = userRows[editIdx];
    aba.getRange(sheetRow, 2, 1, 3).setValues([[ferramenta, login, senha]]);
  } else {
    aba.appendRow([usuario, ferramenta, login, senha]);
  }
}

function excluirAcessoSheet(usuario, editIdx) {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const aba  = getAbaAcessos(ss);
  const rows = aba.getDataRange().getValues();
  const userRows = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === usuario) userRows.push(i + 1);
  }
  if (editIdx >= 0 && editIdx < userRows.length) {
    aba.deleteRow(userRows[editIdx]);
  }
}

function getAbaTrocas(ss) {
  let aba = ss.getSheetByName('Trocas');
  if (!aba) {
    aba = ss.insertSheet('Trocas');
    aba.appendRow(['id','solicitante','dia_sol','mes_sol','ano_sol','alvo','dia_alvo','mes_alvo','ano_alvo','status','data_criacao']);
  }
  return aba;
}

function gerarIdTroca() {
  return 'TR' + new Date().getTime();
}

function listarConsultores(slug) {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const aba  = ss.getSheetByName('Usuarios');
  if (!aba) return [];
  const rows = aba.getDataRange().getValues();
  return rows.slice(1)
    .filter(r => String(r[0]).trim().toLowerCase() !== slug && String(r[0]).trim() !== '')
    .map(r => ({ slug: String(r[0]).trim().toLowerCase(), nome: String(r[2]||r[0]).trim() }));
}

function listarSabados(slug, mes, ano) {
  const escala = buscarEscala(slug, mes, ano);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return escala.filter(d => {
    const data = new Date(ano, mes, d.dia);
    const dow  = data.getDay();
    return dow === 6 && data >= hoje;
  });
}

function listarTrocasPendentes(usuario) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaTrocas(ss);
  const rows = aba.getDataRange().getValues().slice(1);
  return rows
    .filter(r => String(r[5]).trim().toLowerCase() === String(usuario).trim().toLowerCase() && String(r[9]).trim() === 'pendente')
    .map(r => ({
      id:          String(r[0]),
      solicitante: String(r[1]),
      dia_sol:     parseInt(r[2]),
      mes_sol:     parseInt(r[3]),
      ano_sol:     parseInt(r[4]),
      dia_alvo:    parseInt(r[6]),
      mes_alvo:    parseInt(r[7]),
      ano_alvo:    parseInt(r[8]),
    }));
}

function solicitarTroca(solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo) {
  const dowSol  = new Date(ano_sol,  mes_sol,  dia_sol).getDay();
  const dowAlvo = new Date(ano_alvo, mes_alvo, dia_alvo).getDay();
  if (dowSol !== 6 || dowAlvo !== 6) return { ok: false, erro: 'So e permitido trocar sabados.' };

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dataSol  = new Date(ano_sol,  mes_sol,  dia_sol);
  const dataAlvo = new Date(ano_alvo, mes_alvo, dia_alvo);
  if (dataSol < hoje || dataAlvo < hoje) {
    return { ok: false, erro: 'Nao e possivel trocar um sabado que ja passou.' };
  }

  const dowHoje = new Date().getDay();
  if (dowHoje === 5) return { ok: false, erro: 'Nao e possivel solicitar trocas na sexta-feira.' };

  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const aba = getAbaTrocas(ss);

  const rows = aba.getDataRange().getValues().slice(1);
  const jaExiste = rows.some(r =>
    String(r[9]) === 'pendente' &&
    ((String(r[1]) === solicitante && parseInt(r[2]) === dia_sol && parseInt(r[3]) === mes_sol && parseInt(r[4]) === ano_sol) ||
     (String(r[5]) === solicitante && parseInt(r[6]) === dia_sol && parseInt(r[7]) === mes_sol && parseInt(r[8]) === ano_sol))
  );
  if (jaExiste) return { ok: false, erro: 'Ja existe uma solicitacao pendente para este sabado.' };

  const id = gerarIdTroca();
  const agora = new Date();
  const dataStr = Utilities.formatDate(agora, 'America/Recife', 'dd/MM/yyyy HH:mm');
  aba.appendRow([id, solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo, 'pendente', dataStr]);

  registrarLogTrocaUsuarios(solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo, 'Solicitada', dataStr);

  return { ok: true, id: id };
}

function registrarLogTrocaUsuarios(solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo, status, dataStr) {
  try {
    const ss  = SpreadsheetApp.openById(SHEET_ID);
    const aba = ss.getSheetByName('Usuarios');
    if (!aba) return;
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const texto = dataStr + ' - ' + solicitante + ' (' + dia_sol + ' ' + meses[mes_sol] + '/' + ano_sol + ') com ' + alvo + ' (' + dia_alvo + ' ' + meses[mes_alvo] + '/' + ano_alvo + ') [' + status + ']';
    const ultimaLinha = aba.getLastRow();
    aba.getRange(ultimaLinha + 1, 6).setValue(texto);
  } catch(e) { }
}

function responderTroca(idTroca, aceitar, usuario) {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const aba  = getAbaTrocas(ss);
  const rows = aba.getDataRange().getValues();

  let linhaIdx = -1;
  let troca    = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === idTroca) { linhaIdx = i + 1; troca = rows[i]; break; }
  }
  if (!troca) return { ok: false, erro: 'Troca nao encontrada.' };
  if (String(troca[5]).toLowerCase().trim() !== String(usuario).toLowerCase().trim()) return { ok: false, erro: 'Nao autorizado.' };
  if (String(troca[9]).trim() !== 'pendente') return { ok: false, erro: 'Esta troca ja foi respondida.' };

  const novoStatus = aceitar ? 'aceita' : 'recusada';
  aba.getRange(linhaIdx, 10).setValue(novoStatus);

  if (aceitar) {
    const sol      = String(troca[1]);
    const dia_sol  = parseInt(troca[2]), mes_sol = parseInt(troca[3]), ano_sol = parseInt(troca[4]);
    const alvo     = String(troca[5]);
    const dia_alvo = parseInt(troca[6]), mes_alvo = parseInt(troca[7]), ano_alvo = parseInt(troca[8]);

    atualizarDiaEscala(sol, dia_sol,  mes_sol,  ano_sol,  'F');
    atualizarDiaEscala(sol, dia_alvo, mes_alvo, ano_alvo, 'TR');

    atualizarDiaEscala(alvo, dia_alvo, mes_alvo, ano_alvo, 'F');
    atualizarDiaEscala(alvo, dia_sol,  mes_sol,  ano_sol,  'TR');
  }

  const agora = Utilities.formatDate(new Date(), 'America/Recife', 'dd/MM/yyyy HH:mm');
  registrarLogTrocaUsuarios(
    String(troca[1]), parseInt(troca[2]), parseInt(troca[3]), parseInt(troca[4]),
    String(troca[5]), parseInt(troca[6]), parseInt(troca[7]), parseInt(troca[8]),
    aceitar ? 'Aceita' : 'Recusada', agora
  );

  return { ok: true };
}

function atualizarDiaEscala(slug, dia, mes, ano, novoStatus) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const cfg = ABAS_MAP[slug];
  if (!cfg || !cfg.escala) return;
  const aba  = ss.getSheetByName(cfg.escala);
  if (!aba) return;
  const rows = aba.getDataRange().getValues();

  const mesesPT = {'jan':0,'fev':1,'mar':2,'abr':3,'mai':4,'jun':5,'jul':6,'ago':7,'set':8,'out':9,'nov':10,'dez':11};

  let linhaIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    const val = rows[i][0];
    let parsedMes = -1, parsedAno = -1;
    if (val instanceof Date) { parsedMes = val.getUTCMonth(); parsedAno = val.getUTCFullYear(); }
    else {
      const s = String(val).toLowerCase().trim();
      const m = s.match(/([a-z]{3})[^0-9]*(\d{4})/);
      if (m) { parsedMes = mesesPT[m[1]]; if (parsedMes === undefined) parsedMes = -1; parsedAno = parseInt(m[2]); }
    }
    if (parsedMes === mes && parsedAno === ano) { linhaIdx = i + 1; break; }
  }
  if (linhaIdx === -1) return;

  const cab = rows[0];
  for (let j = 1; j < cab.length; j++) {
    if (parseInt(cab[j]) === dia) {
      aba.getRange(linhaIdx, j + 1).setValue(novoStatus);
      return;
    }
  }
}

function buscarHistoricoAuditoria(slug, periodo, mes, ano, semIniStr, semFimStr) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const cfg = ABAS_MAP[slug];
  if (!cfg || !cfg.audit) return { nota: null, itens: [] };
  const aba = ss.getSheetByName(cfg.audit);
  if (!aba) return { nota: null, itens: [] };

  const todos = aba.getDataRange().getValues();
  const COL_INI = 18, COL_FIM = 19, COL_DADO = 20;
  const COL_ID_BRUTO    = 15;
  const COL_SCORE_BRUTO = 17;

  var idParaScore = {};
  for (var r = 0; r < todos.length; r++) {
    var rowD = todos[r];
    var d = parseDate(rowD[0]);
    if (!d) continue;
    var idVal    = String(rowD[COL_ID_BRUTO]    || '').trim();
    var scoreVal = rowD[COL_SCORE_BRUTO];
    if (idVal && scoreVal !== '' && scoreVal !== null && scoreVal !== undefined) {
      var scoreNum = parseFloat(String(scoreVal).replace(',','.'));
      if (!isNaN(scoreNum)) idParaScore[idVal] = scoreNum;
    }
  }

  function encontrarLinha(blocoIni, blocoFim, iniStr, fimStr) {
    for (var i = blocoIni; i <= blocoFim && i < todos.length; i++) {
      if (fmtDateBR(todos[i][COL_INI]) === iniStr && fmtDateBR(todos[i][COL_FIM]) === fimStr) return i;
    }
    return -1;
  }

  function encontrarLinhaMes(blocoIni, blocoFim, mes, ano) {
    for (var i = blocoIni; i <= blocoFim && i < todos.length; i++) {
      var d = parseDate(todos[i][COL_INI]);
      if (d && d.getMonth() === mes && d.getFullYear() === ano) return i;
    }
    return -1;
  }

  function extrairDados(idx) {
    if (idx < 0 || idx >= todos.length) return [];
    var row = todos[idx], result = [];
    for (var c = COL_DADO; c < row.length; c++) {
      var v = String(row[c] || '').trim();
      if (v) result.push(v);
    }
    return result;
  }

  var nota, idxIds, idxComents;
  if (periodo === 'semana' && semIniStr && semFimStr) {
    nota       = lookupPctSemana(todos, 3, 4, 5, semIniStr, semFimStr);
    idxIds     = encontrarLinha(29, 80, semIniStr, semFimStr);
    idxComents = encontrarLinha(83, 134, semIniStr, semFimStr);
  } else {
    nota       = lookupPctMes(todos, 7, 9, mes, ano);
    idxIds     = encontrarLinhaMes(1, 12, mes, ano);
    idxComents = encontrarLinhaMes(15, 26, mes, ano);
  }

  var ids = extrairDados(idxIds), coments = extrairDados(idxComents);
  var total = Math.max(ids.length, coments.length);
  var itens = [];
  for (var i = 0; i < total; i++) {
    var id    = ids[i]     || '';
    var obs   = coments[i] || '';
    var score = id && idParaScore[id.trim()] !== undefined ? idParaScore[id.trim()] : null;
    if (id || obs) itens.push({ id: id, obs: obs, score: score });
  }
  return { nota: nota, itens: itens };
}
