// Premiação (SB Coin) — histórico semanal de peças no prazo, faixa e
// coins. Portado do arquivo standalone premiacao_wallac_2.html — mesma
// planilha/Apps Script do Wallac, só que agora via proxy do hub em vez de
// chamar o Apps Script direto do navegador.

function formatarDataBR(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function nomeMes(mesRef) {
  if (!mesRef) return '-';
  const [ano, mes] = mesRef.split('-');
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[Number(mes) - 1]} de ${ano}`;
}

function classeFaixa(faixa) {
  return (faixa || 'nenhuma').toLowerCase();
}

function pEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function carregarHistorico() {
  const corpo = document.getElementById('corpo-tabela');
  try {
    const resp = await fetch('/wallac/api/premiacao-historico');
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro);

    const historico = dados.historico.slice().reverse(); // mais recente primeiro

    if (historico.length === 0) {
      corpo.innerHTML = '<tr><td colspan="4" class="premiacao-vazio">Nenhum fechamento registrado ainda</td></tr>';
      document.getElementById('mes-atual').textContent = 'Sem dados';
      document.getElementById('coins-mes').innerHTML = '0 <span>coins no mês</span>';
      return;
    }

    // Resumo do mês mais recente.
    const mesMaisRecente = historico[0].mes_referencia;
    const coinsDoMes = historico[0].coins_acumulados_no_mes || 0;
    document.getElementById('mes-atual').textContent = nomeMes(mesMaisRecente);
    document.getElementById('coins-mes').innerHTML = coinsDoMes + ' <span>coins no mês</span>';

    corpo.innerHTML = historico.map((item) => `
      <tr>
        <td>${formatarDataBR(item.semana_inicio)} - ${formatarDataBR(item.semana_fim)}</td>
        <td>${pEsc(item.pecas_no_prazo)}</td>
        <td><span class="selo-faixa ${pEsc(classeFaixa(item.faixa))}">${pEsc(item.faixa)}</span></td>
        <td class="coins-semana">+${pEsc(item.coins_da_semana)}</td>
      </tr>
    `).join('');
  } catch (err) {
    corpo.innerHTML = '<tr><td colspan="4" class="premiacao-vazio">Erro ao carregar histórico</td></tr>';
  }
}

// Limites das faixas — precisam bater com premiacaoFaixaECoins no Apps
// Script (só usados aqui pra montar a barra/legenda de progresso).
const PREMIACAO_LIMITES = [
  { faixa: 'Bronze', min: 30 },
  { faixa: 'Prata', min: 50 },
  { faixa: 'Ouro', min: 80 },
];

function premiacaoNota(pecas) {
  const proxima = PREMIACAO_LIMITES.find((l) => pecas < l.min);
  if (!proxima) return 'Faixa Ouro atingida — máximo de coins da semana garantido! 🏆';
  const faltam = proxima.min - pecas;
  return `Faltam ${faltam} peça${faltam === 1 ? '' : 's'} no prazo pra faixa ${proxima.faixa}.`;
}

async function carregarSemanaAtual() {
  try {
    const resp = await fetch('/wallac/api/premiacao-semana-atual');
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro);

    const s = dados.semana;
    document.getElementById('semana-atual-pecas').textContent = s.pecas_no_prazo;
    const faixaEl = document.getElementById('semana-atual-faixa');
    faixaEl.textContent = s.faixa;
    faixaEl.className = 'selo-faixa ' + classeFaixa(s.faixa);
    document.getElementById('progresso-fill').style.width = Math.min(100, s.pecas_no_prazo) + '%';
    document.getElementById('semana-atual-nota').textContent = premiacaoNota(s.pecas_no_prazo);
  } catch (err) {
    document.getElementById('semana-atual-nota').textContent = 'Não foi possível carregar o progresso da semana.';
  }
}

carregarHistorico();
carregarSemanaAtual();
// Atualiza sozinho enquanto a tela ficar aberta, pra acompanhar a
// evolução conforme os cards vão sendo finalizados no Kanban.
setInterval(carregarSemanaAtual, 60000);
