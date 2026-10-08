/**
 * INDICADORES DA EQUIPE — TRECHO NOVO para o espelho do hub (SÓ LEITURA).
 * Cole no Apps Script do projeto da planilha "KPI PV - 2026", no arquivo que tem a função buscarDados (o do Indicadores da Equipe).
 * NÃO mexe no script do Octadesk nem nos gatilhos nem em nenhuma fórmula: só ADICIONA uma ação de leitura.
 *
 * O que faz: devolve as séries diárias do ano INTEIRO, calculadas pela MESMA função buscarDados que já existe (então o hub
 * não repete regra nenhuma), junto com a data de cada posição. O hub guarda essa cópia no banco e responde os painéis dela.
 *
 * COMO COLAR:
 *  1) Em doGet(e), logo DEPOIS do bloco "if (p.action === 'dados') { ... }", adicione:
 *       if (p.action === 'dadosCompleto') {
 *         const time = TIMES[p.time];
 *         if (!time) return out({ ok: false, erro: 'Time desconhecido: ' + p.time });
 *         return out({ ok: true, ...buscarDadosCompleto(time) });
 *       }
 *  2) Cole a função abaixo no fim do arquivo.
 *  3) Implantar > Gerenciar implantações > Editar > Nova versão > Implantar (mesma implantação, a URL não muda).
 */
function buscarDadosCompleto(time) {
  const dados = buscarDados(time, '1900-01-01', '2999-12-31'); // todas as linhas com data, na ordem da planilha
  const aba = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ABA_DADOS);
  const datas = aba.getDataRange().getDisplayValues().slice(2)
    .map((r) => parseDate(r[0]))
    .filter((d) => d)
    .map((d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2));
  return { datas: datas, porConsultor: dados.porConsultor, porEquipe: dados.porEquipe };
}
