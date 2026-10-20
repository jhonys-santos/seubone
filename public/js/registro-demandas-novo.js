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
  } catch (e) {
    mostrarMsg('Erro: ' + e.message, 'err');   // mantém o id: tentar de novo não duplica
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar ao financeiro';
  }
});

// ── Retornos do finfin (gestor) ───────────────────────────────────────────────
async function carregarRetornos() {
  const box = $('retornos');
  if (!box) return;
  try {
    const r = await (await fetch(API + '/retornos', { cache: 'no-store' })).json();
    if (!r.ok) throw new Error(r.erro);
    const sem = r.concluidosSemRetorno;
    $('retornos-resumo').innerHTML = (r.webhookConfigurado ? '' : '<b style="color:var(--bad-text,#e5484d)">Segredo do webhook não configurado no servidor (FINFIN_WEBHOOK_SECRET).</b> ')
      + (r.chamadas.length ? `Última chamada do finfin: <b>${esc(r.chamadas[0].quando)}</b> (${esc(r.chamadas[0].resultado)}).` : 'O finfin ainda não chamou o hub.')
      + (sem.length ? ` <b style="color:var(--warn-text,#d9a400)">Concluídos no finfin sem retorno aqui: ${sem.map((x) => esc(x.codigo)).join(', ')}.</b>` : '');
    box.innerHTML = r.chamadas.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;color:var(--text-muted)"><th>Quando</th><th>Card</th><th>Coluna</th><th>Resultado</th><th>Anexos</th><th>HTTP</th></tr></thead><tbody>`
      + r.chamadas.map((c) => `<tr style="border-top:1px solid var(--border)"><td>${esc(c.quando)}</td><td>${esc(c.codigo || '—')}</td><td>${esc(c.coluna || '—')}</td><td>${esc(c.resultado)}${c.notificado ? ' · avisou o solicitante' : ''}${c.erro ? ' · ' + esc(c.erro) : ''}</td><td>${c.anexos_novos}/${c.anexos_recebidos}</td><td>${c.http}</td></tr>`).join('') + '</tbody></table>' : '';
  } catch (e) { $('retornos-resumo').textContent = 'Não consegui carregar os retornos.'; }
}
if ($('btn-conferir')) $('btn-conferir').addEventListener('click', async () => {
  const b = $('btn-conferir'); b.disabled = true; b.textContent = 'Conferindo...';
  try {
    const r = await (await fetch(API + '/conferir', { method: 'POST' })).json();
    if (!r.ok) throw new Error(r.erro);
    mostrarMsg(`Conferidos ${r.verificados} card(s) abertos; ${r.mudaram} mudaram de coluna.${r.concluidosSemRetorno.length ? ' Concluídos sem retorno: ' + r.concluidosSemRetorno.join(', ') + '.' : ''}`, r.concluidosSemRetorno.length ? 'err' : 'ok');
    carregarRetornos();
  } catch (e) { mostrarMsg('Erro ao conferir: ' + e.message, 'err'); }
  b.disabled = false; b.textContent = 'Conferir com o finfin agora';
});

carregarDemandas();
carregarRetornos();


// Atualiza sozinho o painel de retornos (gestor) a cada 30 s, só com a aba à vista; ao voltar para a aba, atualiza na hora.
setInterval(() => { if (!document.hidden) carregarRetornos(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) carregarRetornos(); });
