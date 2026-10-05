-- Migration: Fix settle_agent_task PL/pgSQL error and enforce strict lease_token fencing
-- Date: 2026-10-05
-- Problem: The previous settle_agent_task used `UPDATE ... INTO v_updated` which is
-- invalid PL/pgSQL syntax (UPDATE does not support INTO; only SELECT does).
-- Additionally, the legacy fallback allowing settle without lease_token was unsafe.
-- Fix: Use GET DIAGNOSTICS ROW_COUNT after UPDATE, require non-null lease_token,
-- and enforce strict fencing: lease_token must match AND lease must not be expired.

DROP FUNCTION IF EXISTS public.settle_agent_task(UUID, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.settle_agent_task(UUID, TEXT, JSONB, TEXT, UUID);

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
  -- Validate status
  IF p_status NOT IN ('completed', 'failed', 'pending') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be completed, failed, or pending (for retry).', p_status;
  END IF;

  -- Strict fencing: lease_token is REQUIRED. Reject if null.
  IF p_lease_token IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Settle only if task is running, lease_token matches, and lease has not expired.
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
    AND lease_token = p_lease_token
    AND lease_expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- If status is 'failed' and attempts < max_attempts, reset to pending for retry
  IF p_status = 'failed' AND v_updated > 0 THEN
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

  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION public.settle_agent_task(UUID, TEXT, JSONB, TEXT, UUID) IS
  'Settles a task only if lease_token matches and lease is still valid. Uses GET DIAGNOSTICS instead of invalid UPDATE...INTO. Requires non-null lease_token for strict stale-worker fencing.';

GRANT EXECUTE ON FUNCTION public.settle_agent_task(UUID, TEXT, JSONB, TEXT, UUID) TO authenticated;