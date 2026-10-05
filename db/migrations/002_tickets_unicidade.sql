-- Aplique DEPOIS de importar os dados (scripts/importar-tickets.js avisa se
-- houver duplicados que impeçam este índice).
--
-- Trava de verdade contra ticket duplicado: o mesmo negócio (negocio_id) não
-- pode ter dois tickets do mesmo identificador (ex.: dois "Erro de Envio").
-- Identificadores diferentes (Pedido atrasado x Erro de Envio) convivem.
create unique index if not exists tickets_negocio_identificador_uk
  on tickets (negocio_id, lower(identificador))
  where negocio_id <> '';
