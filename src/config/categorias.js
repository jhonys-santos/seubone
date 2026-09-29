// Categorias que agrupam vários painéis/atalhos na sidebar (ex: Logística
// reúne Cotações, Emissão Correios, Emissão Latam e Gerador de Autorização,
// que sem isso ficariam soltos no topo do menu). Um painel/atalho entra
// numa categoria via o campo "categoria" (mesma chave abaixo) — quando
// marcado, some da lista solta de "Painéis"/"Atalhos" e aparece só aqui
// dentro (ver sidebar.ejs).
module.exports = [
  { chave: 'logistica', titulo: 'Logística', icone: 'ti-truck-delivery' },
];
