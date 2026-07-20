// Gera os PDFs do Gerador de Autorização — porta do que antes eram templates
// do Google Docs (com marcadores {{CAMPO}}) preenchidos pelo Apps Script.
// Aqui o layout é desenhado direto com pdfkit (sem depender de LibreOffice/
// Google Docs), reaproveitando as mesmas imagens (logo, assinatura, banner
// oficial da LATAM) extraídas dos modelos originais.

const PDFDocument = require('pdfkit');
const path = require('path');

const IMG = (nome) => path.join(__dirname, '..', '..', 'public', 'img', 'autorizacoes', nome);

function novoPdf(opts) {
  return new PDFDocument({ size: 'A4', margin: 56, bufferPages: true, ...opts });
}

function paraBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---------------------------------------------------------------- AZUL ----

async function gerarPdfAzul(dados) {
  const doc = novoPdf({ margin: 72 });
  const largura = doc.page.width - 144;

  doc.image(IMG('logo-wordmark.png'), 72, 60, { width: 130 });
  doc.moveDown(4);

  doc.font('Helvetica-Bold').fontSize(15).text('AUTORIZAÇÃO', 72, 150, { align: 'center', width: largura });
  doc.moveDown(2);

  doc.font('Helvetica').fontSize(11.5).text(
    `Eu, Jhonys Oliveira Santos, gerente da empresa SEUBONE COMERCIO DE BONES PERSONALIZADOS LTDA, ` +
    `inscrita no CNPJ: 36.153.457/0001-83, remetente do envio: ${dados.ENVIO}, autorizo ${dados.NOME} ` +
    `CPF: ${dados.CPF}, a realizar a retirada de ${dados.VOLUMES} no Aeroporto ${dados.AEROPORTO}.`,
    { align: 'justify', lineGap: 4 }
  );
  doc.moveDown(2);
  doc.text(`Natal, ${dados.DATA}.`, { align: 'right' });

  doc.moveDown(5);
  const yAssinatura = doc.y;
  doc.image(IMG('assinatura-jhonys.png'), 72, yAssinatura, { width: 140 });
  doc.moveDown(3.2);
  doc.font('Helvetica-Bold').fontSize(10.5).text('_______________________________');
  doc.font('Helvetica-Bold').text('Jhonys Oliveira Santos');
  doc.font('Helvetica').fontSize(10).text('Pessoa responsável');
  doc.text('Gerente de Sucesso do Cliente');
  doc.text('Seu Boné');

  doc.moveDown(1.5);
  doc.image(IMG('letterhead-empresa.png'), 72, doc.y, { width: 110 });
  doc.moveDown(3.2);
  doc.font('Helvetica').fontSize(9).fillColor('#444').text(
    'SEUBONE COMÉRCIO DE BONÉS PERSONALIZADOS LTDA\n' +
    'Rua Alfredo Pegado Cortez, 3346, Bairro: Candelária, Natal - RN CEP: 59066-080\n' +
    'Fone: (84) 99629-6629',
    { lineGap: 2 }
  );

  return paraBuffer(doc);
}

// ---------------------------------------------------------------- LATAM ---

async function gerarPdfLatam(dados) {
  const doc = novoPdf({ margin: 40 });
  const largura = doc.page.width - 80;

  doc.image(IMG('latam-banner.jpg'), 40, 40, { width: largura });
  doc.y = 40 + (largura * (98 / 800)) + 14;
  doc.x = 40;

  doc.font('Helvetica-Oblique').fontSize(10).text('Outros clientes - Autorização Avulsa');
  doc.moveDown(0.8);

  doc.font('Helvetica').fontSize(10.5).text(
    `Mediante este termo, autorizo o Sr.(a) ${dados.NOME}, com CPF: ${dados.CPF} a realizar a retirada de ` +
    `carga(s) referente ao seguinte(s) conhecimento(s) aéreo(s).`,
    { align: 'justify', lineGap: 3 }
  );
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').text('Número(s) de conhecimento (AWB):');
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(10);
  const colEsq = 40, colDir = 40 + largura / 2, linhaAltura = 15;
  for (let i = 0; i < 5; i++) {
    const y = doc.y;
    doc.text(`${i + 1})  ${dados['AWB' + (i + 1)] || ''}`, colEsq, y, { width: largura / 2 - 10 });
    doc.text(`${i + 6})`, colDir, y, { width: largura / 2 - 10 });
    doc.y = y + linhaAltura;
  }

  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(9).text(
    'Tenho ciência de que a autorização será única e exclusivamente válida para a presente retira avulsa. ' +
    'Tenho ciência de que essa autorização deverá ser enviada para o e-mail do Terminal de Cargas a realizar ' +
    'a entrega ou ser apresentada no ato da retirada da carga. O presente termo somente será considerado ' +
    'válido se estiver com todos os campos devidamente preenchidos e com carimbo constando razão social e/ou ' +
    'nome fantasia + CNPJ e acompanhado do contrato social da empresa (somente para retiradas cujo valor ' +
    'total seja superior a R$ 100.000,00. Para estes casos, se o responsável por emitir a autorização NÃO ' +
    'integrar o contrato social, ou seja, se não for um representante legal da empresa, será necessário ' +
    'apresentar também uma procuração, reconhecida em cartório, emitida por um dos proprietários ou sócio ' +
    'em favor do emissor da autorização).',
    { align: 'justify', lineGap: 2 }
  );

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10.5).text('Dados do emissor do termo para autorização de retirada:');
  doc.moveDown(0.5);

  const campoEmissor = (rotulo, valor, legenda) => {
    doc.font('Helvetica-Bold').fontSize(10).text(`${rotulo}: `, { continued: true }).font('Helvetica').text(valor);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666').text(`(${legenda})`).fillColor('#000');
    doc.moveDown(0.4);
  };
  campoEmissor('NOME', 'SEUBONE COMERCIO DE BONES PERSONALIZADOS LTDA', 'nome da empresa');
  campoEmissor('ENDEREÇO', 'Avenida Luiz Dantas de Araujo, 173, Bairro: Vila Altiva II, Caicó - RN CEP: 59300-000', 'endereço da empresa');
  campoEmissor('CNPJ DO TOMADOR', '36.153.457/0001-83', 'CNPJ da empresa');
  campoEmissor('EMISSOR DO TERMO', 'Jhonys Oliveira Santos', 'nome do emissor');
  campoEmissor('E-MAIL DO EMISSOR', 'jhonys@seubone.com', 'e-mail do emissor');

  doc.moveDown(1);
  const yBoxes = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).text('CARIMBO DA EMPRESA', colEsq, yBoxes, { width: largura / 2 - 10 });
  doc.text('ASSINATURA DO EMISSOR', colDir, yBoxes, { width: largura / 2 - 10 });
  doc.image(IMG('logo-wordmark.png'), colEsq, yBoxes + 16, { width: 110 });
  doc.image(IMG('assinatura-jhonys.png'), colDir, yBoxes + 16, { width: 110 });
  doc.y = yBoxes + 70;

  const yFooter = Math.max(doc.y + 10, doc.page.height - 100);
  doc.image(IMG('latam-footer.jpg'), 40, yFooter, { width: largura });

  return paraBuffer(doc);
}

