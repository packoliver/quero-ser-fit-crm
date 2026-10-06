import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  createClient: vi.fn(),
  decryptToken: vi.fn((value: string) => value.replace('encrypted:', '')),
  fetch: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ getServerEnv: mocks.env }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/security/encryption', () => ({ decryptToken: mocks.decryptToken }))

describe('Gateway de IA por organização', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.env.mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-key',
      OMNIROUTE_BASE_URL: 'https://old-tunnel.example/v1',
      OMNIROUTE_API_KEY: 'test-only-fallback-key',
      OMNIROUTE_MODEL: 'fallback-model',
    })
    mocks.eq.mockImplementation((_column: string, organizationId: string) => ({
      maybeSingle: vi.fn().mockResolvedValue({
        data: organizationId === 'missing' ? null : {
          ai_gateway_url: `https://${organizationId}.example/v1`,
          ai_gateway_api_key_encrypted: `encrypted:test-only-${organizationId}-key`,
          ai_gateway_model: `${organizationId}-model`,
        },
        error: null,
      }),
    }))
    mocks.createClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: mocks.eq }) }),
    })
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
    })
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('usa URL, chave e modelo da empresa solicitada, mesmo após outra empresa preencher o cache', async () => {
    const { askQuestion } = await import('../client')
    for (const organizationId of ['company-a', 'company-b', 'company-a']) {
      expect(await askQuestion({ organizationId, context: 'Dados fictícios.', question: 'Responda OK.' })).toBe('OK')
    }

    expect(mocks.eq.mock.calls).toEqual([
      ['id', 'company-a'], ['id', 'company-b'], ['id', 'company-a'],
    ])
    for (const [index, organizationId] of ['company-a', 'company-b', 'company-a'].entries()) {
      const [url, options] = mocks.fetch.mock.calls[index]
      expect(url).toBe(`https://${organizationId}.example/v1/chat/completions`)
      expect(options.headers.Authorization).toBe(`Bearer test-only-${organizationId}-key`)
      expect(JSON.parse(options.body).model).toBe(`${organizationId}-model`)
    }
  })

  it('reutiliza o cache somente para a mesma organização', async () => {
    const { isAiConfigured, askQuestion } = await import('../client')
    expect(await isAiConfigured('company-a')).toBe(true)
    await askQuestion({ organizationId: 'company-a', context: 'Dados fictícios.', question: 'OK?' })
    expect(mocks.eq).toHaveBeenCalledTimes(1)
  })

  it('pede JSON na entrada compatível com o gateway e mantém imagens fora do texto', async () => {
    const { requestAuditJson } = await import('../client')
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) })
    expect(await requestAuditJson('company-a', 'Responda JSON.', { messages: [] })).toEqual({ ok: true })
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).messages[1].content).toContain('JSON')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).model).toBe('company-a-model')
    await requestAuditJson('company-a', 'Descreva JSON.', {}, { mime: 'image/jpeg', base64: 'test-only' })
    const content = JSON.parse(mocks.fetch.mock.calls[1][1].body).messages[1].content
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).model).toBe('groq/qwen/qwen3.8-27b')
    expect(content[0].text).toContain('JSON')
    expect(content[1].image_url.url).toBe('data:image/jpeg;base64,test-only')
  })
  it('propaga limite 429 e intervalo sem expor corpo ou credenciais do provedor', async () => {
    const { requestAuditJson } = await import('../client')
    mocks.fetch.mockResolvedValue(new Response('sensitive provider details', { status: 429, headers: { 'Retry-After': '120' } }))
    await expect(requestAuditJson('company-a', 'JSON', {}, { mime: 'image/jpeg', base64: 'test' }))
      .rejects.toMatchObject({ auditGatewayStatus: 429, auditGatewayKind: 'image', retryAfterSeconds: 120,
        message: 'Gateway da auditoria retornou HTTP 429.' })
  })

  it('usa rotas dedicadas sem trocar URL ou credencial da organização', async () => {
    mocks.env.mockReturnValue({
      ...mocks.env(), OMNIROUTE_AUDIT_MODEL: 'crm-profissional',
      OMNIROUTE_IMAGE_MODEL: 'crm-visao', OMNIROUTE_AUDIO_MODEL: 'audio-reserva',
    })
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) })
    const { requestAuditJson, transcribeAuditAudio, askQuestion } = await import('../client')
    await requestAuditJson('company-a', 'JSON', {})
    await requestAuditJson('company-a', 'JSON', {}, { mime: 'image/png', base64: 'test-only' })
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).model).toBe('crm-profissional')
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).model).toBe('crm-visao')
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Transcrição fictícia.', segments: [] }) })
    await transcribeAuditAudio('company-a', new Blob(['test-only'], { type: 'audio/wav' }), 'test.wav')
    expect(mocks.fetch.mock.calls[2][1].body.get('model')).toBe('audio-reserva')
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect(url).toMatch(/^https:\/\/company-a\.example\/v1\//)
      expect(options.headers.Authorization).toBe('Bearer test-only-company-a-key')
    }
    await askQuestion({ organizationId: 'company-a', context: 'Dados fictícios.', question: 'OK?' })
    expect(JSON.parse(mocks.fetch.mock.calls[3][1].body).model).toBe('company-a-model')
  })

  it('preserva a rota de áudio atual quando não existe alternativa configurada', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Teste.', segments: [] }) })
    const { transcribeAuditAudio } = await import('../client')
    expect(await transcribeAuditAudio('company-b', new Blob(['test']), 'test.wav')).toEqual({ text: 'Teste.', uncertain: false })
    expect(mocks.fetch.mock.calls[0][1].body.get('model')).toBe('groq/whisper-large-v3')
  })

  it('usa a reserva de visão após 429 sem perder imagem ou credencial da empresa', async () => {
    mocks.env.mockReturnValue({ ...mocks.env(), OMNIROUTE_IMAGE_MODEL: 'vision-primary', OMNIROUTE_IMAGE_FALLBACK_MODEL: 'vision-backup' })
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"imageAccessible":true,"description":"Teste."}' } }] }) })
    const { requestAuditJson } = await import('../client')
    expect(await requestAuditJson('company-a', 'JSON', {}, { mime: 'image/png', base64: 'test-only' })).toMatchObject({ imageAccessible: true })
    expect(mocks.fetch.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['vision-primary', 'vision-backup'])
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect(url).toBe('https://company-a.example/v1/chat/completions')
      expect(options.headers.Authorization).toBe('Bearer test-only-company-a-key')
      expect(JSON.parse(options.body).messages[1].content[1].image_url.url).toBe('data:image/png;base64,test-only')
    }
  })

  it('não aceita uma visão sem acesso à imagem e tenta a reserva', async () => {
    mocks.env.mockReturnValue({ ...mocks.env(), OMNIROUTE_IMAGE_FALLBACK_MODEL: 'vision-backup' })
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"imageAccessible":false}' } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"imageAccessible":true}' } }] }) })
    const { requestAuditJson } = await import('../client')
    expect(await requestAuditJson('company-a', 'JSON', {}, { mime: 'image/png', base64: 'test' })).toEqual({ imageAccessible: true })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('não repete erros de autenticação na reserva de visão', async () => {
    mocks.env.mockReturnValue({ ...mocks.env(), OMNIROUTE_IMAGE_FALLBACK_MODEL: 'vision-backup' })
    mocks.fetch.mockResolvedValue(new Response('', { status: 401 }))
    const { requestAuditJson } = await import('../client')
    await expect(requestAuditJson('company-a', 'JSON', {}, { mime: 'image/png', base64: 'test' }))
      .rejects.toMatchObject({ auditGatewayStatus: 401 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('interrompe a primeira visão após 35s e libera a tentativa de reserva', async () => {
    vi.useFakeTimers()
    mocks.env.mockReturnValue({ ...mocks.env(), OMNIROUTE_IMAGE_FALLBACK_MODEL: 'vision-backup' })
    mocks.fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Tempo da visão esgotado.')), { once: true })
    })).mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"imageAccessible":true}' } }] }) })
    const { requestAuditJson } = await import('../client')
    const pending = requestAuditJson('company-a', 'JSON', {}, { mime: 'image/png', base64: 'test' })
    await vi.advanceTimersByTimeAsync(35_000)
    expect(await pending).toEqual({ imageAccessible: true })
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('mantém o fallback existente quando a empresa não tem configuração', async () => {
    const { askQuestion } = await import('../client')
    await askQuestion({ organizationId: 'missing', context: 'Dados fictícios.', question: 'OK?' })
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://old-tunnel.example/v1/chat/completions')
    expect(mocks.eq).toHaveBeenCalledWith('id', 'missing')
  })

  it('também usa a empresa da conversa na análise automática', async () => {
    const { analyzeConversation } = await import('../client')
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        status: 'ok', signals: [], summary: 'Teste fictício.', outcome: 'aberta', outcomeReason: '',
      }) } }] }),
    })
    const result = await analyzeConversation({ organizationId: 'company-b', transcript: 'Cliente fictício: oi.', knownOutcome: null })
    expect(result?.summary).toBe('Teste fictício.')
    expect(mocks.eq).toHaveBeenCalledWith('id', 'company-b')
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://company-b.example/v1/chat/completions')
  })

  it('aceita um relatório que demora mais de 45 segundos para chegar', async () => {
    vi.useFakeTimers()
    const { askQuestion } = await import('../client')
    mocks.fetch.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true, json: async () => ({ choices: [{ message: { content: 'Relatório concluído.' } }] }) }), 60_000)
    }))
    const pending = askQuestion({ organizationId: 'company-a', context: 'Dados fictícios.', question: 'Analise o período.' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await pending).toBe('Relatório concluído.')
  })

  it('interrompe a requisição quando o gateway excede o limite', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { askQuestion } = await import('../client')
    mocks.fetch.mockImplementationOnce(() => new Promise(() => {}))
    const pending = askQuestion({ organizationId: 'company-a', context: 'Dados fictícios.', question: 'Analise o período.' })
    await vi.advanceTimersByTimeAsync(115_000)
    expect(await pending).toBeNull()
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('limita também a leitura de um corpo que nunca termina, mesmo com headers recebidos', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { askQuestion } = await import('../client')
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) })
    const pending = askQuestion({ organizationId: 'company-a', context: 'Dados fictícios.', question: 'Analise o período.' })
    await vi.advanceTimersByTimeAsync(115_000)
    expect(await pending).toBeNull()
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
