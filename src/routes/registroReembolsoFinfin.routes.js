// Formulário NOVO de reembolso: o card nasce direto no kanban "Solicitações de reembolso - SAC" do finfin (FINFIN_REEMBOLSO_MODO). Ver finfinFormulario.router.js.
// Com REEMBOLSO_EXIGE_ERRO=on, cada ID de venda precisa ter o erro registrado no Painel de Erros ou dispensado com motivo (ver reembolsoErro.service.js).
const erro = require('../services/reembolsoErro.service');
module.exports = require('./finfinFormulario.router').criarRouter({
  formulario: 'reembolso_sac', view: 'registro-demandas/reembolso-novo',
  antes: (req) => erro.validarAntesDeEnviar(req.body),
  depois: (req, json) => erro.gravarDispensasDoEnvio(req.body, json.codigo, req.session.user),
});
