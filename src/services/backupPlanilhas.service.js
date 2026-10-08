// Backup automático: copia o que está no banco de volta para as planilhas, de segunda a
// sexta às 20h (Brasília). Cada área manda os dados para o Apps Script da sua planilha,
// que grava uma ABA NOVA POR DIA ("bkp AAAA-MM-DD <nome>") e guarda só os últimos 7 dias.
// As abas originais NUNCA são tocadas. Só entram as áreas que já estão no banco (as que
// ainda vivem na planilha já estão lá).
const db = require('../db');
const env = require('../config/env');

const DIAS_GUARDADOS = 7;
const HORA_DO_BACKUP = 20; // Brasília
const INTERVALO_VERIFICACAO_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS_POR_DIA = 3;

// ── Definição do que sai de cada tabela (ordem das colunas = ordem na aba) ──
const TS = (c) => `coalesce(to_char(${c}, 'YYYY-MM-DD HH24:MI:SS'), '')`;
const TSZ = (c) => `coalesce(to_char(${c} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS'), '')`; // timestamptz -> Brasília
const D = (c) => `coalesce(to_char(${c}, 'YYYY-MM-DD'), '')`;
const B = (c) => `case when ${c} then 'TRUE' else 'FALSE' end`;
const N = 'n'; // coluna numérica (as demais entram como texto: preserva zero à esquerda e nunca vira fórmula)

/** [rótulo da coluna, expressão SQL, tipo opcional] */
function aba(nome, tabela, ordem, colunas) { return { nome, tabela, ordem, colunas }; }

