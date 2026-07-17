// Catálogo central dos painéis do hub. Usado para montar a home, a sidebar
// e para os middlewares requirePainel() saberem quais chaves existem.
//
// "subpaginas" alimenta o submenu expansível da sidebar pra painéis com
// mais de uma tela. O item de subpágina que tiver "somenteSlug" só aparece
// pra quem tem exatamente aquele slug (ex: Gestão de Estoque é só do
// Wallac) — não usa o sistema geral de permissões por painel, que é
// tudo-ou-nada por usuário.
module.exports = [
  {
    chave: 'painel-sac', titulo: 'Meus Indicadores', descricao: 'Indicadores pessoais, escala e sugestões',
    url: '/painel-sac', icone: 'ti-chart-bar',
  },
  {
    chave: 'wallac', titulo: 'Produção SBP', descricao: 'Kanban de pedidos em produção no escritório',
    url: '/wallac', icone: 'ti-packages',
    subpaginas: [
      { titulo: 'Kanban', url: '/wallac' },
      { titulo: 'Gestão de Estoque', url: '/wallac/estoque', somenteSlug: 'wallac' },
      { titulo: 'Histórico', url: '/wallac/historico' },
    ],
  },
  {
    chave: 'pedidos-urgentes', titulo: 'Pedidos Urgentes', descricao: 'Cadastro, painel do estoque e histórico',
    url: '/pedidos-urgentes/painel', icone: 'ti-alert-triangle',
    subpaginas: [
      { titulo: 'Cadastrar', url: '/pedidos-urgentes/cadastro' },
      { titulo: 'Painel Estoque', url: '/pedidos-urgentes/painel' },
      { titulo: 'Histórico', url: '/pedidos-urgentes/historico' },
    ],
  },
  {
    chave: 'ranking-sac', titulo: 'Ranking SAC', descricao: 'Painel de corrida entre consultores (tela de TV)',
    url: '/ranking-sac', icone: 'ti-trophy',
  },
  {
    chave: 'registro-demandas', titulo: 'Registro de Demandas Gerais', descricao: 'Demandas gerais e reembolsos solicitados ao financeiro',
    url: '/registro-demandas', icone: 'ti-clipboard-text',
    subpaginas: [
      { titulo: 'Registro', url: '/registro-demandas' },
      { titulo: 'Reembolso', url: '/registro-demandas/reembolso' },
      { titulo: 'Histórico', url: '/registro-demandas/historico' },
      { titulo: 'Histórico de Reembolsos', url: '/registro-demandas/historico-reembolso' },
    ],
  },
];
