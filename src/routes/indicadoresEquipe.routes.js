const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const ticketsStore = require('../services/ticketsStore');
const env = require('../config/env');
const espelho = require('../services/espelhoKpi.service');

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
const { minutosDeTratamento } = require('../services/ticketsTempo');
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
// exatamente a mesma conta (da atribuição ao agente até o fechamento, só em horário de trabalho: seg-qui 08h-18h, sex 08h-17h; sem atribuição
// registrada, da abertura — ver ticketsTempo.js), só filtro diferente.
function serieDeTickets_(tickets, dias) {
  const tempo = dias.map((chaveAlvo) => {
    const doDia = tickets.filter((t) => chaveDia_(t.dataFechamento) === chaveAlvo);
    if (!doDia.length) return null;
    // Segundos — porEquipe.tempo_ppf sempre foi em segundos aqui (ver meta
    // 24*60*60 em IE_TIMES no front), diferente do painel-sac (minutos).
    const segundos = doDia
      .map((t) => minutosDeTratamento(t) * 60)
      .filter((s) => Number.isFinite(s) && s >= 0);
    if (!segundos.length) return null;
    return segundos.reduce((a, b) => a + b, 0) / segundos.length;
  });

  const qtd = dias.map((chaveAlvo) => tickets.filter((t) => chaveDia_(t.dataFechamento) === chaveAlvo).length);

  return { tempo, qtd };
}

async function buscarResolucaoEquipeDosTickets_(desde, ate) {
  if (!desde || !ate) return null;

  const json = await ticketsStore.listarComAtribuicao();
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

// Time Atendimento (Iasmin, Nathalia e Francis): "Tickets Refabricação" e "TMR Refabricação" (chaves tickets_refab / tmt_refab) passam a vir dos
// tickets de Refabricação do hub, com a mesma conta do Time Resolução: tickets Resolvidos, contados e medidos pelo dia do FECHAMENTO, tempo da
// atribuição ao fechamento só em horário de trabalho (ver serieDeTickets_ e ticketsTempo.js). Antes de REFAB_HUB_DESDE os tickets ainda estavam no
// Octadesk (o histórico foi migrado a partir de 01/10/2026), então esses dias continuam vindo da planilha, dia a dia.
const CONSULTORES_ATENDIMENTO = { iasmin: 'Iasmin Cristina', nathalia: 'Nathalia Guedes', francis: 'Francis Medeiros' };
const REFAB_HUB_DESDE = 20261001;

async function buscarRefabAtendimentoDosTickets_(desde, ate) {
  if (!desde || !ate) return null;
  const json = await ticketsStore.listarComAtribuicao();
  if (!json || !json.ok || !Array.isArray(json.tickets)) return null;

  const dias = [];
  const cursor = new Date(desde + 'T00:00:00Z');
  const fim = new Date(ate + 'T00:00:00Z');
  while (cursor <= fim) {
    dias.push(cursor.getUTCFullYear() * 10000 + (cursor.getUTCMonth() + 1) * 100 + cursor.getUTCDate());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const resolvidos = json.tickets.filter(
    (t) => t.identificador === 'Refabricação' && t.status === 'Resolvido' && t.dataFechamento && CONSULTORES_ATENDIMENTO[t.responsavelSlug]
  );
  const serie = (lista) => { const s = serieDeTickets_(lista, dias); return { tickets_refab: s.qtd, tmt_refab: s.tempo }; };
  const porConsultor = {};
  for (const [slug, nome] of Object.entries(CONSULTORES_ATENDIMENTO)) porConsultor[nome] = serie(resolvidos.filter((t) => t.responsavelSlug === slug));
  return { equipe: serie(resolvidos), porConsultor, usaHub: dias.map((d) => d >= REFAB_HUB_DESDE) };
}

// Troca, dia a dia, o valor da planilha pelo do hub (só nos dias com usaHub); o resto do array fica como veio.
function misturarDias_(destino, serie, usaHub) {
  for (const chave of Object.keys(serie)) {
    const base = Array.isArray(destino[chave]) ? destino[chave].slice() : new Array(usaHub.length).fill(null);
    for (let i = 0; i < usaHub.length; i++) if (usaHub[i]) base[i] = serie[chave][i];
    destino[chave] = base;
  }
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
    const refabTicketsPromise = time === 'atendimento'
      ? buscarRefabAtendimentoDosTickets_(desde, ate).catch((err) => {
          console.error('[indicadores-equipe] falha ao buscar Refabricação do Painel de Ticket (segue com a planilha):', err.message);
          return null;
        })
      : Promise.resolve(null);

    // Espelho primeiro (resposta em milissegundos, sem abrir a planilha); se estiver desligado, velho ou sem o período, planilha como sempre.
    const doEspelho = await espelho.obterDados(time, desde, ate).catch((err) => { console.error('[indicadores-equipe] espelho indisponível, usando a planilha:', err.message); return null; });
    const [json, resolucaoTickets, refabTickets] = await Promise.all([
      doEspelho || chamarAppsScript(env.indicadoresEquipeAppsScriptUrl, {
        params: { action: 'dados', time, desde, ate },
        cache: true,
      }),
      resolucaoTicketsPromise,
      refabTicketsPromise,
    ]);

    if (time === 'resolucao' && json.ok && json.porEquipe && resolucaoTickets) {
      Object.assign(json.porEquipe, resolucaoTickets.equipe);
      if (json.porConsultor) {
        for (const [nome, serie] of Object.entries(resolucaoTickets.porConsultor)) {
          if (json.porConsultor[nome]) Object.assign(json.porConsultor[nome], serie);
        }
      }
    }

    if (time === 'atendimento' && json.ok && json.porEquipe && refabTickets && refabTickets.usaHub.some(Boolean)) {
      misturarDias_(json.porEquipe, refabTickets.equipe, refabTickets.usaHub);
      if (json.porConsultor) {
        for (const [nome, s] of Object.entries(refabTickets.porConsultor)) {
          if (json.porConsultor[nome]) misturarDias_(json.porConsultor[nome], s, refabTickets.usaHub);
        }
      }
    }

    res.json(json);
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao buscar indicadores: ' + err.message });
  }
});

module.exports = router;
