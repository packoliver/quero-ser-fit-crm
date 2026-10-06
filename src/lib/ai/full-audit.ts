import { createHash, randomUUID } from 'node:crypto'
import type { AdminClient } from '@/lib/supabase/admin'
import { requestAuditJson } from './client'
import { interpretAuditMedia } from './audit-media'
import { AUDIT_INSTRUCTION, AUDIT_VERSION, LOSS_CATEGORIES, buildAuditBatches, calculateAuditCoverage,
  validateAuditAnalysis, validateTextSalesAnalysis, type AuditAnalysis, type AuditMessage } from './audit-model'
import { FORENSIC_VERSION, FORENSIC_INSTRUCTION, validateForensicAnalysis, forensicAuditTriggers, forensicCoreOutcome,
  type ForensicAnalysis, type ForensicQuality } from './audit-forensic'

export const AUDIT_BUCKET = 'crm-private-ai-audits'
type Channel = 'whatsapp' | 'instagram'
export interface AuditConversationState {
  id: string; channel: Channel; state: 'pending' | 'completed' | 'failed'; error?: string
  coverage?: ReturnType<typeof calculateAuditCoverage>; insightUpdated?: boolean
  outcome?: AuditAnalysis['outcome']; payment?: NonNullable<AuditAnalysis['payment']>['status']
  resultRunId?: string
}
export interface AuditRun {
  version: string; id: string; organizationId: string; cutoff: string; startedAt: string; updatedAt: string
  mode?: 'text' | 'media'
  status: 'running' | 'completed' | 'completed_with_errors' | 'completed_with_gaps' | 'superseded'; conversations: AuditConversationState[]
}
interface ChunkRecord { hash: string; analysis: AuditAnalysis; messageIds: string[] }
export interface ConversationAudit {
  runId: string; conversationId: string; channel: Channel; cutoff: string; completedAt: string
  coverage: ReturnType<typeof calculateAuditCoverage>; analysis: AuditAnalysis; chunks: ChunkRecord[]
  sourceHash: string; previousInsight: unknown; insightUpdated: boolean
  recordedOutcome?: AuditAnalysis['outcome'] | null
  recordedStage?: string | null
  contactName?: string | null
  assigneeId?: string | null
  forensic?: ForensicAnalysis
  quality?: ForensicQuality
  media: { messageId: string; createdAt: string; interpretation: NonNullable<AuditMessage['mediaInterpretation']> }[]
}

