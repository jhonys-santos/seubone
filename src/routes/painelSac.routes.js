const express = require('express');
const { requireAuth, requirePainel, requireRole } = require('../middleware/auth');
const { resolveSlug } = require('../middleware/resolveSlug');
const { chamarAppsScript } = require('../services/appsScriptClient');
const { listarUsuarios } = require('../services/usuarios.service');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('painel-sac'));

// ── Auditoria de processos (time de atendimento) ──────────────────────────
// Até aqui essa seção vinha de abas internas da planilha do Painel SAC
// (Auditoria_Nathalia/Francis/Iasmin, com layout de colunas fixas por
// semana/mês). Passou a vir da planilha "Sistema_Registro" da Auditoria de
// Qualidade — mesmas regras de exibição (nota % do período, lista de
// atendimentos com nota individual 0-100), só trocou a fonte. Gabrielle e
// Daniel (time PPF) ficam de fora: o "auditorias" deles é uma contagem
// simples vs meta, processo diferente, não passou pela Auditoria de
// Qualidade — mantido como estava, lendo da planilha antiga.
const SAC_AGENTE_POR_SLUG = { nathalia: 'Nathalia', francis: 'Francis', iasmin: 'Iasmin' };

// Compara datas como inteiro AAAAMMDD (sem Date/fuso horário no meio) —
// evita virada de dia por conversão de timezone entre o que a planilha
// devolve e o que a semana/mês pedidos representam.
function dataParaChave(dataStr) {
  const d = new Date(dataStr);
  if (isNaN(d)) return null;
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function dataBrParaChave(dataBr) {
  const [dia, mes, ano] = String(dataBr).split('/').map(Number);
  if (!dia || !mes || !ano) return null;
  return ano * 10000 + mes * 100 + dia;
}
function registroNoPeriodo(dataStr, periodo, mes, ano, semIniStr, semFimStr) {
  const chave = dataParaChave(dataStr);
  if (chave === null) return false;
  if (periodo === 'semana' && semIniStr && semFimStr) {
    const ini = dataBrParaChave(semIniStr);
    const fim = dataBrParaChave(semFimStr);
    return ini !== null && fim !== null && chave >= ini && chave <= fim;
  }
  const d = new Date(dataStr);
  return d.getUTCMonth() === Number(mes) && d.getUTCFullYear() === Number(ano);
}

// Busca as auditorias do consultor pro período pedido e devolve no mesmo
// formato que o front-end já espera (indicadores.audit + auditorias_historico).
async function buscarAuditoriaSac(slugAlvo, periodo, mes, ano, semIni, semFim) {
  const agente = SAC_AGENTE_POR_SLUG[slugAlvo];
  if (!agente) return null;

  const json = await chamarAppsScript(env.auditoriaAppsScriptUrl);
  if (!json || !json.ok) return null;

  const doPeriodo = (json.data || [])
    .filter((r) => String(r.Agente || '').trim().toLowerCase() === agente.toLowerCase())
    .filter((r) => registroNoPeriodo(r.Data, periodo, mes, ano, semIni, semFim));

  const total = doPeriodo.length;
  const ok = doPeriodo.filter((r) => r.Classificacao !== 'CRITICO').length;
  const nota = total > 0 ? Math.round(doPeriodo.reduce((soma, r) => soma + Number(r.Total || 0), 0) / total) : null;
  const itens = doPeriodo.map((r) => ({ id: String(r.ConversationId || ''), obs: String(r.Observacoes || ''), score: Number(r.Total || 0) }));

  return {
    audit: { pct: nota !== null ? nota : 0, ok, total },
    historico: { nota, itens },
  };
}

router.get('/', (req, res) => {
  const u = req.session.user;
  const iniciais = u.nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

  // Lista de colaboradores que o gestor pode "ver como" — só monta se for gestor.
  // Gestor vê todo mundo, independente do time (sac ou ppf). Contas de teste
  // ("Diag..." — usadas só pra diagnosticar problema de indicador) ficam de
  // fora: não servem pra nada nesse dropdown, só teriam poluído a lista.
  const outrosColaboradores =
    u.role === 'gestor'
      ? listarUsuarios()
          .filter((c) => c.slug !== u.slug && !/^diag/i.test(c.nome))
          .map((c) => ({ slug: c.slug, nome: c.nome, tipo: c.tipo, indicadoresPendentes: !!c.indicadoresPendentes }))
      : [];

  res.render('painel-sac/index', {
    usuarioAtual: { ...u, iniciais },
    outrosColaboradores,
  });
});

// ── Aviso (banner exibido na home, logo após o login) ──────────────────
// Sempre usa o slug da própria sessão — o aviso é de quem está logado, não
// de quem um gestor esteja "vendo como". Reaproveita a action 'dados' do
// Apps Script (que já traz o aviso junto) pra não precisar de uma rota nova lá.
router.get('/api/aviso', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'dados', usuario: req.session.user.slug },
    });
    res.json({ aviso: json.aviso || null });
  } catch (err) {
    res.status(502).json({ aviso: null });
  }
});

