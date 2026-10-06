-- Run in the CRM Supabase SQL editor as postgres. All objects are temporary,
-- and the transaction rolls back. Expectations are captured before switching
-- to authenticated so the test cannot accidentally validate bypass-RLS access.
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE inbox_expected ON COMMIT DROP AS
SELECT om.user_id,
       array_agg(DISTINCT om.organization_id) AS organization_ids,
       array_agg(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL) AS conversation_ids
FROM public.organization_members om
LEFT JOIN public.conversations c
  ON c.organization_id = om.organization_id
 AND (
   om.role = 'admin'
   OR CASE
        WHEN jsonb_typeof(om.permissions -> 'view_all_conversations') = 'boolean'
          THEN (om.permissions ->> 'view_all_conversations')::boolean
        ELSE true
      END
   OR c.current_assignee_id = om.user_id
   OR c.current_assignee_id IS NULL
 )
GROUP BY om.user_id;

CREATE TEMP TABLE inbox_results (
  user_id uuid,
  conversations bigint,
  elapsed_ms numeric
) ON COMMIT DROP;
GRANT SELECT ON inbox_expected TO authenticated;
GRANT SELECT, INSERT ON inbox_results TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_user_org_ids()', 'EXECUTE')
     OR has_function_privilege('anon', 'crm_private.get_user_org_ids()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_unread_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous access to inbox helpers';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  test_case record;
  actual_ids uuid[];
  started_at timestamptz;
BEGIN
  FOR test_case IN SELECT * FROM inbox_expected LOOP
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', test_case.user_id, 'role', 'authenticated'
    )::text, true);
    PERFORM set_config('request.jwt.claim.sub', test_case.user_id::text, true);
    started_at := clock_timestamp();

    SELECT array_agg(id ORDER BY id) INTO actual_ids
    FROM public.get_conversation_list_secure();
    IF COALESCE(actual_ids, '{}'::uuid[]) IS DISTINCT FROM ARRAY(
      SELECT id FROM unnest(test_case.conversation_ids) id ORDER BY id
    ) THEN
      RAISE EXCEPTION 'Conversation visibility mismatch for %', test_case.user_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE NOT (organization_id = ANY(test_case.organization_ids))
    ) THEN
      RAISE EXCEPTION 'Membership tenant leak for %', test_case.user_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.get_unread_counts() u
      WHERE NOT (u.conversation_id = ANY(COALESCE(actual_ids, '{}'::uuid[])))
    ) THEN
      RAISE EXCEPTION 'Unread count visibility leak for %', test_case.user_id;
    END IF;

    INSERT INTO inbox_results VALUES (
      test_case.user_id, cardinality(COALESCE(actual_ids, '{}'::uuid[])),
      round(extract(epoch FROM clock_timestamp() - started_at)::numeric * 1000, 2)
    );
  END LOOP;

  -- A JWT for a user without membership must not reveal any tenant data.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  IF EXISTS (SELECT 1 FROM public.get_conversation_list_secure())
     OR EXISTS (SELECT 1 FROM public.get_unread_counts()) THEN
    RAISE EXCEPTION 'Inbox data exposed to a nonmember';
  END IF;

  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF EXISTS (SELECT 1 FROM public.get_user_org_ids())
     OR EXISTS (SELECT 1 FROM public.get_conversation_list_secure())
     OR EXISTS (SELECT 1 FROM public.get_unread_counts()) THEN
    RAISE EXCEPTION 'Inbox data exposed without a JWT subject';
  END IF;
END;
$$;

SELECT count(*) AS users_verified, sum(conversations) AS conversation_checks,
       max(elapsed_ms) AS slowest_combined_queries_ms
FROM inbox_results;
ROLLBACK;