const ABAS = {
  tickets: aba('Tickets', 'tickets', 'row_index', [
    ['Linha', 'row_index::int', N], ['ID Ticket', 'id_ticket'], ['Pedido/Cliente', 'pedido'], ['ID da Venda', 'id_venda'], ['Identificador', 'identificador'],
    ['Fabrica', 'fabrica'], ['Setor', 'setor'], ['Responsavel', 'responsavel'], ['Responsavel Slug', 'responsavel_slug'], ['Status', 'status'],
    ['Data Abertura', TS('data_abertura')], ['Data Fechamento', TS('data_fechamento')], ['Origem', 'origem'], ['Link', 'link'], ['Observacao', 'observacao'],
    ['Anexos', 'anexos'], ['Tem Evento', B('tem_evento')], ['Data do Evento', TS('data_evento')], ['Entrega', 'entrega'], ['Aeroporto', 'aeroporto'],
    ['PPE', TS('ppe')], ['Previsao de Finalizacao', TS('previsao_finalizacao')], ['P Folha', TS('p_folha')], ['Novo Prazo', TS('novo_prazo')],
    ['Atraso Notificado', B('atraso_notificado')], ['Negocio Id', 'negocio_id'], ['Codigo de Rastreio', 'codigo_rastreio'],
    ['P. Entrega Transportadora', TS('previsao_entrega_transportadora')],
  ]),
  ticketsHistorico: aba('Historico', 'ticket_historico', 'id', [
    ['Data/Hora', TS('quando')], ['Linha do ticket', 'ticket_row_index::int', N], ['ID Ticket', 'id_ticket'], ['Usuario', 'usuario'], ['Acao', 'acao'],
    ['Detalhe', 'detalhe'], ['Slug', 'slug'],
  ]),
  erros: aba('Casos', 'erros_casos', 'row_index', [
    ['Linha', 'row_index::int', N], ['Carimbo de data/hora', D('data')], ['Auditoria', B('auditoria')], ['ID da venda', 'id_venda'], ['Nome do card', 'nome_card'],
    ['Descricao e solucao', 'descricao'], ['Link do card', 'link_pedido'], ['Quem cadastrou', 'quem_cadastrou'], ['Culpa de', 'culpa_de'],
    ['Setor do problema', 'setor'], ['Responsavel', 'responsavel'], ['Empresa', 'empresa'], ['Tipo de problema', 'tipo_problema'], ['Subproblema', 'subproblema'],
    ['Quantidade de produtos', 'qtd::float8', N], ['Custo do erro', 'custo::float8', N], ['Tipo de produto', 'tipo_produto'], ['Linha do produto', 'linha'],
    ['Que fim', 'que_fim'], ['Solucao', 'tipo_resolucao'], ['Status', 'status'], ['Foto', 'foto'], ['AprovacaoRefab', 'aprovacao_refab'],
    ['ComentarioAprovacao', 'comentario_aprovacao'], ['Comentario Final', 'comentario_final'], ['Registrado por (slug)', 'registrado_por_slug'],
  ]),
  errosHistorico: aba('Historico', 'erros_historico', 'id', [
    ['Data/Hora', TS('quando')], ['Linha do caso', 'caso_row_index::int', N], ['ID venda', 'id_venda'], ['Usuario', 'usuario'], ['Acao', 'acao'],
    ['Detalhe', 'detalhe'], ['Slug', 'slug'],
  ]),
  registro: aba('Registro', 'registro_demandas', 'ordem', [
    ['ID', 'id'], ['Data', D('data')], ['DataVencimento', D('data_vencimento')], ['IDCompra', 'id_compra'], ['LinkCard', 'link_card'], ['Solicitante', 'solicitante'],
    ['Empresa', 'empresa'], ['NumeroCorporativo', 'numero_corporativo'], ['TipoDemanda', 'tipo_demanda'], ['DemandaSolicitada', 'demanda_solicitada'],
    ['Observacao', 'observacao'], ['Email', 'email'], ['Anexos', 'anexos'], ['Status', 'status'], ['FeitoPor', 'feito_por'], ['InseridoEm', TSZ('inserido_em')],
    ['SolicitanteSlug', 'solicitante_slug'],
  ]),
  reembolso: aba('Reembolso', 'reembolsos', 'ordem', [
    ['ID', 'id'], ['DataVencimento', D('data_vencimento')], ['IDReferencia', 'id_referencia'], ['CPFCNPJ', 'cpf_cnpj'], ['Email', 'email'],
    ['MotivoReembolso', 'motivo_reembolso'], ['RazaoSocialCliente', 'razao_social_cliente'], ['Banco', 'banco'], ['Agencia', 'agencia'], ['Conta', 'conta'],
    ['ChavePix', 'chave_pix'], ['TipoChave', 'tipo_chave'], ['Valor', 'valor::float8', N], ['EmpresaResponsavel', 'empresa_responsavel'], ['Anexos', 'anexos'],
    ['Status', 'status'], ['FeitoPor', 'feito_por'], ['InseridoEm', TSZ('inserido_em')], ['SolicitanteSlug', 'solicitante_slug'],
  ]),
  notificacoes: aba('Notificacoes', 'notificacoes', 'criada_em, id', [
    ['ID', 'id'], ['Mensagem', 'mensagem'], ['Link', "coalesce(link, '')"], ['LidaPor', "array_to_string(lida_por, ',')"], ['CriadoEm', TSZ('criada_em')],
    ['Destinatario', 'destinatario'],
  ]),
  pagamentos: aba('Pagamentos', 'pagamentos', 'ordem', [
    ['ID', 'id'], ['DataVencimento', D('data_vencimento')], ['CPFCNPJ', 'cpf_cnpj'], ['Email', 'email'], ['Motivo', 'motivo'], ['RazaoSocial', 'razao_social'],
    ['Banco', 'banco'], ['Agencia', 'agencia'], ['Conta', 'conta'], ['ChavePix', 'chave_pix'], ['TipoChave', 'tipo_chave'], ['Valor', 'valor::float8', N],
    ['EmpresaResponsavel', 'empresa_responsavel'], ['Solicitante', 'solicitante'], ['NumeroNotaFiscal', 'numero_nota_fiscal'], ['Anexos', 'anexos'],
    ['Status', 'status'], ['FeitoPor', 'feito_por'], ['InseridoEm', TSZ('inserido_em')], ['SolicitanteSlug', 'solicitante_slug'],
  ]),
  corridas: aba('Corridas', 'corridas', 'ordem', [
    ['id', 'id'], ['dataCadastro', TSZ('data_cadastro')], ['dataCorrida', D('data_corrida')], ['numeroNf', 'numero_nf'], ['endereco', 'endereco'],
    ['valor', 'valor::float8', N], ['printUrl', 'print_urls::text'], ['registradoPorSlug', 'registrado_por_slug'], ['registradoPorNome', 'registrado_por_nome'],
    ['nomeMotorista', 'nome_motorista'],
  ]),
};

