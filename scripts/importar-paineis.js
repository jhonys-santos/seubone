#!/usr/bin/env node
// Copia Usuários do hub, Quitações, Auditoria e Foco/Agenda da Semana das planilhas para o Postgres.
// Só LÊ as planilhas (nunca escreve nelas). Pode rodar quantas vezes quiser ANTES de ligar as flags:
// por padrão só insere o que ainda não está no banco e não mexe no que já está.
//
//   node scripts/importar-paineis.js                         # relatório de tudo (não grava)
//   node scripts/importar-paineis.js quitacoes --aplicar     # grava só as Quitações (usuarios | quitacoes | auditoria | agenda | urgentes | wallac | escala | todos)
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

// ── Wallac (status, estoque, solicitações e premiação; os cards de compra continuam na aba LTV) ──
const tsOuNull = (v) => { const t = instante(v); return t == null ? null : new Date(t).toISOString(); };
async function importarWallac(d, db, { atualizar = false, refazer = false } = {}) {
  return db.transaction(async (tx) => {
    if (refazer) for (const t of ['wallac_status', 'wallac_estoque', 'wallac_solicitacoes', 'wallac_premiacao']) await tx.query('delete from ' + t);
    let ins = 0, atu = 0, ign = 0;
    const upsert = async (existe, atualizarSql, inserirSql, params) => {
      if (existe.rowCount) { if (!atualizar) { ign++; return; } await tx.query(atualizarSql, params); atu++; } else { await tx.query(inserirSql, params); ins++; }
    };
    // status: se a linha da LTV aparece mais de uma vez, vale a ÚLTIMA (é a que o kanban mostrava)
    const status = new Map(); for (const x of d.status || []) status.set(Number(x.linha_ltv), x);
    for (const x of status.values()) {
      const p = [Number(x.linha_ltv), str(x.status_atual) || 'A chegar', tsOuNull(x.data_recebido), tsOuNull(x.data_inicio_producao), tsOuNull(x.data_finalizado)];
      await upsert(await tx.query('select 1 from wallac_status where linha_ltv = $1', [p[0]]),
        'update wallac_status set status_atual=$2, data_recebido=$3::timestamptz, data_inicio_producao=$4::timestamptz, data_finalizado=$5::timestamptz where linha_ltv=$1',
        'insert into wallac_status (linha_ltv, status_atual, data_recebido, data_inicio_producao, data_finalizado) values ($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz)', p);
    }
    for (const x of d.estoque || []) {
      const p = [Number(x.linha), str(x.produto), Number(x.quantidade) || 0];
      await upsert(await tx.query('select 1 from wallac_estoque where id = $1', [p[0]]), 'update wallac_estoque set produto=$2, quantidade=$3 where id=$1', 'insert into wallac_estoque (id, produto, quantidade) values ($1,$2,$3)', p);
    }
    for (const x of d.solicitacoes || []) {
      const p = [Number(x.linha), str(x.produto), Number(x.quantidade) || 0, str(x.id_venda_cliente), str(x.prazo_producao) || null, str(x.prazo_entrega) || null, str(x.observacoes), str(x.logo_url),
        str(x.status_atual) || 'Recebido', tsOuNull(x.data_recebido), tsOuNull(x.data_inicio_producao), tsOuNull(x.data_finalizado), str(x.solicitante)];
      await upsert(await tx.query('select 1 from wallac_solicitacoes where id = $1', [p[0]]),
        'update wallac_solicitacoes set produto=$2, quantidade=$3, id_venda_cliente=$4, prazo_producao=$5, prazo_entrega=$6, observacoes=$7, logo_url=$8, status_atual=$9, data_recebido=$10::timestamptz, data_inicio_producao=$11::timestamptz, data_finalizado=$12::timestamptz, solicitante=$13 where id=$1',
        'insert into wallac_solicitacoes (id, produto, quantidade, id_venda_cliente, prazo_producao, prazo_entrega, observacoes, logo_url, status_atual, data_recebido, data_inicio_producao, data_finalizado, solicitante) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13)', p);
    }
    for (const x of d.premiacao || []) {
      const p = [str(x.semana_inicio), str(x.semana_fim), Number(x.pecas_no_prazo) || 0, str(x.faixa) || 'Nenhuma', Number(x.coins_da_semana) || 0, str(x.mes_referencia), Number(x.coins_acumulados_no_mes) || 0];
      await upsert(await tx.query('select 1 from wallac_premiacao where semana_inicio = $1::date', [p[0]]),
        'update wallac_premiacao set semana_fim=$2::date, pecas_no_prazo=$3, faixa=$4, coins_da_semana=$5, mes_referencia=$6, coins_acumulados_no_mes=$7 where semana_inicio=$1::date',
        'insert into wallac_premiacao (semana_inicio, semana_fim, pecas_no_prazo, faixa, coins_da_semana, mes_referencia, coins_acumulados_no_mes) values ($1::date,$2::date,$3,$4,$5,$6,$7)', p);
    }
    // os próximos itens criados no hub continuam depois da maior linha já usada (mínimo 2)
    for (const t of ['wallac_estoque', 'wallac_solicitacoes']) await tx.query("select setval(pg_get_serial_sequence('" + t + "', 'id'), greatest((select coalesce(max(id), 0) from " + t + "), 1), true)");
    return { inseridos: ins, atualizados: atu, ignorados: ign };
  });
}
async function conferirWallac(d, db) {
  const dif = [];
  const q = async (s) => (await db.query(s)).rows;
  const status = new Map(); for (const x of d.status || []) status.set(Number(x.linha_ltv), x);
  const sb = new Map((await q('select linha_ltv, status_atual, data_recebido, data_inicio_producao, data_finalizado from wallac_status')).map((x) => [Number(x.linha_ltv), x]));
  for (const [l, x] of status) {
    const b = sb.get(l); if (!b) { dif.push('status linha ' + l + ': não está no banco'); continue; }
    if ((str(x.status_atual) || 'A chegar') !== b.status_atual) dif.push('status linha ' + l + ': status diferente');
    for (const c of ['data_recebido', 'data_inicio_producao', 'data_finalizado']) if ((instante(x[c]) || null) !== (b[c] ? new Date(b[c]).getTime() : null)) dif.push('status linha ' + l + ': ' + c + ' diferente');
  }
  const eb = new Map((await q('select id, produto, quantidade from wallac_estoque')).map((x) => [Number(x.id), x]));
  for (const x of d.estoque || []) { const b = eb.get(Number(x.linha)); if (!b) dif.push('estoque linha ' + x.linha + ': não está no banco'); else if (b.produto !== str(x.produto) || Number(b.quantidade) !== Number(x.quantidade)) dif.push('estoque linha ' + x.linha + ': diferente'); }
  const sob = new Map((await q('select * from wallac_solicitacoes')).map((x) => [Number(x.id), x]));
  for (const x of d.solicitacoes || []) {
    const b = sob.get(Number(x.linha)); if (!b) { dif.push('solicitação linha ' + x.linha + ': não está no banco'); continue; }
    for (const [c, k] of [['produto', 'produto'], ['id_venda_cliente', 'id_venda_cliente'], ['observacoes', 'observacoes'], ['logo_url', 'logo_url'], ['status_atual', 'status_atual'], ['solicitante', 'solicitante']]) if (str(x[c]) !== str(b[k])) dif.push('solicitação linha ' + x.linha + ': ' + c + ' diferente');
    if (Number(x.quantidade) !== Number(b.quantidade)) dif.push('solicitação linha ' + x.linha + ': quantidade diferente');
    if ((str(x.prazo_producao) || null) !== b.prazo_producao || (str(x.prazo_entrega) || null) !== b.prazo_entrega) dif.push('solicitação linha ' + x.linha + ': prazos diferentes');
    for (const c of ['data_recebido', 'data_inicio_producao', 'data_finalizado']) if ((instante(x[c]) || null) !== (b[c] ? new Date(b[c]).getTime() : null)) dif.push('solicitação linha ' + x.linha + ': ' + c + ' diferente');
  }
  const pb = new Map((await q("select to_char(semana_inicio, 'YYYY-MM-DD') as ini, to_char(semana_fim, 'YYYY-MM-DD') as fim, pecas_no_prazo, faixa, coins_da_semana, mes_referencia, coins_acumulados_no_mes from wallac_premiacao")).map((x) => [x.ini, x]));
  for (const x of d.premiacao || []) {
    const b = pb.get(str(x.semana_inicio)); if (!b) { dif.push('premiação ' + x.semana_inicio + ': não está no banco'); continue; }
    if (b.fim !== str(x.semana_fim) || Number(b.pecas_no_prazo) !== Number(x.pecas_no_prazo) || b.faixa !== str(x.faixa) || Number(b.coins_da_semana) !== Number(x.coins_da_semana) || b.mes_referencia !== str(x.mes_referencia) || Number(b.coins_acumulados_no_mes) !== Number(x.coins_acumulados_no_mes)) dif.push('premiação ' + x.semana_inicio + ': diferente');
  }
  return dif;
}

