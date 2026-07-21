// Catálogo central dos painéis do hub. Usado para montar a home, a sidebar
// e para os middlewares requirePainel() saberem quais chaves existem.
//
// "subpaginas" alimenta o submenu expansível da sidebar pra painéis com
// mais de uma tela. O item de subpágina que tiver "somenteSlug" só aparece
// pra quem tem exatamente aquele slug (ex: Gestão de Estoque é só do
// Wallac) — não usa o sistema geral de permissões por painel, que é
// tudo-ou-nada por usuário. "somenteRole" funciona do mesmo jeito, mas
// filtrando por papel (ex: Indicadores Equipe é só pra gestor).
//
// No nível do PAINEL (não da subpágina), "somenteRole" e "somenteSlugs"
// (lista) se combinam com OU, não com E — um painel com os dois definidos
// aparece pra quem bater em QUALQUER um deles (ex: Corridas Avulsas é só
// do Wallac + qualquer gestor). Sem nenhum dos dois, fica liberado pra
// todo mundo. Em ambos os casos, também é reforçado no middleware da
// rota — a sidebar só evita mostrar pra quem não pode mesmo abrir.
module.exports = [
  {
    chave: 'painel-sac', titulo: 'Meus Indicadores', descricao: 'Indicadores pessoais, escala e sugestões',
    url: '/painel-sac', icone: 'ti-chart-bar',
  },
  {
    chave: 'indicadores-equipe', titulo: 'Indicadores Equipe', descricao: 'Indicadores diários por consultor — visão de gestor',
    url: '/indicadores-equipe/atendimento', icone: 'ti-users', somenteRole: 'gestor',
    subpaginas: [
      { titulo: 'Time Atendimento', url: '/indicadores-equipe/atendimento', icone: 'ti-headset' },
      { titulo: 'Time Resolução', url: '/indicadores-equipe/resolucao', icone: 'ti-tool' },
    ],
  },
  {
    chave: 'wallac', titulo: 'Produção SBP', descricao: 'Kanban de pedidos em produção no escritório',
    url: '/wallac', icone: 'ti-packages',
    subpaginas: [
      { titulo: 'Kanban', url: '/wallac', icone: 'ti-layout-kanban' },
      { titulo: 'Gestão de Estoque', url: '/wallac/estoque', somenteSlug: 'wallac', icone: 'ti-box' },
      { titulo: 'Histórico', url: '/wallac/historico', icone: 'ti-history' },
      { titulo: 'Solicitar Personalização', url: '/wallac/solicitar', icone: 'ti-brush' },
    ],
  },
  {
    chave: 'pedidos-urgentes', titulo: 'Pedidos Urgentes', descricao: 'Cadastro, painel do estoque e histórico',
    url: '/pedidos-urgentes/painel', icone: 'ti-alert-triangle',
    subpaginas: [
      { titulo: 'Cadastrar', url: '/pedidos-urgentes/cadastro', icone: 'ti-square-plus' },
      { titulo: 'Painel Estoque', url: '/pedidos-urgentes/painel', icone: 'ti-clipboard-list' },
      { titulo: 'Histórico', url: '/pedidos-urgentes/historico', icone: 'ti-history' },
    ],
  },
  {
    chave: 'ranking-sac', titulo: 'Ranking SAC', descricao: 'Painel de corrida entre consultores (tela de TV)',
    url: '/ranking-sac', icone: 'ti-trophy',
  },
  {
    chave: 'quitacoes', titulo: 'Quitações Pendentes', descricao: 'Pedidos despachados sem quitação do cliente',
    url: '/quitacoes/painel', icone: 'ti-clock-dollar',
    subpaginas: [
      { titulo: 'Cadastrar', url: '/quitacoes/cadastrar', icone: 'ti-square-plus' },
      { titulo: 'Painel', url: '/quitacoes/painel', icone: 'ti-clipboard-list' },
      { titulo: 'Histórico', url: '/quitacoes/historico', icone: 'ti-history' },
    ],
  },
  {
    chave: 'registro-demandas', titulo: 'Solicitações Financeiro', descricao: 'Demandas gerais e reembolsos solicitados ao financeiro',
    url: '/registro-demandas', icone: 'ti-report-money',
    subpaginas: [
      { titulo: 'Registro', url: '/registro-demandas', icone: 'ti-file-text' },
      { titulo: 'Reembolso', url: '/registro-demandas/reembolso', icone: 'ti-cash' },
      { titulo: 'Histórico', url: '/registro-demandas/historico', icone: 'ti-history' },
      { titulo: 'Histórico de Reembolsos', url: '/registro-demandas/historico-reembolso', icone: 'ti-receipt' },
    ],
  },
  {
    chave: 'corridas-avulsas', titulo: 'Corridas Avulsas', descricao: 'Registro de corridas avulsas (Uber parceiro) pra solicitar pagamento ao financeiro',
    url: '/corridas-avulsas', icone: 'ti-truck-delivery', somenteRole: 'gestor', somenteSlugs: ['wallac'],
  },
];
