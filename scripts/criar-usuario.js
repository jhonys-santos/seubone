#!/usr/bin/env node
/* eslint-disable no-console */
const readline = require('readline');
const { criarOuAtualizarUsuario } = require('../src/services/usuarios.service');

// Não usamos rl.question() encadeado: com múltiplas perguntas sequenciais,
// se a entrada chegar em um único bloco (comum quando o terminal recebe
// texto colado, ou em uso não-interativo/scriptado), o readline pode perder
// linhas que chegam entre uma pergunta e a próxima. Uma fila manual sobre o
// evento 'line' evita esse problema tanto na digitação normal quanto colada.
function criarPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const fila = [];
  const esperando = [];
  function escoar() {
    while (fila.length && esperando.length) esperando.shift()(fila.shift());
  }
  rl.on('line', (linha) => { fila.push(linha); escoar(); });
  return {
    perguntar(texto) {
      process.stdout.write(texto);
      return new Promise((resolve) => { esperando.push(resolve); escoar(); });
    },
    close() { rl.close(); },
  };
}

async function main() {
  const p = criarPrompter();

  console.log('=== Criar/atualizar usuário do SeuBoné Hub ===\n');

  const usuario = (await p.perguntar('Usuário (login, sem espaços): ')).trim();
  const senha = (await p.perguntar('Senha: ')).trim();
  const nome = (await p.perguntar('Nome completo: ')).trim();
  const slug = (await p.perguntar('Slug (identificador na planilha, ex: "daniel"): ')).trim();
  const role = (await p.perguntar('Papel ["colaborador" ou "gestor"]: ')).trim().toLowerCase();
  const tipo = (await p.perguntar('Tipo/time ["sac" ou "ppf", ou deixe em branco]: ')).trim().toLowerCase();
  const paineisTexto = await p.perguntar(
    'Painéis liberados, separados por vírgula (ex: painel-sac,wallac) ou vazio para todos: '
  );

  p.close();

  if (!usuario || !senha || !nome || !slug) {
    console.error('\nUsuário, senha, nome e slug são obrigatórios.');
    process.exit(1);
  }
  if (!['colaborador', 'gestor'].includes(role)) {
    console.error('\nPapel inválido — use exatamente "colaborador" ou "gestor".');
    process.exit(1);
  }

  const paineis = paineisTexto
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const registro = await criarOuAtualizarUsuario({
    usuario,
    senha,
    nome,
    slug,
    role,
    tipo: tipo || null,
    paineis,
  });

  console.log('\nUsuário salvo com sucesso em data/usuarios.json:');
  console.log({ ...registro, senhaHash: '(oculto)' });
}

main().catch((err) => {
  console.error('Erro ao criar usuário:', err);
  process.exit(1);
});
