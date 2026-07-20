// Catálogo dos modelos de documento do Gerador de Autorização — portado do
// Apps Script original (Código.js do "Gerador de Documentos"). Os campos
// aqui alimentam tanto o formulário (via /autorizacoes/api/config) quanto a
// validação e a montagem do PDF no servidor.
//
// "formOnly" não entra no corpo do documento, só existe pra controlar a UI
// (ex: checkbox de "enviar e-mail"). "showWhen"/"requiredWhen" mostram e
// exigem um campo só quando outro (geralmente um checkbox) está num valor
// específico. "auto" é preenchido pelo servidor (ex: data de hoje), nunca
// aparece no formulário.

const CLIENTE_ASSUNTO = 'Autorização de retirada de carga — {NOME}';
const CLIENTE_CORPO =
  'Olá,\n\n' +
  'Segue em anexo a autorização de retirada da sua carga.\n\n' +
  'Qualquer dúvida, estamos à disposição.\n\n' +
  'Atenciosamente,\nSAC — SeuBoné';

module.exports = [
  {
    id: 'autorizacao-latam',
    label: 'Autorização LATAM (retirada de carga)',
    fields: [
      { key: 'NOME', label: 'Nome do autorizado (Sr/Sra)', required: true },
      { key: 'CPF', label: 'CPF (Só números)', required: true },
      { key: 'AWBS', label: 'AWB(s) — Separe por vírgula (até 5)', required: true, awbMulti: 5 },
      { key: 'ENVIAR_GRU', label: 'Retirada no Aeroporto de Guarulhos (GRU) — Enviar à transportadora', type: 'checkbox', formOnly: true },
      { key: 'ENVIAR_CLIENTE', label: 'Enviar cópia para o cliente', type: 'checkbox', formOnly: true },
      {
        key: 'EMAIL_CLIENTE', label: 'E-mail do cliente', type: 'email', formOnly: true,
        showWhen: { field: 'ENVIAR_CLIENTE', value: true },
        requiredWhen: { field: 'ENVIAR_CLIENTE', value: true },
      },
    ],
    filenamePattern: 'Autorizacao_LATAM_{NOME}',
    emails: [
      {
        id: 'transportadora',
        label: 'Transportadora (LATAM Cargo GRU)',
        recipientLabel: 'transportadora (LATAM Cargo GRU)',
        triggerField: 'ENVIAR_GRU', triggerValue: true,
        to: 'grp_lojalatamcargogrudom@latam.com',
        // Se o cliente também tiver e-mail informado, ele entra em cópia
        // nesse mesmo envio em vez de receber uma mensagem separada.
        ccWhen: { field: 'ENVIAR_CLIENTE', value: true, emailField: 'EMAIL_CLIENTE' },
        subject: 'Autorização de retirada de carga — {NOME} — AWB(s) {AWB_LISTA}',
        body:
          'Prezados,\n\n' +
          'Segue em anexo a autorização de retirada de carga referente ao(s) AWB(s) {AWB_LISTA}, ' +
          'destinada ao Aeroporto de Guarulhos — GRU (LATAM Cargo).\n\n' +
          'Qualquer dúvida, estamos à disposição.\n\n' +
          'Atenciosamente,\nSAC — SeuBoné',
      },
      {
        id: 'cliente',
        label: 'Cliente',
        triggerField: 'ENVIAR_CLIENTE', triggerValue: true,
        // Só manda separado pro cliente se NÃO for pro GRU — quando é pro
        // GRU, o cliente já vai em cópia na regra acima (não duplica envio).
        suppressWhen: { field: 'ENVIAR_GRU', value: true },
        toField: 'EMAIL_CLIENTE',
        subject: CLIENTE_ASSUNTO,
        body: CLIENTE_CORPO,
      },
    ],
  },
  {
    id: 'autorizacao-azul',
    label: 'Autorização Azul (retirada de carga)',
    fields: [
      { key: 'ENVIO', label: 'Número do envio', required: true },
      { key: 'NOME', label: 'Nome do autorizado', required: true },
      { key: 'CPF', label: 'CPF', required: true },
      { key: 'VOLUMES', label: 'Quantidade de volumes', required: true, unit: 'volume' },
      { key: 'AEROPORTO', label: 'Aeroporto de destino', required: true },
      { key: 'ENVIAR_CLIENTE', label: 'Enviar cópia para o cliente', type: 'checkbox', formOnly: true },
      {
        key: 'EMAIL_CLIENTE', label: 'E-mail do cliente', type: 'email', formOnly: true,
        showWhen: { field: 'ENVIAR_CLIENTE', value: true },
        requiredWhen: { field: 'ENVIAR_CLIENTE', value: true },
      },
      { key: 'DATA', auto: 'today' },
    ],
    filenamePattern: 'Autorizacao_Azul_{NOME}',
    emails: [
      {
        id: 'cliente',
        label: 'Cliente',
        triggerField: 'ENVIAR_CLIENTE', triggerValue: true,
        toField: 'EMAIL_CLIENTE',
        subject: CLIENTE_ASSUNTO,
        body: CLIENTE_CORPO,
      },
    ],
  },
  {
    id: 'etiqueta-correios',
    label: 'Etiqueta Correios (SEDEX)',
    fields: [
      { key: 'DEST_NOME', label: 'Destinatário (nome)', required: true },
      { key: 'DEST_RUA', label: 'Rua / Endereço', required: true },
      { key: 'DEST_COMPLEMENTO', label: 'Complemento (A/C, etc.)', required: false },
      { key: 'DEST_BAIRRO', label: 'Bairro', required: true },
      { key: 'DEST_CIDADE', label: 'Cidade/UF', required: true },
      { key: 'DEST_CEP', label: 'CEP', required: true },
    ],
    filenamePattern: 'Correios_{DEST_NOME}',
  },
];