// ── Escala e Trocas (Painel SAC) ──────────────────────────────────────────
const MESES_PT = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const STATUS_ESCALA = ['T', 'F', 'FN', 'FM', 'TR', 'FE'];

/** Mesma leitura do rótulo "mês/ano" (coluna A) que o Apps Script fazia: data de verdade, número de série ou texto "jan/2026". */
function mesAnoDoRotulo(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.data) { const d = new Date(v.data); return Number.isNaN(d.getTime()) ? null : { mes: d.getUTCMonth(), ano: d.getUTCFullYear() }; }
  if (typeof v === 'number' && v > 40000) { const d = new Date((v - 25569) * 86400000); return { mes: d.getUTCMonth(), ano: d.getUTCFullYear() }; }
  const m = String(v).toLowerCase().trim().match(/([a-z]{3})[^0-9]*(\d{4})/);
  if (!m) return null;
  const mes = MESES_PT[m[1]];
  return mes === undefined ? null : { mes, ano: parseInt(m[2], 10) };
}
const rotuloTexto = (v) => (v && typeof v === 'object' && v.data ? v.data : str(v));

/** Dia/hora "dd/MM/aaaa HH:mm" (Brasília) ou ISO -> instante ISO; null se não der para ler. */
function instanteDaTroca(v) {
  const s = str(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0) + 3, +(m[5] || 0))).toISOString();
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Lê o que o Apps Script exportou (ação "exportar") e separa o que vai para o banco, junto com avisos do que não deu para aproveitar.
 * Como o Apps Script: dentro de cada aba vale a PRIMEIRA linha de cada mês; dia sem valor conta como "F".
 */
