// Formulário NOVO de reembolso: o card nasce direto no kanban "Solicitações de reembolso - SAC" do finfin (FINFIN_REEMBOLSO_MODO). Ver finfinFormulario.router.js.
module.exports = require('./finfinFormulario.router').criarRouter({ formulario: 'reembolso_sac', view: 'registro-demandas/reembolso-novo' });