// ── Indicadores pessoais (respeita resolveSlug: colaborador só vê o próprio slug) ──
router.get('/api/dados', resolveSlug, async (req, res) => {
  try {
    const { periodo, mes, ano, sem_ini, sem_fim } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'dados', usuario: req.slugAlvo, periodo, mes, ano, sem_ini, sem_fim },
    });

    if (SAC_AGENTE_POR_SLUG[req.slugAlvo] && json.indicadores) {
      try {
        const auditoria = await buscarAuditoriaSac(req.slugAlvo, periodo, mes, ano, sem_ini, sem_fim);
        if (auditoria) {
          json.indicadores.audit = auditoria.audit;
          json.auditorias_historico = auditoria.historico;
        }
      } catch (err) {
        // Não deixa uma falha na Auditoria de Qualidade quebrar o resto dos
        // indicadores — pior caso, essa seção específica fica sem dado.
        console.error('[painel-sac] falha ao buscar auditoria da Auditoria de Qualidade:', err.message);
      }
    }

    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar indicadores: ' + err.message });
  }
});

router.get('/api/escala', resolveSlug, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'escala', usuario: req.slugAlvo, mes, ano },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar escala: ' + err.message });
  }
});

// Escala da equipe inteira (Home, visão de gestor) numa chamada só — bem
// mais rápido que buscar pessoa por pessoa (era isso que deixava lento).
router.get('/api/escala-equipe', requireRole('gestor'), async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'escalaEquipe', mes, ano },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar escala da equipe: ' + err.message });
  }
});

// Editar a escala de qualquer consultor direto da Home (visão de gestor) —
// só gestor pode chamar, reforçado aqui no servidor (o Apps Script só confia
// no segredo compartilhado, quem pode usar essa ação é decidido aqui).
router.post('/api/escala', requireRole('gestor'), async (req, res) => {
  try {
    const { slug, dia, mes, ano, status } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'atualizarEscala', slug, dia, mes, ano, status },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar escala: ' + err.message });
  }
});

// Cadastro em lote (Férias/Feriados) — mesma trava de gestor, mesmo padrão.
router.post('/api/escala-lote', requireRole('gestor'), async (req, res) => {
  try {
    const { slugs, dias, status } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'atualizarEscalaLote', slugs, dias, status },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao cadastrar em lote: ' + err.message });
  }
});

// ── Consultores/sábados: listagem entre colegas para pedido de troca.       ──
// Não usa resolveSlug — qualquer colaborador autenticado pode ver a lista de
// colegas e os sábados de qualquer um (é assim que a troca peer-to-peer já
// funcionava no painel original; não é uma visão "gestor vê tudo").
router.get('/api/consultores', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'consultores', usuario: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar consultores: ' + err.message });
  }
});

router.get('/api/sabados-consultor', async (req, res) => {
  try {
    const { alvo, mes, ano } = req.query;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'sabadosConsultor', usuario: req.session.user.slug, alvo, mes, ano },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar sábados do colega: ' + err.message });
  }
});

router.post('/api/solicitar-troca', async (req, res) => {
  try {
    const u = req.session.user;
    const { dia_solicitante, mes_solicitante, ano_solicitante, consultor_alvo, dia_alvo, mes_alvo, ano_alvo } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: {
        action: 'solicitarTroca',
        usuario: u.slug, // sempre o usuário da sessão, nunca o que o cliente mandar
        dia_solicitante, mes_solicitante, ano_solicitante,
        consultor_alvo, dia_alvo, mes_alvo, ano_alvo,
      },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao solicitar troca: ' + err.message });
  }
});

router.post('/api/responder-troca', async (req, res) => {
  try {
    const u = req.session.user;
    const { id_troca, aceitar } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'responderTroca', usuario: u.slug, id_troca, aceitar },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao responder troca: ' + err.message });
  }
});

// ── Acessos (cofre de senhas pessoal) ────────────────────────────────────
// Sempre opera sobre o slug da PRÓPRIA sessão, nunca sobre slugAlvo/"ver como"
// — são as credenciais de ferramentas de quem está logado, não de quem o
// gestor está visualizando.
router.get('/api/acessos', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      params: { action: 'acessos', usuario: req.session.user.slug },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar acessos: ' + err.message });
  }
});

router.post('/api/acessos/salvar', async (req, res) => {
  try {
    const { ferramenta, login, senha, editIdx } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'salvarAcesso', usuario: req.session.user.slug, ferramenta, login, senha, editIdx },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao salvar acesso: ' + err.message });
  }
});

router.post('/api/acessos/excluir', async (req, res) => {
  try {
    const { editIdx } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'excluirAcesso', usuario: req.session.user.slug, editIdx },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao excluir acesso: ' + err.message });
  }
});

router.post('/api/sugestao', async (req, res) => {
  try {
    const u = req.session.user;
    const { titulo, sugestao } = req.body;
    const json = await chamarAppsScript(env.painelSacAppsScriptUrl, {
      method: 'POST',
      body: { action: 'sugestao', consultor: u.nome, titulo, sugestao },
    });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao enviar sugestão: ' + err.message });
  }
});

module.exports = router;
