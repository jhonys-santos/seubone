// Router de um formulário novo que cria card direto no finfin: Pagamento, Reembolso SAC ou Análise de termo.
//   GET  /               a tela
//   POST /api/enviar     cria o card (solicitante sempre da sessão) e grava o recibo
//   GET  /api/minhas     últimos pedidos de quem está logado
//   GET  /api/status     situação atual de um card no finfin (só dos que a própria pessoa criou)
//
// Modo (FINFIN_PAGAMENTO_MODO / FINFIN_REEMBOLSO_MODO / FINFIN_ANALISE_TERMO_MODO): 'teste' (padrão) = só gestor abre e os cards saem com
// "[TESTE]"; 'producao' = aberto a todos, sem prefixo. Ver finfinFormularios.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const finfin = require('../services/finfinDemandas.service');
const consulta = require('../services/finfinConsulta.service');
const envio = require('../services/finfinEnvio.service');

function criarRouter({ formulario, view }) {
  const router = express.Router();
  router.use(requireAuth);

  // Em teste, só gestor (mesma tela de "acesso negado" do resto do hub).
  router.use((req, res, next) => {
    if (envio.emTeste(formulario) && (!req.session.user || req.session.user.role !== 'gestor')) {
      return res.status(403).render('erro', { titulo: 'Acesso negado', mensagem: 'Este formulário está em teste e só está liberado para gestores.', usuario: req.session.user || null });
    }
    next();
  });

  router.get('/', (req, res) => {
    res.render(view, { emTeste: envio.emTeste(formulario), nomeSolicitante: req.session.user.nome, integracaoConfigurada: finfin.configurado() });
  });

  router.post('/api/enviar', async (req, res) => {
    try {
      const r = await envio.enviar({ formulario, usuario: req.session.user, corpo: req.body });
      res.status(r.http).json(r.json);
    } catch (err) {
      res.status(502).json({ ok: false, erro: 'Falha ao enviar ao finfin: ' + err.message });
    }
  });

  router.get('/api/minhas', async (req, res) => {
    try {
      const r = await db.query(
        `select codigo, demanda, dados, coluna, modo, to_char(criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as criado_em,
                to_char(concluido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as concluido_em, anexos_retorno, comentario_retorno, concluido_por
           from finfin_demandas where solicitante_slug = $1 and formulario = $2 order by ordem desc limit 20`, [req.session.user.slug || '', formulario]);
      res.json({ ok: true, itens: r.rows });
    } catch (err) {
      res.status(502).json({ ok: false, erro: 'Falha ao buscar suas solicitações: ' + err.message });
    }
  });

  router.get('/api/status', async (req, res) => {
    try {
      const codigo = String(req.query.codigo || '').trim();
      const dono = await db.query('select 1 from finfin_demandas where codigo = $1 and solicitante_slug = $2 and formulario = $3', [codigo, req.session.user.slug || '', formulario]);
      if (!codigo || !dono.rowCount) return res.status(404).json({ ok: false, erro: 'Solicitação não encontrada.' });
      const r = await consulta.sincronizarCard(codigo);
      if (!r.ok) return res.status(502).json({ ok: false, erro: r.erro });
      res.json({ ok: true, coluna: r.coluna });
    } catch (err) {
      res.status(502).json({ ok: false, erro: 'Falha ao consultar o finfin: ' + err.message });
    }
  });

  return router;
}

module.exports = { criarRouter };
