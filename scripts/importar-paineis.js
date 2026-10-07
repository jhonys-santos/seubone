#!/usr/bin/env node
// Copia Usuários do hub, Quitações, Auditoria e Foco/Agenda da Semana das planilhas para o Postgres.
// Só LÊ as planilhas (nunca escreve nelas). Pode rodar quantas vezes quiser ANTES de ligar as flags:
// por padrão só insere o que ainda não está no banco e não mexe no que já está.
//
//   node scripts/importar-paineis.js                         # relatório de tudo (não grava)
//   node scripts/importar-paineis.js quitacoes --aplicar     # grava só as Quitações (usuarios | quitacoes | auditoria | agenda | urgentes | todos)
//   node scripts/importar-paineis.js todos --aplicar --atualizar
//        --atualizar: também corrige no banco o que mudou na planilha (usuários, quitações pagas, agenda).
//                     Use SÓ antes de ligar a flag da área: depois dela, o banco é a fonte e a planilha fica velha.
//   node scripts/importar-paineis.js quitacoes --aplicar --refazer   # APAGA a tabela e importa de novo (só antes de ligar a flag)
const path = require('path');

const str = (v) => String(v == null ? '' : v);
const instante = (v) => { const t = new Date(str(v)).getTime(); return Number.isNaN(t) ? null : t; };
/** Dia (AAAA-MM-DD) no fuso de Brasília de um instante vindo da planilha; "AAAA-MM-DD" puro passa direto. */
function diaBrasilia(v) {
  const s = str(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = instante(s);
  return t == null ? null : new Date(t - 3 * 3600000).toISOString().slice(0, 10);
}
const sim = (v) => str(v).trim().toLowerCase() === 'sim' || v === true;

// ── Usuários ──────────────────────────────────────────────────────────────
async function importarUsuarios(lista, db, { atualizar = false, refazer = false } = {}) {
  return db.transaction(async (tx) => {
    if (refazer) await tx.query('delete from hub_usuarios');
    let ins = 0, atu = 0, ign = 0;
    for (const u of lista) {
      if (!str(u.usuario).trim()) continue;
      const params = [str(u.id) || `u-${u.slug}`, str(u.usuario), str(u.senhaHash), str(u.nome), str(u.slug), str(u.role) || 'colaborador', u.tipo ? str(u.tipo) : null,
        Array.isArray(u.paineis) ? u.paineis : [], !!u.indicadoresPendentes];
      const existe = await tx.query('select 1 from hub_usuarios where lower(btrim(usuario)) = lower(btrim($1))', [params[1]]);
      if (existe.rowCount) {
        if (!atualizar) { ign++; continue; }
        await tx.query(
          `update hub_usuarios set id=$1, usuario=$2, senha_hash=$3, nome=$4, slug=$5, role=$6, tipo=$7, paineis=$8::text[], indicadores_pendentes=$9
           where lower(btrim(usuario)) = lower(btrim($2))`, params);
        atu++;
      } else {
        await tx.query(
          `insert into hub_usuarios (id, usuario, senha_hash, nome, slug, role, tipo, paineis, indicadores_pendentes) values ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9)`, params);
        ins++;
      }
    }
    return { inseridos: ins, atualizados: atu, ignorados: ign };
  });
}
function conferirUsuarios(planilha, banco) {
  const dif = [];
  const porUsuario = new Map(banco.map((u) => [str(u.usuario).trim().toLowerCase(), u]));
  for (const p of planilha) {
    const k = str(p.usuario).trim().toLowerCase();
    if (!k) continue;
    const b = porUsuario.get(k);
    if (!b) { dif.push(`usuário ${p.usuario}: não está no banco`); continue; }
    for (const c of ['id', 'usuario', 'senhaHash', 'nome', 'slug', 'role']) if (str(p[c]) !== str(b[c])) dif.push(`usuário ${p.usuario}: ${c} diferente`);
    if ((p.tipo || null) !== (b.tipo || null)) dif.push(`usuário ${p.usuario}: tipo diferente`);
    if (JSON.stringify(p.paineis || []) !== JSON.stringify(b.paineis || [])) dif.push(`usuário ${p.usuario}: painéis diferentes`);
    if (!!p.indicadoresPendentes !== !!b.indicadoresPendentes) dif.push(`usuário ${p.usuario}: indicadoresPendentes diferente`);
  }
  return dif;
}

// ── Quitações ─────────────────────────────────────────────────────────────
async function importarQuitacoes(itens, db, { atualizar = false, refazer = false } = {}) {
  const ordenados = [...itens].filter((x) => str(x.id).trim()).sort((a, b) => (instante(a.dataCadastro) || 0) - (instante(b.dataCadastro) || 0));
  return db.transaction(async (tx) => {
    if (refazer) await tx.query('delete from quitacoes');
    let ins = 0, atu = 0, ign = 0;
    for (const x of ordenados) {
      const cad = instante(x.dataCadastro);
      const pag = instante(x.dataPagamento);
      const p = [str(x.id), cad == null ? new Date().toISOString() : new Date(cad).toISOString(), str(x.idVendaOmie), str(x.cliente), diaBrasilia(x.dataPrevista), str(x.linkCrm), str(x.modalidade),
        str(x.tipoEnvioAereo), str(x.aeroporto), x.freteDedicado === true || str(x.freteDedicado).toLowerCase() === 'true', str(x.transportadora), str(x.entregador), str(x.observacao),
        str(x.cadastradoPorSlug), str(x.cadastradoPorNome), str(x.status) || 'pendente', pag == null ? null : new Date(pag).toISOString()];
      const cols = '(id, data_cadastro, id_venda_omie, cliente, data_prevista, link_crm, modalidade, tipo_envio_aereo, aeroporto, frete_dedicado, transportadora, entregador, observacao, cadastrado_por_slug, cadastrado_por_nome, status, data_pagamento)';
      const vals = '($1,$2::timestamptz,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::timestamptz)';
      const existe = await tx.query('select 1 from quitacoes where id = $1', [p[0]]);
      if (existe.rowCount) {
        if (!atualizar) { ign++; continue; }
        await tx.query(`update quitacoes set data_cadastro=$2::timestamptz, id_venda_omie=$3, cliente=$4, data_prevista=$5::date, link_crm=$6, modalidade=$7, tipo_envio_aereo=$8, aeroporto=$9,
          frete_dedicado=$10, transportadora=$11, entregador=$12, observacao=$13, cadastrado_por_slug=$14, cadastrado_por_nome=$15, status=$16, data_pagamento=$17::timestamptz where id=$1`, p);
        atu++;
      } else {
        await tx.query(`insert into quitacoes ${cols} values ${vals}`, p);
        ins++;
      }
    }
    return { inseridos: ins, atualizados: atu, ignorados: ign };
  });
}
function conferirQuitacoes(planilha, banco) {
  const dif = [];
  const porId = new Map(banco.map((x) => [str(x.id), x]));
  for (const p of planilha) {
    const b = porId.get(str(p.id));
    if (!b) { dif.push(`quitação ${p.id}: não está no banco`); continue; }
    for (const c of ['idVendaOmie', 'cliente', 'linkCrm', 'modalidade', 'tipoEnvioAereo', 'aeroporto', 'transportadora', 'entregador', 'observacao', 'cadastradoPorSlug', 'cadastradoPorNome', 'status'])
      if (str(p[c]) !== str(b[c])) dif.push(`quitação ${p.id}: ${c} diferente`);
    if (!!p.freteDedicado !== !!b.freteDedicado) dif.push(`quitação ${p.id}: freteDedicado diferente`);
    if (instante(p.dataCadastro) !== instante(b.dataCadastro)) dif.push(`quitação ${p.id}: dataCadastro diferente`);
    if ((str(p.dataPagamento) ? instante(p.dataPagamento) : null) !== (str(b.dataPagamento) ? instante(b.dataPagamento) : null)) dif.push(`quitação ${p.id}: dataPagamento diferente`);
    if ((diaBrasilia(p.dataPrevista) || '') !== str(b.dataPrevista)) dif.push(`quitação ${p.id}: dataPrevista diferente`);
  }
  return dif;
}

// ── Auditoria ─────────────────────────────────────────────────────────────
async function importarAuditoria(linhas, db, { refazer = false } = {}) {
  const ordenados = [...linhas].filter((x) => str(x.Data).trim()).sort((a, b) => (instante(a.Timestamp) || 0) - (instante(b.Timestamp) || 0));
  return db.transaction(async (tx) => {
    if (refazer) await tx.query('delete from auditorias');
    let ins = 0, ign = 0;
    for (const x of ordenados) {
      const ts = instante(x.Timestamp);
      const tsIso = ts == null ? null : new Date(ts).toISOString();
      const dia = str(x.Data).slice(0, 10);
      const conv = str(x.ConversationId).trim();
      // Sem chave natural: o mesmo instante de registro + a mesma conversa + o mesmo agente já importados contam como repetidos.
      const existe = await tx.query(
        `select 1 from auditorias where registrado_em = $1::timestamptz and conversation_id = $2 and agente = $3`, [tsIso || new Date(0).toISOString(), conv, str(x.Agente)]);
      if (existe.rowCount) { ign++; continue; }
      const n = (k) => (Number.isNaN(Number(x[k])) ? 0 : Number(x[k]));
      await tx.query(
        `insert into auditorias (registrado_em, data, semana, auditado_por, agente, tipo_ocorrencia, canal, conversation_id,
           c11, c12, c13, c14, c21, c22, c23, c24, c31, c32, c33, c34, s1, s2, s3, total, classificacao, fg1, fg2, fg3, fg4, falha_grave, observacoes)
         values (coalesce($1::timestamptz, now()), $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)`,
        [tsIso, dia, str(x.Semana), str(x.AuditadoPor), str(x.Agente), str(x.TipoOcorrencia), str(x.Canal), conv,
          n('c11'), n('c12'), n('c13'), n('c14'), n('c21'), n('c22'), n('c23'), n('c24'), n('c31'), n('c32'), n('c33'), n('c34'), n('S1'), n('S2'), n('S3'), n('Total'), str(x.Classificacao),
          sim(x.FG1), sim(x.FG2), sim(x.FG3), sim(x.FG4), sim(x.FalhaGrave), str(x.Observacoes)]);
      ins++;
    }
    return { inseridos: ins, atualizados: 0, ignorados: ign };
  });
}
function conferirAuditoria(planilha, banco) {
  const dif = [];
  const chave = (x) => `${instante(x.Timestamp)}|${str(x.ConversationId).trim()}|${str(x.Agente)}`;
  const cont = new Map();
  for (const b of banco) cont.set(chave(b), (cont.get(chave(b)) || 0) + 1);
  const porChave = new Map(banco.map((b) => [chave(b), b]));
  for (const p of planilha.filter((x) => str(x.Data).trim())) {
    const b = porChave.get(chave(p));
    if (!b) { dif.push(`auditoria ${str(p.ConversationId)} (${p.Agente}): não está no banco`); continue; }
    for (const c of ['Semana', 'AuditadoPor', 'TipoOcorrencia', 'Canal', 'Classificacao', 'FG1', 'FG2', 'FG3', 'FG4', 'FalhaGrave', 'Observacoes'])
      if (str(p[c]) !== str(b[c])) dif.push(`auditoria ${str(p.ConversationId)}: ${c} diferente`);
    for (const c of ['c11', 'c12', 'c13', 'c14', 'c21', 'c22', 'c23', 'c24', 'c31', 'c32', 'c33', 'c34', 'S1', 'S2', 'S3', 'Total'])
      if (Number(p[c]) !== Number(b[c])) dif.push(`auditoria ${str(p.ConversationId)}: ${c} diferente`);
    if (str(p.Data).slice(0, 10) !== str(b.Data).slice(0, 10)) dif.push(`auditoria ${str(p.ConversationId)}: Data diferente`);
  }
  if (banco.length < planilha.filter((x) => str(x.Data).trim()).length) dif.push(`banco tem menos linhas (${banco.length}) que a planilha`);
  return dif;
}

// ── Foco/Agenda ───────────────────────────────────────────────────────────
async function importarAgenda(dados, db, { atualizar = false, refazer = false } = {}) {
  return db.transaction(async (tx) => {
    if (refazer) { await tx.query('delete from agenda_eventos'); await tx.query('delete from agenda_foco'); }
    let ins = 0, atu = 0, ign = 0;
    const foco = await tx.query('select texto from agenda_foco where id = 1');
    if (!foco.rowCount) { await tx.query('insert into agenda_foco (id, texto) values (1, $1)', [str(dados.foco)]); ins++; }
    else if (atualizar && foco.rows[0].texto !== str(dados.foco)) { await tx.query('update agenda_foco set texto = $1 where id = 1', [str(dados.foco)]); atu++; }
    else ign++;
    for (const e of dados.eventos || []) {
      const id = Number(e.linha);
      if (!id) continue;
      const p = [id, str(e.dia), str(e.hora), str(e.descricao), str(e.tipo) || 'Outro'];
      const existe = await tx.query('select 1 from agenda_eventos where id = $1', [id]);
      if (existe.rowCount) {
        if (!atualizar) { ign++; continue; }
        await tx.query('update agenda_eventos set dia=$2, hora=$3, descricao=$4, tipo=$5 where id=$1', p);
        atu++;
      } else {
        await tx.query('insert into agenda_eventos (id, dia, hora, descricao, tipo) values ($1,$2,$3,$4,$5)', p);
        ins++;
      }
    }
    // Eventos novos criados no hub continuam depois do maior número de linha já usado (mínimo 5).
    await tx.query(`select setval(pg_get_serial_sequence('agenda_eventos', 'id'), greatest((select coalesce(max(id), 0) from agenda_eventos), 4), true)`);
    return { inseridos: ins, atualizados: atu, ignorados: ign };
  });
}
function conferirAgenda(planilha, banco) {
  const dif = [];
  if (str(planilha.foco).trim() !== str(banco.foco)) dif.push('foco da semana diferente');
  const porLinha = new Map((banco.eventos || []).map((e) => [e.linha, e]));
  for (const p of planilha.eventos || []) {
    const b = porLinha.get(Number(p.linha));
    if (!b) { dif.push(`evento linha ${p.linha}: não está no banco`); continue; }
    for (const c of ['dia', 'hora', 'descricao', 'tipo']) if (str(p[c]) !== str(b[c])) dif.push(`evento linha ${p.linha}: ${c} diferente`);
  }
  if ((banco.eventos || []).length !== (planilha.eventos || []).length) dif.push(`quantidade de eventos: planilha ${(planilha.eventos || []).length}, banco ${(banco.eventos || []).length}`);
  return dif;
}

// ── Pedidos Urgentes ──────────────────────────────────────────────────────
async function importarUrgentes(lista, db, { atualizar = false, refazer = false } = {}) {
  const ordenados = [...lista].filter((x) => str(x.ID).trim()).sort((a, b) => (instante(a.InseridoEm) || 0) - (instante(b.InseridoEm) || 0));
  return db.transaction(async (tx) => {
    if (refazer) await tx.query('delete from pedidos_urgentes');
    let ins = 0, atu = 0, ign = 0;
    for (const x of ordenados) {
      const t = (k) => { const v = instante(x[k]); return v == null ? null : new Date(v).toISOString(); };
      const p = [str(x.ID), str(x.OS), str(x.Cliente), str(x.LinkCRM), str(x.Transportadora), str(x.Modalidade), str(x.TipoEnvioAereo), str(x.AeroportoRetirada), str(x.OSImagemId),
        str(x.ManifestoLink), str(x.NotaFiscalLink), str(x.Observacao), t('Prazo'), str(x.Status) || 'Pendente', str(x.InseridoPor), t('InseridoEm') || new Date().toISOString(), str(x.DespachadoPor), t('DespachadoEm')];
      const existe = await tx.query('select 1 from pedidos_urgentes where id = $1', [p[0]]);
      if (existe.rowCount) {
        if (!atualizar) { ign++; continue; }
        await tx.query(`update pedidos_urgentes set os=$2, cliente=$3, link_crm=$4, transportadora=$5, modalidade=$6, tipo_envio_aereo=$7, aeroporto_retirada=$8, os_imagem_id=$9,
          manifesto_link=$10, nota_fiscal_link=$11, observacao=$12, prazo=$13::timestamptz, status=$14, inserido_por=$15, inserido_em=$16::timestamptz, despachado_por=$17, despachado_em=$18::timestamptz where id=$1`, p);
        atu++;
      } else {
        await tx.query(`insert into pedidos_urgentes (id, os, cliente, link_crm, transportadora, modalidade, tipo_envio_aereo, aeroporto_retirada, os_imagem_id, manifesto_link, nota_fiscal_link,
          observacao, prazo, status, inserido_por, inserido_em, despachado_por, despachado_em)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14,$15,$16::timestamptz,$17,$18::timestamptz)`, p);
        ins++;
      }
    }
    return { inseridos: ins, atualizados: atu, ignorados: ign };
  });
}
function conferirUrgentes(planilha, banco) {
  const dif = [];
  const porId = new Map(banco.map((x) => [str(x.ID), x]));
  for (const p of planilha.filter((x) => str(x.ID).trim())) {
    const b = porId.get(str(p.ID));
    if (!b) { dif.push('pedido ' + p.ID + ': não está no banco'); continue; }
    for (const c of ['OS', 'Cliente', 'LinkCRM', 'Transportadora', 'Modalidade', 'TipoEnvioAereo', 'AeroportoRetirada', 'OSImagemId', 'ManifestoLink', 'NotaFiscalLink', 'Observacao', 'Status', 'InseridoPor', 'DespachadoPor'])
      if (str(p[c]) !== str(b[c])) dif.push('pedido ' + p.ID + ': ' + c + ' diferente');
    for (const c of ['Prazo', 'InseridoEm', 'DespachadoEm']) if ((str(p[c]) ? instante(p[c]) : null) !== (str(b[c]) ? instante(b[c]) : null)) dif.push('pedido ' + p.ID + ': ' + c + ' diferente');
  }
  if (banco.length < planilha.filter((x) => str(x.ID).trim()).length) dif.push('banco tem menos pedidos (' + banco.length + ') que a planilha');
  return dif;
}

// ── Execução ──────────────────────────────────────────────────────────────
async function lerPlanilha(url, params) {
  const { chamarAppsScript } = require('../src/services/appsScriptClient');
  let ultimo = '';
  for (let i = 0; i < 5; i++) {
    try {
      const r = await chamarAppsScript(url, { params, timeoutMs: 170000 });
      if (r && typeof r === 'object') return r;
      ultimo = 'o Google devolveu uma página de erro';
    } catch (e) { ultimo = e.message; }
    await new Promise((x) => setTimeout(x, 4000));
  }
  throw new Error(`Não consegui ler a planilha: ${ultimo}`);
}

const AREAS = {
  urgentes: {
    rotulo: 'Pedidos Urgentes',
    ler: async (env) => { const r = await lerPlanilha(env.pedidosUrgentesAppsScriptUrl, { action: 'list' }); if (!Array.isArray(r)) throw new Error('Pedidos Urgentes: ' + ((r && r.erro) || 'resposta inesperada')); return r; },
    importar: importarUrgentes, conferir: conferirUrgentes,
    doBanco: () => require('../src/services/pedidosUrgentesDb.service').listar(),
  },
  usuarios: {
    rotulo: 'Usuários',
    ler: async (env) => (await lerPlanilha(env.painelSacAppsScriptUrl, { action: 'hubListarUsuarios' })).usuarios || [],
    importar: importarUsuarios, conferir: conferirUsuarios,
    doBanco: () => require('../src/services/usuariosDb.service').listar(),
  },
  quitacoes: {
    rotulo: 'Quitações',
    ler: async (env) => {
      const p = await lerPlanilha(env.quitacoesAppsScriptUrl, { action: 'lista', status: 'pendente' });
      const g = await lerPlanilha(env.quitacoesAppsScriptUrl, { action: 'lista', status: 'pago' });
      if (!p.ok || !g.ok) throw new Error(`Quitações: ${p.erro || g.erro || 'resposta inesperada'}`);
      return [...(p.itens || []), ...(g.itens || [])];
    },
    importar: importarQuitacoes, conferir: conferirQuitacoes,
    doBanco: async () => { const s = require('../src/services/quitacoesDb.service'); return [...(await s.listar('pendente')).itens, ...(await s.listar('pago')).itens]; },
  },
  auditoria: {
    rotulo: 'Auditoria',
    ler: async (env) => { const r = await lerPlanilha(env.auditoriaAppsScriptUrl, {}); if (!r.ok) throw new Error(`Auditoria: ${r.error || 'resposta inesperada'}`); return r.data || []; },
    importar: importarAuditoria, conferir: conferirAuditoria,
    doBanco: async () => (await require('../src/services/auditoriaDb.service').listar()).data,
  },
  agenda: {
    rotulo: 'Foco/Agenda da Semana',
    ler: async (env) => { const r = await lerPlanilha(env.agendaSemanaAppsScriptUrl, { action: 'ler' }); if (!r.ok) throw new Error(`Agenda: ${r.erro || 'resposta inesperada'}`); return r.dados; },
    importar: importarAgenda, conferir: conferirAgenda,
    doBanco: async () => (await require('../src/services/agendaDb.service').ler()).dados,
  },
};
const tamanho = (d) => (Array.isArray(d) ? d.length : (d.eventos || []).length);

async function principal() {
  const env = require('../src/config/env');
  const args = process.argv.slice(2);
  const alvo = args.find((a) => !a.startsWith('--')) || 'todos';
  const nomes = alvo === 'todos' ? Object.keys(AREAS) : [alvo];
  for (const n of nomes) if (!AREAS[n]) { console.error(`Área desconhecida: ${n}. Use: ${Object.keys(AREAS).join(' | ')} | todos`); process.exit(1); }
  const aplicar = args.includes('--aplicar');
  const db = require('../src/db');
  let falhou = false;
  for (const n of nomes) {
    const a = AREAS[n];
    process.stdout.write(`\n== ${a.rotulo}\n`);
    try {
      const dados = await a.ler(env);
      console.log(`  na planilha: ${tamanho(dados)}`);
      if (!aplicar) { console.log('  (relatório: nada foi gravado; use --aplicar)'); continue; }
      const r = await a.importar(dados, db, { atualizar: args.includes('--atualizar'), refazer: args.includes('--refazer') });
      console.log(`  inseridos ${r.inseridos}, atualizados ${r.atualizados}, já existiam ${r.ignorados}`);
      const dif = a.conferir(dados, await a.doBanco());
      if (dif.length) { falhou = true; console.log(`  CONFERÊNCIA: ${dif.length} diferença(s):`); dif.slice(0, 15).forEach((d) => console.log('    - ' + d)); }
      else console.log(`  conferência campo a campo: tudo igual (${tamanho(dados)} itens)`);
    } catch (e) { falhou = true; console.error('  ERRO:', e.message); }
  }
  await db.fechar();
  if (falhou) process.exit(1);
}

module.exports = { importarUrgentes, conferirUrgentes, importarUsuarios, importarQuitacoes, importarAuditoria, importarAgenda, conferirUsuarios, conferirQuitacoes, conferirAuditoria, conferirAgenda, diaBrasilia };
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  principal().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
