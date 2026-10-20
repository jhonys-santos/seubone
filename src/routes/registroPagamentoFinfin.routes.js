// Formulário NOVO de pagamento: o card nasce direto no kanban "Pagamentos" do finfin (FINFIN_PAGAMENTO_MODO). Ver finfinFormulario.router.js.
module.exports = require('./finfinFormulario.router').criarRouter({ formulario: 'pagamento', view: 'registro-demandas/pagamento-novo' });
