// Análise de termo (card direto no kanban "Análise de termo" do finfin). Dois anexos obrigatórios: orçamento e layout.
// Peças comuns em finfin-form-comum.js.
const API = '/registro-demandas/analise-termo/api';
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const F = window.FinfinForm;
const $ = F.$;

$('t-email').value = localStorage.getItem('rd-ultimo-email') || '';
const mostrarMsg = F.criarMensagens('form-msg');
// Um arquivo por categoria: escolher outro substitui o anterior.
const orcamento = F.criarAnexos('t-orcamento', 't-orcamento-lista', { unico: true });
const layout = F.criarAnexos('t-layout', 't-layout-lista', { unico: true });

// Um id por tentativa: clicar duas vezes, ou repetir depois de uma falha de rede, nunca cria dois cards.
let idDaTentativa = crypto.randomUUID();
const CAMPOS_LIMPAR = ['t-cpfcnpj', 't-idvenda', 't-link', 't-forma', 't-apos-nf', 't-obs'];

const minhas = F.criarMinhas({
  api: API,
  nomesColuna: { em_analise: 'Em análise', reprovado: 'Reprovado', ajustar: 'Ajustar', pre_aprovado: 'Pré-aprovado' },
  colunasOk: ['pre_aprovado'],
  titulo: (i, d) => `Venda ${esc(d.id_venda || '')}`,
  rotuloFim: (i) => ({ pre_aprovado: 'Pré-aprovado', reprovado: 'Reprovado' }[i.coluna] || 'Concluído'),
  vazio: 'Nenhum ainda.', erroCarregar: 'Não consegui carregar seus termos.', aoErro: (m) => mostrarMsg(m, 'err'),
});

$('btn-registrar').addEventListener('click', async () => {
  const v = (id) => $(id).value.trim();
  const dados = { email: v('t-email'), cpfCnpj: v('t-cpfcnpj'), idVenda: v('t-idvenda'), linkLulu: v('t-link'), formaPagamento: v('t-forma'), pagamentoAposNf: v('t-apos-nf'), observacoes: v('t-obs') };
  const [arqOrc] = orcamento.arquivos(), [arqLay] = layout.arquivos();

  const obrigatorios = ['email', 'cpfCnpj', 'idVenda', 'linkLulu', 'formaPagamento', 'pagamentoAposNf'];
  if (obrigatorios.some((k) => !dados[k])) return mostrarMsg('Preencha todos os campos obrigatórios (marcados com *).', 'err');
  if (!arqOrc) return mostrarMsg('Anexe o PDF do orçamento.', 'err');
  if (!arqLay) return mostrarMsg('Anexe o layout do boné.', 'err');
  if (!F.docValido(dados.cpfCnpj)) return mostrarMsg('CPF/CNPJ inválido. Confira os dígitos.', 'err');
  if (!F.pareceUrl(dados.linkLulu)) return mostrarMsg('O link do card do Lulu precisa ser um link (começando com https://), não um nome ou texto.', 'err');
  if (arqOrc.size + arqLay.size > MAX_TOTAL_BYTES) return mostrarMsg('Os anexos somados passam de 4 MB (limite do finfin). Envie arquivos menores.', 'err');

  const btn = $('btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  try {
    const corpoAnexos = [await F.lerBase64(arqOrc, { categoria: 'orcamento' }), await F.lerBase64(arqLay, { categoria: 'layout' })];
    const resp = await fetch(API + '/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: idDaTentativa, ...dados, anexos: corpoAnexos }) });
    const r = await resp.json();
    if (!r.ok) throw new Error(F.textoDoErro(r));
    mostrarMsg(`Termo enviado para análise! Código ${r.codigo || ''}`.trim(), 'ok');
    localStorage.setItem('rd-ultimo-email', dados.email);
    CAMPOS_LIMPAR.forEach((id) => { $(id).value = ''; });
    orcamento.limpar(); layout.limpar();
    idDaTentativa = crypto.randomUUID();   // próximo termo = id novo
    minhas.carregar();
  } catch (e) {
    mostrarMsg('Erro: ' + e.message, 'err');   // mantém o id: tentar de novo não duplica
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Enviar para análise';
  }
});
