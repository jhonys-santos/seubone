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

// Desenha a imagem girada em torno do canto superior-esquerdo dela mesma —
// usado pra imitar o efeito de "carimbo"/stamp que os modelos originais
// tinham no logo e no texto do CNPJ.
function imagemGirada(doc, caminho, x, y, largura, anguloGraus) {
  doc.save();
  doc.rotate(anguloGraus, { origin: [x, y] });
  doc.image(caminho, x, y, { width: largura });
  doc.restore();
}

// ---------------------------------------------------------------- AZUL ----

async function gerarPdfAzul(dados) {
  const doc = novoPdf({ margin: 72 });
  const largura = doc.page.width - 144;
  const larguraLogo = 130;

  doc.image(IMG('logo-wordmark.png'), (doc.page.width - larguraLogo) / 2, 60, { width: larguraLogo });
  doc.y = 150;
  doc.x = 72;

  doc.font('Helvetica-Bold').fontSize(15).text('AUTORIZAÇÃO', 72, doc.y, { align: 'center', width: largura });
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
  // O "carimbo" original era um texto/imagem levemente inclinado — imita
  // esse efeito em vez de colar a imagem reta.
  imagemGirada(doc, IMG('letterhead-empresa.png'), 72, doc.y, 110, -6);
  doc.moveDown(3.6);
  doc.font('Helvetica').fontSize(9).fillColor('#444').text(
    'SEUBONE COMÉRCIO DE BONÉS PERSONALIZADOS LTDA\n' +
    'Rua Alfredo Pegado Cortez, 3346, Bairro: Candelária, Natal - RN CEP: 59066-080\n' +
    'Fone: (84) 99629-6629',
    { lineGap: 2 }
  );
  doc.fillColor('#000');

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
  doc.moveDown(0.4);

  // Cada linha imita o formulário original: número + valor (se houver) +
  // um traço de preenchimento, igual a um campo de formulário em papel.
  const colEsq = 40, colDir = 40 + largura / 2, larguraCol = largura / 2 - 20, linhaAltura = 17;
  doc.font('Helvetica').fontSize(10);
  for (let i = 0; i < 5; i++) {
    const y = doc.y;
    const yTraco = y + 12;
    doc.text(`${i + 1})  ${dados['AWB' + (i + 1)] || ''}`, colEsq, y, { width: larguraCol, lineBreak: false });
    doc.moveTo(colEsq, yTraco).lineTo(colEsq + larguraCol, yTraco).lineWidth(0.6).strokeColor('#999').stroke();
    doc.text(`${i + 6})`, colDir, y, { width: larguraCol, lineBreak: false });
    doc.moveTo(colDir, yTraco).lineTo(colDir + larguraCol, yTraco).stroke();
    doc.strokeColor('#000');
    doc.y = y + linhaAltura;
  }

  doc.moveDown(0.6);
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
  imagemGirada(doc, IMG('logo-wordmark.png'), colEsq, yBoxes + 18, 105, -6);
  doc.image(IMG('assinatura-jhonys.png'), colDir, yBoxes + 16, { width: 110 });
  doc.y = yBoxes + 75;

  const yFooter = Math.max(doc.y + 10, doc.page.height - 100);
  doc.image(IMG('latam-footer.jpg'), 40, yFooter, { width: largura });

  return paraBuffer(doc);
}

// ------------------------------------------------------------ CORREIOS ---

// Porta fiel da tabela do modelo original: uma etiqueta estreita com bordas
// e cabeçalhos sombreados (REMETENTE fixo da empresa / DESTINATÁRIO com os
// dados do formulário), terminando na escolha PAC/SEDEX.
async function gerarPdfCorreios(dados) {
  const doc = novoPdf({ size: 'A4', layout: 'landscape', margin: 40 });

  const x = 40, larguraTabela = 300, wLabel = 78, wValor = larguraTabela - wLabel;
  const corCabecalho = '#3a3a3a', corBorda = '#666';
  let y = 40;

  function linha(altura) {
    doc.rect(x, y, larguraTabela, altura).strokeColor(corBorda).lineWidth(0.75).stroke();
    doc.moveTo(x + wLabel, y).lineTo(x + wLabel, y + altura).stroke();
  }
  function cabecalho(texto, altura) {
    doc.rect(x, y, larguraTabela, altura).fillAndStroke(corCabecalho, corBorda);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff')
      .text(texto, x + 6, y + altura / 2 - 5, { width: larguraTabela - 12 });
    doc.fillColor('#000');
    y += altura;
  }
  function campo(label, valor, altura) {
    linha(altura);
    doc.font('Helvetica-Bold').fontSize(8.5).text(label, x + 6, y + altura / 2 - 5, { width: wLabel - 12 });
    doc.font('Helvetica').fontSize(9.5).text(valor || '', x + wLabel + 6, y + altura / 2 - 5, { width: wValor - 12 });
    y += altura;
  }

  // REMETENTE (fixo — sempre o estoque da própria SeuBoné)
  doc.rect(x, y, larguraTabela, 32).fillAndStroke('#3a3a3a', corBorda);
  doc.moveTo(x + wLabel, y).lineTo(x + wLabel, y + 32).strokeColor(corBorda).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff').text('REMETENTE', x + 6, y + 11, { width: wLabel - 12 });
  doc.image(IMG('logo-wordmark.png'), x + wLabel + 10, y + 4, { fit: [wValor - 20, 24] });
  doc.fillColor('#000');
  y += 32;

  cabecalho('ESTOQUE SEU BONÉ', 20);
  campo('RUA', 'LAFAYETE LAMARTINE, 1945', 22);
  campo('BAIRRO', 'Candelária', 22);
  campo('CIDADE', 'NATAL/RN.', 22);
  campo('CEP', '59064-510', 22);

  y += 10;

  // DESTINATÁRIO (vem do formulário)
  cabecalho('DESTINATÁRIO', 20);
  campo('NOME', dados.DEST_NOME, 22);
  campo('RUA', dados.DEST_RUA, 22);
  if (dados.DEST_COMPLEMENTO) campo('COMPLEMENTO', dados.DEST_COMPLEMENTO, 22);
  campo('BAIRRO', dados.DEST_BAIRRO, 22);
  campo('CIDADE', dados.DEST_CIDADE, 22);
  campo('CEP', dados.DEST_CEP, 22);

  y += 14;

  // ☐/☒ não existem na fonte Helvetica padrão (viram glifo de "ausente") —
  // desenha as caixinhas de verdade em vetor em vez de depender do glifo.
  const desenhaCheckbox = (cx, cy, marcado) => {
    doc.rect(cx, cy, 11, 11).strokeColor('#000').lineWidth(1).stroke();
    if (marcado) doc.moveTo(cx + 1.5, cy + 5.5).lineTo(cx + 4.5, cy + 9).lineTo(cx + 9.5, cy + 1.5).stroke();
  };
  desenhaCheckbox(x, y + 2, false);
  doc.font('Helvetica').fontSize(10.5).text('PAC', x + 16, y);
  desenhaCheckbox(x + 90, y + 2, true);
  doc.font('Helvetica-Bold').fontSize(10.5).text('SEDEX', x + 106, y);

  return paraBuffer(doc);
}

async function gerarPdf(templateId, dados) {
  if (templateId === 'autorizacao-azul') return gerarPdfAzul(dados);
  if (templateId === 'autorizacao-latam') return gerarPdfLatam(dados);
  if (templateId === 'etiqueta-correios') return gerarPdfCorreios(dados);
  throw new Error('Template sem gerador de PDF: ' + templateId);
}

module.exports = { gerarPdf };
