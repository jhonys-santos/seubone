#!/usr/bin/env node
// Importa Registro de Demandas, Reembolso, Pagamento e Corridas Avulsas das planilhas para o Postgres,
// lendo direto dos Apps Scripts (mesmos dados que as telas recebem hoje).
//
//   node scripts/importar-financeiro.js              # relatório (NÃO grava nada)
//   node scripts/importar-financeiro.js --aplicar    # grava (só se as tabelas estiverem vazias)
//   node scripts/importar-financeiro.js --aplicar --refazer   # apaga o que já tem e importa de novo
//
// Antes: rodar db/migrations/006_financeiro.sql e publicar os 3 Code.gs novos (ações salvarAnexos/salvarPrints).
// Depois de importar: ligar FINANCEIRO_BACKEND=db.
const path = require('path');
const { paraData } = require('../src/services/financeiroDb.service');

const str = (v) => String(v == null ? '' : v);
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function dataOuAviso(valor, rotulo, avisos) {
  if (!str(valor).trim()) return null;
  const d = paraData(valor);
  if (d == null) avisos.push(`${rotulo}: data não reconhecida "${str(valor).slice(0, 30)}" -> ficará vazia`);
  return d;
}
const instante = (v, rotulo, avisos) => {
  if (ISO_Z.test(str(v))) return str(v);
  if (str(v)) avisos.push(`${rotulo}: horário não reconhecido "${str(v).slice(0, 30)}" -> usado agora`);
  return null;
};

// Cada tabela: colunas na ordem do INSERT + como montar os valores a partir do item da planilha.
const TABELAS = {
  registro: {
    tabela: 'registro_demandas', fonte: 'registros',
    colunas: ['id', 'data', 'data_vencimento', 'id_compra', 'link_card', 'solicitante', 'empresa', 'numero_corporativo', 'tipo_demanda', 'demanda_solicitada',
      'observacao', 'email', 'anexos', 'status', 'feito_por', 'inserido_em', 'solicitante_slug'],
    valores: (x, av) => [str(x.ID), dataOuAviso(x.Data, `Registro ${x.ID} Data`, av), dataOuAviso(x.DataVencimento, `Registro ${x.ID} DataVencimento`, av),
      str(x.IDCompra), str(x.LinkCard), str(x.Solicitante), str(x.Empresa), str(x.NumeroCorporativo), str(x.TipoDemanda), str(x.DemandaSolicitada),
      str(x.Observacao), str(x.Email), str(x.Anexos) || '[]', str(x.Status) || 'Pendente', str(x.FeitoPor), instante(x.InseridoEm, `Registro ${x.ID} InseridoEm`, av),
      str(x.SolicitanteSlug)],
  },
  reembolso: {
    tabela: 'reembolsos', fonte: 'reembolsos',
    colunas: ['id', 'data_vencimento', 'id_referencia', 'cpf_cnpj', 'email', 'motivo_reembolso', 'razao_social_cliente', 'banco', 'agencia', 'conta', 'chave_pix',
      'tipo_chave', 'valor', 'empresa_responsavel', 'anexos', 'status', 'feito_por', 'inserido_em', 'solicitante_slug'],
    valores: (x, av) => [str(x.ID), dataOuAviso(x.DataVencimento, `Reembolso ${x.ID} DataVencimento`, av), str(x.IDReferencia), str(x.CPFCNPJ), str(x.Email),
      str(x.MotivoReembolso), str(x.RazaoSocialCliente), str(x.Banco), str(x.Agencia), str(x.Conta), str(x.ChavePix), str(x.TipoChave), Number(x.Valor) || 0,
      str(x.EmpresaResponsavel), str(x.Anexos) || '[]', str(x.Status) || 'Pendente', str(x.FeitoPor), instante(x.InseridoEm, `Reembolso ${x.ID} InseridoEm`, av),
      str(x.SolicitanteSlug)],
  },
  pagamento: {
    tabela: 'pagamentos', fonte: 'pagamentos',
    colunas: ['id', 'data_vencimento', 'cpf_cnpj', 'email', 'motivo', 'razao_social', 'banco', 'agencia', 'conta', 'chave_pix', 'tipo_chave', 'valor',
      'empresa_responsavel', 'solicitante', 'numero_nota_fiscal', 'anexos', 'status', 'feito_por', 'inserido_em', 'solicitante_slug'],
    valores: (x, av) => [str(x.ID), dataOuAviso(x.DataVencimento, `Pagamento ${x.ID} DataVencimento`, av), str(x.CPFCNPJ), str(x.Email), str(x.Motivo),
      str(x.RazaoSocial), str(x.Banco), str(x.Agencia), str(x.Conta), str(x.ChavePix), str(x.TipoChave), Number(x.Valor) || 0, str(x.EmpresaResponsavel),
      str(x.Solicitante), str(x.NumeroNotaFiscal), str(x.Anexos) || '[]', str(x.Status) || 'Pendente', str(x.FeitoPor),
      instante(x.InseridoEm, `Pagamento ${x.ID} InseridoEm`, av), str(x.SolicitanteSlug)],
  },
  corrida: {
    tabela: 'corridas', fonte: 'corridas',
    colunas: ['id', 'data_cadastro', 'data_corrida', 'numero_nf', 'endereco', 'valor', 'print_urls', 'registrado_por_slug', 'registrado_por_nome', 'nome_motorista'],
    valores: (x, av) => [str(x.id), instante(x.dataCadastro, `Corrida ${x.id} dataCadastro`, av), dataOuAviso(x.dataCorrida, `Corrida ${x.id} dataCorrida`, av),
      str(x.numeroNf), str(x.endereco), Number(x.valor) || 0, JSON.stringify(Array.isArray(x.printUrls) ? x.printUrls : []), str(x.registradoPorSlug),
      str(x.registradoPorNome), str(x.nomeMotorista)],
    cast: { print_urls: '::jsonb' },
  },
};

