const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

const DB_PATH = path.join(env.dataDir, 'usuarios.json');

function lerBanco() {
  if (!fs.existsSync(DB_PATH)) return { usuarios: [] };
  const bruto = fs.readFileSync(DB_PATH, 'utf-8');
  if (!bruto.trim()) return { usuarios: [] };
  return JSON.parse(bruto);
}

function salvarBanco(banco) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(banco, null, 2), 'utf-8');
}

function listarUsuarios() {
  return lerBanco().usuarios;
}

function buscarPorUsuario(usuario) {
  const alvo = String(usuario || '').trim().toLowerCase();
  return listarUsuarios().find((u) => u.usuario.toLowerCase() === alvo) || null;
}

function buscarPorSlug(slug) {
  return listarUsuarios().find((u) => u.slug === slug) || null;
}

async function autenticar(usuario, senha) {
  const registro = buscarPorUsuario(usuario);
  if (!registro) return null;
  const senhaOk = await bcrypt.compare(String(senha || ''), registro.senhaHash);
  if (!senhaOk) return null;
  return sessaoPublica(registro);
}

function sessaoPublica(registro) {
  return {
    id: registro.id,
    usuario: registro.usuario,
    nome: registro.nome,
    slug: registro.slug,
    role: registro.role,
    tipo: registro.tipo,
    paineis: registro.paineis || null, // null = acesso a todos os painéis
    indicadoresPendentes: !!registro.indicadoresPendentes, // true = ainda não tem KPIs mapeados na planilha
  };
}

function podeAcessarPainel(usuarioSessao, painel) {
  if (!usuarioSessao.paineis) return true; // sem lista = libera tudo
  return usuarioSessao.paineis.includes(painel);
}

async function criarOuAtualizarUsuario({ usuario, senha, nome, slug, role, tipo, paineis }) {
  const banco = lerBanco();
  const senhaHash = await bcrypt.hash(senha, 10);
  const existente = banco.usuarios.find((u) => u.usuario.toLowerCase() === usuario.toLowerCase());

  const registro = {
    id: existente ? existente.id : `u-${slug}`,
    usuario,
    senhaHash,
    nome,
    slug,
    role,
    tipo,
    paineis: paineis && paineis.length ? paineis : undefined,
  };

  if (existente) {
    Object.assign(existente, registro);
  } else {
    banco.usuarios.push(registro);
  }

  salvarBanco(banco);
  return registro;
}

module.exports = {
  listarUsuarios,
  buscarPorUsuario,
  buscarPorSlug,
  autenticar,
  sessaoPublica,
  podeAcessarPainel,
  criarOuAtualizarUsuario,
};
