const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const TEMPLATES = require('../config/autorizacoesTemplates');
const { acharTpl, prepararValores, buildFilename, preencherTexto, regrasAtivas, ccDaRegra } = require('../services/autorizacoes.service');
const { gerarPdf } = require('../services/pdfAutorizacoes');
const { enviarEmail } = require('../services/email.service');

const router = express.Router();

router.use(requireAuth, requirePainel('autorizacoes'));

// Mesma coisa que getClientConfig() no Apps Script original: manda pro
// formulário só os campos que o usuário preenche (os "auto", como a data de
// hoje, o servidor calcula sozinho na hora de gerar).
function configPublica() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    fields: t.fields.filter((f) => !f.auto),
  }));
}

router.get('/', (req, res) => {
  res.render('autorizacoes/index', { config: configPublica() });
});

// Gera o PDF e devolve pro navegador IMEDIATAMENTE — os e-mails cujo
// gatilho (checkbox) estiver marcado disparam depois, em segundo plano.
// Antes eles eram enviados antes de responder, então uma rede que bloqueia
// a porta SMTP silenciosamente (comum em PaaS) travava o download junto
// com o e-mail; agora o PDF nunca fica hostage do envio.
router.post('/api/gerar', async (req, res) => {
  try {
    const { templateId, values } = req.body;
    const tpl = acharTpl(templateId);
    const dados = prepararValores(tpl, values || {});
    const pdf = await gerarPdf(templateId, dados);
    const filename = buildFilename(tpl, dados) + '.pdf';

    const emailsAgendados = regrasAtivas(tpl, values || {})
      .map((regra) => ({ regra, destino: regra.toField ? (dados[regra.toField] || '') : regra.to, cc: ccDaRegra(regra, values || {}, dados) }))
      .filter((e) => e.destino);

    res.json({
      ok: true,
      filename,
      base64: pdf.toString('base64'),
      mimeType: 'application/pdf',
      emailsAgendados: emailsAgendados.map((e) => ({ label: e.regra.label, to: e.destino, cc: e.cc })),
    });

    for (const { regra, destino, cc } of emailsAgendados) {
      enviarEmail({
        to: destino,
        cc,
        subject: preencherTexto(regra.subject, dados),
        text: preencherTexto(regra.body, dados),
        attachment: { filename, content: pdf },
      }).catch((err) => {
        console.error(`[autorizacoes] falha ao enviar e-mail (${regra.label}) para ${destino}:`, err.message);
      });
    }
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});

module.exports = router;
