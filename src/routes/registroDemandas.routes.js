const express = require('express');
const { requireAuth } = require('../middleware/auth');
const financeiroStore = require('../services/financeiroStore');
const finfinHistorico = require('../services/finfinHistorico.service');
const notificacoesService = require('../services/notificacoes.service');
const env = require('../config/env');

const router = express.Router();

// Webhook do n8n avisando que uma solicitação (Registro ou Reembolso) foi
// concluída pelo financeiro — protegido por segredo compartilhado, não por
// sessão (o n8n não é um usuário logado no hub, por isso essa rota vem
// ANTES do requireAuth abaixo, pra não exigir login de quem está chamando).
router.post('/webhook/n8n', async (req, res) => {
  try {
    const { segredo, tipo, id, anexos, concluidoPor } = req.body;
    if (!env.n8nWebhookSecret || segredo !== env.n8nWebhookSecret) {
      return res.status(401).json({ ok: false, erro: 'Segredo inválido.' });
    }
    if (!id || (tipo !== 'registro' && tipo !== 'reembolso')) {
      return res.status(400).json({ ok: false, erro: 'Informe "id" e "tipo" ("registro" ou "reembolso").' });
    }

    const dados = { id, status: 'Feito', marcadoPor: concluidoPor || 'Financeiro (n8n)', anexos: anexos || [] };
    const json = tipo === 'reembolso' ? await financeiroStore.marcarReembolso(dados) : await financeiroStore.marcarRegistro(dados);
    if (json.ok) {
      const link = tipo === 'reembolso' ? '/registro-demandas/historico-reembolso' : '/registro-demandas/historico';
      const referencia = json.referencia || id;
      // Notifica só quem criou (slug gravado na hora da criação); se a
      // solicitação é antiga e não tem isso registrado, avisa todo mundo
      // em vez de deixar a notificação sem destinatário nenhum.
      notificacoesService.adicionar(`Solicitação referente ao ID ${referencia} foi concluída pelo financeiro.`, link, json.solicitanteSlug || null)
        .catch((err) => console.error('[registro-demandas] falha ao criar notificação:', err.message));
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao processar retorno do n8n: ' + err.message });
  }
});

router.use(requireAuth);

// Avisa o n8n quando uma solicitação é criada — não trava nem falha o
// cadastro do usuário se o n8n estiver fora do ar ou a URL ainda não
// tiver sido configurada (só loga o erro).
async function notificarN8n(tipo, payload) {
  if (!env.n8nRegistroDemandasWebhookUrl) return;
  try {
    await fetch(env.n8nRegistroDemandasWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, ...payload }),
    });
  } catch (err) {
    console.error('[registro-demandas] falha ao notificar n8n:', err.message);
  }
}

// Pagamento (geral) usa a mesma planilha/webhook do "Solicitar pagamento"
// de Corridas Avulsas (env.corridasPagamentosAppsScriptUrl /
// env.n8nCorridasPagamentosWebhookUrl) — são dois pontos de entrada pro
// mesmo pipeline, não dois sistemas separados. "tipo: 'pagamento'" é o
// que o n8n usa pra saber qual branch seguir dentro do workflow.
async function notificarN8nPagamento(payload) {
  if (!env.n8nCorridasPagamentosWebhookUrl) return;
  try {
    await fetch(env.n8nCorridasPagamentosWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'pagamento', ...payload }),
    });
  } catch (err) {
    console.error('[registro-demandas] falha ao notificar n8n (pagamento):', err.message);
  }
}

// Sem restrição de painel — "visível pra todo mundo" no hub, por decisão
// do usuário (diferente da Gestão de Estoque do Wallac, que é só de uma
// pessoa).
// Com FINFIN_DEMANDAS_MODO=producao o "Registro" passa a ser o formulário novo (card direto no finfin) para todo mundo: o menu e
// os favoritos continuam em /registro-demandas, só o destino muda. Voltar o modo para 'teste' devolve o formulário antigo.
const finfinNoAr = () => env.finfinDemandasModo === 'producao';

router.get('/', (req, res) => {
  if (finfinNoAr()) return res.redirect('/registro-demandas/novo');
  res.render('registro-demandas/index');
});

// Idem para o Reembolso: com FINFIN_REEMBOLSO_MODO=producao, /registro-demandas/reembolso leva ao formulário novo (kanban "Solicitações de reembolso - SAC").
const finfinReembolsoNoAr = () => env.finfinReembolsoModo === 'producao';

router.get('/reembolso', (req, res) => {
  if (finfinReembolsoNoAr()) return res.redirect('/registro-demandas/reembolso/novo');
  res.render('registro-demandas/reembolso');
});

router.get('/historico', (req, res) => {
  res.render('registro-demandas/historico');
});

router.get('/historico-reembolso', (req, res) => {
  res.render('registro-demandas/historico-reembolso');
});

// Idem para o Pagamento: com FINFIN_PAGAMENTO_MODO=producao, /registro-demandas/pagamento leva ao formulário novo (kanban "Pagamentos" do finfin).
const finfinPagamentoNoAr = () => env.finfinPagamentoModo === 'producao';

router.get('/pagamento', (req, res) => {
  if (finfinPagamentoNoAr()) return res.redirect('/registro-demandas/pagamento/novo');
  res.render('registro-demandas/pagamento');
});

router.get('/historico-pagamento', (req, res) => {
  res.render('registro-demandas/historico-pagamento');
});

