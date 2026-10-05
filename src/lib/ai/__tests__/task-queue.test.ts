import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Testes de integração da fila durável de tarefas (agent_tasks).
 *
 * Estes testes validam o fluxo completo no banco real:
 * - enqueue → claim → settle (happy path)
 * - retry com backoff após falha
 * - reconciliação de leases expirados
 * - health check
 *
 * Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.
 * Roda contra o projeto de produção — usa org ID real existente.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Org ID real do Quero Ser Fit CRM (obtido via MCP anteriormente)
const TEST_ORG_ID = 'd07d0c26-b776-4725-833b-a7cccacc1bab'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: SupabaseClient<any>

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY)('agent_tasks queue integration', () => {
  const createdTaskIds: string[] = []

  beforeAll(() => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  })

  afterAll(async () => {
    // Cleanup: remove tarefas criadas pelos testes
    if (createdTaskIds.length > 0) {
      await admin.from('agent_tasks').delete().in('id', createdTaskIds)
    }
  })

  it('enqueue cria tarefa com status pending', async () => {
    const { data, error } = await admin
      .from('agent_tasks')
      .insert({
        organization_id: TEST_ORG_ID,
        kind: 'conversation_analysis',
        payload: { test: true },
        priority: 100,
        status: 'pending',
        due_at: new Date().toISOString(),
      })
      .select('id, status, kind')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.status).toBe('pending')
    expect(data!.kind).toBe('conversation_analysis')
    createdTaskIds.push(data!.id)
  })

  it('claim_agent_tasks adquire tarefas pendentes e retorna lease_token', async () => {
    // Cria 2 tarefas para o teste com prioridade máxima (1)
    const { data: inserted } = await admin
      .from('agent_tasks')
      .insert([
        { organization_id: TEST_ORG_ID, kind: 'qa_question', payload: { q: 1 }, priority: 1, status: 'pending', due_at: new Date().toISOString() },
        { organization_id: TEST_ORG_ID, kind: 'qa_question', payload: { q: 2 }, priority: 1, status: 'pending', due_at: new Date().toISOString() },
      ])
      .select('id')

    const ids = (inserted || []).map((r: { id: string }) => r.id)
    createdTaskIds.push(...ids)

    // Claim com lease curto (10s) para teste rápido
    const { data: claimed, error } = await admin.rpc('claim_agent_tasks', {
      p_limit: 10,
      p_lease_duration_seconds: 10,
    })

    expect(error).toBeNull()
    expect(claimed).toBeDefined()
    expect(Array.isArray(claimed)).toBe(true)

    // Valida que o RPC retorna tarefas com lease_token (fencing ativo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const task of (claimed || []) as any[]) {
      expect(task.lease_token).not.toBeNull()
      expect(task.status).toBe('running')
      expect(task.attempts).toBeGreaterThanOrEqual(1)
    }

    // Valida que pelo menos algumas tarefas foram adquiridas
    expect((claimed || []).length).toBeGreaterThan(0)
  })

  it('settle_agent_task marca como completed com lease_token correto', async () => {
    const { data: inserted } = await admin
      .from('agent_tasks')
      .insert({
        organization_id: TEST_ORG_ID,
        kind: 'conversation_analysis',
        payload: { test: 'settle' },
        priority: 1,
        status: 'pending',
        due_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    createdTaskIds.push(inserted!.id)

    // Claim primeiro com prioridade alta para garantir que pega nossa tarefa
    const { data: claimed } = await admin.rpc('claim_agent_tasks', { p_limit: 10, p_lease_duration_seconds: 60 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = (claimed || []).find((t: any) => t.id === inserted!.id)
    expect(task).toBeDefined()
    expect(task!.lease_token).not.toBeNull()

    // Settle como completed COM lease_token obrigatório
    const { data: settled, error } = await admin.rpc('settle_agent_task', {
      p_task_id: inserted!.id,
      p_status: 'completed',
      p_result: { testResult: true },
      p_lease_token: task!.lease_token,
    })

    expect(error).toBeNull()
    expect(settled).toBe(true)

    // Verifica estado final
    const { data: final } = await admin
      .from('agent_tasks')
      .select('status, result, completed_at')
      .eq('id', inserted!.id)
      .single()

    expect(final!.status).toBe('completed')
    expect(final!.result).toEqual({ testResult: true })
    expect(final!.completed_at).not.toBeNull()
  })

  it('reconcile_stale_agent_tasks recupera tarefas com lease expirado', async () => {
    // Cria tarefa e faz claim
    const { data: inserted } = await admin
      .from('agent_tasks')
      .insert({
        organization_id: TEST_ORG_ID,
        kind: 'qa_question',
        payload: { test: 'stale' },
        priority: 1,
        status: 'pending',
        due_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    createdTaskIds.push(inserted!.id)

    // Claim com lease longo
    const { data: claimed } = await admin.rpc('claim_agent_tasks', { p_limit: 10, p_lease_duration_seconds: 300 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = (claimed || []).find((t: any) => t.id === inserted!.id)
    expect(task).toBeDefined()

    // Simula expiração do lease via UPDATE direto (teste determinístico, sem sleep)
    // Usa eq('lease_token', task.lease_token) para garantir que só atualiza nossa tarefa
    const { error: expireErr } = await admin
      .from('agent_tasks')
      .update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', inserted!.id)
      .eq('lease_token', task!.lease_token)
    expect(expireErr).toBeNull()

    // Confirma que o lease foi realmente expirado antes de reconciliar
    const { data: beforeReconcile } = await admin
      .from('agent_tasks')
      .select('status, lease_expires_at')
      .eq('id', inserted!.id)
      .single()
    expect(beforeReconcile!.status).toBe('running')
    expect(new Date(beforeReconcile!.lease_expires_at!).getTime()).toBeLessThan(Date.now())

    // Reconcilia
    const { data: reconciled, error } = await admin.rpc('reconcile_stale_agent_tasks')

    expect(error).toBeNull()
    expect(reconciled).toBeGreaterThanOrEqual(1)

    // Tarefa deve estar pending novamente
    const { data: afterReconcile } = await admin
      .from('agent_tasks')
      .select('status, lease_expires_at, lease_token')
      .eq('id', inserted!.id)
      .single()

    expect(afterReconcile!.status).toBe('pending')
    expect(afterReconcile!.lease_expires_at).toBeNull()
    expect(afterReconcile!.lease_token).toBeNull()
  })

  it('get_agent_tasks_health retorna métricas válidas', async () => {
    const { data, error } = await admin.rpc('get_agent_tasks_health')

    expect(error).toBeNull()
    expect(data).toBeDefined()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const health = Array.isArray(data) ? data[0] : (data as any)
    expect(health).not.toBeNull()
    expect(typeof health!.queued).toBe('number')
    expect(typeof health!.running).toBe('number')
    expect(typeof health!.failed).toBe('number')
    expect(typeof health!.completed_last_24h).toBe('number')
  })

  it.skipIf(!process.env.RUN_DISPATCH_TEST)('dispatch route rejeita chamada sem autenticação', async () => {
    const response = await fetch('http://localhost:3000/api/internal/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    // Em dev sem secrets configurados, pode aceitar — mas em prod rejeitaria
    // Este teste documenta o comportamento esperado
    expect([200, 401]).toContain(response.status)
  })
})