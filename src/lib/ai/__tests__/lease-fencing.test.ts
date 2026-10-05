import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Teste obrigatório de stale-worker fencing via lease_token.
 *
 * Cenário validado:
 * 1. Worker A adquire task T → recebe lease_token_A
 * 2. Lease de A expira (simulado via UPDATE direto)
 * 3. Reconcile recupera a tarefa
 * 4. Worker B adquire a MESMA task → recebe lease_token_B
 * 5. Confirma que lease_token_A !== lease_token_B
 * 6. Worker A tenta settle com lease_token_A → DEVE FALHAR (0 rows updated)
 * 7. Worker B faz settle com lease_token_B → DEVE SUCEDER
 *
 * Isso prova que um worker obsoleto não pode corromper uma tarefa readquirida.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TEST_ORG_ID = 'b7f5e3c2-1a4d-4f8e-9c6b-2d3e4f5a6b7c'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: SupabaseClient<any>

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY)('lease_token fencing', () => {
  const createdTaskIds: string[] = []

  beforeAll(() => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  })

  afterAll(async () => {
    if (createdTaskIds.length > 0) {
      await admin.from('agent_tasks').delete().in('id', createdTaskIds)
    }
  })

  it('stale worker é rejeitado após reclaim por outro worker', async () => {
    // 1. Cria tarefa de teste
    const { data: inserted, error: insertErr } = await admin
      .from('agent_tasks')
      .insert({
        organization_id: TEST_ORG_ID,
        kind: 'conversation_analysis',
        payload: { test: 'fencing' },
        priority: 100,
        status: 'pending',
        due_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).not.toBeNull()
    const taskId = inserted!.id
    createdTaskIds.push(taskId)

    // 2. Worker A faz claim → obtém lease_token_A
    const { data: claimedA, error: claimAErr } = await admin.rpc('claim_agent_tasks', {
      p_limit: 1,
      p_lease_duration_seconds: 300,
    })
    expect(claimAErr).toBeNull()

    // Filtra a tarefa específica do resultado do claim (pode haver outras pendentes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskA = (claimedA || []).find((t: any) => t.id === taskId)
    expect(taskA).toBeDefined()
    expect(taskA!.status).toBe('running')
    expect(taskA!.lease_token).not.toBeNull()
    const leaseTokenA = taskA!.lease_token

    // 3. Simula expiração do lease de A (UPDATE direto para teste controlado)
    const { error: expireErr } = await admin
      .from('agent_tasks')
      .update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', taskId)
    expect(expireErr).toBeNull()

    // 4. Reconcile recupera a tarefa (limpa lease_token e volta para pending)
    const { data: reconciled, error: reconcileErr } = await admin.rpc('reconcile_stale_agent_tasks')
    expect(reconcileErr).toBeNull()
    expect(reconciled).toBeGreaterThanOrEqual(1)

    // Confirma que a tarefa voltou para pending com lease_token NULL
    const { data: afterReconcile } = await admin
      .from('agent_tasks')
      .select('status, lease_token')
      .eq('id', taskId)
      .single()
    expect(afterReconcile!.status).toBe('pending')
    expect(afterReconcile!.lease_token).toBeNull()

    // 5. Worker B faz claim da MESMA tarefa → obtém lease_token_B
    const { data: claimedB, error: claimBErr } = await admin.rpc('claim_agent_tasks', {
      p_limit: 1,
      p_lease_duration_seconds: 300,
    })
    expect(claimBErr).toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskB = (claimedB || []).find((t: any) => t.id === taskId)
    expect(taskB).toBeDefined()
    expect(taskB!.status).toBe('running')
    expect(taskB!.lease_token).not.toBeNull()
    const leaseTokenB = taskB!.lease_token

    // 6. Confirma que os tokens são diferentes
    expect(leaseTokenA).not.toBe(leaseTokenB)

    // 7. Worker A (stale) tenta settle com lease_token_A → DEVE FALHAR
    const { data: settleA } = await admin.rpc('settle_agent_task', {
      p_task_id: taskId,
      p_status: 'completed',
      p_result: { worker: 'A-stale' },
      p_lease_token: leaseTokenA,
    })
    expect(settleA).toBe(false) // 0 rows updated = stale worker rejeitado

    // 8. Confirma que a tarefa continua running com lease_token_B
    const { data: stillRunning } = await admin
      .from('agent_tasks')
      .select('status, lease_token')
      .eq('id', taskId)
      .single()
    expect(stillRunning!.status).toBe('running')
    expect(stillRunning!.lease_token).toBe(leaseTokenB)

    // 9. Worker B faz settle com lease_token_B → DEVE SUCEDER
    const { data: settleB } = await admin.rpc('settle_agent_task', {
      p_task_id: taskId,
      p_status: 'completed',
      p_result: { worker: 'B-valid' },
      p_lease_token: leaseTokenB,
    })
    expect(settleB).toBe(true)

    // 10. Confirma estado final: completed com resultado de B
    const { data: finalState } = await admin
      .from('agent_tasks')
      .select('status, result, completed_at')
      .eq('id', taskId)
      .single()
    expect(finalState!.status).toBe('completed')
    expect(finalState!.result).toEqual({ worker: 'B-valid' })
    expect(finalState!.completed_at).not.toBeNull()
  })

  it('dois workers concorrentes não adquirem a mesma tarefa', async () => {
    // Cria 3 tarefas
    const { data: inserted } = await admin
      .from('agent_tasks')
      .insert([
        { organization_id: TEST_ORG_ID, kind: 'qa_question', payload: { q: 'conc1' }, priority: 50, status: 'pending', due_at: new Date().toISOString() },
        { organization_id: TEST_ORG_ID, kind: 'qa_question', payload: { q: 'conc2' }, priority: 50, status: 'pending', due_at: new Date().toISOString() },
        { organization_id: TEST_ORG_ID, kind: 'qa_question', payload: { q: 'conc3' }, priority: 50, status: 'pending', due_at: new Date().toISOString() },
      ])
      .select('id')

    const ids = (inserted || []).map((r: { id: string }) => r.id)
    createdTaskIds.push(...ids)

    // Dois claims simultâneos (sequenciais mas sem settle entre eles)
    const { data: claim1 } = await admin.rpc('claim_agent_tasks', { p_limit: 2, p_lease_duration_seconds: 60 })
    const { data: claim2 } = await admin.rpc('claim_agent_tasks', { p_limit: 2, p_lease_duration_seconds: 60 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids1 = new Set((claim1 || []).map((t: any) => t.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids2 = new Set((claim2 || []).map((t: any) => t.id))

    // Nenhuma tarefa deve aparecer em ambos os claims
    for (const id of ids1) {
      expect(ids2.has(id)).toBe(false)
    }
  })
})