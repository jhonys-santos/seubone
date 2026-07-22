const path = require('path');
require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

module.exports = {
  port: Number(required('PORT', 3000)),
  sessionSecret: required('SESSION_SECRET', 'dev-secret-troque-isso'),
  isProduction: process.env.NODE_ENV === 'production',

  // Onde ficam usuarios.json e as sessões. Em produção (Render), aponte
  // DATA_DIR para o disco persistente montado (ex: /data) — senão esses
  // arquivos são apagados a cada novo deploy. Localmente usa a pasta data/
  // dentro do próprio projeto, sem precisar configurar nada.
  dataDir: required('DATA_DIR', path.join(__dirname, '..', '..', 'data')),

  // Protege a tela /setup (criar/atualizar usuário pelo navegador, sem Shell).
  // Defina uma string longa e aleatória — sem ela, /setup fica desativada.
  setupToken: required('SETUP_TOKEN', ''),

  appsScriptSharedSecret: required('APPS_SCRIPT_SHARED_SECRET', ''),

  wallacAppsScriptUrl: required('WALLAC_APPS_SCRIPT_URL', ''),
  pedidosUrgentesAppsScriptUrl: required('PEDIDOS_URGENTES_APPS_SCRIPT_URL', ''),
  painelSacAppsScriptUrl: required('PAINEL_SAC_APPS_SCRIPT_URL', ''),
  registroDemandasAppsScriptUrl: required('REGISTRO_DEMANDAS_APPS_SCRIPT_URL', ''),
  quitacoesAppsScriptUrl: required('QUITACOES_APPS_SCRIPT_URL', ''),
  indicadoresEquipeAppsScriptUrl: required('INDICADORES_EQUIPE_APPS_SCRIPT_URL', ''),
  corridasAvulsasAppsScriptUrl: required('CORRIDAS_AVULSAS_APPS_SCRIPT_URL', ''),

  // Integração com n8n (Solicitações Financeiro): o hub avisa o n8n quando
  // uma solicitação é criada (URL de saída); quando o financeiro conclui
  // lá, o n8n chama de volta o webhook do hub (segredo de entrada, ver
  // src/routes/registroDemandas.routes.js).
  n8nRegistroDemandasWebhookUrl: required('N8N_REGISTRO_DEMANDAS_WEBHOOK_URL', ''),
  n8nWebhookSecret: required('N8N_WEBHOOK_SECRET', ''),

  rankingSacCsvUrls: {
    atd: required('RANKING_SAC_CSV_ATD', ''),
    rsl: required('RANKING_SAC_CSV_RSL', ''),
    kpi: required('RANKING_SAC_CSV_KPI', ''),
    agenda: required('RANKING_SAC_CSV_AGENDA', ''),
  },
};
