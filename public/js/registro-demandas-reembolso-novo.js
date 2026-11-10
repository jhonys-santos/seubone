// Formulário novo de reembolso (card direto no kanban "Solicitações de reembolso - SAC" do finfin). Peças comuns em finfin-form-comum.js.
const API = '/registro-demandas/reembolso/novo/api';
const MAX_ANEXOS = 10;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const F = window.FinfinForm;
const $ = F.$;

$('r-email').value = localStorage.getItem('rd-ultimo-email') || '';
const mostrarMsg = F.criarMensagens('form-msg');
const anexos = F.criarAnexos('r-anexos', 'r-anexos-lista');

// Bloco "Erro deste pedido" (só com REEMBOLSO_EXIGE_ERRO=on no servidor): cada ID de venda precisa ter o erro registrado, ser registrado agora ou ser dispensado.
let blocoErro = null;
(async function iniciarBlocoErro() {
  try {
    const cfg = await ReembolsoErro.chamar('/config');
    if (!cfg.ligado) return;
    $('rb-secao').hidden = false;
    blocoErro = ReembolsoErro.criar({
      container: $('rb-bloco'),
      contexto: () => ({ idVenda: $('r-idvenda').value, cliente: $('r-razaosocial').value.trim(), link: $('r-link').value.trim(), motivo: $('r-motivo').value.trim() }),
    });
    let t = null;
    ['input', 'blur'].forEach((ev) => $('r-idvenda').addEventListener(ev, () => { clearTimeout(t); t = setTimeout(() => blocoErro.atualizarIds(), ev === 'blur' ? 0 : 600); }));
    ['r-razaosocial', 'r-link', 'r-motivo'].forEach((id) => $(id).addEventListener('input', () => blocoErro.sincronizar()));
    blocoErro.atualizarIds();
  } catch (e) { /* sem o bloco o formulário segue; o servidor ainda confere ao enviar */ }
})();

// Um id por tentativa: clicar duas vezes, ou repetir depois de uma falha de rede, nunca cria dois cards.
let idDaTentativa = crypto.randomUUID();
const CAMPOS_LIMPAR = ['r-idvenda', 'r-vencimento', 'r-cpfcnpj', 'r-link', 'r-motivo', 'r-razaosocial', 'r-banco', 'r-agencia', 'r-conta', 'r-tipochave', 'r-chavepix', 'r-valor'];

$('btn-registrar').addEventListener('click', async () => {
  const v = (id) => $(id).value.trim();
  const dados = {
    idVenda: v('r-idvenda'), vencimento: v('r-vencimento'), cpfCnpj: v('r-cpfcnpj'), email: v('r-email'), linkLulu: v('r-link'), motivo: v('r-motivo'),
    razaoSocial: v('r-razaosocial'), banco: v('r-banco'), agencia: v('r-agencia'), conta: v('r-conta'), pixTipo: v('r-tipochave'), pixChave: v('r-chavepix'), valor: v('r-valor'),
  };
  const arquivos = anexos.arquivos();

  if (Object.values(dados).some((x) => !x)) return mostrarMsg('Preencha todos os campos obrigatórios (marcados com *).', 'err');
  if (!F.docValido(dados.cpfCnpj)) return mostrarMsg('CPF/CNPJ inválido. Confira os dígitos.', 'err');
  if (!F.pareceUrl(dados.linkLulu)) return mostrarMsg('O link do card do Lulu precisa ser um link (começando com https://), não um nome ou texto.', 'err');
  const erroPix = F.erroDaChavePix(dados.pixTipo, dados.pixChave);
  if (erroPix) return mostrarMsg(erroPix, 'err');
  if (!(F.numeroBr(dados.valor) > 0)) return mostrarMsg('Valor inválido. Use um número, ex.: 150,00.', 'err');
  if (arquivos.length > MAX_ANEXOS) return mostrarMsg(`Máximo de ${MAX_ANEXOS} anexos.`, 'err');
  if (arquivos.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return mostrarMsg('Os anexos somados passam de 4 MB (limite do finfin). Envie arquivos menores.', 'err');

  let erroDispensas = [];
  if (blocoErro) {
    const v = blocoErro.validar();
    if (!v.ok) { $('rb-secao').scrollIntoView({ behavior: 'smooth', block: 'center' }); return mostrarMsg(v.mensagem, 'err'); }
  }

  const btn = $('btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    if (blocoErro) {   // registra os erros que faltam ANTES do reembolso: se falhar, nada é enviado ao financeiro
      erroDispensas = (await blocoErro.executar((m) => { btn.textContent = m; })).dispensas;
      btn.textContent = 'Enviando...';
    }
    const corpoAnexos = arquivos.length ? await Promise.all(arquivos.map((f) => F.lerBase64(f))) : [];
    const resp = await fetch(API + '/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: idDaTentativa, ...dados, anexos: corpoAnexos, erroDispensas }) });
    const r = await resp.json();
    if (!r.ok) throw new Error(F.textoDoErro(r));
    mostrarMsg(`Reembolso enviado! Código ${r.codigo || ''}`.trim(), 'ok');
    localStorage.setItem('rd-ultimo-email', dados.email);
    CAMPOS_LIMPAR.forEach((id) => { $(id).value = ''; });
    anexos.limpar();
    if (blocoErro) blocoErro.reiniciar();
    idDaTentativa = crypto.randomUUID();   // próximo reembolso = id novo
  } catch (e) {
    mostrarMsg('Erro: ' + e.message, 'err');   // mantém o id: tentar de novo não duplica
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar ao financeiro';
  }
});
