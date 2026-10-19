// Formulário NOVO de solicitação ao financeiro: só os campos que o finfin pede, e o card nasce direto no kanban "Envio de demandas -
// Gerais" do finfin. Convive com o Registro antigo (/registro-demandas, n8n + planilha), que NÃO foi alterado.
//
// Modo (FINFIN_DEMANDAS_MODO): 'teste' (padrão) = só gestor abre e os cards saem com "[TESTE]" no título;
//                              'producao'     = aberto a quem acessa o Registro, sem prefixo.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const env = require('../config/env');
const db = require('../db');
const finfin = require('../services/finfinDemandas.service');

const router = express.Router();
router.use(requireAuth);

const emTeste = () => env.finfinDemandasModo !== 'producao';

// Em teste, só gestor (mesma tela de "acesso negado" do resto do hub).
router.use((req, res, next) => {
  if (emTeste() && (!req.session.user || req.session.user.role !== 'gestor')) {
    return res.status(403).render('erro', { titulo: 'Acesso negado', mensagem: 'Este formulário está em teste e só está liberado para gestores.', usuario: req.session.user || null });
  }
  next();
});

router.get('/', (req, res) => {
  res.render('registro-demandas/novo', { emTeste: emTeste(), nomeSolicitante: req.session.user.nome, integracaoConfigurada: finfin.configurado(), ehGestor: req.session.user.role === 'gestor' });
});

// Demandas oferecidas no formulário (lista real do finfin; reserva = lista antiga do hub).
router.get('/api/demandas', async (req, res) => {
  try {
    res.json({ ok: true, ...(await finfin.demandasAceitas()) });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar as demandas: ' + err.message });
  }
});

router.post('/api/enviar', async (req, res) => {
  try {
    if (!finfin.configurado()) return res.status(503).json({ ok: false, erro: 'A integração com o finfin ainda não está configurada (falta o token no servidor).' });
    const u = req.session.user;
    const b = req.body || {};
    // Solicitante vem sempre da sessão, nunca do que o navegador mandar.
    const lista = await finfin.demandasAceitas();
    const { payload, erros } = finfin.montarCard(
      { id: b.id, solicitante: u.nome, email: b.email, telefone: b.telefone, demandaSolicitada: b.demandaSolicitada, especificacao: b.especificacao, descricao: b.descricao, linkLulu: b.linkLulu, anexos: b.anexos },
      { demandasFinfin: lista.origem === 'finfin' ? lista.nomes : null, prefixoTitulo: emTeste() ? '[TESTE] ' : '' },
    );
    if (erros.length) return res.status(422).json({ ok: false, erro: erros[0], erros });

    const r = await finfin.criarCard(payload);
    if (!r.ok) {
      const detalhe = r.erros ? Object.values(r.erros).join(' ') : '';
      return res.status(r.status === 422 ? 422 : 502).json({ ok: false, erro: r.erro + (detalhe ? ' ' + detalhe : ''), erros: r.erros || null });
    }

    // Recibo local (o card mora no finfin). Se gravar falhar, o card já existe: não derruba a resposta.
    try {
      await db.query(
        `insert into finfin_demandas (id_finfin, codigo, solicitante_slug, solicitante_nome, solicitante_email, demanda, especificacao, link_lulu, titulo, coluna, modo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id_finfin) do nothing`,
        [payload.id, String(r.codigo || ''), u.slug || '', u.nome || '', payload.campos.solicitante_email, payload.campos.demanda_solicitada, payload.campos.especificacao || '',
          payload.campos.link_lulu, payload.campos.titulo || '', (r.coluna && r.coluna.chave) || 'backlog', emTeste() ? 'teste' : 'producao'],
      );
    } catch (e) { console.error('[registro-finfin] card criado, mas falhou ao gravar o recibo:', e.message); }

    res.json({ ok: true, codigo: r.codigo, coluna: r.coluna || null, anexos: r.anexos || null });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao enviar ao finfin: ' + err.message });
  }
});