const S_N = (c) => `case when ${c} then 'Sim' else 'Nao' end`;
ABAS.quitacoes = aba('Quitacoes', 'quitacoes', 'ordem', [
  ['id', 'id'], ['dataCadastro', TSZ('data_cadastro')], ['idVendaOmie', 'id_venda_omie'], ['cliente', 'cliente'], ['dataPrevista', D('data_prevista')], ['linkCrm', 'link_crm'],
  ['modalidade', 'modalidade'], ['tipoEnvioAereo', 'tipo_envio_aereo'], ['aeroporto', 'aeroporto'], ['freteDedicado', "case when frete_dedicado then 'true' else 'false' end"],
  ['transportadora', 'transportadora'], ['entregador', 'entregador'], ['observacao', 'observacao'], ['cadastradoPorSlug', 'cadastrado_por_slug'], ['cadastradoPorNome', 'cadastrado_por_nome'],
  ['status', 'status'], ['dataPagamento', TSZ('data_pagamento')],
]);
ABAS.auditoria = aba('Sistema_Registro', 'auditorias', 'ordem', [
  ['Timestamp', TSZ('registrado_em')], ['Data', D('data')], ['Semana', 'semana'], ['AuditadoPor', 'auditado_por'], ['Agente', 'agente'], ['TipoOcorrencia', 'tipo_ocorrencia'], ['Canal', 'canal'],
  ['ConversationId', 'conversation_id'],
  ...['c11', 'c12', 'c13', 'c14', 'c21', 'c22', 'c23', 'c24', 'c31', 'c32', 'c33', 'c34'].map((c) => [c, `${c}::float8`, N]),
  ['S1', 's1::float8', N], ['S2', 's2::float8', N], ['S3', 's3::float8', N], ['Total', 'total::float8', N], ['Classificacao', 'classificacao'],
  ['FG1', S_N('fg1')], ['FG2', S_N('fg2')], ['FG3', S_N('fg3')], ['FG4', S_N('fg4')], ['FalhaGrave', S_N('falha_grave')], ['Observacoes', 'observacoes'],
]);
ABAS.pedidosUrgentes = aba('Pedidos', 'pedidos_urgentes', 'ordem', [
  ['ID', 'id'], ['OS', 'os'], ['Cliente', 'cliente'], ['LinkCRM', 'link_crm'], ['Transportadora', 'transportadora'], ['Modalidade', 'modalidade'],
  ['TipoEnvioAereo', 'tipo_envio_aereo'], ['AeroportoRetirada', 'aeroporto_retirada'], ['OSImagemId', 'os_imagem_id'], ['ManifestoLink', 'manifesto_link'],
  ['NotaFiscalLink', 'nota_fiscal_link'], ['Observacao', 'observacao'], ['Prazo', TSZ('prazo')], ['Status', 'status'], ['InseridoPor', 'inserido_por'],
  ['InseridoEm', TSZ('inserido_em')], ['DespachadoPor', 'despachado_por'], ['DespachadoEm', TSZ('despachado_em')],
]);
ABAS.wallacStatus = aba('Status_Producao_Wallac', 'wallac_status', 'linha_ltv', [
  ['linha_ltv', 'linha_ltv::int', N], ['status_atual', 'status_atual'], ['data_recebido', TSZ('data_recebido')], ['data_inicio_producao', TSZ('data_inicio_producao')], ['data_finalizado', TSZ('data_finalizado')],
]);
ABAS.wallacEstoque = aba('Estoque', 'wallac_estoque', 'id', [['linha', 'id::int', N], ['produto', 'produto'], ['quantidade', 'quantidade::float8', N]]);
ABAS.wallacSolicitacoes = aba('Solicitacoes_Estoque', 'wallac_solicitacoes', 'id', [
  ['linha', 'id::int', N], ['produto', 'produto'], ['quantidade', 'quantidade::float8', N], ['id_venda_cliente', 'id_venda_cliente'], ['prazo_producao', "coalesce(prazo_producao, '')"],
  ['prazo_entrega', "coalesce(prazo_entrega, '')"], ['observacoes', 'observacoes'], ['logo_url', 'logo_url'], ['status_atual', 'status_atual'], ['data_recebido', TSZ('data_recebido')],
  ['data_inicio_producao', TSZ('data_inicio_producao')], ['data_finalizado', TSZ('data_finalizado')], ['solicitante', 'solicitante'],
]);
ABAS.wallacPremiacao = aba('Premiacao_Historico', 'wallac_premiacao', 'semana_inicio', [
  ['semana_inicio', D('semana_inicio')], ['semana_fim', D('semana_fim')], ['pecas_no_prazo', 'pecas_no_prazo::int', N], ['faixa', 'faixa'], ['coins_da_semana', 'coins_da_semana::int', N],
  ['mes_referencia', 'mes_referencia'], ['coins_acumulados_no_mes', 'coins_acumulados_no_mes::int', N],
]);
ABAS.agendaFoco = aba('Foco', 'agenda_foco', 'id', [['Foco da semana', 'texto']]);
ABAS.agendaEventos = aba('Agenda', 'agenda_eventos', 'id', [['Linha', 'id::int', N], ['Dia', 'dia'], ['Horario', 'hora'], ['Descricao', 'descricao'], ['Tipo', 'tipo']]);

