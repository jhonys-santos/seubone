// Formulário novo de pagamento (card direto no kanban "Pagamentos" do finfin). Mesmos campos do formulário público do finfin.
const API = '/registro-demandas/pagamento/novo/api';
const MAX_ANEXOS = 10;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
// esc() vem do ui.js (global)

$('pg-email').value = localStorage.getItem('rd-ultimo-email') || '';

function mostrarMsg(texto, tipo) {
  const el = $('form-msg');
  el.textContent = texto;
  el.className = 'msg ' + tipo;
  el.style.display = 'block';
  clearTimeout(mostrarMsg.t);
  mostrarMsg.t = setTimeout(() => { el.className = 'msg'; el.style.display = ''; }, 9000);
}

// ── CPF/CNPJ (mesma conferência do servidor) ──
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function cnpjValido(v) {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = p.reduce((a, x, i) => a + Number(d[i]) * x, 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

// "1.234,56" / "1234,56" / "1234.56" → número (ou NaN). Com vírgula, ponto é milhar; "1.500" (grupos de 3) também.
function numeroBr(txt) {
  const t = String(txt || '').trim().replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  const norm = t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(norm);
}

// Anexos: o seletor nativo não soma seleções, então a lista de verdade fica aqui.
let anexos = [];
function renderAnexos() {
  $('pg-anexos-lista').innerHTML = anexos.map((f, i) => `<span class="anexo-chip"><span>${esc(f.name)}</span><button type="button" data-i="${i}" title="Remover">✕</button></span>`).join('');
  $('pg-anexos-lista').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { anexos.splice(Number(b.dataset.i), 1); renderAnexos(); }));
}
$('pg-anexos').addEventListener('change', () => { anexos.push(...Array.from($('pg-anexos').files)); $('pg-anexos').value = ''; renderAnexos(); });

const lerBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ nome: file.name, tipo: file.type, base64: reader.result.split(',')[1] });
  reader.onerror = () => reject(new Error('Não consegui ler o arquivo ' + file.name));
  reader.readAsDataURL(file);
});

// Um id por tentativa: clicar duas vezes, ou repetir depois de uma falha de rede, nunca cria dois cards.
let idDaTentativa = crypto.randomUUID();

const CAMPOS_LIMPAR = ['pg-razaosocial', 'pg-cpfcnpj', 'pg-vencimento', 'pg-motivo', 'pg-banco', 'pg-agencia', 'pg-conta', 'pg-valor', 'pg-tipochave', 'pg-chavepix', 'pg-numeronf'];

$('btn-registrar').addEventListener('click', async () => {
  const v = (id) => $(id).value.trim();
  const dados = {
    razaoSocial: v('pg-razaosocial'), cpfCnpj: v('pg-cpfcnpj'), vencimento: v('pg-vencimento'), email: v('pg-email'), motivo: v('pg-motivo'),
    banco: v('pg-banco'), agencia: v('pg-agencia'), conta: v('pg-conta'), valor: v('pg-valor'), pixTipo: v('pg-tipochave'), pixChave: v('pg-chavepix'), notaFiscal: v('pg-numeronf'),
  };

  if (Object.values(dados).some((x) => !x) || !anexos.length) return mostrarMsg('Preencha todos os campos obrigatórios (marcados com *) e anexe ao menos 1 arquivo.', 'err');
  if (!cpfValido(dados.cpfCnpj) && !cnpjValido(dados.cpfCnpj)) return mostrarMsg('CPF/CNPJ inválido. Confira os dígitos.', 'err');
  if (dados.pixTipo === 'cpf' && !cpfValido(dados.pixChave)) return mostrarMsg('A chave pix não é um CPF válido.', 'err');
  if (dados.pixTipo === 'cnpj' && !cnpjValido(dados.pixChave)) return mostrarMsg('A chave pix não é um CNPJ válido.', 'err');
  if (dados.pixTipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.pixChave)) return mostrarMsg('A chave pix não é um e-mail válido.', 'err');
  if (!(numeroBr(dados.valor) > 0)) return mostrarMsg('Valor inválido. Use um número, ex.: 150,00.', 'err');
  if (anexos.length > MAX_ANEXOS) return mostrarMsg(`Máximo de ${MAX_ANEXOS} anexos.`, 'err');
  if (anexos.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return mostrarMsg('Os anexos somados passam de 4 MB (limite do finfin). Envie arquivos menores.', 'err');

  const btn = $('btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const corpoAnexos = await Promise.all(anexos.map(lerBase64));
    const resp = await fetch(API + '/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: idDaTentativa, ...dados, anexos: corpoAnexos }),
    });
    const r = await resp.json();
    if (!r.ok) {
      const lista = r.erros && typeof r.erros === 'object' ? (Array.isArray(r.erros) ? r.erros : Object.values(r.erros)) : [];
      throw new Error(lista.length > 1 ? lista.join(' ') : (r.erro || 'erro ao enviar'));
    }
    mostrarMsg(`Pagamento enviado! Código ${r.codigo || ''}`.trim(), 'ok');
    localStorage.setItem('rd-ultimo-email', dados.email);
    CAMPOS_LIMPAR.forEach((id) => { $(id).value = ''; });
    anexos = []; renderAnexos();
    idDaTentativa = crypto.randomUUID();   // próximo pagamento = id novo
    carregarMinhas();
  } catch (e) {
    mostrarMsg('Erro: ' + e.message, 'err');   // mantém o id: tentar de novo não duplica
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar ao financeiro';
  }
});