function analisar(origem) {
  const rel = { contagens: {}, avisos: [], idsRepetidos: [] };
  for (const [nome, t] of Object.entries(TABELAS)) {
    const lista = origem[t.fonte] || [];
    rel.contagens[nome] = lista.length;
    const ids = lista.map((x) => str(x.ID || x.id));
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (repetidos.length) rel.idsRepetidos.push(`${nome}: ${[...new Set(repetidos)].join(', ')}`);
    lista.forEach((x) => t.valores(x, rel.avisos));
  }
  return rel;
}

async function importar(origem, db, { refazer = false } = {}) {
  const avisos = [];
  return db.transaction(async (tx) => {
    const ja = await tx.query('select (select count(*) from registro_demandas)::int + (select count(*) from reembolsos)::int + (select count(*) from pagamentos)::int + (select count(*) from corridas)::int as n');
    if (ja.rows[0].n > 0) {
      if (!refazer) throw new Error(`As tabelas financeiras já têm ${ja.rows[0].n} linhas. Use --refazer para apagar e importar de novo.`);
      for (const t of Object.values(TABELAS)) await tx.query(`delete from ${t.tabela}`);
    }
    const totais = {};
    for (const [nome, t] of Object.entries(TABELAS)) {
      const lista = origem[t.fonte] || [];
      const idx = t.colunas.indexOf('inserido_em') >= 0 ? t.colunas.indexOf('inserido_em') : t.colunas.indexOf('data_cadastro');
      for (const x of lista) {
        const v = t.valores(x, avisos);
        const marcas = v.map((_, i) => `$${i + 1}${(t.cast && t.cast[t.colunas[i]]) || ''}`);
        // horário vazio -> deixa o default (agora)
        marcas[idx] = `coalesce($${idx + 1}::timestamptz, now())`;
        await tx.query(`insert into ${t.tabela} (${t.colunas.join(', ')}) values (${marcas.join(', ')})`, v);
      }
      totais[nome] = lista.length;
    }
    return { totais, avisos };
  });
}

