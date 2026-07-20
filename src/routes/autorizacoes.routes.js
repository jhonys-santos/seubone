const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const TEMPLATES = require('../config/autorizacoesTemplates');
const { acharTpl, prepararValores, buildFilename, preencherTexto, regrasAtivas } = require('../services/autorizacoes.service');
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

router.post('/api/gerar', async (req, res) => {
  try {
    const { templateId, values } = req.body;
    const tpl = acharTpl(templateId);
    const dados = prepararValores(tpl, values || {});
    const pdf = await gerarPdf(templateId, dados);
    const filename = buildFilename(tpl, dados) + '.pdf';

    const emailsDisponiveis = regrasAtivas(tpl, values || {}).map((regra) => ({
      id: regra.id,
      label: regra.label,
      recipientLabel: regra.recipientLabel || (regra.toField ? (dados[regra.toField] || '') : regra.to),
    }));

    res.json({ ok: true, filename, base64: pdf.toString('base64'), mimeType: 'application/pdf', emailsDisponiveis });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});

router.post('/api/enviar', async (req, res) => {
  try {
    const { templateId, values } = req.body;
    const tpl = acharTpl(templateId);
    const regras = regrasAtivas(tpl, values || {});
    if (!regras.length) return res.status(400).json({ ok: false, erro: 'Nenhum envio selecionado.' });

    const dados = prepararValores(tpl, values || {});
    const pdf = await gerarPdf(templateId, dados);
    const filename = buildFilename(tpl, dados) + '.pdf';

    const enviados = [];
    for (const regra of regras) {
      const destino = regra.toField ? (dados[regra.toField] || '') : regra.to;
      if (!destino) throw new Error('Destinatário vazio para: ' + regra.label);
      await enviarEmail({
        to: destino,
        subject: preencherTexto(regra.subject, dados),
        text: preencherTexto(regra.body, dados),
        attachment: { filename, content: pdf },
      });
      enviados.push({ label: regra.label, to: destino });
    }

    res.json({ ok: true, enviados });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});

module.exports = router;
