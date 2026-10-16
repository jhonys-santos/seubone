// Formulário novo de solicitação ao financeiro (card direto no finfin). Só os campos que o finfin pede.
const API = '/registro-demandas/novo/api';
const MAX_ANEXOS = 10;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
// esc() vem do ui.js (global)

$('f-email').value = localStorage.getItem('rd-ultimo-email') || '';
$('f-telefone').value = localStorage.getItem('rd-ultimo-telefone') || '';

function mostrarMsg(texto, tipo) {
  const el = $('form-msg');
  el.textContent = texto;
  el.className = 'msg ' + tipo;
  el.style.display = 'block';
  clearTimeout(mostrarMsg.t);
  mostrarMsg.t = setTimeout(() => { el.className = 'msg'; el.style.display = ''; }, 7000);
}

// "Outros" pede uma especificação.
const ehOutros = () => $('f-demanda').value.trim().toLowerCase() === 'outros';
$('f-demanda').addEventListener('change', () => { $('bloco-especificacao').style.display = ehOutros() ? '' : 'none'; });

async function carregarDemandas() {
  try {
    const r = await (await fetch(API + '/demandas', { cache: 'no-store' })).json();
    if (!r.ok) throw new Error(r.erro);
    $('f-demanda').innerHTML = '<option value="">Selecionar opção...</option>' + r.nomes.map((n) => `<option>${esc(n)}</option>`).join('');
  } catch (e) {
    $('f-demanda').innerHTML = '<option value="">Não consegui carregar a lista. Recarregue a página.</option>';
  }
}

// Anexos: o seletor nativo não soma seleções, então a lista de verdade fica aqui.
let anexos = [];
function renderAnexos() {
  $('f-anexos-lista').innerHTML = anexos.map((f, i) => `<span class="anexo-chip"><span>${esc(f.name)}</span><button type="button" data-i="${i}" title="Remover">✕</button></span>`).join('');
  $('f-anexos-lista').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { anexos.splice(Number(b.dataset.i), 1); renderAnexos(); }));
}
$('f-anexos').addEventListener('change', () => { anexos.push(...Array.from($('f-anexos').files)); $('f-anexos').value = ''; renderAnexos(); });

const lerBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ nome: file.name, tipo: file.type, base64: reader.result.split(',')[1] });
  reader.onerror = () => reject(new Error('Não consegui ler o arquivo ' + file.name));
  reader.readAsDataURL(file);
});

function pareceUrl(v) { try { return /^https?:\/\//i.test(v) && !!new URL(v); } catch (e) { return false; } }

// Um id por tentativa: clicar duas vezes, ou repetir depois de uma falha de rede, nunca cria dois cards.
let idDaTentativa = crypto.randomUUID();

$('btn-enviar').addEventListener('click', async () => {
  const email = $('f-email').value.trim();
  const telefone = $('f-telefone').value.trim();
  const demandaSolicitada = $('f-demanda').value;
  const especificacao = $('f-especificacao').value.trim();
  const descricao = $('f-descricao').value.trim();
  const linkLulu = $('f-link').value.trim();

  if (!email || !demandaSolicitada || !descricao || !linkLulu) return mostrarMsg('Preencha os campos obrigatórios (marcados com *).', 'err');
  if (ehOutros() && !especificacao) return mostrarMsg('Diga o que é a demanda no campo "Especificação".', 'err');
  if (!pareceUrl(linkLulu)) return mostrarMsg('O link do card do Lulu precisa ser um link (começando com https://), não um nome ou texto.', 'err');
  if (anexos.length > MAX_ANEXOS) return mostrarMsg(`Máximo de ${MAX_ANEXOS} anexos.`, 'err');
  if (anexos.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return mostrarMsg('Os anexos somados passam de 4 MB (limite do finfin). Envie arquivos menores.', 'err');

  const btn = $('btn-enviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const corpoAnexos = anexos.length ? await Promise.all(anexos.map(lerBase64)) : [];
    const resp = await fetch(API + '/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: idDaTentativa, email, telefone, demandaSolicitada, especificacao, descricao, linkLulu, anexos: corpoAnexos }),
    });
    const r = await resp.json();
    if (!r.ok) throw new Error(r.erro || 'erro ao enviar');
    mostrarMsg(`Solicitação enviada! Código ${r.codigo || ''}`.trim(), 'ok');
    localStorage.setItem('rd-ultimo-email', email);
    localStorage.setItem('rd-ultimo-telefone', telefone);
    $('f-demanda').value = ''; $('f-especificacao').value = ''; $('f-descricao').value = ''; $('f-link').value = '';
    $('bloco-especificacao').style.display = 'none';
    anexos = []; renderAnexos();
    idDaTentativa = crypto.randomUUID();   // próxima solicitação = id novo
    carregarMinhas();
  } catch (e) {
    mostrarMsg('Erro: ' + e.message, 'err');   // mantém o id: tentar de novo não duplica
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar ao financeiro';
  }
});

const NOMES_COLUNA = { backlog: 'Backlog', delegado: 'Delegado', aguardando: 'Aguardando retorno', fazendo: 'Fazendo', concluido: 'Concluído', cancelado: 'Cancelado' };

// Anexos que o financeiro colocou ao concluir (links do Drive).
function anexosDoFinanceiro(i) {
  let a = i.anexos_retorno;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = []; } }
  if (!Array.isArray(a) || !a.length) return i.concluido_em ? `<br><small>Concluído em ${esc(i.concluido_em)}</small>` : '';
  return `<br><small>Concluído em ${esc(i.concluido_em || '')} · anexos do financeiro: ` + a.filter((x) => x.url).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" style="color:var(--gold)">${esc(x.nome)}</a>`).join(', ') + '</small>';
}

async function carregarMinhas() {
  const box = $('minhas');
  try {
    const r = await (await fetch(API + '/minhas', { cache: 'no-store' })).json();
    if (!r.ok) throw new Error(r.erro);
    box.innerHTML = r.itens.length ? r.itens.map((i) => `
      <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--border)">
        <span><b style="color:var(--text)">${esc(i.codigo || '—')}</b> · ${esc(i.demanda)}${i.modo === 'teste' ? ' <i>(teste)</i>' : ''}<br><small>${esc(i.criado_em)}</small>${anexosDoFinanceiro(i)}</span>
        <span><span data-status="${esc(i.codigo)}">${esc(NOMES_COLUNA[i.coluna] || i.coluna)}</span> <button type="button" class="btn-link" data-atualizar="${esc(i.codigo)}" style="background:none;border:0;color:var(--gold);cursor:pointer">atualizar</button></span>
      </div>`).join('') : 'Nenhuma ainda.';
    box.querySelectorAll('[data-atualizar]').forEach((b) => b.addEventListener('click', async () => {
      b.textContent = '...';
      try {
        const s = await (await fetch(API + '/status?codigo=' + encodeURIComponent(b.dataset.atualizar), { cache: 'no-store' })).json();
        if (!s.ok) throw new Error(s.erro);
        box.querySelector(`[data-status="${CSS.escape(b.dataset.atualizar)}"]`).textContent = (s.coluna && s.coluna.nome) || '—';
      } catch (e) { mostrarMsg('Não consegui consultar: ' + e.message, 'err'); }
      b.textContent = 'atualizar';
    }));
  } catch (e) { box.textContent = 'Não consegui carregar suas solicitações.'; }
}

carregarDemandas();
carregarMinhas();
