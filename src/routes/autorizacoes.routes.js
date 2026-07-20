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

// Gera o PDF e, na mesma chamada, já dispara os e-mails cujo gatilho
// (checkbox) estiver marcado — não existe mais um segundo clique de
// confirmação pra enviar. Uma falha no envio nunca bloqueia o download: o
// PDF sempre volta pro navegador, e o que der errado no e-mail aparece
// separado em "emailsComErro".
router.post('/api/gerar', async (req, res) => {
  try {
    const { templateId, values } = req.body;
    const tpl = acharTpl(templateId);
    const dados = prepararValores(tpl, values || {});
    const pdf = await gerarPdf(templateId, dados);
    const filename = buildFilename(tpl, dados) + '.pdf';

    const emailsEnviados = [];
    const emailsComErro = [];
    for (const regra of regrasAtivas(tpl, values || {})) {
      const destino = regra.toField ? (dados[regra.toField] || '') : regra.to;
      const cc = ccDaRegra(regra, values || {}, dados);
      if (!destino) continue;
      try {
        await enviarEmail({
          to: destino,
          cc,
          subject: preencherTexto(regra.subject, dados),
          text: preencherTexto(regra.body, dados),
          attachment: { filename, content: pdf },
        });
        emailsEnviados.push({ label: regra.label, to: destino, cc });
      } catch (err) {
        emailsComErro.push({ label: regra.label, erro: err.message });
      }
    }

    res.json({ ok: true, filename, base64: pdf.toString('base64'), mimeType: 'application/pdf', emailsEnviados, emailsComErro });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});

module.exports = router;
