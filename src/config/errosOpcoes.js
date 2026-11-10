// Listas do formulário de erro usadas fora da tela do Painel de Erros (hoje: bloco "Erro deste pedido" do formulário de Reembolso).
// Espelham as de public/js/erros.js (SETOR_OPCOES, RESOLUCAO_TABLE, RESPONSAVEL_SUGESTOES): se mudar lá, mude aqui.
module.exports = {
  setores: ['Vendas', 'Fábrica', 'Dupla (Vendedor e Designer)', 'Escritório', 'Cliente', 'Estoque'],
  resolucoes: ['Sem custo', 'Envio rápido', 'Ajuste do produto', 'Brinde até 12 und.', 'Desconto <=20%', 'Desconto >20%', 'Refabricação', 'Reembolso parcial', 'Reembolso total', 'Outros'],
  responsaveis: [
    'Expectativa do Cliente', 'Estoque Caicó', 'Fabrica Cacinho', 'Fabrica CIA Bruto', 'Fabrica Eneas',
    'Fabrica Neidinha', 'Fabrica 88 Brindes', 'Fabrica SLC', 'Fabrica LaserTools', 'Fabrica (Outros)',
    'Amanda Alves', 'Ana Beatriz', 'Anderson Carlos', 'Anderson Gabriel', 'Arthur Felix', 'Caio Targino',
    'Camilla Marinho', 'Cleyton Andrade', 'Emanuel Pereira', 'Emily Dantas', 'Gabriel Vinicius',
    'Giovani Augusto', 'Guilherme Matias', 'Hadyja Saraiva', 'Igor Neves', 'Jailton Queiroz',
    'Jonathan Silva', 'Lucas Matheus', 'Lucas Santos', 'Luiz Cavalcante', 'Marcelo Moreira',
    'Pedro Maranhao', 'Paulo Sergio', 'Sabrina Silva', 'Stephanie Rayssa', 'Taynara Soares',
    'Victor Brito', 'Victor Clemerson', 'Victor Medeiros', 'Victor Varela', 'Vinicius Barros',
    'Walter Galdino', 'Yuri Pinheiro', 'Jonathan Felipe',
  ],
  // Motivos para "não será necessário registrar o erro" (além do texto livre em "Outro").
  motivosDispensa: ['Valor pago a mais pelo cliente', 'Retenção paga pelo cliente (devolução)', 'Cancelamento pelo cliente'],
};
