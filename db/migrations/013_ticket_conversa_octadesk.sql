-- Conversa aberta com o cliente pelo Octadesk a partir do ticket (botão "Abrir conversa com o cliente").
-- Guarda a última abertura; cada abertura também vira um evento no histórico do ticket.
alter table ticket_entrega add column if not exists conversa_aberta_em  timestamptz;
alter table ticket_entrega add column if not exists conversa_aberta_por text;
alter table ticket_entrega add column if not exists conversa_room_key   text;