function runPath(run: AuditRun) { return `${run.organizationId}/runs/${run.id}` }
export async function readAuditObject<T>(admin: AdminClient, path: string): Promise<T | null> {
  // Etapas e progresso mudam durante a execução; uma leitura antiga pode perder a retomada.
  let response = await admin.storage.from(AUDIT_BUCKET).download(path, { cacheNonce: randomUUID() }, { cache: 'no-store' })
  for (let attempt = 0; response.error && attempt < 2; attempt++) {
    const status = 'statusCode' in response.error ? Number(response.error.statusCode) : 0
    if (status !== 429 && status < 500) break
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
    response = await admin.storage.from(AUDIT_BUCKET).download(path, { cacheNonce: randomUUID() }, { cache: 'no-store' })
  }
  const { data, error } = response
  if (error) {
    if ('statusCode' in error && ['404', '400'].includes(String(error.statusCode)) && /not found|does not exist/i.test(error.message)) return null
    throw new Error(`Não foi possível ler o registro privado: ${error.message}`)
  }
  return JSON.parse(await data.text()) as T
}
export async function writeAuditObject(admin: AdminClient, path: string, value: unknown) {
  const { error } = await admin.storage.from(AUDIT_BUCKET).upload(path, Buffer.from(JSON.stringify(value)), {
    contentType: 'application/json', upsert: true, cacheControl: '0',
  })
  if (error) throw new Error(`Não foi possível salvar o registro privado: ${error.message}`)
}
export async function ensureAuditBucket(admin: AdminClient) {
  const { data: buckets, error } = await admin.storage.listBuckets()
  if (error) throw new Error('Não foi possível verificar o armazenamento privado.')
  const existing = buckets.find(bucket => bucket.id === AUDIT_BUCKET)
  if (existing?.public) throw new Error('O armazenamento da auditoria precisa ser privado.')
  if (!existing) {
    const created = await admin.storage.createBucket(AUDIT_BUCKET, {
      public: false, allowedMimeTypes: ['application/json'], fileSizeLimit: 10 * 1024 * 1024,
    })
    if (created.error) throw new Error(`Falha ao criar armazenamento privado: ${created.error.message}`)
  }
}
export async function getLatestAuditRun(admin: AdminClient, organizationId: string): Promise<AuditRun | null> {
  const pointer = await readAuditObject<{ id: string }>(admin, `${organizationId}/latest.json`)
  if (!pointer) return null
  return readAuditObject<AuditRun>(admin, `${organizationId}/runs/${pointer.id}/run.json`)
}
export async function saveAuditRun(admin: AdminClient, run: AuditRun) {
  run.updatedAt = new Date().toISOString()
  await writeAuditObject(admin, `${runPath(run)}/run.json`, run)
}
export async function startAuditRun(admin: AdminClient, organizationId: string, mode: 'text' | 'media' = 'text',
  options: { id?: string; previous?: AuditRun; version?: string } = {}): Promise<AuditRun> {
  await ensureAuditBucket(admin)
  const cutoff = new Date().toISOString()
  const previous = options.previous
  const version = options.version || AUDIT_VERSION
  if (previous && (previous.organizationId !== organizationId || previous.version !== version || previous.mode !== mode))
    throw new Error('A revisão anterior não é compatível com esta atualização.')
  const changed = new Set<string>()
  if (previous) {
    let messageCursor: string | null = null
    for (;;) {
      // updated_at também inclui edições e mensagens importadas com data antiga.
      let query = admin.from('messages').select('id, conversation_id').eq('organization_id', organizationId)
        .or(`created_at.gt.${previous.cutoff},updated_at.gt.${previous.cutoff}`).order('id').limit(500)
      if (messageCursor) query = query.gt('id', messageCursor)
      const { data, error } = await query
      if (error) throw new Error('Não foi possível identificar as conversas alteradas.')
      const rows = data as { id: string; conversation_id: string }[]
      rows.forEach(row => changed.add(row.conversation_id))
      if (rows.length < 500) break
      messageCursor = rows.at(-1)!.id
    }
  }
  const completed = new Map(previous?.conversations.filter(c => c.state === 'completed').map(c => [c.id, c]))
  const conversations: AuditConversationState[] = []
  let cursor: string | null = null
  for (;;) {
    let query = admin.from('conversations').select('id, channel_type, last_message_at, updated_at').eq('organization_id', organizationId)
      .lte('created_at', cutoff).in('channel_type', ['whatsapp', 'instagram']).order('id').limit(500)
    if (cursor) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw new Error(`Falha ao inventariar conversas: ${error.message}`)
    const rows = data as { id: string; channel_type: Channel; last_message_at: string | null; updated_at: string | null }[]
    for (const row of rows) {
      const old = completed.get(row.id)
      const unchanged = previous && old && !changed.has(row.id) && row.channel_type === old.channel
        && row.last_message_at && row.updated_at && Date.parse(row.last_message_at) <= Date.parse(previous.cutoff)
        && Date.parse(row.updated_at) <= Date.parse(previous.cutoff)
      conversations.push(unchanged ? { ...old, resultRunId: old.resultRunId || previous.id }
        : { id: row.id, channel: row.channel_type, state: 'pending' })
    }
    if (rows.length < 500) break
    cursor = rows.at(-1)!.id
  }
  const run: AuditRun = { version, mode, id: options.id || randomUUID(), organizationId, cutoff,
    startedAt: cutoff, updatedAt: cutoff, status: 'running', conversations }
  await saveAuditRun(admin, run)
  await writeAuditObject(admin, `${organizationId}/latest.json`, { id: run.id })
  return run
}
/** Cursor por UUID não perde mensagens com horários iguais e supera o teto REST de 1000. */
export async function loadAuditMessages(admin: AdminClient, organizationId: string, conversationId: string, cutoff: string) {
  const messages: AuditMessage[] = []
  let cursor: string | null = null
  for (;;) {
    let query = admin.from('messages').select('id, sender_type, sender_id, content, media_url, media_type, created_at, updated_at, status')
      .eq('organization_id', organizationId).eq('conversation_id', conversationId)
      .lte('created_at', cutoff).order('id').limit(500)
    if (cursor) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw new Error(`Falha ao ler mensagens: ${error.message}`)
    const rows = data as AuditMessage[]
    messages.push(...rows)
    if (rows.length < 500) break
    cursor = rows.at(-1)!.id
  }
  return messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id))
}
function sourceHash(messages: AuditMessage[], version = AUDIT_VERSION) { return createHash('sha256').update(version).update(JSON.stringify(messages)).digest('hex') }
async function validatedCompletion(organizationId: string, input: unknown, sources: AuditMessage[], attempts = 3, requirePayment = false, forensic = false) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const instruction = forensic ? AUDIT_INSTRUCTION.replace('Fora do modo text, preserve esse desfecho.', 'Não preserve o desfecho manual sem evidência.').replace('ou knownOutcome;', ';') : AUDIT_INSTRUCTION
      const analysis = validateAuditAnalysis(await requestAuditJson(organizationId, instruction, input), sources)
      if (requirePayment && !analysis.payment) throw new Error('Auditoria de vendas sem estado do pagamento.')
      return requirePayment ? validateTextSalesAnalysis(analysis, sources) : analysis
    } catch (error) { lastError = error }
  }
  throw lastError
}
export class AuditPendingError extends Error {
  constructor() { super('Lote salvo; a auditoria continua na próxima etapa.') }
}
export async function auditFullConversation(admin: AdminClient, run: AuditRun, conversation: AuditConversationState, maxCompletions = Infinity): Promise<ConversationAudit> {
  const forensicMode = run.version === FORENSIC_VERSION
  let completions = 0
  const reserveCompletion = () => {
    if (completions >= maxCompletions) throw new AuditPendingError()
    completions++
  }
  const complete = async (input: unknown, sources: AuditMessage[]) => {
    reserveCompletion()
    return validatedCompletion(run.organizationId, input, sources, Number.isFinite(maxCompletions) ? 1 : 3, run.mode === 'text', forensicMode)
  }
  const { data: owned, error: ownedError } = await admin.from('conversations').select('id, last_message_at, current_assignee_id, contacts(name, is_group)')
    .eq('organization_id', run.organizationId).eq('id', conversation.id).maybeSingle()
  if (ownedError || !owned) throw new Error('Conversa não encontrada na organização da auditoria.')
  const isGroup = !!(owned as unknown as { contacts: { is_group: boolean } | null }).contacts?.is_group
  const messages = await loadAuditMessages(admin, run.organizationId, conversation.id, run.cutoff)
  // A versão pertence à revisão; publicar novos critérios não reinicia uma revisão antiga em andamento.
  const hashVersion = forensicMode ? run.version : AUDIT_VERSION
  const originalHash = sourceHash(messages, hashVersion)
  const basePath = `${runPath(run)}/conversations/${conversation.id}`
  const existing = await readAuditObject<ConversationAudit>(admin, `${basePath}/result.json`)
  if (existing?.sourceHash === originalHash) return existing
  if (run.mode === 'text') {
    for (const message of messages) {
      if (message.media_url || message.media_type) message.mediaInterpretation = {
        kind: 'unsupported', state: 'unavailable', text: '',
        limitations: ['Anexo não interpretado nesta revisão de texto; conferir o original se necessário para confirmar o pagamento.'],
      }
    }
  } else {
  const mediaCheckpointPath = `${basePath}/${originalHash}/media.json`
  const mediaCheckpoint = await readAuditObject<Record<string, AuditMessage['mediaInterpretation']>>(admin, mediaCheckpointPath) || {}
  for (const message of messages) {
    if (!(message.media_url || message.media_type)) continue
    if (mediaCheckpoint[message.id]) { message.mediaInterpretation = mediaCheckpoint[message.id]; continue }
    message.mediaInterpretation = await interpretAuditMedia(admin, run.organizationId, message, {
      read: <T>(path: string) => readAuditObject<T>(admin, path),
      write: (path, value) => writeAuditObject(admin, path, value), reserveCompletion,
    })
    mediaCheckpoint[message.id] = message.mediaInterpretation
    await writeAuditObject(admin, mediaCheckpointPath, mediaCheckpoint)
    if (completions >= maxCompletions) throw new AuditPendingError()
  }
  }
  const hash = sourceHash(messages, hashVersion)
  const [{ data: previousInsight, error: previousError }, { data: deals, error: dealError }, { data: stages, error: stageError }] = await Promise.all([
    admin.from('ai_conversation_insights').select('*').eq('organization_id', run.organizationId).eq('conversation_id', conversation.id).maybeSingle(),
    admin.from('deals').select('id, stage').eq('organization_id', run.organizationId).eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(1),
    admin.from('pipeline_stages').select('key, is_won, is_lost').eq('organization_id', run.organizationId),
  ])
  if (previousError || dealError || stageError) throw new Error('Falha ao conferir a análise anterior ou o desfecho registrado no funil.')
  const archived = await readAuditObject<{ insight: unknown }>(admin, `${basePath}/previous.json`)
  if (!archived) await writeAuditObject(admin, `${basePath}/previous.json`, { insight: previousInsight })
  const deal = deals?.[0] as { id: string; stage: string } | undefined
  const stage = (stages as { key: string; is_won: boolean; is_lost: boolean }[] | null)?.find(item => item.key === deal?.stage)
  const knownOutcome = stage?.is_won ? 'ganha' : stage?.is_lost ? 'perdida' : null
  const chunks: ChunkRecord[] = []
  const batches = run.mode === 'text' ? buildAuditBatches(messages, 36_000, 150) : buildAuditBatches(messages)
  const modelMessages = (batch: ReturnType<typeof buildAuditBatches>[number]) => run.mode === 'text'
    ? batch.map(({ id, sender_type, content, created_at, media_type, part, parts }) =>
      ({ id, sender_type, content, created_at, media_type, part, parts }))
    : batch
  for (const [index, batch] of batches.entries()) {
    const chunkPath = `${basePath}/${hash}/chunk-${index}.json`
    const cached = await readAuditObject<ChunkRecord>(admin, chunkPath)
    if (cached?.hash === hash) { chunks.push(cached); continue }
    const analysis = await complete({
      channel: conversation.channel, isGroup, cutoff: run.cutoff, knownOutcome,
      batch: index + 1, batches: batches.length, previousSummary: chunks.at(-1)?.analysis.summary ?? null,
      isFinalBatch: index === batches.length - 1, auditMode: run.mode || 'media',
      messages: modelMessages(batch),
    }, messages)
    const record = { hash, analysis, messageIds: [...new Set(batch.map(message => message.id))] }
    await writeAuditObject(admin, chunkPath, record)
    chunks.push(record)
  }
  let analysis: AuditAnalysis
  if (!chunks.length) {
    analysis = { status: 'ok', outcome: run.mode === 'text' ? 'aberta' : knownOutcome ?? 'aberta', summary: 'Não há mensagens armazenadas nesta conversa até a data de corte.',
      outcomeReason: null, lossCategory: null, findings: [], payment: {
        status: 'sem_indicio', method: 'nao_identificado', summary: 'Sem mensagens para identificar pagamento.', evidence: [],
      } }
  } else if (chunks.length === 1) {
    analysis = chunks[0].analysis
  } else {
    // Consolidação hierárquica limita o contexto sem descartar nenhum lote revisado.
    let summaries = chunks.map(chunk => chunk.analysis)
    let level = 0
    while (summaries.length > 1) {
      const merged: AuditAnalysis[] = []
      for (let offset = 0; offset < summaries.length; offset += 8) {
        const group = summaries.slice(offset, offset + 8)
        if (group.length === 1) { merged.push(group[0]); continue }
        const mergePath = `${basePath}/${hash}/merge-${level}-${offset}.json`
        const cachedMerge = await readAuditObject<ChunkRecord>(admin, mergePath)
        if (cachedMerge?.hash === hash) { merged.push(cachedMerge.analysis); continue }
        const mergedAnalysis = await complete({
          channel: conversation.channel, isGroup, cutoff: run.cutoff, knownOutcome, consolidate: true,
          auditMode: run.mode || 'media',
          coverage: calculateAuditCoverage(messages), chronologicalAnalyses: group,
          finalMessages: modelMessages(buildAuditBatches(messages.slice(-30)).flat()),
        }, messages)
        await writeAuditObject(admin, mergePath, { hash, analysis: mergedAnalysis, messageIds: [] })
        merged.push(mergedAnalysis)
      }
      summaries = merged
      level++
    }
    analysis = summaries[0]
  }
  let forensic: ForensicAnalysis | undefined
  let quality: ForensicQuality | undefined
  if (forensicMode) {
    const input = { cutoff: run.cutoff, channel: conversation.channel, isGroup, knownOutcome,
      chronologicalAnalyses: chunks.map(chunk => chunk.analysis), consolidatedAnalysis: analysis,
      finalMessages: modelMessages(buildAuditBatches(messages.slice(-80)).flat()), coverage: calculateAuditCoverage(messages) }
    const firstPath = `${basePath}/${hash}/forensic-first.json`
    const secondPath = `${basePath}/${hash}/forensic-second.json`
    let first = await readAuditObject<ForensicAnalysis>(admin, firstPath)
    if (!first) {
      reserveCompletion()
      first = validateForensicAnalysis(await requestAuditJson(run.organizationId, FORENSIC_INSTRUCTION, { ...input, pass: 1 }), messages)
      await writeAuditObject(admin, firstPath, first)
    } else first = validateForensicAnalysis(first, messages)
    let second = await readAuditObject<{ analysis: ForensicAnalysis; quality: ForensicQuality }>(admin, secondPath)
    if (!second) {
      reserveCompletion()
      const validated = validateForensicAnalysis(await requestAuditJson(run.organizationId, FORENSIC_INSTRUCTION,
        { ...input, pass: 2, firstPass: first, validationTriggers: forensicAuditTriggers(messages, first, knownOutcome) }), messages)
      second = { analysis: validated, quality: { secondPassAt: new Date().toISOString(), initialStatus: first.status,
        triggers: forensicAuditTriggers(messages, first, knownOutcome) } }
      await writeAuditObject(admin, secondPath, second)
    }
    forensic = validateForensicAnalysis(second.analysis, messages); quality = second.quality
    analysis = { ...analysis, outcome: forensicCoreOutcome(forensic.status), summary: forensic.reasoning,
      outcomeReason: ['GANHA', 'PERDIDA'].includes(forensic.status) ? forensic.reasoning.slice(0, 400) : null,
      outcomeEvidence: forensic.evidence.slice(0, 4) }
  } else if (knownOutcome && run.mode !== 'text') analysis = { ...analysis, outcome: knownOutcome }
  const coverage = calculateAuditCoverage(messages)
  const { data: current } = await admin.from('conversations').select('last_message_at')
    .eq('organization_id', run.organizationId).eq('id', conversation.id).maybeSingle()
  let insightUpdated = false
  // Se chegou mensagem após o corte, conserva o resultado atual e guarda a auditoria histórica separadamente.
  if (messages.length && current && new Date(current.last_message_at).getTime() <= new Date(run.cutoff).getTime()) {
    const reason = analysis.outcome === 'perdida' && analysis.lossCategory
      ? `${LOSS_CATEGORIES[analysis.lossCategory]}${analysis.outcomeReason ? ` — ${analysis.outcomeReason}` : ''}`
      : analysis.outcomeReason
    const { error } = await admin.from('ai_conversation_insights').upsert({
      organization_id: run.organizationId, conversation_id: conversation.id, deal_id: deal?.id ?? null,
      status: analysis.status, outcome: analysis.outcome, summary: analysis.summary,
      outcome_reason: analysis.outcome !== 'aberta' ? reason : null,
      signals: analysis.findings.filter(finding => finding.type !== 'acerto').slice(0, 5).map(finding => finding.description),
      last_analyzed_message_id: coverage.lastMessageId, last_analyzed_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id' })
    if (error) throw new Error(`Falha ao atualizar indicadores: ${error.message}`)
    insightUpdated = true
  }
  const result: ConversationAudit = { runId: run.id, conversationId: conversation.id, channel: conversation.channel,
    cutoff: run.cutoff, completedAt: new Date().toISOString(), coverage, analysis, chunks,
    sourceHash: originalHash, recordedOutcome: knownOutcome, previousInsight: archived?.insight ?? previousInsight, insightUpdated,
    ...(forensic ? { forensic, quality } : {}),
    recordedStage: deal?.stage ?? null,
    contactName: (owned as unknown as { contacts: { name: string } | null }).contacts?.name ?? null,
    assigneeId: (owned as unknown as { current_assignee_id: string | null }).current_assignee_id ?? null,
    media: messages.filter(message => !!message.mediaInterpretation).map(message => ({ messageId: message.id,
      createdAt: message.created_at, interpretation: message.mediaInterpretation! })) }
  await writeAuditObject(admin, `${basePath}/result.json`, result)
  return result
}

export function summarizeAuditRun(run: AuditRun) {
  const completed = run.conversations.filter(conversation => conversation.state === 'completed')
  const channels = ['whatsapp', 'instagram'].map(channel => {
    const all = run.conversations.filter(conversation => conversation.channel === channel)
    const done = all.filter(conversation => conversation.state === 'completed')
    return { channel, total: all.length, completed: done.length, messages: done.reduce((sum, item) => sum + (item.coverage?.messages ?? 0), 0) }
  })
  const paymentCounts = completed.reduce<Record<string, number>>((counts, conversation) => {
    const status = conversation.payment || 'sem_indicio'
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {})
  return { id: run.id, version: run.version, mode: run.mode || 'media', cutoff: run.cutoff, status: run.status, updatedAt: run.updatedAt,
    paymentCounts, reused: completed.filter(conversation => conversation.resultRunId).length,
    total: run.conversations.length, completed: completed.length,
    failed: run.conversations.filter(conversation => conversation.state === 'failed').length,
    messages: completed.reduce((sum, item) => sum + (item.coverage?.messages ?? 0), 0),
    mediaInterpreted: completed.reduce((sum, item) => sum + (item.coverage?.mediaInterpreted ?? 0), 0),
    mediaLimited: completed.reduce((sum, item) => sum + (item.coverage?.mediaLimited ?? 0), 0),
    mediaUntranscribed: completed.reduce((sum, item) => sum + (item.coverage?.mediaUntranscribed ?? 0), 0), channels }
}
