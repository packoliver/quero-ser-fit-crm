import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Teste obrigatório de stale-worker fencing via lease_token.
 *
 * Cenário validado (determinístico, sem dependência de reconcile/claim global):
 * 1. Worker A adquire task T → recebe lease_token_A (via claim_agent_tasks)
 * 2. Lease de A expira + reclaim simulado via UPDATE direto (pending, token NULL)
 * 3. Worker B reclama a MESMA task via UPDATE direto (running, token_B)
 * 4. Confirma que lease_token_A !== lease_token_B
 * 5. Worker A tenta settle com lease_token_A → DEVE FALHAR (false)
 * 6. Worker B faz settle com lease_token_B → DEVE SUCEDER (true)
 * 7. Task termina completed com resultado de B
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TEST_ORG_ID = 'd07d0c26-b776-4725-833b-a7cccacc1bab'

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
    // 1. Cria tarefa de teste com prioridade máxima (1) e due_at no passado
    const { data: inserted, error: insertErr } = await admin
      .from('agent_tasks')
      .insert({
        organization_id: TEST_ORG_ID,
        kind: 'conversation_analysis',
        payload: { test: 'fencing' },
        priority: 1,
        status: 'pending',
        due_at: new Date(Date.now() - 10000).toISOString(),
      })
      .select('id')
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).not.toBeNull()
    const taskId = inserted!.id
    createdTaskIds.push(taskId)

    // 2. Worker A faz claim → obtém lease_token_A
    const { data: claimedA, error: claimAErr } = await admin.rpc('claim_agent_tasks', {
      p_limit: 10,
      p_lease_duration_seconds: 300,
    })
    expect(claimAErr).toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskA = (claimedA || []).find((t: any) => t.id === taskId)
    expect(taskA).toBeDefined()
    expect(taskA!.status).toBe('running')
    expect(taskA!.lease_token).not.toBeNull()
    const leaseTokenA = taskA!.lease_token

    // 3. Simula expiração do lease de A E reclaim em um único UPDATE atômico
    // (evita dependência do reconcile global que pode ser afetado por outras tarefas)
    // Isso equivale ao que reconcile_stale_agent_tasks + claim_agent_tasks fariam,
    // mas de forma determinística e isolada para esta tarefa específica.
    const leaseTokenB = 'b0000000-0000-0000-0000-00000000000b'
    const { error: reclaimErr } = await admin
      .from('agent_tasks')
      .update({
        status: 'running',
        attempts: 2,
        lease_expires_at: new Date(Date.now() + 300000).toISOString(),
        lease_token: leaseTokenB,
      })
      .eq('id', taskId)
      .eq('lease_token', leaseTokenA) // só atualiza se ainda tem o token de A

    expect(reclaimErr).toBeNull()

    // Confirma que a tarefa está running com o novo token B
    const { data: afterReclaim } = await admin
      .from('agent_tasks')
      .select('status, lease_token')
      .eq('id', taskId)
      .single()

    expect(afterReclaim!.status).toBe('running')
    expect(afterReclaim!.lease_token).toBe(leaseTokenB)

    // 4. Confirma que os tokens são diferentes
    expect(leaseTokenA).not.toBe(leaseTokenB)

    // 5. Worker A (stale) tenta settle com lease_token_A → DEVE FALHAR
    const { data: settleA } = await admin.rpc('settle_agent_task', {
      p_task_id: taskId,
      p_status: 'completed',
      p_result: { worker: 'A-stale' },
      p_lease_token: leaseTokenA,
    })
    expect(settleA).toBe(false)

    // 6. Confirma que a tarefa continua running com lease_token_B (não foi corrompida por A)
    const { data: stillRunning } = await admin
      .from('agent_tasks')
      .select('status, lease_token')
      .eq('id', taskId)
      .single()

    expect(stillRunning!.status).toBe('running')
    expect(stillRunning!.lease_token).toBe(leaseTokenB)

    // 7. Worker B faz settle com lease_token_B → DEVE SUCEDER
    const { data: settleB } = await admin.rpc('settle_agent_task', {
      p_task_id: taskId,
      p_status: 'completed',
      p_result: { worker: 'B-valid' },
      p_lease_token: leaseTokenB,
    })
    expect(settleB).toBe(true)

    // 8. Confirma estado final: completed com resultado de B
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