// ------------------------------------------------------------ CORREIOS ---

async function gerarPdfCorreios(dados) {
  const doc = novoPdf({ size: 'A4', layout: 'landscape', margin: 40 });
  const largura = doc.page.width - 80;
  const meioX = 40 + largura / 2;

  doc.image(IMG('correios-badge.png'), 40, 40, { width: 90 });

  const linha = (label, valor, x, y, wLabel, wValor) => {
    doc.font('Helvetica-Bold').fontSize(9).text(label, x, y, { width: wLabel });
    doc.font('Helvetica').fontSize(10).text(valor || '', x + wLabel + 8, y, { width: wValor });
  };

  let y = 140;
  doc.font('Helvetica-Bold').fontSize(11).text('REMETENTE', 40, y);
  y += 20;
  linha('RUA', 'LAFAYETE LAMARTINE, 1945', 40, y, 70, largura / 2 - 80); y += 18;
  linha('BAIRRO', 'Candelária', 40, y, 70, largura / 2 - 80); y += 18;
  linha('CIDADE', 'NATAL/RN', 40, y, 70, largura / 2 - 80); y += 18;
  linha('CEP', '59064-510', 40, y, 70, largura / 2 - 80); y += 30;

  doc.font('Helvetica-Bold').fontSize(11).text('DESTINATÁRIO', 40, y);
  y += 20;
  linha('NOME', dados.DEST_NOME, 40, y, 70, largura / 2 - 80); y += 18;
  linha('RUA', dados.DEST_RUA, 40, y, 70, largura / 2 - 80); y += 18;
  if (dados.DEST_COMPLEMENTO) { linha('COMPLEMENTO', dados.DEST_COMPLEMENTO, 40, y, 70, largura / 2 - 80); y += 18; }
  linha('BAIRRO', dados.DEST_BAIRRO, 40, y, 70, largura / 2 - 80); y += 18;
  linha('CIDADE', dados.DEST_CIDADE, 40, y, 70, largura / 2 - 80); y += 18;
  linha('CEP', dados.DEST_CEP, 40, y, 70, largura / 2 - 80); y += 30;

  // ☐/☒ não existem na fonte Helvetica padrão (viram glifo de "ausente") —
  // desenha as caixinhas de verdade em vetor em vez de depender do glifo.
  const desenhaCheckbox = (x, y, marcado) => {
    doc.rect(x, y, 11, 11).stroke();
    if (marcado) {
      doc.moveTo(x + 1.5, y + 5.5).lineTo(x + 4.5, y + 9).lineTo(x + 9.5, y + 1.5).stroke();
    }
  };

  const yBox = 140;
  doc.rect(meioX + 20, yBox, largura / 2 - 60, 90).stroke();
  desenhaCheckbox(meioX + 40, yBox + 22, false);
  doc.font('Helvetica').fontSize(11).text('PAC', meioX + 58, yBox + 22);
  desenhaCheckbox(meioX + 40, yBox + 52, true);
  doc.font('Helvetica-Bold').fontSize(11).text('SEDEX', meioX + 58, yBox + 52);

  return paraBuffer(doc);
}

async function gerarPdf(templateId, dados) {
  if (templateId === 'autorizacao-azul') return gerarPdfAzul(dados);
  if (templateId === 'autorizacao-latam') return gerarPdfLatam(dados);
  if (templateId === 'etiqueta-correios') return gerarPdfCorreios(dados);
  throw new Error('Template sem gerador de PDF: ' + templateId);
}

module.exports = { gerarPdf };