// Cada área = uma planilha (um Apps Script). "ativa" diz se ela já está no banco.
const AREAS = [
  { chave: 'tickets', rotulo: 'Tickets', url: () => env.ticketsAppsScriptUrl, abas: [{ aba: ABAS.tickets, ativa: () => env.ticketsBackend === 'db' }, { aba: ABAS.ticketsHistorico, ativa: () => env.ticketsBackend === 'db' }] },
  { chave: 'erros', rotulo: 'Painel de Erros', url: () => env.errosAppsScriptUrl, abas: [{ aba: ABAS.erros, ativa: () => env.errosBackend === 'db' }, { aba: ABAS.errosHistorico, ativa: () => env.errosBackend === 'db' }] },
  {
    chave: 'solicitacoes', rotulo: 'Solicitações Financeiro (Registro, Reembolso e Notificações)', url: () => env.registroDemandasAppsScriptUrl,
    abas: [{ aba: ABAS.registro, ativa: () => env.financeiroBackend === 'db' }, { aba: ABAS.reembolso, ativa: () => env.financeiroBackend === 'db' }, { aba: ABAS.notificacoes, ativa: () => env.notificacoesBackend === 'db' }],
  },
  { chave: 'pagamentos', rotulo: 'Pagamentos', url: () => env.corridasPagamentosAppsScriptUrl, abas: [{ aba: ABAS.pagamentos, ativa: () => env.financeiroBackend === 'db' }] },
  { chave: 'quitacoes', rotulo: 'Quitações Pendentes', url: () => env.quitacoesAppsScriptUrl, abas: [{ aba: ABAS.quitacoes, ativa: () => env.quitacoesBackend === 'db' }] },
  { chave: 'auditoria', rotulo: 'Auditoria de Qualidade', url: () => env.auditoriaAppsScriptUrl, abas: [{ aba: ABAS.auditoria, ativa: () => env.auditoriaBackend === 'db' }] },
  { chave: 'agenda', rotulo: 'Foco e Agenda da Semana', url: () => env.agendaSemanaAppsScriptUrl, abas: [{ aba: ABAS.agendaFoco, ativa: () => env.agendaBackend === 'db' }, { aba: ABAS.agendaEventos, ativa: () => env.agendaBackend === 'db' }] },
  { chave: 'pedidosUrgentes', rotulo: 'Pedidos Urgentes', url: () => env.pedidosUrgentesAppsScriptUrl, abas: [{ aba: ABAS.pedidosUrgentes, ativa: () => env.pedidosUrgentesBackend === 'db' }] },
  { chave: 'wallac', rotulo: 'Wallac (Produção SBP)', url: () => env.wallacAppsScriptUrl, abas: [{ aba: ABAS.wallacStatus, ativa: () => env.wallacBackend === 'db' }, { aba: ABAS.wallacEstoque, ativa: () => env.wallacBackend === 'db' }, { aba: ABAS.wallacSolicitacoes, ativa: () => env.wallacBackend === 'db' }, { aba: ABAS.wallacPremiacao, ativa: () => env.wallacBackend === 'db' }] },
  { chave: 'corridas', rotulo: 'Corridas Avulsas', url: () => env.corridasAvulsasAppsScriptUrl, abas: [{ aba: ABAS.corridas, ativa: () => env.financeiroBackend === 'db' }] },
];

