// Envio de e-mail do Gerador de Autorização — porta do GmailApp.sendEmail()
// do Apps Script original. Usa uma conta Gmail com "senha de app" (não a
// senha normal), autenticada via SMTP.

const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

function getTransporter() {
  if (!env.sacEmailUser || !env.sacEmailAppPassword) {
    throw new Error('E-mail não configurado no .env (SAC_EMAIL_USER / SAC_EMAIL_APP_PASSWORD).');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.sacEmailUser, pass: env.sacEmailAppPassword },
    });
  }
  return transporter;
}

async function enviarEmail({ to, subject, text, attachment }) {
  await getTransporter().sendMail({
    from: `"SAC — SeuBoné" <${env.sacEmailUser}>`,
    to,
    subject,
    text,
    attachments: [attachment],
  });
}

module.exports = { enviarEmail };
