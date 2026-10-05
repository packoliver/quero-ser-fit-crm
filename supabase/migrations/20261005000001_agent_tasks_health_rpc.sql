-- Migration: Health check RPC for agent_tasks queue
-- Date: 2026-10-05
-- Returns counts by status and age of oldest pending task for monitoring/alerting.

CREATE OR REPLACE FUNCTION public.get_agent_tasks_health()
RETURNS TABLE (
  queued BIGINT,
  running BIGINT,
  failed BIGINT,
  completed_last_24h BIGINT,
  oldest_pending_age_seconds DOUBLE PRECISION
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
SELECT
  (SELECT count(*) FROM public.agent_tasks WHERE status = 'pending') AS queued,
  (SELECT count(*) FROM public.agent_tasks WHERE status = 'running') AS running,
  (SELECT count(*) FROM public.agent_tasks WHERE status = 'failed') AS failed,
  (SELECT count(*) FROM public.agent_tasks WHERE status = 'completed' AND completed_at > now() - interval '24 hours') AS completed_last_24h,
  (SELECT EXTRACT(EPOCH FROM (now() - MIN(due_at))) FROM public.agent_tasks WHERE status = 'pending') AS oldest_pending_age_seconds;
$$;

GRANT EXECUTE ON FUNCTION public.get_agent_tasks_health() TO authenticated;
COMMENT ON FUNCTION public.get_agent_tasks_health IS 'Returns queue health metrics for monitoring dashboards and /api/internal/dispatch GET endpoint.';