// ── Datas (Brasília = UTC-3 fixo, sem horário de verão) ──
function agoraBrasilia(agora = new Date()) { return new Date(agora.getTime() - 3 * 3600000); }
function dataBrasilia(agora = new Date()) { return agoraBrasilia(agora).toISOString().slice(0, 10); }
/** Segunda a sexta, a partir das 20h de Brasília. */
function devidoAgora(agora = new Date()) {
  const b = agoraBrasilia(agora);
  const dia = b.getUTCDay(); // 0 = domingo ... 6 = sábado
  return dia >= 1 && dia <= 5 && b.getUTCHours() >= HORA_DO_BACKUP;
}

// ── Montagem ──
/** Lê uma tabela e devolve { nome, cabecalho, linhas, colunasNumero } pronto para enviar. */
async function montarAba(def) {
  const sql = `select ${def.colunas.map((c, i) => `${c[1]} as c${i}`).join(', ')} from ${def.tabela} order by ${def.ordem}`;
  const r = await db.query(sql);
  const linhas = r.rows.map((x) => def.colunas.map((_, i) => (x[`c${i}`] == null ? '' : x[`c${i}`])));
  return {
    nome: def.nome, cabecalho: def.colunas.map((c) => c[0]), linhas,
    colunasNumero: def.colunas.map((c, i) => (c[2] === N ? i : -1)).filter((i) => i >= 0),
  };
}

function areasAtivas() {
  return AREAS.map((a) => ({ ...a, abasAtivas: a.abas.filter((x) => x.ativa()).map((x) => x.aba) })).filter((a) => a.abasAtivas.length && a.url());
}

// ── Envio ──
let enviar = async (url, corpo) => {
  const { chamarAppsScript } = require('./appsScriptClient');
  return chamarAppsScript(url, { method: 'POST', body: corpo, timeoutMs: 170000 });
};
/** Só para testes. */
function definirEnvio(fn) { enviar = fn; }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let esperaEntreTentativasMs = 15000;
function definirEspera(ms) { esperaEntreTentativasMs = ms; }

async function enviarComTentativas(area, corpo) {
  let ultimo = '';
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await enviar(area.url(), corpo);
      if (r && typeof r === 'object' && r.ok) return r;
      const msg = r && typeof r === 'object' ? (r.erro || r.error || JSON.stringify(r)) : 'resposta que não é JSON (o Google devolveu uma página de erro)';
      ultimo = String(msg).slice(0, 200);
      if (/A[cç][aã]o (inv[aá]lida|desconhecida)/i.test(ultimo)) throw new Error('O Apps Script desta planilha ainda não tem a ação salvarBackup: cole o trecho novo e publique uma nova versão.');
    } catch (e) {
      ultimo = (e && e.message) || String(e);
      if (/ainda não tem a ação/.test(ultimo)) throw e; // não adianta tentar de novo
    }
    if (i < 3) await dormir(esperaEntreTentativasMs);
  }
  throw new Error(ultimo || 'falha desconhecida');
}