function prepararEscalaTrocas(ex) {
  const avisos = [];
  const nomes = {};
  for (const u of ex.usuarios || []) { const s = str(u.slug).trim().toLowerCase(); if (s && !(s in nomes)) nomes[s] = str(u.nome).trim() || str(u.slug).trim(); }
  const pessoas = []; const escala = [];
  (ex.escala || []).forEach((p, i) => {
    pessoas.push({ slug: p.slug, nome: nomes[p.slug] || p.slug, ordem: i });
    if (!p.linhas) { avisos.push(`${p.slug}: aba ${p.aba} não existe na planilha`); return; }
    const dias = (p.cabecalho || []).slice(1).map((c) => parseInt(c, 10));
    if (dias.length < 31 || dias.some((d, k) => d !== k + 1)) avisos.push(`${p.slug}: cabeçalho da escala não é 1..31 (${dias.join(',')})`);
    const vistos = new Set();
    for (const l of p.linhas) {
      const ma = mesAnoDoRotulo(l.rotulo);
      if (!ma) { if (str(rotuloTexto(l.rotulo)).trim() || (l.valores || []).some((v) => str(v).trim())) avisos.push(`${p.slug}: linha ${l.linha} com rótulo "${rotuloTexto(l.rotulo)}" não é um mês: ignorada`); continue; }
      const chave = `${ma.ano}-${ma.mes}`;
      if (vistos.has(chave)) { avisos.push(`${p.slug}: mês ${ma.mes + 1}/${ma.ano} aparece de novo na linha ${l.linha}: vale só a primeira (como na planilha)`); continue; }
      vistos.add(chave);
      const valores = [];
      for (let k = 0; k < 31; k++) {
        const v = k < (l.valores || []).length ? (l.valores[k] || 'F') : 'F';
        const st = str(v).trim().toUpperCase();
        if (!STATUS_ESCALA.includes(st)) avisos.push(`${p.slug} ${ma.mes + 1}/${ma.ano} dia ${k + 1}: status fora do padrão "${st}"`);
        valores.push(st);
      }
      escala.push({ slug: p.slug, ano: ma.ano, mes: ma.mes, rotulo: rotuloTexto(l.rotulo), dias: valores, linha: l.linha });
    }
  });
  const trocas = [];
  for (const r of ex.trocas || []) {
    if (!str(r[0]).trim()) continue;
    trocas.push({
      id: str(r[0]), solicitante: str(r[1]), dia_sol: parseInt(r[2], 10), mes_sol: parseInt(r[3], 10), ano_sol: parseInt(r[4], 10),
      alvo: str(r[5]), dia_alvo: parseInt(r[6], 10), mes_alvo: parseInt(r[7], 10), ano_alvo: parseInt(r[8], 10), status: str(r[9]).trim() || 'pendente',
      criada_em: instanteDaTroca(r[10]), criada_em_original: str(r[10]),
    });
  }
  return { pessoas, escala, trocas, avisos };
}

