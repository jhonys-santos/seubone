// Envio de e-mail do Gerador de Autorização — porta do GmailApp.sendEmail()
// do Apps Script original. A conta sac@seubone.com é hospedada no Zoho Mail,
// então conecta direto no SMTP do Zoho (nada de Gmail aqui).

const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

function getTransporter() {
  if (!env.sacEmailUser || !env.sacEmailAppPassword) {
    throw new Error('E-mail não configurado no .env (SAC_EMAIL_USER / SAC_EMAIL_APP_PASSWORD).');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user: env.sacEmailUser, pass: env.sacEmailAppPassword },
    });
  }
  return transporter;
}

async function enviarEmail({ to, cc, subject, text, attachment }) {
  await getTransporter().sendMail({
    from: `"SAC — SeuBoné" <${env.sacEmailUser}>`,
    to,
    cc,
    subject,
    text,
    attachments: [attachment],
  });
}

module.exports = { enviarEmail };