/** Faz o backup de todas as áreas ativas. Devolve { ok, data, areas: [{ chave, rotulo, abas|erro }] }. */
async function rodarBackup({ agora = new Date(), simular = false } = {}) {
  const data = dataBrasilia(agora);
  const resultado = { ok: true, data, areas: [] };
  for (const area of areasAtivas()) {
    const item = { chave: area.chave, rotulo: area.rotulo };
    try {
      const abas = [];
      for (const def of area.abasAtivas) abas.push(await montarAba(def));
      item.abas = abas.map((a) => ({ nome: a.nome, linhas: a.linhas.length }));
      if (!simular) {
        const r = await enviarComTentativas(area, { action: 'salvarBackup', data, manter: DIAS_GUARDADOS, abas });
        item.removidas = r.removidas || [];
      }
    } catch (e) {
      item.erro = (e && e.message) || String(e);
      resultado.ok = false;
    }
    resultado.areas.push(item);
  }
  return resultado;
}

const resumo = (r) => r.areas.map((a) => (a.erro ? `${a.rotulo}: ERRO ${a.erro}` : `${a.rotulo}: ${a.abas.map((x) => `${x.nome} ${x.linhas}`).join(', ')}`)).join(' | ');

// ── Agendamento: confere a cada 10 min; roda 1x por dia útil depois das 20h, até 3 tentativas ──
async function notificarFalha(texto) {
  try {
    const usuarios = require('./usuarios.service').listarUsuarios().filter((u) => u.role === 'gestor');
    const notificacoes = require('./notificacoes.service');
    for (const u of usuarios) await notificacoes.adicionar(`O backup das planilhas falhou hoje: ${texto}`.slice(0, 280), null, u.slug);
  } catch (e) { console.error('[backup] não consegui avisar os gestores:', e.message); }
}

/** Reserva o dia (1 execução por vez e por dia). Devolve a linha reservada, ou null se não é pra rodar agora. */
async function reservarDia(data) {
  const r = await db.query(
    `insert into backups_planilhas (data, status, tentativas) values ($1, 'rodando', 1)
     on conflict (data) do update set status = 'rodando', tentativas = backups_planilhas.tentativas + 1, iniciado_em = now(), concluido_em = null
       where backups_planilhas.tentativas < $2
         and (backups_planilhas.status = 'erro' or (backups_planilhas.status = 'rodando' and backups_planilhas.iniciado_em < now() - interval '30 minutes'))
     returning tentativas`,
    [data, MAX_TENTATIVAS_POR_DIA],
  );
  return r.rows[0] || null;
}

async function verificarEExecutar(agora = new Date()) {
  if (env.backupPlanilhas !== 'on' || !devidoAgora(agora)) return null;
  const data = dataBrasilia(agora);
  const reserva = await reservarDia(data);
  if (!reserva) return null;
  let resultado;
  try { resultado = await rodarBackup({ agora }); } catch (e) { resultado = { ok: false, data, areas: [{ rotulo: 'geral', erro: (e && e.message) || String(e) }] }; }
  const detalhe = resumo(resultado).slice(0, 4000);
  await db.query(`update backups_planilhas set status = $2, concluido_em = now(), detalhe = $3 where data = $1`, [data, resultado.ok ? 'ok' : 'erro', detalhe]);
  if (resultado.ok) console.log('[backup] concluído:', detalhe);
  else {
    console.error('[backup] falhou (tentativa', reserva.tentativas + '):', detalhe);
    if (reserva.tentativas >= MAX_TENTATIVAS_POR_DIA) await notificarFalha(detalhe);
  }
  return resultado;
}

function iniciarBackupPlanilhas() {
  if (env.backupPlanilhas !== 'on') { console.log('[backup] desligado (defina BACKUP_PLANILHAS=on para ligar)'); return; }
  const tick = () => verificarEExecutar().catch((e) => console.error('[backup] erro na verificação:', e.message));
  tick();
  setInterval(tick, INTERVALO_VERIFICACAO_MS);
  console.log('[backup] ligado: segunda a sexta, depois das 20h (Brasília), últimos', DIAS_GUARDADOS, 'dias em cada planilha');
}

module.exports = {
  AREAS, ABAS, areasAtivas, montarAba, rodarBackup, devidoAgora, dataBrasilia, reservarDia, verificarEExecutar, iniciarBackupPlanilhas,
  definirEnvio, definirEspera, resumo, DIAS_GUARDADOS,
};
