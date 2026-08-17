'use client'

// Compressão de mídia direto no navegador, antes do upload — câmeras de celular hoje
// gravam foto/vídeo bem acima do limite de anexo de 24MB do Instagram Direct/WhatsApp
// (ver MAX_MEDIA_SIZE_BYTES em inbox/page.tsx), e pedir pra vendedora comprimir na mão
// em outro app antes de cada envio não é realista no dia a dia. Fotos usam Canvas (rápido,
// nativo do navegador); vídeo usa ffmpeg.wasm (mais pesado, só carregado quando
// realmente precisa comprimir um vídeo grande — ver getFFmpeg abaixo).

export interface CompressProgress {
  /** 'loading' = baixando o motor de compressão (só na primeira vez); 'compressing' = processando o arquivo. */
  stage: 'loading' | 'compressing'
  /** 0–1. Aproximado para vídeo (vem do progresso interno do ffmpeg); sempre 1 ao final. */
  ratio: number
}

const IMAGE_MAX_DIMENSION = 1920 // full HD já é mais que suficiente pra ver detalhe de peça numa tela de chat
const IMAGE_QUALITY = 0.82
// Fotos pequenas não valem o custo de recomprimir (perda de qualidade sem ganho real) —
// só comprime acima disso.
const IMAGE_COMPRESS_THRESHOLD_BYTES = 3 * 1024 * 1024

/**
 * Reduz uma imagem via Canvas (redimensiona pro lado maior caber em IMAGE_MAX_DIMENSION e
 * reexporta como JPEG). Devolve o arquivo original sem mexer se ele já for pequeno, se o
 * navegador não conseguir decodificar a imagem, ou se por algum motivo o resultado
 * comprimido não ficar menor que o original (Ex: PNG com poucas cores já é bem pequeno).
 */
export async function compressImageIfLarge(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY))
    if (!blob || blob.size >= file.size) return file

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch (err) {
    console.warn('[compressImageIfLarge] Não foi possível comprimir a imagem, enviando original:', err)
    return file
  }
}

// --- Vídeo (ffmpeg.wasm) ---------------------------------------------------------------
//
// ffmpeg.js é carregado via <script> injetada em runtime (não `import('@ffmpeg/ffmpeg')`)
// de propósito: o pacote cria seu worker internamente com
// `new Worker(new URL(classWorkerURL, import.meta.url))`, e o Turbopack do Next.js não
// consegue analisar isso estaticamente quando importado como módulo ES ("Cannot find
// module as expression is too dynamic" — quebra em runtime, confirmado em teste manual
// antes desta versão). Carregado como <script> comum (build UMD, self-contained, com seu
// próprio carregador de chunk interno), o bundler nunca toca nesse código — só busca os
// arquivos estáticos em public/ffmpeg/ (copiados de node_modules por
// scripts/copy-ffmpeg-core.js) como qualquer outro asset.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FFmpegWASM?: { FFmpeg: new () => any }
  }
}

let scriptLoadPromise: Promise<void> | null = null

function loadFFmpegScript(): Promise<void> {
  if (window.FFmpegWASM) return Promise.resolve(undefined)
  if (scriptLoadPromise) return scriptLoadPromise

  const promise: Promise<void> = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/ffmpeg/ffmpeg.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Falha ao carregar /ffmpeg/ffmpeg.js'))
    document.head.appendChild(script)
  }).catch((err) => {
    scriptLoadPromise = null
    throw err
  })

  scriptLoadPromise = promise
  return promise
}

/** Converte um File/Blob em Uint8Array — o que ffmpeg.wasm espera pra escrever no seu
 * sistema de arquivos virtual (writeFile). Equivalente ao `fetchFile` de @ffmpeg/util,
 * reimplementado aqui pra não precisar dessa dependência extra só por essa função. */
