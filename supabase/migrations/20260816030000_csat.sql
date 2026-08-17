-- Migration: avaliação de atendimento (CSAT) — pedir nota 1-5 ao cliente quando a
-- conversa é encerrada, e capturar a resposta automaticamente.
--
-- Liga/desliga e as mensagens ficam em `organizations` (config de organização inteira,
-- não por conversa) — mesmo lugar de qualquer outro ajuste "geral" da conta. O estado
-- por conversa (se já foi pedido, qual foi a nota) fica em `conversations`.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS csat_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS csat_request_message TEXT NOT NULL DEFAULT 'De 1 a 5, como foi seu atendimento hoje? Responda só com o número. 🙏',
    ADD COLUMN IF NOT EXISTS csat_thank_you_message TEXT NOT NULL DEFAULT 'Muito obrigado pela sua avaliação! 💚';

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS csat_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS csat_score SMALLINT CHECK (csat_score BETWEEN 1 AND 5);
