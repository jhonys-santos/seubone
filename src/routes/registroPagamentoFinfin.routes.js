// Formulário NOVO de pagamento: o card nasce direto no kanban "Pagamentos" do finfin (módulo Demandas), com os mesmos campos do formulário
// público de lá. Mesma ideia do Registro novo (registroDemandasFinfin.routes.js).
//
// Modo (FINFIN_PAGAMENTO_MODO): 'teste' (padrão) = só gestor abre e os cards saem com "[TESTE]" no título; o Pagamento antigo
//                                                   (/registro-demandas/pagamento, n8n + planilha) segue valendo para todos;
//                               'producao'     = este formulário é o Pagamento de todo mundo, sem prefixo; /registro-demandas/pagamento
//                                                   redireciona para cá e o /api/create-pagamento antigo deixa de gravar.
const crypto = require('crypto');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const env = require('../config/env');
const db = require('../db');
const finfin = require('../services/finfinDemandas.service');
const consulta = require('../services/finfinConsulta.service');

const router = express.Router();
router.use(requireAuth);

const emTeste = () => env.finfinPagamentoModo !== 'producao';

// Em teste, só gestor (mesma tela de "acesso negado" do resto do hub).
router.use((req, res, next) => {
  if (emTeste() && (!req.session.user || req.session.user.role !== 'gestor')) {
    return res.status(403).render('erro', { titulo: 'Acesso negado', mensagem: 'Este formulário está em teste e só está liberado para gestores.', usuario: req.session.user || null });
  }
  next();
});

router.get('/', (req, res) => {
  res.render('registro-demandas/pagamento-novo', { emTeste: emTeste(), nomeSolicitante: req.session.user.nome, integracaoConfigurada: finfin.configurado() });
});

router.post('/api/enviar', async (req, res) => {
  try {
    if (!finfin.configurado()) return res.status(503).json({ ok: false, erro: 'A integração com o finfin ainda não está configurada (falta o token no servidor).' });
    const u = req.session.user;
    const b = req.body || {};
    // Solicitante vem sempre da sessão, nunca do que o navegador mandar.
    const { payload, erros } = finfin.montarCardPagamento(
      { id: b.id, solicitante: u.nome, email: b.email, razaoSocial: b.razaoSocial, vencimento: b.vencimento, cpfCnpj: b.cpfCnpj, motivo: b.motivo, banco: b.banco,
        agencia: b.agencia, conta: b.conta, pixTipo: b.pixTipo, pixChave: b.pixChave, valor: b.valor, notaFiscal: b.notaFiscal, anexos: b.anexos },
      { prefixoTitulo: emTeste() ? '[TESTE] ' : '' },
    );
    if (erros.length) return res.status(422).json({ ok: false, erro: erros[0], erros });

    const r = await finfin.criarCard(payload);
    if (!r.ok) {
      const detalhe = r.erros ? Object.values(r.erros).join(' ') : '';
      return res.status(r.status === 422 ? 422 : 502).json({ ok: false, erro: r.erro + (detalhe ? ' ' + detalhe : ''), erros: r.erros || null });
    }

    // Recibo local (o card mora no finfin). Se gravar falhar, o card já existe: não derruba a resposta.
    try {
      const c = payload.campos;
      await db.query(
        `insert into finfin_demandas (id_finfin, codigo, solicitante_slug, solicitante_nome, solicitante_email, demanda, titulo, coluna, modo, formulario, dados, anexos_enviados)
         values ($1,$2,$3,$4,$5,'Pagamento',$6,$7,$8,'pagamento',$9::json,$10::json) on conflict (id_finfin) do nothing`,
        [payload.id, String(r.codigo || ''), u.slug || '', u.nome || '', c.solicitante_email, c.titulo || '', (r.coluna && r.coluna.chave) || 'backlog', emTeste() ? 'teste' : 'producao',
          JSON.stringify({ razao_social: c.razao_social, vencimento: c.vencimento, cpf_cnpj: c.cpf_cnpj, motivo: c.motivo, banco: c.banco, agencia: c.agencia, conta: c.conta,
            pix_tipo: c.pix_tipo, pix_chave: c.pix_chave, valor: c.valor, nota_fiscal: c.nota_fiscal }),
          JSON.stringify((payload.anexos || []).map((a) => ({ nome: a.nome, hash: crypto.createHash('sha256').update(Buffer.from(a.conteudo_base64, 'base64')).digest('hex') })))],
      );
    } catch (e) { console.error('[pagamento-finfin] card criado, mas falhou ao gravar o recibo:', e.message); }

    res.json({ ok: true, codigo: r.codigo, coluna: r.coluna || null, anexos: r.anexos || null });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao enviar ao finfin: ' + err.message });
  }
});

// Últimos pagamentos de quem está logado (recibos locais).
router.get('/api/minhas', async (req, res) => {
  try {
    const r = await db.query(
      `select codigo, dados, coluna, modo, to_char(criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as criado_em,
              to_char(concluido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') as concluido_em, anexos_retorno, comentario_retorno, concluido_por
         from finfin_demandas where solicitante_slug = $1 and formulario = 'pagamento' order by ordem desc limit 20`, [req.session.user.slug || '']);
    res.json({ ok: true, itens: r.rows });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar seus pagamentos: ' + err.message });
  }
});

// Situação atual de um card NO FINFIN (só dos que a própria pessoa criou).
router.get('/api/status', async (req, res) => {
  try {
    const codigo = String(req.query.codigo || '').trim();
    const dono = await db.query("select 1 from finfin_demandas where codigo = $1 and solicitante_slug = $2 and formulario = 'pagamento'", [codigo, req.session.user.slug || '']);
    if (!codigo || !dono.rowCount) return res.status(404).json({ ok: false, erro: 'Pagamento não encontrado.' });
    const r = await consulta.sincronizarCard(codigo);
    if (!r.ok) return res.status(502).json({ ok: false, erro: r.erro });
    res.json({ ok: true, coluna: r.coluna });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao consultar o finfin: ' + err.message });
  }
});

module.exports = router;