async function fileToUint8Array(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegInstance: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffmpegLoadPromise: Promise<any> | null = null

/** Carrega o motor ffmpeg.wasm (núcleo single-thread, servido do nosso próprio domínio
 * via public/ffmpeg) sob demanda, uma única vez por sessão da página. ~32MB na primeira
 * vez; o navegador cacheia depois disso. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFFmpeg(onProgress?: (p: CompressProgress) => void): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance
  if (ffmpegLoadPromise) return ffmpegLoadPromise

  ffmpegLoadPromise = (async () => {
    onProgress?.({ stage: 'loading', ratio: 0 })
    await loadFFmpegScript()
    if (!window.FFmpegWASM) throw new Error('window.FFmpegWASM ausente após carregar ffmpeg.js')

    const ffmpeg = new window.FFmpegWASM.FFmpeg()
    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL: '/ffmpeg/ffmpeg-core.wasm',
    })
    onProgress?.({ stage: 'loading', ratio: 1 })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })().catch((err) => {
    // Não deixa uma falha de carregamento travar tentativas futuras nesta mesma sessão.
    ffmpegLoadPromise = null
    throw err
  })

  return ffmpegLoadPromise
}

interface VideoPass {
  /** Largura máxima (a altura acompanha mantendo a proporção). */
  maxWidth: number
  /** CRF do libx264 — menor = mais qualidade e mais pesado. */
  crf: number
}

// Duas tentativas: a primeira prioriza qualidade (ainda em resolução alta o bastante pra
// ver detalhe de tecido/acabamento), a segunda é bem mais agressiva — só usada se a
// primeira não coube no limite.
const VIDEO_PASSES: VideoPass[] = [
  { maxWidth: 1280, crf: 28 },
  { maxWidth: 854, crf: 32 },
]

async function runVideoPass(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ffmpeg: any,
  inputBytes: Uint8Array,
  inputName: string,
  pass: VideoPass,
  onProgress?: (p: CompressProgress) => void
): Promise<Uint8Array> {
  const outputName = 'output.mp4'
  const progressHandler = ({ progress }: { progress: number }) => {
    // progress vem 0–1 (às vezes passa um pouco de 1 por imprecisão do ffmpeg) — limita.
    onProgress?.({ stage: 'compressing', ratio: Math.min(1, Math.max(0, progress)) })
  }
  ffmpeg.on('progress', progressHandler)

  try {
    await ffmpeg.writeFile(inputName, inputBytes)
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', String(pass.crf),
      '-vf', `scale='min(${pass.maxWidth},iw)':-2`,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ])
    const data = await ffmpeg.readFile(outputName)
    return data as Uint8Array
  } finally {
    ffmpeg.off('progress', progressHandler)
    // Limpa o sistema de arquivos virtual do ffmpeg — cada tentativa reusa os mesmos
    // nomes de arquivo, e o worker é reaproveitado entre chamadas na mesma sessão.
    await ffmpeg.deleteFile(inputName).catch(() => {})
    await ffmpeg.deleteFile(outputName).catch(() => {})
  }
}

/**
 * Comprime um vídeo até caber em `maxBytes`, tentando as passagens de VIDEO_PASSES em
 * ordem (cada uma mais agressiva que a anterior). Devolve `null` se mesmo a tentativa
 * mais agressiva não coube — quem chama decide a mensagem de erro nesse caso. Nunca
 * lança: qualquer falha do ffmpeg (formato não suportado, memória insuficiente no
 * aparelho, etc.) também devolve `null`, e quem chama trata como "não comprimiu".
 */
export async function compressVideo(file: File, maxBytes: number, onProgress?: (p: CompressProgress) => void): Promise<File | null> {
  try {
    const ffmpeg = await getFFmpeg(onProgress)
    const inputBytes = await fileToUint8Array(file)
    const inputName = 'input' + (file.name.match(/\.[^.]+$/)?.[0] || '.mp4')

    for (const pass of VIDEO_PASSES) {
      // .slice() copia os bytes — ffmpeg.writeFile transfere (não copia) o ArrayBuffer
      // de origem pro worker via postMessage, "esvaziando" (detach) o buffer original no
      // fim da chamada. Sem essa cópia, a segunda passagem (quando a primeira não coube
      // no limite) falharia com "ArrayBuffer is already detached".
      const result = await runVideoPass(ffmpeg, inputBytes.slice(), inputName, pass, onProgress)
      if (result.byteLength > 0 && result.byteLength <= maxBytes) {
        const newName = file.name.replace(/\.[^.]+$/, '') + '.mp4'
        return new File([result as BlobPart], newName, { type: 'video/mp4' })
      }
    }
    return null
  } catch (err) {
    console.warn('[compressVideo] Falha ao comprimir vídeo, envio original será rejeitado pelo limite:', err)
    return null
  }
}
