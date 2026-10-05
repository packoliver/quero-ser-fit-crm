-- Migration: Fix stale worker race condition in settle_agent_task
-- Date: 2026-10-05
-- Problem: A worker whose lease expired could still call settle_agent_task and
-- overwrite the result of a new worker that already claimed the same task.
-- Fix: Only allow settling if the task is still 'running' AND the lease has not expired.
-- This ensures a stale worker cannot corrupt a task that was reclaimed by another worker.

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

  -- Only settle if task is running AND lease is still valid (not expired).
  -- This prevents a stale worker from overwriting a reclaimed task.
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
    AND lease_expires_at > now()
  INTO v_updated;

  -- If status is 'failed' and attempts < max_attempts, reset to pending for retry
  IF p_status = 'failed' AND COALESCE(v_updated, 0) > 0 THEN
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

COMMENT ON FUNCTION public.settle_agent_task IS 'Settles a task only if it is still running with a valid lease. Prevents stale workers from corrupting reclaimed tasks.';