async function importarEscala(ex, db, { atualizar = false, refazer = false } = {}) {
  const { pessoas, escala, trocas } = prepararEscalaTrocas(ex);
  return db.transaction(async (tx) => {
    if (refazer) { await tx.query('delete from sac_escala'); await tx.query('delete from sac_trocas'); await tx.query('delete from sac_escala_pessoas'); }
    let ins = 0, atu = 0, ign = 0;
    for (const p of pessoas) {
      const e = await tx.query('select nome from sac_escala_pessoas where slug = $1', [p.slug]);
      if (!e.rowCount) { await tx.query('insert into sac_escala_pessoas (slug, nome, ordem) values ($1,$2,$3)', [p.slug, p.nome, p.ordem]); ins++; }
      else if (atualizar) { await tx.query('update sac_escala_pessoas set nome = $2, ordem = $3 where slug = $1', [p.slug, p.nome, p.ordem]); atu++; }
      else ign++;
    }
    for (const l of escala) {
      const e = await tx.query('select 1 from sac_escala where slug = $1 and ano = $2 and mes = $3', [l.slug, l.ano, l.mes]);
      if (!e.rowCount) { await tx.query('insert into sac_escala (slug, ano, mes, rotulo, dias) values ($1,$2,$3,$4,$5::text[])', [l.slug, l.ano, l.mes, l.rotulo, l.dias]); ins++; }
      else if (atualizar) { await tx.query('update sac_escala set rotulo = $4, dias = $5::text[], atualizado_em = now() where slug = $1 and ano = $2 and mes = $3', [l.slug, l.ano, l.mes, l.rotulo, l.dias]); atu++; }
      else ign++;
    }
    for (const t of trocas) {
      const p = [t.id, t.solicitante, t.dia_sol, t.mes_sol, t.ano_sol, t.alvo, t.dia_alvo, t.mes_alvo, t.ano_alvo, t.status, t.criada_em, t.criada_em_original];
      const e = await tx.query('select 1 from sac_trocas where id = $1', [t.id]);
      if (!e.rowCount) { await tx.query('insert into sac_trocas (id, solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo, status, criada_em, criada_em_original) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', p); ins++; }
      else if (atualizar) { await tx.query('update sac_trocas set solicitante=$2, dia_sol=$3, mes_sol=$4, ano_sol=$5, alvo=$6, dia_alvo=$7, mes_alvo=$8, ano_alvo=$9, status=$10 where id=$1', p.slice(0, 10)); atu++; }
      else ign++;
    }
    return { inseridos: ins, atualizados: atu, ignorados: ign };
  });
}

/** Foto do banco no mesmo formato que a planilha preparada (para comparar campo a campo e pelo resultado das telas). */
async function lerEscalaDoBanco() {
  const db = require('../src/db');
  const E = require('../src/services/escalaDb.service');
  const pessoas = (await db.query('select slug, nome, ordem from sac_escala_pessoas order by ordem, slug')).rows;
  const linhas = (await db.query('select slug, ano, mes, dias from sac_escala order by slug, ano, mes')).rows;
  const trocas = (await db.query('select id, solicitante, dia_sol, mes_sol, ano_sol, alvo, dia_alvo, mes_alvo, ano_alvo, status from sac_trocas order by ordem')).rows;
  const telas = {};
  for (const l of linhas) telas[`${l.slug}|${l.ano}|${l.mes}`] = await E.buscarEscala(l.slug, l.mes, l.ano);
  return { pessoas, linhas, trocas, telas };
}

/** A escala como a planilha a devolvia (algoritmo de buscarEscalaComSS aplicado aos dados exportados). */
function escalaComoAPlanilha(ex, slug, mes, ano) {
  const p = (ex.escala || []).find((x) => x.slug === slug);
  if (!p || !p.linhas) return [];
  const linha = p.linhas.find((l) => { const ma = mesAnoDoRotulo(l.rotulo); return ma && ma.mes === mes && ma.ano === ano; });
  if (!linha) return [];
  const saida = [];
  for (let i = 1; i < p.cabecalho.length; i++) {
    const dia = parseInt(p.cabecalho[i], 10);
    if (!dia || dia < 1 || dia > 31) continue;
    saida.push({ dia, status: str(linha.valores[i - 1] || 'F').trim().toUpperCase() });
  }
  return saida;
}