/** Lê do banco o que as telas receberiam e compara, item a item e campo a campo, com a planilha. */
async function conferir(origem, servico) {
  const problemas = [];
  const comparar = (nome, esperados, obtidos, chave) => {
    const porId = new Map(obtidos.map((x) => [x[chave], x]));
    if (esperados.length !== obtidos.length) problemas.push(`${nome}: quantidade origem ${esperados.length} x banco ${obtidos.length}`);
    esperados.forEach((o, i) => {
      const d = porId.get(o[chave]);
      if (!d) { problemas.push(`${nome} ${o[chave]}: não está no banco`); return; }
      if (obtidos[i] && obtidos[i][chave] !== o[chave]) problemas.push(`${nome} ${o[chave]}: ordem diferente (posição ${i})`);
      for (const k of Object.keys(o)) {
        let esperado = o[k]; let obtido = d[k];
        if (/Data|data/.test(k) && k !== 'dataCadastro' && esperado && !paraData(esperado)) continue; // data inválida: foi avisada
        if (k === 'printUrls') { esperado = JSON.stringify(esperado || []); obtido = JSON.stringify(obtido || []); }
        else if (typeof o[k] === 'number') { esperado = Number(esperado); obtido = Number(obtido); }
        else { esperado = str(esperado); obtido = str(obtido); }
        if (esperado !== obtido) problemas.push(`${nome} ${o[chave]} campo ${k}: origem "${esperado.slice(0, 40)}" x banco "${obtido.slice(0, 40)}"`);
      }
    });
  };
  comparar('Registro', origem.registros, await servico.listarRegistros(), 'ID');
  comparar('Reembolso', origem.reembolsos, await servico.listarReembolsos(), 'ID');
  comparar('Pagamento', origem.pagamentos, await servico.listarPagamentos(), 'ID');
  comparar('Corrida', origem.corridas, (await servico.listarCorridas()).itens, 'id');
  return problemas;
}

async function buscarOrigem() {
  const env = require('../src/config/env');
  const pegar = async (url, extra) => {
    const u = new URL(url);
    u.searchParams.set('segredo', env.appsScriptSharedSecret);
    Object.entries(extra || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(170000) });
    return r.json();
  };
  const registros = await pegar(env.registroDemandasAppsScriptUrl, { action: 'list' });
  const reembolsos = await pegar(env.registroDemandasAppsScriptUrl, { action: 'listReembolso' });
  const pagamentos = await pegar(env.corridasPagamentosAppsScriptUrl, { action: 'list' });
  const corridas = await pegar(env.corridasAvulsasAppsScriptUrl, { action: 'lista' });
  for (const [n, v] of [['registros', registros], ['reembolsos', reembolsos], ['pagamentos', pagamentos]]) {
    if (!Array.isArray(v)) throw new Error(`Apps Script não devolveu a lista de ${n}: ${(v && v.erro) || '?'}`);
  }
  if (!corridas.ok || !Array.isArray(corridas.itens)) throw new Error('Apps Script não devolveu as corridas: ' + (corridas.erro || '?'));
  return { registros, reembolsos, pagamentos, corridas: corridas.itens };
}

async function principal() {
  const aplicar = process.argv.includes('--aplicar');
  const refazer = process.argv.includes('--refazer');
  console.log('Lendo dos Apps Scripts (pode levar alguns minutos, as planilhas são lentas)...');
  const origem = await buscarOrigem();
  const rel = analisar(origem);
  console.log('\nRegistros:', rel.contagens.registro, '| Reembolsos:', rel.contagens.reembolso, '| Pagamentos:', rel.contagens.pagamento, '| Corridas:', rel.contagens.corrida);
  console.log('Ids repetidos:', rel.idsRepetidos.length ? '\n  ' + rel.idsRepetidos.join('\n  ') : 'nenhum');
  if (rel.avisos.length) console.log(`Avisos (${rel.avisos.length}):\n  ` + rel.avisos.slice(0, 30).join('\n  '));
  if (!aplicar) { console.log('\nNada foi gravado (modo relatório). Use --aplicar para importar.'); return; }
  if (rel.idsRepetidos.length) throw new Error('Há ids repetidos na planilha: resolva antes de importar.');

  const db = require('../src/db');
  const r = await importar(origem, db, { refazer });
  console.log('\nImportados:', JSON.stringify(r.totais));
  const problemas = await conferir(origem, require('../src/services/financeiroDb.service'));
  if (problemas.length) { console.log(`\nCONFERÊNCIA: ${problemas.length} diferenças:\n  ` + problemas.slice(0, 40).join('\n  ')); process.exitCode = 1; }
  else console.log('CONFERÊNCIA: todos os campos de todos os registros batem com a origem (e na mesma ordem).');
  await db.fechar();
}

module.exports = { analisar, importar, conferir, TABELAS };
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  principal().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
