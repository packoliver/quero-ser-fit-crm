import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const bucket = 'crm-private-ai-audits'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export class AuditWorkerError extends Error {
  constructor(message, fatal = false, retryAfterMs = 0) { super(message); this.fatal = fatal; this.retryAfterMs = retryAfterMs }
}
export function readConfig(env) {
  const config = { database: env.NEXT_PUBLIC_SUPABASE_URL, token: env.SUPABASE_SERVICE_ROLE_KEY,
    crm: env.CRM_URL, organizationId: env.AUDIT_ORGANIZATION_ID, runId: env.AUDIT_RUN_ID,
    version: env.AUDIT_EXPECTED_VERSION, concurrency: Number(env.AUDIT_CONCURRENCY || 2) }
  for (const field of ['database', 'crm']) {
    let url
    try { url = new URL(config[field]) } catch { throw new AuditWorkerError('URL de configuração inválida.', true) }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new AuditWorkerError('Configure uma origem HTTPS sem credenciais ou caminho.', true)
    config[field] = url.origin
  }
  if (!config.token || !config.version || !uuid.test(config.organizationId || '') || !uuid.test(config.runId || '')
    || !Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 4)
    throw new AuditWorkerError('Configuração incompleta do executor.', true)
  return config
}

function auditTransport(config, options = {}) {
  const fetcher = options.fetch || fetch
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const log = options.log || (record => console.log(JSON.stringify(record)))
  const headers = { Authorization: `Bearer ${config.token}`, apikey: config.token }
  async function request(url, init = {}, timeout = 30_000, optional = false) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let response
      const target = new URL(url)
      if (!init.method && target.pathname.includes('/storage/v1/object/')) target.searchParams.set('cacheNonce', randomUUID())
      try { response = await fetcher(target.href, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeout) }) }
      catch { /* Não registrar erros externos: podem conter URLs ou credenciais. */ }
      if (response?.ok) {
        try { return await response.json() }
        catch { throw new AuditWorkerError('Resposta JSON inválida.') }
      }
      if (response?.status === 429) {
        const raw = response.headers.get('retry-after')
        const seconds = raw ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000) : 300
        throw new AuditWorkerError('Limite temporário da IA; as pendências serão retomadas.', false,
          (Number.isFinite(seconds) ? Math.min(86400, Math.max(1, Math.ceil(seconds))) : 300) * 1000)
      }
      if (optional && response && [400, 404].includes(response.status)) {
        const data = await response.json().catch(() => null)
        if (response.status === 404 || /not found|does not exist/i.test(data?.message || data?.error || '')) return null
      }
      if (response && [400, 401, 403, 404].includes(response.status))
        throw new AuditWorkerError(`Acesso/configuração: HTTP ${response.status}.`, true)
      if (attempt === 5) throw new AuditWorkerError(`Falha após seis tentativas (HTTP ${response?.status || 'rede'}).`)
      log({ event: 'retry', attempt: attempt + 1, http: response?.status || 'network' })
      await sleep(Math.min(60_000, 10_000 * 2 ** attempt))
    }
  }
  const object = objectPath => `${config.database}/storage/v1/object/${bucket}/${objectPath}`
  return { request, headers, object,
    read: (path, optional = false) => request(object(path), { headers }, 30_000, optional),
    write: (path, value) => request(object(path), { method: 'POST', headers: { ...headers,
      'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': 'max-age=0' }, body: JSON.stringify(value) }),
    listRequests: () => request(`${config.database}/storage/v1/object/list/${bucket}`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: `${config.organizationId}/requests`,
        limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'asc' } }) }),
    removeRequest: id => request(`${config.database}/storage/v1/object/${bucket}`, { method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [`${config.organizationId}/requests/${id}.json`] }) }),
  }
}