function conferirEscala(ex, banco) {
  const dif = [];
  const { pessoas, escala, trocas } = prepararEscalaTrocas(ex);
  const pb = new Map(banco.pessoas.map((p) => [p.slug, p]));
  for (const p of pessoas) {
    const b = pb.get(p.slug);
    if (!b) dif.push(`pessoa ${p.slug}: não está no banco`);
    else if (b.nome !== p.nome || Number(b.ordem) !== p.ordem) dif.push(`pessoa ${p.slug}: nome/ordem diferente`);
  }
  const lb = new Map(banco.linhas.map((l) => [`${l.slug}|${l.ano}|${l.mes}`, l]));
  for (const l of escala) {
    const b = lb.get(`${l.slug}|${l.ano}|${l.mes}`);
    if (!b) { dif.push(`escala ${l.slug} ${l.mes + 1}/${l.ano}: não está no banco`); continue; }
    const igual = l.dias.length === b.dias.length && l.dias.every((d, i) => d === b.dias[i]);
    if (!igual) dif.push(`escala ${l.slug} ${l.mes + 1}/${l.ano}: dias diferentes`);
    // Resultado que a tela recebe: igual ao que a planilha devolveria hoje.
    const esperado = JSON.stringify(escalaComoAPlanilha(ex, l.slug, l.mes, l.ano));
    if (JSON.stringify(banco.telas[`${l.slug}|${l.ano}|${l.mes}`]) !== esperado) dif.push(`escala ${l.slug} ${l.mes + 1}/${l.ano}: resposta da tela diferente da planilha`);
  }
  if (banco.linhas.length < escala.length) dif.push(`banco tem menos meses de escala (${banco.linhas.length}) que a planilha (${escala.length})`);
  const tb = new Map(banco.trocas.map((t) => [t.id, t]));
  for (const t of trocas) {
    const b = tb.get(t.id);
    if (!b) { dif.push(`troca ${t.id}: não está no banco`); continue; }
    for (const c of ['solicitante', 'alvo', 'status']) if (str(t[c]) !== str(b[c])) dif.push(`troca ${t.id}: ${c} diferente`);
    for (const c of ['dia_sol', 'mes_sol', 'ano_sol', 'dia_alvo', 'mes_alvo', 'ano_alvo']) if (Number(t[c]) !== Number(b[c])) dif.push(`troca ${t.id}: ${c} diferente`);
  }
  if (banco.trocas.length < trocas.length) dif.push(`banco tem menos trocas (${banco.trocas.length}) que a planilha (${trocas.length})`);
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
  escala: {
    rotulo: 'Painel SAC: Escala e Trocas',
    ler: async (env) => {
      const r = await lerPlanilha(env.painelSacAppsScriptUrl, { action: 'exportar' });
      if (!Array.isArray(r.escala)) throw new Error('Painel SAC: ' + (r.erro || 'o Apps Script ainda não tem a ação "exportar" (cole o Code.gs novo e publique uma nova versão)'));
      return r;
    },
    importar: importarEscala, conferir: conferirEscala,
    doBanco: lerEscalaDoBanco,
  },
  wallac: {
    rotulo: 'Wallac (status, estoque, solicitações, premiação)',
    ler: async (env) => { const r = await lerPlanilha(env.wallacAppsScriptUrl, { acao: 'exportar' }); if (!r.ok) throw new Error('Wallac: ' + (r.erro || 'o Apps Script ainda não tem a ação "exportar" (cole trechos-novos.gs e publique uma nova versão)')); return r; },
    importar: importarWallac, conferir: conferirWallac,
    doBanco: () => require('../src/db'),
  },
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
const tamanho = (d) => (Array.isArray(d) ? d.length : d.escala ? (() => { const x = prepararEscalaTrocas(d); return `${x.pessoas.length} pessoas, ${x.escala.length} meses de escala, ${x.trocas.length} trocas`; })() : d.status ? `${(d.status || []).length} status, ${(d.estoque || []).length} produtos, ${(d.solicitacoes || []).length} solicitações, ${(d.premiacao || []).length} semanas` : (d.eventos || []).length);

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
      const dif = await a.conferir(dados, await a.doBanco());
      if (dif.length) { falhou = true; console.log(`  CONFERÊNCIA: ${dif.length} diferença(s):`); dif.slice(0, 15).forEach((d) => console.log('    - ' + d)); }
      else console.log(`  conferência campo a campo: tudo igual (${tamanho(dados)} itens)`);
    } catch (e) { falhou = true; console.error('  ERRO:', e.message); }
  }
  await db.fechar();
  if (falhou) process.exit(1);
}

module.exports = { importarEscala, conferirEscala, prepararEscalaTrocas, lerEscalaDoBanco, escalaComoAPlanilha, importarWallac, conferirWallac, importarUrgentes, conferirUrgentes, importarUsuarios, importarQuitacoes, importarAuditoria, importarAgenda, conferirUsuarios, conferirQuitacoes, conferirAuditoria, conferirAgenda, diaBrasilia };
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  principal().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
