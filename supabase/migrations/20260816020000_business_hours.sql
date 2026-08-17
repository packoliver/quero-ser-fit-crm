-- Migration: horário de atendimento + resposta automática fora do expediente.
--
-- Uma linha por organização (organization_id é a própria PK — não faz sentido ter mais
-- de um horário configurado por org). `schedule` guarda os 7 dias da semana com
-- open/close em "HH:mm" (hora local, ver `timezone`) e um `closed` pra dias sem
-- atendimento. Ativado por padrão como `false` — a org existente continua respondendo
-- 24/7 até o admin ligar isso deliberadamente em Configurações.

CREATE TABLE IF NOT EXISTS public.business_hours_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    schedule JSONB NOT NULL DEFAULT '{
        "mon": {"closed": false, "open": "09:00", "close": "18:00"},
        "tue": {"closed": false, "open": "09:00", "close": "18:00"},
        "wed": {"closed": false, "open": "09:00", "close": "18:00"},
        "thu": {"closed": false, "open": "09:00", "close": "18:00"},
        "fri": {"closed": false, "open": "09:00", "close": "18:00"},
        "sat": {"closed": false, "open": "09:00", "close": "13:00"},
        "sun": {"closed": true, "open": "09:00", "close": "13:00"}
    }'::jsonb,
    auto_reply_message TEXT NOT NULL DEFAULT 'Olá! No momento estamos fora do nosso horário de atendimento. Assim que reabrirmos, respondemos sua mensagem. 💪',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.business_hours_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for business_hours_settings" ON public.business_hours_settings
    FOR ALL USING (organization_id IN (SELECT public.get_user_org_ids()));

DROP TRIGGER IF EXISTS trg_business_hours_updated_at ON public.business_hours_settings;
CREATE OR REPLACE FUNCTION public.set_business_hours_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_business_hours_updated_at
    BEFORE UPDATE ON public.business_hours_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_business_hours_updated_at();

-- Cooldown pra não mandar a resposta automática de novo a cada mensagem nova do mesmo
-- cliente fora do horário — só reenvia depois de passado AUTO_REPLY_COOLDOWN_HOURS
-- (ver src/lib/integrations/auto-reply.ts) desde o último auto-reply nessa conversa.
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS last_auto_reply_at TIMESTAMPTZ;