const NOMES_COLUNA = { backlog: 'Backlog', lancar_omie: 'Lançar no Omie', aguardando: 'Ajuste/Aguardando retorno', lancado: 'Lançado', pago: 'Pago', cancelado: 'Cancelado' };
const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Anexos que o financeiro colocou ao pagar (comprovante): botões de download, iguais aos do Histórico.
function anexosDoFinanceiro(i) {
  let a = i.anexos_retorno;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = []; } }
  a = Array.isArray(a) ? a.filter((x) => x && (x.downloadUrl || x.url)) : [];
  const quem = i.concluido_por ? ' por ' + esc(i.concluido_por) : '';
  const quando = i.concluido_em ? ' em ' + esc(i.concluido_em) : '';
  const linha = i.coluna === 'pago' || i.concluido_em ? '<br><small>Pago' + quem + quando + '</small>' : '';
  const coment = i.comentario_retorno ? '<br><small>' + esc(i.comentario_retorno) + '</small>' : '';
  const botoes = a.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + a.map((x, n) => '<a class="anexo-btn" href="' + esc(x.downloadUrl || x.url) + '" target="_blank" rel="noopener" title="' + esc(x.nome) + '"><i class="ti ti-download" aria-hidden="true"></i> ' + esc(x.nome || ('Anexo ' + (n + 1))) + '</a>').join('') + '</div>'
    : '';
  return linha + coment + botoes;
}

async function carregarMinhas() {
  const box = $('minhas');
  try {
    const r = await (await fetch(API + '/minhas', { cache: 'no-store' })).json();
    if (!r.ok) throw new Error(r.erro);
    box.innerHTML = r.itens.length ? r.itens.map((i) => {
      let d = i.dados; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } } d = d || {};
      return `
      <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--border)">
        <span><b style="color:var(--text)">${esc(i.codigo || '—')}</b> · ${esc(d.razao_social || '')}${d.valor != null ? ' · ' + esc(brl(d.valor)) : ''}${i.modo === 'teste' ? ' <i>(teste)</i>' : ''}<br><small>${esc(i.criado_em)}</small>${anexosDoFinanceiro(i)}</span>
        <span><span data-status="${esc(i.codigo)}" style="${i.coluna === 'pago' ? 'color:var(--ok-text,#3fb950);font-weight:700' : ''}">${esc(NOMES_COLUNA[i.coluna] || i.coluna)}</span> <button type="button" class="btn-link" data-atualizar="${esc(i.codigo)}" style="background:none;border:0;color:var(--gold);cursor:pointer">atualizar</button></span>
      </div>`;
    }).join('') : 'Nenhum ainda.';
    box.querySelectorAll('[data-atualizar]').forEach((b) => b.addEventListener('click', async () => {
      b.textContent = '...';
      try {
        const s = await (await fetch(API + '/status?codigo=' + encodeURIComponent(b.dataset.atualizar), { cache: 'no-store' })).json();
        if (!s.ok) throw new Error(s.erro);
        box.querySelector(`[data-status="${CSS.escape(b.dataset.atualizar)}"]`).textContent = (s.coluna && s.coluna.nome) || '—';
      } catch (e) { mostrarMsg('Não consegui consultar: ' + e.message, 'err'); }
      b.textContent = 'atualizar';
    }));
  } catch (e) { box.textContent = 'Não consegui carregar seus pagamentos.'; }
}

carregarMinhas();
// Atualiza sozinho a cada 15 s (só com a aba à vista); ao voltar para a aba, atualiza na hora.
setInterval(() => { if (!document.hidden) carregarMinhas(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) carregarMinhas(); });
