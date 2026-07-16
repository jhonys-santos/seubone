// Catálogo central dos painéis do hub. Usado para montar o menu da home
// e para os middlewares requirePainel() saberem quais chaves existem.
module.exports = [
  { chave: 'painel-sac', titulo: 'Meus Indicadores', descricao: 'Indicadores pessoais, escala e sugestões', url: '/painel-sac', icone: 'ti-chart-bar' },
  { chave: 'wallac', titulo: 'Produção SBP', descricao: 'Kanban de pedidos em produção no escritório', url: '/wallac', icone: 'ti-packages' },
  { chave: 'pedidos-urgentes', titulo: 'Pedidos Urgentes', descricao: 'Cadastro, painel do estoque e histórico', url: '/pedidos-urgentes/painel', icone: 'ti-alert-triangle' },
  { chave: 'ranking-sac', titulo: 'Ranking SAC', descricao: 'Painel de corrida entre consultores (tela de TV)', url: '/ranking-sac', icone: 'ti-trophy' },
  { chave: 'registro-demandas', titulo: 'Registro de Demandas Gerais', descricao: 'Demandas gerais e reembolsos solicitados ao financeiro', url: '/registro-demandas', icone: 'ti-clipboard-text' },
];
