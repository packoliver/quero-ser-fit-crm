'use client'

import { getFFmpeg, type CompressProgress } from './compress'

/**
 * Áudio gravado no navegador, pronto pra virar mensagem.
 *
 * O problema que este arquivo resolve: cada navegador grava num formato diferente, e o
 * WhatsApp não aceita todos. O Safari do iPhone grava em MP4/AAC, que o WhatsApp aceita
 * direto. O Chrome grava em WebM, que ele NÃO aceita. Então em iPhone a gravação sai na
 * hora, sem conversão nenhuma; no Chrome ela passa por uma troca de embalagem antes.
 */

/**
 * Formatos que WhatsApp e Instagram aceitam como áudio sem conversão.
 *
 * Vem da documentação da Cloud API do WhatsApp (aac, mp4, mpeg, amr, ogg-opus); a uazapi
 * fala o mesmo protocolo por baixo. WebM está fora de propósito — é justamente o formato
 * que o Chrome grava, e o motivo de a conversão existir.
 */
const FORMATOS_ACEITOS = ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/amr', 'audio/ogg']

/**
 * Ordem de preferência de gravação. Os dois primeiros saem prontos pra enviar; o WebM
 * só entra quando o navegador não oferece nada melhor (é o caso do Chrome).
 */
const FORMATOS_DE_GRAVACAO = [
  // AAC dentro de MP4, pedido explicitamente. Vem primeiro porque é o que o Chrome
  // precisa ouvir pra não entregar Opus dentro de MP4 (ver podeEnviarDireto).
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4', // Safari / iPhone — aqui isto já significa AAC
  'audio/ogg;codecs=opus', // Firefox — é o formato nativo de áudio de voz do WhatsApp
  'audio/webm;codecs=opus', // Chrome antigo
  'audio/webm',
]

const EXTENSAO_POR_FORMATO: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
}

/** Tira o `;codecs=...` — `MediaRecorder` devolve o tipo completo, e comparação precisa do puro. */
export function tipoBase(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase()
}

/**
 * Este áudio pode ir pro WhatsApp/Instagram como está, sem passar pelo conversor?
 *
 * Não basta olhar `audio/mp4`: existe Opus dentro de MP4, e o Chrome grava exatamente
 * assim quando você pede só "audio/mp4" (medido no navegador — pedindo `audio/mp4` ele
 * devolve `audio/mp4;codecs=opus`). O WhatsApp espera AAC dentro de um .m4a, então esse
 * caso precisa converter como qualquer outro, apesar do tipo parecer aceitável.
 */
export function podeEnviarDireto(mime: string): boolean {
  const base = tipoBase(mime)
  if (!FORMATOS_ACEITOS.includes(base)) return false
  if (base === 'audio/mp4' && /opus/i.test(mime)) return false
  return true
}

/**
 * Melhor formato que este navegador sabe gravar, ou `undefined` se ele não gravar áudio.
 * Fora do navegador (renderização no servidor) devolve `undefined` sem quebrar.
 */
export function formatoDeGravacao(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return FORMATOS_DE_GRAVACAO.find((tipo) => {
    try {
      return MediaRecorder.isTypeSupported(tipo)
    } catch {
      return false
    }
  })
}

/** `0:07`, `1:42`. Nunca negativo, nunca `NaN` — o cronômetro fica visível o tempo todo. */
export function formatarDuracao(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0
  const min = Math.floor(total / 60)
  const seg = total % 60
  return `${min}:${String(seg).padStart(2, '0')}`
}

/** Nome de arquivo com a extensão certa pro formato — alguns provedores olham a extensão. */
export function nomeDoArquivo(mime: string): string {
  const extensao = EXTENSAO_POR_FORMATO[tipoBase(mime)] || 'ogg'
  return `audio-${Date.now()}.${extensao}`
}

/**
 * Deixa a gravação num formato que dá pra enviar.
 *
 * No iPhone isso não faz nada: a gravação já sai em MP4/AAC e volta na mesma hora, sem
 * carregar o ffmpeg (que são 32MB de download na primeira vez). Só o WebM do Chrome passa
 * pelo conversor — e aí é uma troca de embalagem, não recodificação: WebM e OGG carregam
 * o mesmo Opus por dentro, então `-c:a copy` só reempacota, em milissegundos. A
 * recodificação de verdade fica como plano B, para o caso raro de o WebM não vir em Opus.
 *
 * Nunca lança. Se tudo falhar, devolve o arquivo original — que pode ser recusado no
 * envio, e aí a mensagem aparece como "Falha ao enviar", que é visível, em vez de o
 * botão simplesmente não fazer nada.
 */
export async function prepararParaEnvio(
  blob: Blob,
  onProgress?: (p: CompressProgress) => void
): Promise<File> {
  const tipoOriginal = blob.type || 'audio/webm'

  if (podeEnviarDireto(tipoOriginal)) {
    return new File([blob], nomeDoArquivo(tipoOriginal), { type: tipoBase(tipoOriginal) })
  }

  const entrada = `voz-entrada.${EXTENSAO_POR_FORMATO[tipoBase(tipoOriginal)] || 'webm'}`
  const saida = 'voz-saida.ogg'

  try {
    const ffmpeg = await getFFmpeg(onProgress)
    onProgress?.({ stage: 'compressing', ratio: 0 })
    const bytes = new Uint8Array(await blob.arrayBuffer())

    // Duas tentativas: reempacotar (instantâneo) e, se o Opus não estiver lá dentro,
    // recodificar. 32k mono com o perfil `voip` é a faixa que o próprio WhatsApp usa em
    // mensagem de voz — voz fica limpa e o arquivo fica em alguns KB por minuto.
    const tentativas = [
      ['-i', entrada, '-c:a', 'copy', saida],
      ['-i', entrada, '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-application', 'voip', saida],
    ]

    for (const args of tentativas) {
      try {
        await ffmpeg.writeFile(entrada, bytes.slice())
        await ffmpeg.exec(args)
        const dados = (await ffmpeg.readFile(saida)) as Uint8Array
        if (dados.byteLength > 0) {
          return new File([dados as BlobPart], nomeDoArquivo('audio/ogg'), { type: 'audio/ogg' })
        }
      } catch {
        // Tentativa seguinte.
      } finally {
        await ffmpeg.deleteFile(entrada).catch(() => {})
        await ffmpeg.deleteFile(saida).catch(() => {})
      }
    }
  } catch (err) {
    console.warn('[prepararParaEnvio] Não foi possível converter o áudio, enviando original:', err)
  } finally {
    onProgress?.({ stage: 'compressing', ratio: 1 })
  }

  return new File([blob], nomeDoArquivo(tipoOriginal), { type: tipoBase(tipoOriginal) })
}
