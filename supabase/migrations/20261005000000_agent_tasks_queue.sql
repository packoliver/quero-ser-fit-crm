-- Migration: Durable Agent Task Queue
-- Date: 2026-10-05
-- Inspired by trycompai/crm's task dispatch pattern.
-- Replaces fire-and-forget AI analysis calls with a durable queue that survives
-- deploys, retries on failure, and prevents duplicate processing via row-level leasing.

-- Step 1: Create agent_tasks table
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('conversation_analysis', 'backfill_insights', 'qa_question')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  payload JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_expires_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.agent_tasks IS 'Fila durável de tarefas de IA. Substitui chamadas fire-and-forget com leasing, retentativas e reconciliação.';
COMMENT ON COLUMN public.agent_tasks.kind IS 'Tipo de tarefa: conversation_analysis (análise pós-mensagem), backfill_insights (reprocessamento histórico), qa_question (pergunta livre).';
COMMENT ON COLUMN public.agent_tasks.priority IS 'Prioridade: menor = mais urgente. 50=urgente, 100=normal, 200=backfill.';
COMMENT ON COLUMN public.agent_tasks.lease_expires_at IS 'Timestamp até quando o worker tem exclusividade. NULL = não está sendo processado.';
COMMENT ON COLUMN public.agent_tasks.due_at IS 'Quando a tarefa pode ser processada. Permite agendamento futuro (ex: recheck em 7 dias).';

-- Step 2: Indexes for efficient claim queries
-- Nota: predicado com now() não é permitido em índices parciais (não imutável).
-- O filtro de due_at <= now() é aplicado apenas na query de claim, não no índice.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_claimable
ON public.agent_tasks (priority ASC, due_at ASC)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_tasks_org_status
ON public.agent_tasks (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_lease
ON public.agent_tasks (lease_expires_at)
WHERE status = 'running';

-- Step 3: RLS — members can only see tasks from their own organization
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_agent_tasks"
ON public.agent_tasks FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  )
);

CREATE POLICY "org_members_insert_agent_tasks"
ON public.agent_tasks FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  )
);

CREATE POLICY "org_members_update_agent_tasks"
ON public.agent_tasks FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
  )
);

-- Step 4: RPC to claim tasks atomically (FOR UPDATE SKIP LOCKED)
-- This is the core of the durable queue: two workers calling this simultaneously
-- get disjoint sets of tasks. A crashed worker's tasks become reclaimable after
-- lease_expires_at passes.
CREATE OR REPLACE FUNCTION public.claim_agent_tasks(
  p_limit INTEGER DEFAULT 5,
  p_lease_duration_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.agent_tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.agent_tasks t
  SET
    status = 'running',
    attempts = t.attempts + 1,
    lease_expires_at = now() + (p_lease_duration_seconds || ' seconds')::interval,
    updated_at = now()
  WHERE t.id IN (
    SELECT t2.id
    FROM public.agent_tasks t2
    WHERE t2.status = 'pending'
      AND t2.due_at <= now()
    ORDER BY t2.priority ASC, t2.due_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING t.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_agent_tasks(integer, integer) TO authenticated;

-- Step 5: RPC to settle a task (complete or fail)
CREATE OR REPLACE FUNCTION public.settle_agent_task(
  p_task_id UUID,
  p_status TEXT,
  p_result JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'pending') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be completed, failed, or pending (for retry).', p_status;
  END IF;

  UPDATE public.agent_tasks
  SET
    status = p_status,
    result = CASE WHEN p_status = 'completed' THEN p_result ELSE result END,
    error_message = CASE WHEN p_status = 'failed' THEN p_error_message ELSE NULL END,
    lease_expires_at = NULL,
    completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id
    AND status = 'running'
  INTO v_updated;

  -- If status is 'failed' and attempts < max_attempts, reset to pending for retry
  IF p_status = 'failed' THEN
    UPDATE public.agent_tasks
    SET
      status = 'pending',
      due_at = now() + (LEAST(attempts * 60, 3600) || ' seconds')::interval,
      lease_expires_at = NULL,
      updated_at = now()
    WHERE id = p_task_id
      AND attempts < max_attempts;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_agent_task(uuid, text, jsonb, text) TO authenticated;

-- Step 6: RPC to reconcile stale leases (crashed workers)
-- Tasks stuck in 'running' past their lease are reset to 'pending'.
CREATE OR REPLACE FUNCTION public.reconcile_stale_agent_tasks()
RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  WITH stale AS (
    UPDATE public.agent_tasks
    SET
      status = 'pending',
      lease_expires_at = NULL,
      updated_at = now()
    WHERE status = 'running'
      AND lease_expires_at < now()
    RETURNING id
  )
  SELECT count(*)::integer FROM stale;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_stale_agent_tasks() TO authenticated;

-- Step 7: Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.update_agent_tasks_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_tasks_updated_at ON public.agent_tasks;
CREATE TRIGGER trg_agent_tasks_updated_at
BEFORE UPDATE ON public.agent_tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_agent_tasks_updated_at();