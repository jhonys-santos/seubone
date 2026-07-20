// Atalhos externos do hub (links de fora, não são páginas do próprio app).
// "requerPainel" restringe a visibilidade ao mesmo critério de acesso de
// um painel existente (ex: Base de Conhecimento só pra quem tem Meus
// Indicadores); sem essa chave, aparece pra todo mundo autenticado.
module.exports = [
  {
    titulo: 'Base de Conhecimento', descricao: 'Guias e procedimentos do SAC',
    url: 'https://tourmaline-quartz-cf5.notion.site/Base-de-Conhecimento-SAC-8216ddb8fcf74707b0fcd57d75b4fe72',
    icone: 'ti-book', novaAba: true, requerPainel: 'painel-sac',
  },
  {
    titulo: 'Gerador de Autorização', descricao: 'Autorização de retirada de pedidos nas transportadoras',
    url: 'https://script.google.com/macros/s/AKfycbxhBVqrHmr9xIHQIMNISVOgnHqIRYTwRqXpORF83cLapjQcGYbZOZXq70UO_96-Ygxv/exec',
    icone: 'ti-file-text', novaAba: true,
  },
];
