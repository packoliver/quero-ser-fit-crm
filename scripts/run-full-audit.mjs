import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname, extname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(resolve(root, '.env')) } catch { /* Credenciais podem ser fornecidas pelo ambiente. */ }
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) return nextResolve(pathToFileURL(resolve(root, 'src', `${specifier.slice(2)}.ts`)).href, context)
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
    }
    return nextResolve(specifier, context)
  },
})
const args = process.argv.slice(2)
const organizationId = args[args.indexOf('--organization') + 1]
if (!args.includes('--organization') || !/^[\da-f-]{36}$/i.test(organizationId)) throw new Error('Informe --organization UUID da empresa.')
const remote = args.includes('--remote') ? new URL(args[args.indexOf('--remote') + 1]) : null
if (remote && remote.protocol !== 'https:') throw new Error('O executor remoto requer HTTPS.')
const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const audit = await import('../src/lib/ai/full-audit.ts')
const admin = createAdminClient()
await audit.ensureAuditBucket(admin)
let run = args.includes('--resume') ? await audit.getLatestAuditRun(admin, organizationId) : null
const { AUDIT_VERSION } = await import('../src/lib/ai/audit-model.ts')
if (run && run.version !== AUDIT_VERSION) throw new Error('A auditoria anterior usa outra versão. Inicie a nova revisão sem --resume.')
if (!run) run = await audit.startAuditRun(admin, organizationId)
run.status = 'running'
const queue = run.conversations.filter(conversation => conversation.state !== 'completed')
const pilot = args.includes('--pilot')
const concurrency = args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) : 2
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Informe --concurrency de 1 a 4.')
if (pilot) queue.splice(1)
let saving = Promise.resolve()
const save = () => {
  run.updatedAt = new Date().toISOString()
  const snapshot = structuredClone(run)
  saving = saving.then(() => audit.saveAuditRun(admin, snapshot))
  return saving
}
const report = () => console.log(JSON.stringify(audit.summarizeAuditRun(run)))
report()
await Promise.all(Array.from({ length: pilot ? 1 : concurrency }, async () => {
  for (;;) {
    const conversation = queue.shift()
    if (!conversation) break
    try {
      let result
      if (remote) {
        let failures = 0
        for (;;) {
          let response, data
          try {
          response = await fetch(new URL('/api/internal/full-audit', remote), {
            method: 'POST', signal: AbortSignal.timeout(160_000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ organizationId, runId: run.id, conversationId: conversation.id }),
          })
          data = await response.json()
          } catch {
            if (++failures >= 6) throw new Error('Não foi possível conectar ao executor após seis tentativas; retome os lotes salvos.')
            console.error(JSON.stringify({ conversationId: conversation.id, retry: failures, reason: 'connection' }))
            await new Promise(resolve => setTimeout(resolve, Math.min(60_000, 10_000 * 2 ** (failures - 1))))
            continue
          }
          if (!response.ok) {
            if (++failures >= 6 || [400, 401, 403, 404].includes(response.status)) throw new Error(`Executor remoto retornou HTTP ${response.status}.`)
            console.error(JSON.stringify({ conversationId: conversation.id, retry: failures, httpStatus: response.status }))
            await new Promise(resolve => setTimeout(resolve, Math.min(60_000, 10_000 * 2 ** (failures - 1))))
            continue
          }
          failures = 0
          if (data.done) { result = data; break }
        }
      } else result = await audit.auditFullConversation(admin, run, conversation)
      conversation.state = 'completed'; delete conversation.error
      conversation.coverage = result.coverage; conversation.insightUpdated = result.insightUpdated
      conversation.outcome = result.outcome || result.analysis?.outcome
      conversation.payment = result.payment || result.analysis?.payment?.status || 'sem_indicio'
    } catch (error) {
      conversation.state = 'failed'
      conversation.error = String(error.message || error).slice(0, 300)
      // Somente identificadores e erro técnico; mensagens e credenciais não entram nos logs.
      console.error(JSON.stringify({ conversationId: conversation.id, error: conversation.error }))
    }
    await save()
    report()
  }
}))
if (!pilot) run.status = run.conversations.some(conversation => conversation.state === 'failed') ? 'completed_with_errors'
  : run.mode !== 'text' && run.conversations.some(conversation => conversation.coverage?.mediaUntranscribed) ? 'completed_with_gaps' : 'completed'
await save()
report()