// Últimas solicitações de quem está logado (recibos locais).
router.get('/api/minhas', async (req, res) => {
  try {
    const r = await db.query(
      `select codigo, demanda, coluna, modo, to_char(criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as criado_em,
              to_char(concluido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as concluido_em, anexos_retorno, comentario_retorno, concluido_por,
              (notificado_em is not null) as retorno_recebido
         from finfin_demandas where solicitante_slug = $1 order by ordem desc limit 20`, [req.session.user.slug || '']);
    res.json({ ok: true, itens: r.rows });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar suas solicitações: ' + err.message });
  }
});

// Situação atual de um card NO FINFIN (só dos que a própria pessoa criou).
router.get('/api/status', async (req, res) => {
  try {
    const codigo = String(req.query.codigo || '').trim();
    const dono = await db.query('select 1 from finfin_demandas where codigo = $1 and solicitante_slug = $2', [codigo, req.session.user.slug || '']);
    if (!codigo || !dono.rowCount) return res.status(404).json({ ok: false, erro: 'Solicitação não encontrada.' });
    const r = await finfin.consultarCard(codigo);
    if (!r.ok) return res.status(502).json({ ok: false, erro: r.erro });
    const chave = r.card && r.card.coluna && r.card.coluna.chave;
    if (chave) await db.query('update finfin_demandas set coluna = $2, atualizado_em = now(), concluido_em = case when $2 = \'concluido\' then coalesce(concluido_em, now()) else concluido_em end where codigo = $1', [codigo, chave]);
    res.json({ ok: true, coluna: r.card && r.card.coluna });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao consultar o finfin: ' + err.message });
  }
});

const soGestor = (req, res, next) => (req.session.user && req.session.user.role === 'gestor' ? next() : res.status(403).json({ ok: false, erro: 'Só gestor.' }));

// Últimas chamadas que o finfin fez ao webhook do hub + cards concluídos no finfin cujo retorno ainda não chegou.
router.get('/api/retornos', soGestor, async (req, res) => {
  try {
    const log = await db.query(
      `select to_char(recebido_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') as quando, http, codigo, coluna, resultado, anexos_recebidos, anexos_novos, notificado, erro, duracao_ms
         from finfin_webhook_log order by id desc limit 30`);
    const pend = await db.query(
      `select codigo, demanda, solicitante_nome, to_char(criado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as criado_em
         from finfin_demandas where coluna = 'concluido' and notificado_em is null order by ordem desc limit 30`);
    res.json({ ok: true, chamadas: log.rows, concluidosSemRetorno: pend.rows, webhookConfigurado: !!env.finfinWebhookSecret });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar os retornos: ' + err.message });
  }
});

// Confere com o finfin (GET por código) os cards ainda abertos e atualiza a coluna. Um card que já está Concluído lá e sem retorno aqui
// aparece em "concluidosSemRetorno" (o webhook não chegou: avisar o financeiro/finfin).
router.post('/api/conferir', soGestor, async (req, res) => {
  try {
    if (!finfin.configurado()) return res.status(503).json({ ok: false, erro: 'Falta o token do finfin no servidor.' });
    const abertos = await db.query(
      `select codigo from finfin_demandas where codigo <> '' and coluna not in ('concluido', 'cancelado') and criado_em > now() - interval '60 days' order by ordem desc limit 40`);
    let verificados = 0, mudaram = 0; const falhas = [];
    for (const { codigo } of abertos.rows) {
      const r = await finfin.consultarCard(codigo);
      if (!r.ok) { falhas.push(codigo); if (r.status === 429) break; continue; }
      verificados++;
      const chave = r.card && r.card.coluna && r.card.coluna.chave;
      if (!chave) continue;
      const up = await db.query(
        `update finfin_demandas set coluna = $2, atualizado_em = now(), concluido_em = case when $2 = 'concluido' then coalesce(concluido_em, now()) else concluido_em end
          where codigo = $1 and coluna <> $2`, [codigo, chave]);
      if (up.rowCount) mudaram++;
    }
    const pend = await db.query("select codigo from finfin_demandas where coluna = 'concluido' and notificado_em is null order by ordem desc limit 30");
    res.json({ ok: true, verificados, mudaram, falhas, concluidosSemRetorno: pend.rows.map((x) => x.codigo) });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao conferir com o finfin: ' + err.message });
  }
});

module.exports = router;
