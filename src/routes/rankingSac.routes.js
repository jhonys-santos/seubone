const express = require('express');
const { requireAuth, requirePainel } = require('../middleware/auth');
const { chamarAppsScript } = require('../services/appsScriptClient');
const env = require('../config/env');

const router = express.Router();

router.use(requireAuth, requirePainel('ranking-sac'));

const CHAVES_VALIDAS = ['atd', 'rsl', 'kpi', 'agenda'];

router.get('/', (req, res) => {
  res.render('ranking-sac/index');
});

// Devolve o CSV cru (mesmo formato que o Google Sheets publica) — o parsing
// client-side original não muda uma linha, só a URL de onde ele busca.
router.get('/api/csv/:chave', async (req, res) => {
  const { chave } = req.params;
  if (!CHAVES_VALIDAS.includes(chave)) {
    return res.status(400).send('chave inválida');
  }
  try {
    const csv = await chamarAppsScript(env.rankingSacCsvUrls[chave], { cache: true });
    res.type('text/csv').send(typeof csv === 'string' ? csv : '');
  } catch (err) {
    res.status(502).send('erro ao buscar planilha: ' + err.message);
  }
});

/* ============================ TIME RESOLUÇÃO (direto do Painel de Ticket) ============================
 * Antes vinha de uma planilha manual (CSV "rsl"). Agora TMR PPF+1 e
 * Resolvidos são calculados aqui a partir dos tickets reais — sem depender
 * de alguém preencher planilha à parte.
 */

// Mesmos dois consultores do "Time Resolução" de sempre — casados com o
// responsavelSlug gravado nos tickets (não com o nome, que pode variar).
const CONSULTORES_RESOLUCAO = [
  { nome: 'Gabrielle', slug: 'gabrielle' },
  { nome: 'Daniel', slug: 'daniel' },
];

// Fuso fixo (UTC-3): Brasil não tem mais horário de verão desde 2019, mesmo
// truque já usado no agendamento da importação da Lulu — dá pra saber o dia
// de Brasília sem depender do fuso do servidor (Render roda em UTC).
const FUSO_BRASILIA_OFFSET_MS = -3 * 3600000;

function chaveDiaISO_(ano, mes, dia) {
  return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}

// Semana de sexta a quinta, pulando sábado/domingo — devolve as 5 datas
// (yyyy-mm-dd) na ordem Sex,Seg,Ter,Qua,Qui. "offsetSemanas" volta N semanas
// inteiras a partir da semana que contém "hoje" (Brasília); 0 = semana atual
// (se hoje for sexta, a semana começa hoje).
function diasDaSemanaResolucao_(offsetSemanas) {
  const agoraBrasilia = new Date(Date.now() + FUSO_BRASILIA_OFFSET_MS);
  const diaSemana = agoraBrasilia.getUTCDay(); // 0=Dom...5=Sex,6=Sab (já "em Brasília")
  const diffDeSexta = (diaSemana - 5 + 7) % 7;
  const sexta = new Date(agoraBrasilia);
  sexta.setUTCDate(sexta.getUTCDate() - diffDeSexta - offsetSemanas * 7);
  return [0, 3, 4, 5, 6].map((offset) => {
    const d = new Date(sexta);
    d.setUTCDate(d.getUTCDate() + offset);
    return chaveDiaISO_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  });
}

// A data do ticket já vem como "yyyy-MM-ddTHH:mm:ss" no fuso de Brasília
// (é o que o Apps Script grava) — os 10 primeiros caracteres já são a data
// certa, sem precisar converter nada.
function chaveDiaDoTicket_(isoTicket) {
  return isoTicket ? String(isoTicket).slice(0, 10) : null;
}

