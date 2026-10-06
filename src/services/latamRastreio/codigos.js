// Portado de latam-cargo-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio LATAM Cargo (eSales).
// Tabela de eventos do Tracking LATAM (manual "Consulta Tracking" v4, 08/2022, seção 2.3 — conferida na imagem do PDF).
//
// A LATAM manda o código na tag <eventDescription> (sim, o nome engana).
// O código 12 é genérico: o motivo real vem em <receiverName>. Por isso a chave da tabela
// para o 12 é "12:<MOTIVO SEM ACENTO>", ex.: "12:DEVOLVIDO AO REMETENTE".
//
// Alerta = SIM/NAO segue ocorrencias-latam.csv, revisado pela SeuBoné em 29/09/2026
// (43, 44, 12 Em Processo de Liberação Fiscal e 12 Liberado Lote Parcial passaram para NAO).
// Ao editar o CSV, atualize aqui também (ou carregue o CSV e passe em tabelaCodigos).
const CODIGOS_LATAM = {
    '1': { descricao: 'Carga Alocada em Voo', categoria: 'EM TRANSITO', alerta: false },
    '2': { descricao: 'Carga Recepcionada', categoria: 'RECEBIDA', alerta: false },
    '3': { descricao: 'Embarque Confirmado', categoria: 'EM TRANSITO', alerta: false },
    '4': { descricao: 'Em Rota de Entrega / Retira', categoria: 'EM ROTA DE ENTREGA', alerta: false },
    '6': { descricao: 'Carga Desembarcada', categoria: 'EM TRANSITO', alerta: false },
    '7': { descricao: 'Aguardando Desembarque', categoria: 'EM TRANSITO', alerta: false },
    '9': { descricao: 'Carga Entregue', categoria: 'ENTREGUE', alerta: false },
    // Riscado (descontinuado) na v4. Mantido caso ainda apareça em envios antigos.
    '10': { descricao: 'Documento Cancelado', categoria: 'CANCELADO', alerta: true },
    '11': { descricao: 'Recepção Documental', categoria: 'RECEBIDA', alerta: false },
    // Código 12 — motivo em <receiverName>
    '12:CARGA RECUSADA PELO DESTINATARIA': { descricao: 'Carga recusada pelo destinatário', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:CARGA RECUSADA PELO DESTINATARIO': { descricao: 'Carga recusada pelo destinatário', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:CLIENTE AUSENTE': { descricao: 'Cliente Ausente', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:CLIENTE DESCONHECIDO': { descricao: 'Cliente desconhecido', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:CLIENTE MUDOU DE ENDERECO': { descricao: 'Cliente Mudou de Endereço', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:DEVOLVIDO AO REMETENTE': { descricao: 'Devolvido ao Remetente', categoria: 'DEVOLVIDO', alerta: true },
    '12:EM PROCESSO DE LIBERACAO FISCAL': { descricao: 'Em Processo de Liberação Fiscal', categoria: 'FISCAL', alerta: false },
    '12:ENDERECO NAO LOCALIZADO': { descricao: 'Endereço não localizado', categoria: 'PROBLEMA ENTREGA', alerta: true },
    // Entrega Parcial e Liberado (Lote Parcial) estão riscados na v4; mantidos caso ainda apareçam.
    '12:ENTREGA PARCIAL': { descricao: 'Entrega Parcial', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:LIBERADO PELA FISCALIZACAO (LOTE PARCIAL)': { descricao: 'Liberado pela Fiscalização (Lote Parcial)', categoria: 'FISCAL', alerta: false },
    '12:LIBERADO PELA FISCALIZACAO (LOTE COMPLETO)': { descricao: 'Liberado pela Fiscalização (Lote Completo)', categoria: 'FISCAL', alerta: false },
    '12:LOCAL FECHADO': { descricao: 'Local Fechado', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '12:RETIDO PELA FISCALIZACAO PARCIAL': { descricao: 'Retido pela Fiscalização Parcial', categoria: 'FISCAL', alerta: true },
    '12:RETIDO PELA FISCALIZACAO TOTAL': { descricao: 'Retido pela Fiscalização Total', categoria: 'FISCAL', alerta: true },
    '20': { descricao: 'Problemas com recebimento de frete', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '21': { descricao: 'Ocorrência na entrega - entrar em contato com a LATAM', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '22': { descricao: 'Reprogramado para o próximo dia útil', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '23': { descricao: 'Cliente solicitou a retirada da carga', categoria: 'AGUARDANDO RETIRADA', alerta: false },
    '24': { descricao: 'Entrega cancelada', categoria: 'PROBLEMA ENTREGA', alerta: true },
    '25': { descricao: 'Carga em separação', categoria: 'EM ROTA DE ENTREGA', alerta: false },
    '26': { descricao: 'Carga conferida', categoria: 'EM ROTA DE ENTREGA', alerta: false },
    // Coleta (pick up)
    '30': { descricao: 'Coleta solicitada', categoria: 'COLETA', alerta: false },
    '31': { descricao: 'Coletado', categoria: 'COLETA', alerta: false },
    '32': { descricao: 'Saiu para coleta', categoria: 'COLETA', alerta: false },
    '33': { descricao: 'Coleta cancelada', categoria: 'PROBLEMA COLETA', alerta: true },
    '34': { descricao: 'Ausente (coleta)', categoria: 'PROBLEMA COLETA', alerta: true },
    '35': { descricao: 'Coleta fora da dimensão/padrão', categoria: 'PROBLEMA COLETA', alerta: true },
    '36': { descricao: 'Coleta não efetuada', categoria: 'PROBLEMA COLETA', alerta: true },
    '37': { descricao: 'Coleta recusada', categoria: 'PROBLEMA COLETA', alerta: true },
    '38': { descricao: 'Coleta vazia', categoria: 'PROBLEMA COLETA', alerta: true },
    '39': { descricao: 'Endereço não localizado/incorreto (coleta)', categoria: 'PROBLEMA COLETA', alerta: true },
    '40': { descricao: 'Local fechado (coleta)', categoria: 'PROBLEMA COLETA', alerta: true },
    '41': { descricao: 'Ocorrência na coleta', categoria: 'PROBLEMA COLETA', alerta: true },
    '42': { descricao: 'Ocorrência na coleta - entrar em contato com a LATAM', categoria: 'PROBLEMA COLETA', alerta: true },
    '43': { descricao: 'Problemas com recebimento de frete (coleta)', categoria: 'PROBLEMA COLETA', alerta: false },
    '44': { descricao: 'Tempo de espera excedido (coleta)', categoria: 'PROBLEMA COLETA', alerta: false },
};

module.exports = { CODIGOS_LATAM };