router.get('/api/list', async (req, res) => {
  try {
    const json = await financeiroStore.listarRegistros();
    res.json(json);
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar demandas: ' + err.message });
  }
});

// Solicitações do formulário novo (finfin), no mesmo formato de linha do /api/list, para o Histórico mostrar tudo junto.
// Cards de teste só aparecem para gestor.
router.get('/api/list-finfin', async (req, res) => {
  try {
    res.json(await finfinHistorico.listarParaHistorico({ ehGestor: req.session.user && req.session.user.role === 'gestor' }));
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar as solicitações do finfin: ' + err.message });
  }
});

// Pagamentos do formulário novo (finfin), no mesmo formato de linha do /api/list-pagamento. Cards de teste só aparecem para gestor.
router.get('/api/list-pagamento-finfin', async (req, res) => {
  try {
    res.json(await finfinHistorico.listarPagamentosParaHistorico({ ehGestor: req.session.user && req.session.user.role === 'gestor' }));
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar os pagamentos do finfin: ' + err.message });
  }
});

// Reembolsos do formulário novo (finfin), no mesmo formato de linha do /api/list-reembolso. Cards de teste só aparecem para gestor.
router.get('/api/list-reembolso-finfin', async (req, res) => {
  try {
    res.json(await finfinHistorico.listarReembolsosParaHistorico({ ehGestor: req.session.user && req.session.user.role === 'gestor' }));
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar os reembolsos do finfin: ' + err.message });
  }
});

router.get('/api/list-reembolso', async (req, res) => {
  try {
    const json = await financeiroStore.listarReembolsos();
    res.json(json);
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar reembolsos: ' + err.message });
  }
});

router.get('/api/list-pagamento', async (req, res) => {
  try {
    const json = await financeiroStore.listarPagamentos();
    res.json(json);
  } catch (err) {
    res.status(502).json({ erro: 'Falha ao buscar pagamentos: ' + err.message });
  }
});

router.post('/api/create', async (req, res) => {
  // Aba do formulário antigo que ficou aberta durante a troca: não grava mais (a solicitação nasceria fora do finfin).
  if (finfinNoAr()) {
    return res.status(410).json({ ok: false, erro: 'O formulário de Registro foi atualizado. Recarregue a página (F5) e envie novamente.' });
  }
  try {
    // "solicitanteSlug" vem sempre da sessão, nunca do corpo enviado pelo
    // cliente — é o que a notificação de retorno usa pra saber quem avisar,
    // não pode ser algo que o navegador possa forjar.
    const json = await financeiroStore.criarRegistro({ ...req.body, solicitanteSlug: req.session.user.slug });
    if (json.ok) {
      const { anexos, ...campos } = req.body;
      notificarN8n('registro', { id: json.id, ...campos, anexos: json.anexos || [] });
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao registrar demanda: ' + err.message });
  }
});

router.post('/api/create-reembolso', async (req, res) => {
  // Aba do formulário antigo que ficou aberta durante a troca: não grava mais (o reembolso nasceria fora do finfin).
  if (finfinReembolsoNoAr()) {
    return res.status(410).json({ ok: false, erro: 'O formulário de Reembolso foi atualizado. Recarregue a página (F5) e envie novamente.' });
  }
  try {
    // "solicitanteSlug" vem sempre da sessão — ver comentário equivalente
    // em /api/create.
    const json = await financeiroStore.criarReembolso({ ...req.body, solicitanteSlug: req.session.user.slug });
    if (json.ok) {
      // "id" no req.body é a referência que a pessoa digitou no formulário
      // (coluna IDReferencia na planilha), não o ID interno gerado pelo
      // Apps Script — precisa sair do spread, senão sobrescreve o ID real.
      // Manda como "idPainelSc" (mesmo nome do campo customizado já usado
      // no ClickUp do Registro) pra não ficar ambíguo com "idReferencia" na
      // hora de mapear os campos no n8n.
      const { anexos, id: idReferencia, ...campos } = req.body;
      notificarN8n('reembolso', { idPainelSc: json.id, idReferencia, ...campos, anexos: json.anexos || [] });
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao registrar reembolso: ' + err.message });
  }
});

router.post('/api/create-pagamento', async (req, res) => {
  // Aba do formulário antigo que ficou aberta durante a troca: não grava mais (o pagamento nasceria fora do finfin).
  if (finfinPagamentoNoAr()) {
    return res.status(410).json({ ok: false, erro: 'O formulário de Pagamento foi atualizado. Recarregue a página (F5) e envie novamente.' });
  }
  try {
    const { anexos, ...campos } = req.body;
    // "solicitanteSlug" vem sempre da sessão — ver comentário equivalente
    // em /api/create.
    const json = await financeiroStore.criarPagamento({ ...req.body, solicitanteSlug: req.session.user.slug });
    if (json.ok) {
      notificarN8nPagamento({ id: json.id, ...campos, anexos: json.anexos || [] });
    }
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao registrar pagamento: ' + err.message });
  }
});

router.post('/api/marcar', async (req, res) => {
  try {
    const { id, status, marcadoPor } = req.body;
    const json = await financeiroStore.marcarRegistro({ id, status, marcadoPor });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar status: ' + err.message });
  }
});

router.post('/api/marcar-reembolso', async (req, res) => {
  try {
    const { id, status, marcadoPor } = req.body;
    const json = await financeiroStore.marcarReembolso({ id, status, marcadoPor });
    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao atualizar status: ' + err.message });
  }
});

module.exports = router;