export async function runVpsAudit(config, options = {}) {
  const stopped = options.shouldStop || (() => false)
  const log = options.log || (record => console.log(JSON.stringify(record)))
  const { request, object, headers, read, write } = auditTransport(config, options)
  const path = `${config.organizationId}/runs/${config.runId}/run.json`
  const info = await request(`${config.database}/storage/v1/bucket/${bucket}`, { headers })
  if (info.public !== false) throw new AuditWorkerError('A auditoria exige armazenamento privado.', true)
  async function verifyLatest() {
    const latest = await request(object(`${config.organizationId}/latest.json`), { headers })
    if (latest.id !== config.runId) throw new AuditWorkerError('Auditoria substituída; executor interrompido.', true)
  }
  await verifyLatest()
  const run = await request(object(path), { headers })
  if (run.id !== config.runId || run.organizationId !== config.organizationId || run.version !== config.version
    || !['text', 'media'].includes(run.mode) || run.status === 'superseded' || !Array.isArray(run.conversations)
    || run.conversations.some(c => !uuid.test(c.id) || !['pending', 'completed', 'failed'].includes(c.state))
    || new Set(run.conversations.map(c => c.id)).size !== run.conversations.length)
    throw new AuditWorkerError('Identidade, versão ou conteúdo da auditoria incompatível.', true)
  const report = () => log({ event: 'progress', runId: run.id, status: run.status, total: run.conversations.length,
    completed: run.conversations.filter(c => c.state === 'completed').length,
    failed: run.conversations.filter(c => c.state === 'failed').length,
    messages: run.conversations.reduce((sum, c) => sum + (c.state === 'completed' ? c.coverage?.messages || 0 : 0), 0) })
  report()
  if (options.checkOnly || run.status === 'completed') return run
  let saving = Promise.resolve()
  const indexes = new Map()
  const positions = new Map(run.conversations.map((item, index) => [item.id, index]))
  const indexPath = part => `${config.organizationId}/runs/${config.runId}/report-index/part-${part}.json`
  async function addReportRecord(record, conversationId) {
    if (record.runId !== config.runId || record.conversationId !== conversationId)
      throw new AuditWorkerError('Identidade do relatório incompatível.', true)
    const part = Math.floor(positions.get(conversationId) / 25)
    if (!indexes.has(part)) indexes.set(part, read(indexPath(part), true).then(existing => {
      if (existing && (existing.organizationId !== config.organizationId || existing.runId !== config.runId || existing.part !== part || !existing.records))
        throw new AuditWorkerError('Índice privado incompatível.', true)
      return existing || { organizationId: config.organizationId, runId: config.runId, part, records: {} }
    }))
    const index = await indexes.get(part)
    index.records[conversationId] = record
    return { path: indexPath(part), value: structuredClone(index) }
  }
  function save(index) {
    run.updatedAt = new Date().toISOString()
    const snapshot = JSON.stringify(run)
    saving = saving.then(async () => {
      await verifyLatest()
      if (index) await write(index.path, index.value)
      await request(object(path), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json',
        'x-upsert': 'true', 'Cache-Control': 'max-age=0' }, body: snapshot })
    })
    return saving
  }
  run.status = 'running'
  const queue = run.conversations.filter(c => c.state !== 'completed')
  let fatalError
  await Promise.all(Array.from({ length: config.concurrency }, async () => {
    while (!stopped() && !fatalError) {
      const conversation = queue.shift()
      if (!conversation) break
      let reportIndex
      try {
        for (;;) {
          if (stopped() || fatalError) break
          await verifyLatest()
          const result = await request(`${config.crm}/api/internal/full-audit`, { method: 'POST',
            headers: { Authorization: headers.Authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId: config.organizationId, runId: config.runId, conversationId: conversation.id }) }, 160_000)
          if (result.done === false) continue
          if (result.done !== true || !Number.isInteger(result.coverage?.messages) || result.coverage.messages < 0
            || !['ganha', 'perdida', 'aberta'].includes(result.outcome)
            || !['sem_indicio', 'pix_solicitado', 'relatado_pelo_cliente', 'comprovante_mencionado', 'confirmado_pela_loja', 'pendente', 'estorno_mencionado'].includes(result.payment))
            throw new AuditWorkerError('Resultado incompleto do executor.')
          if (result.reportRecord) reportIndex = await addReportRecord(result.reportRecord, conversation.id)
          conversation.state = 'completed'
          delete conversation.error
          conversation.coverage = result.coverage
          conversation.insightUpdated = result.insightUpdated
          conversation.outcome = result.outcome
          conversation.payment = result.payment
          break
        }
      } catch (error) {
        if (error instanceof AuditWorkerError && error.retryAfterMs) {
          conversation.state = 'pending'; delete conversation.error
          fatalError = error; break
        }
        if (error instanceof AuditWorkerError && error.fatal) { fatalError = error; break }
        conversation.state = 'failed'
        conversation.error = 'Falha técnica no executor. Os lotes salvos serão retomados.'
        log({ event: 'conversation_failed', conversationId: conversation.id })
      }
      if (!fatalError || fatalError.retryAfterMs) {
        try { await save(reportIndex); report() }
        catch (error) { fatalError = error }
      }
    }
  }))
  if (fatalError) {
    if (fatalError.retryAfterMs) { await save(); log({ event: 'rate_limit', retryAfterMs: fatalError.retryAfterMs, runId: run.id }) }
    throw fatalError
  }
  if (!stopped()) run.status = run.conversations.some(c => c.state === 'failed') ? 'completed_with_errors'
    : run.mode === 'media' && run.conversations.some(c => c.coverage?.mediaUntranscribed > 0) ? 'completed_with_gaps' : 'completed'
  await save()
  report()
  if (run.status === 'completed_with_errors') throw new AuditWorkerError('Há conversas pendentes de nova tentativa.')
  return run
}

