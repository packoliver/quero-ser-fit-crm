-- Migration: Add lease_token for stale-worker fencing in agent_tasks
-- Date: 2026-10-05
-- Problem: settle_agent_task only checked lease_expires_at > now(), which is insufficient.
-- If Worker A's lease expires and Worker B reclaims the same task, Worker A could still
-- call settle successfully because the new lease from B makes lease_expires_at > now() true.
-- Fix: Add lease_token UUID column. Each claim generates a unique token. Settle requires
-- matching token, so stale workers are rejected even if the lease is currently valid.

-- 1. Add lease_token column (nullable for existing rows; new claims will always set it)
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS lease_token UUID;

-- 2. Drop old overloads to avoid ambiguity, then recreate with lease_token support
DROP FUNCTION IF EXISTS public.claim_agent_tasks(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.settle_agent_task(UUID, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.settle_agent_task(UUID, TEXT, JSONB, TEXT, UUID);
DROP FUNCTION IF EXISTS public.reconcile_stale_agent_tasks();

-- 3. Recreate claim_agent_tasks with lease_token generation
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
    lease_token = gen_random_uuid(),
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

COMMENT ON FUNCTION public.claim_agent_tasks(INTEGER, INTEGER) IS
  'Claims pending tasks atomically with FOR UPDATE SKIP LOCKED. Generates unique lease_token per claim for stale-worker fencing.';

-- 4. Recreate settle_agent_task with lease_token fencing parameter
CREATE OR REPLACE FUNCTION public.settle_agent_task(
  p_task_id UUID,
  p_status TEXT,
  p_result JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_lease_token UUID DEFAULT NULL
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

  -- Fencing: only settle if task is running, lease is valid, AND lease_token matches.
  -- If p_lease_token is NULL (legacy callers), fall back to lease_expires_at check only.
  -- New callers MUST provide lease_token for correct fencing.
  UPDATE public.agent_tasks
  SET
    status = p_status,
    result = CASE WHEN p_status = 'completed' THEN p_result ELSE result END,
    error_message = CASE WHEN p_status = 'failed' THEN p_error_message ELSE NULL END,
    lease_expires_at = NULL,
    lease_token = NULL,
    completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id
    AND status = 'running'
    AND (
      -- Strict fencing when lease_token is provided
      (p_lease_token IS NOT NULL AND lease_token = p_lease_token)
      OR
      -- Legacy fallback: only check expiry (less safe but backward compatible)
      (p_lease_token IS NULL AND lease_expires_at > now())
    )
  INTO v_updated;

  -- If status is 'failed' and attempts < max_attempts, reset to pending for retry
  IF p_status = 'failed' AND COALESCE(v_updated, 0) > 0 THEN
    UPDATE public.agent_tasks
    SET
      status = 'pending',
      due_at = now() + (LEAST(attempts * 60, 3600) || ' seconds')::interval,
      lease_expires_at = NULL,
      lease_token = NULL,
      updated_at = now()
    WHERE id = p_task_id
      AND attempts < max_attempts;
  END IF;

  RETURN COALESCE(v_updated, 0) > 0;
END;
$$;

COMMENT ON FUNCTION public.settle_agent_task(UUID, TEXT, JSONB, TEXT, UUID) IS
  'Settles a task only if lease_token matches (fencing) or falls back to lease_expires_at for legacy callers. Prevents stale workers from corrupting reclaimed tasks.';

-- 5. Recreate reconcile_stale_agent_tasks to clear lease_token on reclaim
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
    lease_token = NULL,
    updated_at = now()
  WHERE status = 'running'
    AND lease_expires_at < now()
  RETURNING id
)
SELECT count(*)::integer FROM stale;
$$;

COMMENT ON FUNCTION public.reconcile_stale_agent_tasks() IS
  'Reclaims tasks whose lease has expired. Clears lease_token so stale workers cannot settle after reclaim.';