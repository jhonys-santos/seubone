const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const escala = require('../services/manifestoEscala.service');
const agenda = require('../services/agendaStore');
const notificacoes = require('../services/notificacoes.service');
const usuarios = require('../services/usuarios.service');

const router = express.Router();
const LINK = '/manifesto-escala';

// Qualquer usuário logado vê a escala e pede/responde troca; só o gestor edita (reforçado nas rotas abaixo). Sem requirePainel: todos podem estar na escala.
router.use(requireAuth);

const avisar = (mensagem, slug) => notificacoes.adicionar(mensagem, LINK, slug).catch((e) => console.error('[manifesto-escala] falha ao notificar:', e.message));
const eventosDaAgenda = async () => {
  try { const r = await agenda.ler(); return r && r.ok && r.dados && Array.isArray(r.dados.eventos) ? r.dados.eventos : []; } catch (e) { return []; }
};
const falha = (res, e, o) => res.status(502).json({ ok: false, erro: `Falha ao ${o}: ${e.message}` });

router.get('/', (req, res) => { res.render('manifesto-escala/index'); });

router.get('/api/mes', async (req, res) => {
  try {
    const hoje = escala.hojeBrasilia();
    const ano = req.query.ano !== undefined ? Number(req.query.ano) : Number(hoje.data.slice(0, 4));
    const mes = req.query.mes !== undefined ? Number(req.query.mes) : Number(hoje.data.slice(5, 7)) - 1;
    const u = req.session.user;
    const [linhas, trocas, proximos, hojeLinha] = await Promise.all([escala.doMes(ano, mes), escala.trocasDe(u.slug), escala.proximosDe(u.slug, hoje.data), escala.doDia(hoje.data)]);
    res.json({
      ok: true, hoje: hoje.data, hojeLinha, ano, mes, escala: linhas, trocas, proximos, ligado: escala.ligado(),
      eu: { slug: u.slug, nome: u.nome, gestor: u.role === 'gestor' },
      usuarios: usuarios.listarUsuarios().filter((x) => !/^diag/i.test(x.nome)).map((x) => ({ slug: x.slug, nome: x.nome })),
      horaPadrao: '17:45', horaSexta: '16:45',
    });
  } catch (e) { falha(res, e, 'carregar a escala'); }
});

// Gestor: define quem faz o Manifesto numa data (e a hora), marca "sem Manifesto" ou volta ao rodízio semanal da Agenda.
router.post('/api/dia', requireRole('gestor'), async (req, res) => {
  try {
    const { data, acao, slug, hora } = req.body || {};
    const u = req.session.user;
    let r;
    if (acao === 'remover') r = await escala.definirDia({ data, slug: null }, u.slug);
    else if (acao === 'sem-manifesto') r = await escala.definirDia({ data, slug: '', hora }, u.slug);
    else if (!slug) return res.status(400).json({ ok: false, erro: 'Escolha quem faz o Manifesto.' });
    else r = await escala.definirDia({ data, slug, hora }, u.slug);
    if (r.ok && r.slug && r.mudouPessoa && r.slug !== u.slug && data >= escala.hojeBrasilia().data) {
      avisar(`Você foi escalado(a) para o Manifesto de ${escala.brData(data)} às ${r.hora}.`, r.slug);
    }
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { falha(res, e, 'salvar o dia'); }
});

router.post('/api/rodizio', requireRole('gestor'), async (req, res) => {
  try {
    const { ano, mes } = req.body || {};
    const r = await escala.preencherRodizio({ ano, mes, eventosAgenda: await eventosDaAgenda() }, req.session.user.slug);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { falha(res, e, 'preencher o rodízio'); }
});

// Dias futuros de um colega (para escolher o dia da troca).
router.get('/api/datas-colega', async (req, res) => {
  try { res.json({ ok: true, datas: await escala.datasFuturasDe(String(req.query.slug || '')) }); } catch (e) { falha(res, e, 'buscar os dias do colega'); }
});

router.post('/api/trocas', async (req, res) => {
  try {
    const u = req.session.user;   // quem pede é sempre o usuário da sessão
    const { dataSol, alvo, dataAlvo, motivo } = req.body || {};
    const r = await escala.solicitarTroca({ solicitante: u.slug, dataSol, alvo, dataAlvo, motivo });
    if (r.ok) avisar(`${u.nome} pediu para trocar o Manifesto de ${escala.brData(dataSol)} pelo seu de ${escala.brData(dataAlvo)}. Responda na Escala do Manifesto.`, r.alvo);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { falha(res, e, 'pedir a troca'); }
});

router.post('/api/trocas/:id/responder', async (req, res) => {
  try {
    const u = req.session.user;
    const aceitar = !!(req.body && req.body.aceitar);
    const r = await escala.responderTroca({ id: req.params.id, slug: u.slug, aceitar });
    if (r.ok && r.troca) {
      const t = r.troca;
      avisar(aceitar ? `${u.nome} aceitou a troca: você faz o Manifesto de ${escala.brData(t.dataAlvo)} e ${u.nome} faz o de ${escala.brData(t.dataSol)}.` : `${u.nome} recusou a troca do Manifesto de ${escala.brData(t.dataSol)}.`, t.solicitante);
    }
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { falha(res, e, 'responder a troca'); }
});

router.post('/api/trocas/:id/cancelar', async (req, res) => {
  try { const r = await escala.cancelarTroca({ id: req.params.id, slug: req.session.user.slug }); res.status(r.ok ? 200 : 400).json(r); } catch (e) { falha(res, e, 'cancelar a troca'); }
});

// Fonte do alerta do Manifesto (manifesto-alerta.js): os eventos de HOJE. Aberto a qualquer usuário logado, para todo mundo da escala receber o aviso.
router.get('/api/alerta', async (req, res) => {
  try {
    // Com a escala desligada o alerta continua só para quem já lia a Agenda (painel Ranking SAC), como antes.
    if (!escala.ligado() && !usuarios.podeAcessarPainel(req.session.user, 'ranking-sac')) return res.json({ ok: true, fonte: 'agenda', eventos: [] });
    const { fonte, eventos } = await escala.eventosDoAlerta(await eventosDaAgenda());
    res.set('Cache-Control', 'no-store').json({ ok: true, fonte, eventos });
  } catch (e) { falha(res, e, 'buscar o alerta'); }
});

module.exports = router;
