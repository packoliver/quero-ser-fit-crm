import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditWorkerError, readConfig, runVpsAudit, watchVpsAudit } from '../run-audit-vps.mjs'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const bucket = 'crm-private-ai-audits'
const runId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`
const config = readConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'private-test-token',
  CRM_URL: 'https://crm.test', AUDIT_ORGANIZATION_ID: org, AUDIT_RUN_ID: runId,
  AUDIT_EXPECTED_VERSION: 'test-text-version', AUDIT_CONCURRENCY: '2' })
function fixture(count = 3) {
  let stored = { id: runId, organizationId: org, mode: 'text', version: config.version, status: 'running',
    conversations: Array.from({ length: count }, (_, n) => ({ id: id(n), state: n === 0 ? 'completed' : 'pending',
      ...(n === 0 ? { coverage: { messages: 9 } } : {}) })) }
  const calls = [], saves = [], logs = [], apiCounts = new Map(), indexes = new Map()
  let publicBucket = false, latestId = runId
  const result = { done: true, coverage: { messages: 15, mediaUntranscribed: 3 }, outcome: 'aberta', payment: 'pendente', insightUpdated: true }
  let api = async () => new Response(JSON.stringify(result), { status: 200 })
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    const target = new URL(url)
    if (!init.method && target.pathname.includes('/storage/v1/object/')) assert.ok(target.searchParams.get('cacheNonce'))
    assert.equal(init.headers.Authorization, `Bearer ${config.token}`)
    if (url.includes('/api/internal/')) {
      const { conversationId } = JSON.parse(init.body)
      apiCounts.set(conversationId, (apiCounts.get(conversationId) || 0) + 1)
      return api(conversationId, apiCounts.get(conversationId))
    }
    if (url.includes('/bucket/')) return Response.json({ public: publicBucket })
    if (target.pathname.endsWith('/latest.json')) return Response.json({ id: latestId })
    if (target.pathname.includes('/report-index/')) {
      const key = target.pathname.split('/report-index/')[1]
      if (init.method === 'POST') { indexes.set(key, JSON.parse(init.body)); return Response.json({ Key: key }) }
      return indexes.has(key) ? Response.json(indexes.get(key)) : Response.json({ message: 'not found' }, { status: 404 })
    }
    assert.ok(target.pathname.endsWith(`/runs/${runId}/run.json`))
    if (init.method === 'POST') {
      stored = JSON.parse(init.body)
      saves.push(structuredClone(stored))
      return Response.json({ Key: 'private/run.json' })
    }
    return Response.json(stored)
  }
  return { calls, saves, logs, apiCounts, indexes, result, fetcher,
    stored: () => stored, changeRun: update => Object.assign(stored, update),
    setPublic: () => { publicBucket = true }, supersede: () => { latestId = id(99) },
    setApi: callback => { api = callback }, options: { fetch: fetcher, sleep: async () => {}, log: entry => logs.push(entry) } }
}
test('retoma pendências, preserva concluídas e serializa progresso concorrente', async () => {
  const f = fixture()
  f.setApi(async (_, attempt) => attempt === 1 ? new Response('{"done":false}', { status: 202 }) : Response.json(f.result))
  await runVpsAudit(config, f.options)
  assert.equal(f.apiCounts.has(id(0)), false)
  assert.equal(f.stored().conversations[0].coverage.messages, 9)
  assert.equal(f.stored().status, 'completed')
  assert.ok(f.stored().conversations.every(c => c.state === 'completed'))
  const counts = f.saves.map(s => s.conversations.filter(c => c.state === 'completed').length)
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b))
  assert.equal(f.logs.at(-1).messages, 39)
  assert.equal(JSON.stringify(f.logs).includes(config.token), false)
})
test('executor aceita revisão multimodal forense com versão explicitamente correspondente', async () => {
  const f = fixture()
  f.changeRun({ version: 'full-history-forensic-media-v6', mode: 'media' })
  await runVpsAudit({ ...config, version: 'full-history-forensic-media-v6' }, f.options)
  assert.equal(f.stored().status, 'completed_with_gaps')
  assert.ok(f.stored().conversations.every(item => item.state === 'completed'))
})
test('índice mantém os dois resultados concorrentes e registros anteriores ao retomar', async () => {
  const f = fixture()
  f.indexes.set('part-0.json', { organizationId: org, runId, part: 0, records: { [id(0)]: { conversationId: id(0), runId } } })
  f.setApi(async conversationId => Response.json({ ...f.result, reportRecord: { conversationId, runId, analysis: {} } }))
  await runVpsAudit(config, f.options)
  assert.equal(Object.keys(f.indexes.get('part-0.json').records).length, 3)
  const writes = f.calls.filter(call => call.init.method === 'POST' && !call.url.includes('/api/'))
  for (let n = 0; n < writes.length; n++) if (writes[n].url.includes('/report-index/'))
    assert.ok(writes[n + 1].url.includes('/run.json'))
})
test('índice de outro tenant não permite publicar a conclusão', async () => {
  const f = fixture(2)
  f.indexes.set('part-0.json', { organizationId: id(99), runId, part: 0, records: {} })
  f.setApi(async conversationId => Response.json({ ...f.result, reportRecord: { conversationId, runId } }))
  await assert.rejects(runVpsAudit(config, f.options), error => error.fatal)
  assert.equal(f.saves.length, 0)
})
test('verificação de configuração é somente leitura e não chama a IA', async () => {
  const f = fixture()
  await runVpsAudit(config, { ...f.options, checkOnly: true })
  assert.equal(f.apiCounts.size, 0)
  assert.equal(f.saves.length, 0)
})
test('armazenamento público e identidade errada impedem execução e escrita', async () => {
  for (const change of [f => f.setPublic(), f => f.changeRun({ organizationId: id(99) }), f => f.supersede()]) {
    const f = fixture(); change(f)
    await assert.rejects(runVpsAudit(config, f.options), error => error.fatal)
    assert.equal(f.apiCounts.size, 0); assert.equal(f.saves.length, 0)
  }
})
test('HTTP 401 interrompe o serviço sem transformar todas as pendências em falhas', async () => {
  const f = fixture()
  f.setApi(async () => new Response('private error', { status: 401 }))
  await assert.rejects(runVpsAudit(config, f.options), error => error.fatal)
  assert.equal(f.stored().conversations.filter(c => c.state === 'failed').length, 0)
  assert.equal(f.saves.length, 0)
})
test('falha temporária retenta e erro com segredo não é registrado', async () => {
  const f = fixture(2)
  f.setApi(async (_, attempt) => { if (attempt === 1) throw new Error(config.token); return Response.json(f.result) })
  await runVpsAudit(config, f.options)
  assert.equal(f.apiCounts.get(id(1)), 2)
  assert.equal(f.stored().status, 'completed')
  assert.equal(JSON.stringify(f.logs).includes(config.token), false)
})
test('limite 429 preserva a conversa pendente e respeita Retry-After sem esgotar outras conversas', async () => {
  const f = fixture(2)
  f.setApi(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '600' } }))
  await assert.rejects(runVpsAudit(config, f.options), error => error.retryAfterMs === 600000)
  assert.equal(f.apiCounts.get(id(1)), 1)
  assert.equal(f.stored().conversations[1].state, 'pending')
  assert.equal(f.stored().status, 'running')
  assert.equal(f.stored().conversations[0].coverage.messages, 9)
  assert.equal(f.logs.at(-1).event, 'rate_limit')
})
test('limite em uma tarefa não perde a conclusão e o índice da outra tarefa em andamento', async () => {
  const f = fixture(3)
  f.setApi(async conversationId => {
    if (conversationId === id(1)) return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
    await new Promise(resolve => setTimeout(resolve, 5))
    return Response.json({ ...f.result, reportRecord: { runId, conversationId } })
  })
  await assert.rejects(runVpsAudit(config, f.options), error => error.retryAfterMs === 60000)
  assert.equal(f.stored().conversations[1].state, 'pending')
  assert.equal(f.stored().conversations[2].state, 'completed')
  assert.ok(f.indexes.get('part-0.json').records[id(2)])
})
test('parada mantém pendência retomável depois de um lote intermediário', async () => {
  const f = fixture(2); let stopping = false
  f.setApi(async () => { stopping = true; return new Response('{"done":false}', { status: 202 }) })
  await runVpsAudit(config, { ...f.options, shouldStop: () => stopping })
  assert.equal(f.stored().status, 'running')
  assert.equal(f.stored().conversations[1].state, 'pending')
  assert.equal(f.apiCounts.get(id(1)), 1)
})
test('substituição durante execução não sobrescreve uma auditoria mais recente', async () => {
  const f = fixture(2)
  f.setApi(async () => { f.supersede(); return Response.json(f.result) })
  await assert.rejects(runVpsAudit(config, f.options), error => error.fatal)
  assert.equal(f.saves.length, 0)
})
test('auditoria concluída sai sem executar nem escrever novamente', async () => {
  const f = fixture(1); f.changeRun({ status: 'completed' })
  await runVpsAudit(config, f.options)
  assert.equal(f.apiCounts.size, 0); assert.equal(f.saves.length, 0)
})
test('resultado malformado salva falha retomável, sem aceitar uma conclusão inventada', async () => {
  const f = fixture(2)
  f.setApi(async () => Response.json({ done: true }))
  await assert.rejects(runVpsAudit(config, f.options), /nova tentativa/)
  assert.equal(f.stored().status, 'completed_with_errors')
  assert.equal(f.stored().conversations[1].state, 'failed')
})
test('configuração rejeita HTTP e URLs contendo credenciais', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'test',
    CRM_URL: 'http://crm.test', AUDIT_ORGANIZATION_ID: org, AUDIT_RUN_ID: runId, AUDIT_EXPECTED_VERSION: 'test' }
  assert.throws(() => readConfig(env), error => error.fatal)
  assert.throws(() => readConfig({ ...env, CRM_URL: 'https://secret:password@crm.test' }), error => error.fatal)
})

function watchFixture() {
  const oldRun = { id: runId, organizationId: org, mode: 'text', version: config.version, status: 'running',
    conversations: [{ id: id(1), state: 'pending' }] }
  const objects = new Map([[`${org}/latest.json`, { id: runId }], [`${org}/runs/${runId}/run.json`, oldRun]])
  const queue = new Map(), commands = [], workers = [], logs = []
  let stopping = false
  const enqueue = (action = 'update') => {
    const command = { id: id(50), action, organizationId: org, expectedRunId: runId }
    queue.set(`${command.id}.json`, command)
    return command
  }
  const fetcher = async (url, init) => {
    const target = new URL(url), json = init.body ? JSON.parse(init.body) : null
    assert.equal(init.headers.Authorization, `Bearer ${config.token}`)
    if (target.pathname.includes('/bucket/')) return Response.json({ public: false })
    if (target.pathname.endsWith('/full-audit/control')) {
      const command = queue.get(`${json.requestId}.json`)
      assert.ok(command); commands.push(command)
      const nextId = command.action === 'update' ? command.id : runId
      if (command.action === 'update') {
        objects.set(`${org}/latest.json`, { id: nextId })
        objects.set(`${org}/runs/${nextId}/run.json`, { ...oldRun, id: nextId })
      }
      const receipt = { id: command.id, state: 'completed', action: command.action, runId: nextId }
      objects.set(`${org}/receipts/${command.id}.json`, receipt)
      return Response.json(receipt)
    }
    if (target.pathname.includes('/object/list/')) return Response.json([...queue.keys()].map(name => ({ name })))
    if (init.method === 'DELETE') {
      for (const prefix of json.prefixes) queue.delete(prefix.split('/').at(-1))
      return Response.json([])
    }
    const path = target.pathname.split(`/object/${bucket}/`)[1]
    assert.ok(path)
    if (init.method === 'POST') {
      objects.set(path, json)
      if (path.endsWith('/worker.json')) workers.push(json)
      return Response.json({ Key: path })
    }
    return objects.has(path) ? Response.json(objects.get(path)) : Response.json({ message: 'Object not found' }, { status: 404 })
  }
  return { objects, queue, enqueue, commands, workers, logs, stop: () => { stopping = true },
    options: { fetch: fetcher, shouldStop: () => stopping, pollIntervalMs: 5, log: entry => logs.push(entry) } }
}
test('monitor aceita atualização, escolhe a nova revisão e remove apenas o comando aplicado', async () => {
  const f = watchFixture(); f.enqueue()
  const executions = []
  await watchVpsAudit(config, { ...f.options, executeAudit: async selected => { executions.push(selected.runId); f.stop() } })
  assert.deepEqual(executions, [id(50)])
  assert.equal(f.commands.length, 1); assert.equal(f.queue.size, 0)
  assert.equal(f.workers.at(-1).controlVersion, 1)
  assert.equal(JSON.stringify(f.logs).includes(config.token), false)
})
test('comando durante leitura interrompe entre etapas e troca revisão sem dois executores', async () => {
  const f = watchFixture(); const executions = []; let active = 0, peak = 0
  await watchVpsAudit(config, { ...f.options, executeAudit: async (selected, options) => {
    active++; peak = Math.max(peak, active); executions.push(selected.runId)
    if (executions.length === 1) {
      f.enqueue()
      for (let n = 0; !options.shouldStop() && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(options.shouldStop(), true)
    } else f.stop()
    active--
  } })
  assert.deepEqual(executions, [runId, id(50)])
  assert.equal(peak, 1)
})
test('monitor continua disponível depois de concluir e aceita uma retomada sem reanalisar concluídas', async () => {
  const f = watchFixture()
  f.objects.get(`${org}/runs/${runId}/run.json`).status = 'completed'
  let pauses = 0, executions = 0
  await watchVpsAudit(config, { ...f.options, executeAudit: async () => { executions++ }, sleep: async () => {
    if (++pauses === 1) f.enqueue('resume'); else f.stop()
  } })
  assert.equal(f.commands.length, 1)
  assert.equal(f.commands[0].action, 'resume')
  assert.equal(executions, 0)
  assert.ok(f.workers.some(worker => worker.state === 'idle'))
})
test('monitor mantém espera automática durante o intervalo do provedor sem repetir chamadas', async () => {
  const f = watchFixture(); let executions = 0, pauses = 0
  await watchVpsAudit(config, { ...f.options, executeAudit: async () => {
    executions++; throw new AuditWorkerError('Limite de IA', false, 600000)
  }, sleep: async () => { if (++pauses === 4) f.stop() } })
  assert.equal(executions, 1)
  const waiting = f.workers.find(worker => worker.waitingReason === 'rate_limit')
  assert.ok(waiting); assert.ok(Date.parse(waiting.nextRetryAt) > Date.now() + 590000)
})