router.get('/api/resolucao', async (req, res) => {
  try {
    const json = await chamarAppsScript(env.ticketsAppsScriptUrl, { cache: true });
    if (!json.ok || !Array.isArray(json.tickets)) {
      return res.status(502).json({ ok: false, error: 'Falha ao buscar tickets.' });
    }

    // "semana" = quantas semanas voltar (0 = atual). Limite de 1 ano só pra
    // não deixar uma URL mal formada pedir uma conta sem sentido.
    const offsetSemanas = Math.min(52, Math.max(0, parseInt(req.query.semana, 10) || 0));
    const chavesDias = diasDaSemanaResolucao_(offsetSemanas);
    const data = {};

    CONSULTORES_RESOLUCAO.forEach(({ nome, slug }) => {
      const resolvidosDaPessoa = json.tickets.filter(
        (t) => t.responsavelSlug === slug && t.status === 'Resolvido' && t.dataFechamento
      );

      const tickets = chavesDias.map((chaveAlvo) => {
        const n = resolvidosDaPessoa.filter((t) => chaveDiaDoTicket_(t.dataFechamento) === chaveAlvo).length;
        return n || null;
      });

      // TMR PPF+1: tempo médio abertura→fechamento, só dos tickets "Pedido
      // atrasado" (os relacionados a PPF, vindos da Lulu) resolvidos naquele
      // dia. A diferença entre os dois horários dá certo mesmo sem converter
      // fuso, porque os dois vêm formatados do mesmo jeito — o erro de fuso
      // (se houvesse) se cancelaria na subtração.
      const tmrppf = chavesDias.map((chaveAlvo) => {
        const doDia = resolvidosDaPessoa.filter(
          (t) => t.identificador === 'Pedido atrasado' && chaveDiaDoTicket_(t.dataFechamento) === chaveAlvo
        );
        if (!doDia.length) return null;
        const minutos = doDia
          .map((t) => (new Date(t.dataFechamento).getTime() - new Date(t.dataAbertura).getTime()) / 60000)
          .filter((m) => Number.isFinite(m) && m >= 0);
        if (!minutos.length) return null;
        const media = minutos.reduce((a, b) => a + b, 0) / minutos.length;
        const h = Math.floor(media / 60);
        const m = Math.round(media % 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      });

      data[nome] = { tickets, tmrppf };
    });

    // Score: até 50 pontos em cada indicador.
    // Resolvidos: quanto MAIS, melhor — valor/MAIOR(valores)*50 (mesma
    // fórmula que já era usada na planilha manual).
    // TMR PPF+1: é tempo, então é o oposto — quanto MENOS, melhor. Quem tem
    // o menor tempo ganha os 50 pontos cheios; os outros ganham proporcional
    // a quão perto ficaram do melhor tempo (MENOR(valores)/valor*50). Sem
    // dado nenhum de TMR na semana = 0 pontos nesse indicador (não tem como
    // saber se foi rápido).
    const totalResolvidos = {};
    const totalTmrMin = {};
    CONSULTORES_RESOLUCAO.forEach(({ nome }) => {
      const valoresResolvidos = data[nome].tickets.filter((v) => v != null);
      totalResolvidos[nome] = valoresResolvidos.length ? valoresResolvidos.reduce((a, b) => a + b, 0) : 0;

      const valoresTmr = data[nome].tmrppf
        .filter((v) => v != null)
        .map((v) => {
          const [h, m] = v.split(':').map(Number);
          return h * 60 + m;
        });
      totalTmrMin[nome] = valoresTmr.length ? valoresTmr.reduce((a, b) => a + b, 0) / valoresTmr.length : null;
    });
    const maxResolvidos = Math.max(0, ...CONSULTORES_RESOLUCAO.map(({ nome }) => totalResolvidos[nome]));
    const tmrValidos = CONSULTORES_RESOLUCAO.map(({ nome }) => totalTmrMin[nome]).filter((v) => v != null && v > 0);
    const minTmr = tmrValidos.length ? Math.min(...tmrValidos) : null;
    CONSULTORES_RESOLUCAO.forEach(({ nome }) => {
      const scoreResolvidos = maxResolvidos > 0 ? (totalResolvidos[nome] / maxResolvidos) * 50 : 0;
      const valorTmr = totalTmrMin[nome];
      const scoreTmr = (minTmr != null && valorTmr != null && valorTmr > 0) ? (minTmr / valorTmr) * 50 : 0;
      data[nome].score = Math.round(scoreResolvidos + scoreTmr);
    });

    res.json({
      ok: true,
      consultores: CONSULTORES_RESOLUCAO.map((c) => c.nome),
      dias: ['Sex', 'Seg', 'Ter', 'Qua', 'Qui'],
      periodo: {
        inicio: chavesDias[0].slice(8, 10) + '/' + chavesDias[0].slice(5, 7),
        fim: chavesDias[4].slice(8, 10) + '/' + chavesDias[4].slice(5, 7),
      },
      offsetSemanas,
      data,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Falha ao calcular Time Resolução: ' + err.message });
  }
});

module.exports = router;
