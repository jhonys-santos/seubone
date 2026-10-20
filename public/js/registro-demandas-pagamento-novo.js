// Formulário novo de pagamento (card direto no kanban "Pagamentos" do finfin). Mesmos campos do formulário público do finfin.
// Peças comuns em finfin-form-comum.js.
const API = '/registro-demandas/pagamento/novo/api';
const MAX_ANEXOS = 10;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const F = window.FinfinForm;
const $ = F.$;

$('pg-email').value = localStorage.getItem('rd-ultimo-email') || '';
const mostrarMsg = F.criarMensagens('form-msg');
const anexos = F.criarAnexos('pg-anexos', 'pg-anexos-lista');

// Um id por tentativa: clicar duas vezes, ou repetir depois de uma falha de rede, nunca cria dois cards.
let idDaTentativa = crypto.randomUUID();
const CAMPOS_LIMPAR = ['pg-razaosocial', 'pg-cpfcnpj', 'pg-vencimento', 'pg-motivo', 'pg-banco', 'pg-agencia', 'pg-conta', 'pg-valor', 'pg-tipochave', 'pg-chavepix', 'pg-numeronf'];

const minhas = F.criarMinhas({
  api: API,
  nomesColuna: { backlog: 'Backlog', lancar_omie: 'Lançar no Omie', aguardando: 'Ajuste/Aguardando retorno', lancado: 'Lançado', pago: 'Pago', cancelado: 'Cancelado' },
  colunasOk: ['pago'],
  titulo: (i, d) => `${esc(d.razao_social || '')}${d.valor != null ? ' · ' + esc(F.brl(d.valor)) : ''}`,
  rotuloFim: (i) => (i.coluna === 'cancelado' ? 'Cancelado' : 'Pago'),
  vazio: 'Nenhum ainda.', erroCarregar: 'Não consegui carregar seus pagamentos.', aoErro: (m) => mostrarMsg(m, 'err'),
});

$('btn-registrar').addEventListener('click', async () => {
  const v = (id) => $(id).value.trim();
  const dados = {
    razaoSocial: v('pg-razaosocial'), cpfCnpj: v('pg-cpfcnpj'), vencimento: v('pg-vencimento'), email: v('pg-email'), motivo: v('pg-motivo'),
    banco: v('pg-banco'), agencia: v('pg-agencia'), conta: v('pg-conta'), valor: v('pg-valor'), pixTipo: v('pg-tipochave'), pixChave: v('pg-chavepix'), notaFiscal: v('pg-numeronf'),
  };
  const arquivos = anexos.arquivos();

  if (Object.values(dados).some((x) => !x) || !arquivos.length) return mostrarMsg('Preencha todos os campos obrigatórios (marcados com *) e anexe ao menos 1 arquivo.', 'err');
  if (!F.docValido(dados.cpfCnpj)) return mostrarMsg('CPF/CNPJ inválido. Confira os dígitos.', 'err');
  const erroPix = F.erroDaChavePix(dados.pixTipo, dados.pixChave);
  if (erroPix) return mostrarMsg(erroPix, 'err');
  if (!(F.numeroBr(dados.valor) > 0)) return mostrarMsg('Valor inválido. Use um número, ex.: 150,00.', 'err');
  if (arquivos.length > MAX_ANEXOS) return mostrarMsg(`Máximo de ${MAX_ANEXOS} anexos.`, 'err');
  if (arquivos.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) return mostrarMsg('Os anexos somados passam de 4 MB (limite do finfin). Envie arquivos menores.', 'err');

  const btn = $('btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const corpoAnexos = await Promise.all(arquivos.map((f) => F.lerBase64(f)));
    const resp = await fetch(API + '/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: idDaTentativa, ...dados, anexos: corpoAnexos }) });
    const r = await resp.json();
    if (!r.ok) throw new Error(F.textoDoErro(r));
    mostrarMsg(`Pagamento enviado! Código ${r.codigo || ''}`.trim(), 'ok');
    localStorage.setItem('rd-ultimo-email', dados.email);
    CAMPOS_LIMPAR.forEach((id) => { $(id).value = ''; });
    anexos.limpar();
    idDaTentativa = crypto.randomUUID();   // próximo pagamento = id novo
    minhas.carregar();
  } catch (e) {
    mostrarMsg('Erro: ' + e.message, 'err');   // mantém o id: tentar de novo não duplica
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar ao financeiro';
  }
});
