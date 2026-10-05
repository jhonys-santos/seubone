const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const ticketsStore = require('../services/ticketsStore');
const env = require('../config/env');

const router = express.Router();

// Visão de gestor sobre a equipe — nada aqui filtra por slug da sessão,
// então trava por papel (não por painel liberado por usuário) igual à
// Gestão de Estoque trava por slug.
router.use(requireAuth, requireRole('gestor'));

router.get('/atendimento', (req, res) => {
  res.render('indicadores-equipe/index', { time: 'atendimento' });
});

router.get('/resolucao', (req, res) => {
  res.render('indicadores-equipe/index', { time: 'resolucao' });
});

// Time Resolução (Gabrielle + Daniel): "Tempo/Tickets PPF+1" (Pedido
// atrasado) e "Tempo/Tickets Erro de Envio" da EQUIPE e de CADA CONSULTOR
// deixam de vir da planilha antiga e passam a vir direto dos tickets reais
// — mesma regra já usada no painel-sac.routes.js, cada métrica filtrada
// pelo identificador correspondente. Devolve um valor por dia no intervalo
// desde..ate pedido, no MESMO formato que porEquipe/porConsultor já vinham
// (array alinhado aos dias do período — o front agrega sozinho via
// ieAgregar), então funciona pra semana, mês ou período personalizado sem
// precisar saber qual é qual aqui.
const CONSULTORES_RESOLUCAO_SLUGS = ['gabrielle', 'daniel'];
// Nome exibido em IE_TIMES.resolucao.consultores (indicadores-equipe.js) —
// é a chave usada em porConsultor, não o slug.
const SLUG_PARA_NOME_RESOLUCAO = { gabrielle: 'Gabrielle Batista', daniel: 'Daniel Sheldon' };

function chaveDia_(dataStr) {
  const d = new Date(dataStr);
  if (isNaN(d)) return null;
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// Série diária de tempo médio (segundos) + quantidade, pra uma lista de
// tickets já filtrada por identificador — reaproveitada tanto pra "Pedido
// atrasado" (PPF+1) quanto pra "Erro de Envio" (TMR Erro de Envio), que têm
// exatamente a mesma conta (abertura até fechamento), só filtro diferente.
function serieDeTickets_(tickets, dias) {
  const tempo = dias.map((chaveAlvo) => {
    const doDia = tickets.filter((t) => chaveDia_(t.dataFechamento) === chaveAlvo);
    if (!doDia.length) return null;
    // Segundos — porEquipe.tempo_ppf sempre foi em segundos aqui (ver meta
    // 24*60*60 em IE_TIMES no front), diferente do painel-sac (minutos).
    const segundos = doDia
      .map((t) => (new Date(t.dataFechamento).getTime() - new Date(t.dataAbertura).getTime()) / 1000)
      .filter((s) => Number.isFinite(s) && s >= 0);
    if (!segundos.length) return null;
    return segundos.reduce((a, b) => a + b, 0) / segundos.length;
  });

  const qtd = dias.map((chaveAlvo) => tickets.filter((t) => chaveDia_(t.dataFechamento) === chaveAlvo).length);

  return { tempo, qtd };
}

async function buscarResolucaoEquipeDosTickets_(desde, ate) {
  if (!desde || !ate) return null;

  const json = await ticketsStore.listar();
  if (!json || !json.ok || !Array.isArray(json.tickets)) return null;

  const resolvidosDaEquipe = json.tickets.filter(
    (t) => CONSULTORES_RESOLUCAO_SLUGS.includes(t.responsavelSlug) && t.status === 'Resolvido' && t.dataFechamento
  );

  // Um dia por posição do array, de "desde" até "ate" (inclusive) — mesmo
  // range que o front já pediu, seja semana (7 dias corridos), mês inteiro
  // ou período personalizado.
  const dias = [];
  const cursor = new Date(desde + 'T00:00:00Z');
  const fim = new Date(ate + 'T00:00:00Z');
  while (cursor <= fim) {
    dias.push(cursor.getUTCFullYear() * 10000 + (cursor.getUTCMonth() + 1) * 100 + cursor.getUTCDate());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  function seriesPara_(lista) {
    const ppf = serieDeTickets_(lista.filter((t) => t.identificador === 'Pedido atrasado'), dias);
    const erroEnvio = serieDeTickets_(lista.filter((t) => t.identificador === 'Erro de Envio'), dias);
    return {
      tempo_ppf: ppf.tempo, qtd_ppf: ppf.qtd,
      tempo_erro_envio: erroEnvio.tempo, qtd_erro_envio: erroEnvio.qtd,
    };
  }

  const equipe = seriesPara_(resolvidosDaEquipe);
  const porConsultor = {};
  for (const [slug, nome] of Object.entries(SLUG_PARA_NOME_RESOLUCAO)) {
    porConsultor[nome] = seriesPara_(resolvidosDaEquipe.filter((t) => t.responsavelSlug === slug));
  }

  return { equipe, porConsultor };
}

router.get('/api/dados', async (req, res) => {
  try {
    const { time, desde, ate } = req.query;

    // As duas buscas são independentes (a dos tickets só usa desde/ate, não
    // o resultado da planilha) — disparam em paralelo em vez de uma esperar
    // a outra. Em série, essa rota chegava a levar o tempo das DUAS chamadas
    // ao Apps Script somado (1-6s cada) toda vez que alguém abria a Home ou
    // o Time Resolução.
    const resolucaoTicketsPromise = time === 'resolucao'
      ? buscarResolucaoEquipeDosTickets_(desde, ate).catch((err) => {
          console.error('[indicadores-equipe] falha ao buscar tempo_ppf/qtd_ppf do Painel de Ticket:', err.message);
          return null;
        })
      : Promise.resolve(null);

    const [json, resolucaoTickets] = await Promise.all([
      chamarAppsScript(env.indicadoresEquipeAppsScriptUrl, {
        params: { action: 'dados', time, desde, ate },
        cache: true,
      }),
      resolucaoTicketsPromise,
    ]);

    if (time === 'resolucao' && json.ok && json.porEquipe && resolucaoTickets) {
      Object.assign(json.porEquipe, resolucaoTickets.equipe);
      if (json.porConsultor) {
        for (const [nome, serie] of Object.entries(resolucaoTickets.porConsultor)) {
          if (json.porConsultor[nome]) Object.assign(json.porConsultor[nome], serie);
        }
      }
    }

    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar indicadores: ' + err.message });
  }
});

module.exports = router;
