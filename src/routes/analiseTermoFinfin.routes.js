// Análise de termo: o card nasce direto no kanban "Análise de termo" do finfin (FINFIN_ANALISE_TERMO_MODO). Ver finfinFormulario.router.js.
module.exports = require('./finfinFormulario.router').criarRouter({ formulario: 'analise_termo', view: 'registro-demandas/analise-termo' });