export async function watchVpsAudit(config, options = {}) {
  const transport = auditTransport(config, options)
  const stopped = options.shouldStop || (() => false)
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const log = options.log || (entry => console.log(JSON.stringify(entry)))
  const execute = options.executeAudit || runVpsAudit
  const info = await transport.request(`${config.database}/storage/v1/bucket/${bucket}`, { headers: transport.headers })
  if (info.public !== false) throw new AuditWorkerError('A auditoria exige armazenamento privado.', true)
  let pendingId = null, processingId = null, activeRunId = null, state = 'idle', checking = null
  let blockedRunId = null, retryAfter = 0
  let waitingReason = null
  const inspect = () => {
    if (checking) return checking
    checking = (async () => {
      const files = await transport.listRequests()
      pendingId = files.find(file => /^[0-9a-f-]{36}\.json$/i.test(file.name) && file.name !== `${processingId}.json`)?.name.slice(0, -5) || null
      await transport.write(`${config.organizationId}/worker.json`, { controlVersion: 1, updatedAt: new Date().toISOString(), state, runId: activeRunId,
        waitingReason: state === 'waiting_retry' ? waitingReason : null,
        nextRetryAt: state === 'waiting_retry' ? new Date(retryAfter).toISOString() : null })
    })().finally(() => { checking = null })
    return checking
  }
  const timer = setInterval(() => { void inspect().catch(() => log({ event: 'control_unavailable' })) }, options.pollIntervalMs || 15_000)
  try {
    while (!stopped()) {
      await inspect()
      if (pendingId) {
        processingId = pendingId; pendingId = null; state = 'updating'
        try {
          const result = await transport.request(`${config.crm}/api/internal/full-audit/control`, { method: 'POST',
            headers: { Authorization: transport.headers.Authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId: config.organizationId, requestId: processingId }) }, 160_000)
          if (!['completed', 'ignored'].includes(result.state)) throw new AuditWorkerError('Solicitação de controle incompleta.')
          await transport.removeRequest(processingId)
          blockedRunId = null; retryAfter = 0
          log({ event: 'command_applied', requestId: processingId, state: result.state })
        } catch {
          const receiptPath = `${config.organizationId}/receipts/${processingId}.json`
          const savedReceipt = await transport.read(receiptPath, true)
          if (!['completed', 'ignored'].includes(savedReceipt?.state)) await transport.write(receiptPath, { id: processingId, state: 'failed',
            message: 'Não foi possível aplicar a solicitação. As etapas anteriores estão preservadas.' })
          await transport.removeRequest(processingId)
          log({ event: 'command_failed', requestId: processingId })
        } finally { processingId = null }
        await inspect()
      }
      const latest = await transport.read(`${config.organizationId}/latest.json`, true)
      if (latest && !uuid.test(latest.id || '')) throw new AuditWorkerError('Identificador de revisão inválido.', true)
      activeRunId = latest?.id || null
      const run = activeRunId ? await transport.read(`${config.organizationId}/runs/${activeRunId}/run.json`) : null
      const finished = run && ['completed', 'completed_with_gaps'].includes(run.status)
      if (!pendingId && run && !finished && run.status !== 'superseded' && !(blockedRunId === activeRunId && Date.now() < retryAfter)) {
        state = 'running'
        try {
          if (run.version !== config.version && run.version !== 'full-history-forensic-media-v6')
            throw new AuditWorkerError('Versão da revisão não reconhecida pelo executor.', true)
          await execute({ ...config, runId: activeRunId, version: run.version }, { ...options, shouldStop: () => stopped() || !!pendingId })
          state = 'idle'; blockedRunId = null
        } catch (error) {
          state = 'waiting_retry'; blockedRunId = activeRunId
          waitingReason = error instanceof AuditWorkerError && error.retryAfterMs ? 'rate_limit' : 'technical'
          retryAfter = Date.now() + (error instanceof AuditWorkerError && error.retryAfterMs ? error.retryAfterMs
            : error instanceof AuditWorkerError && error.fatal ? 300_000 : 60_000)
          log({ event: 'audit_waiting_retry', runId: activeRunId })
        }
      } else if (finished || !run) state = 'idle'
      if (!pendingId && !stopped()) await sleep(options.pollIntervalMs || 15_000)
    }
  } finally {
    clearInterval(timer)
    await checking?.catch(() => {})
    await transport.write(`${config.organizationId}/worker.json`, { controlVersion: 1, updatedAt: new Date().toISOString(), state: 'stopped', runId: activeRunId }).catch(() => {})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true })
  try {
    const config = readConfig(process.env)
    if (process.argv.includes('--watch')) await watchVpsAudit(config, { shouldStop: () => stopping })
    else await runVpsAudit(config, { shouldStop: () => stopping, checkOnly: process.argv.includes('--check') })
  }
  catch (error) {
    console.error(JSON.stringify({ event: 'worker_stopped', reason: error instanceof AuditWorkerError ? error.message : 'Falha técnica no executor.' }))
    process.exitCode = error instanceof AuditWorkerError && error.fatal ? 78 : 1
  }
}
