import { describe, it, expect, afterEach } from 'vitest'
import { formatarDuracao, podeEnviarDireto, tipoBase, nomeDoArquivo, formatoDeGravacao } from '@/lib/media/audio'

/**
 * O que está sendo protegido: a decisão de converter ou não.
 *
 * Cada navegador grava num formato diferente e o WhatsApp não aceita todos. Se o iPhone
 * parar de cair no caminho "envia direto", toda mensagem de voz passa a carregar 32MB de
 * conversor antes de sair — que é exatamente o tipo de lentidão que já custou caro aqui
 * no vídeo, e que nenhum teste de tipo ou de build pegaria.
 */

function simularSuporte(formatos: string[]) {
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: { isTypeSupported: (tipo: string) => formatos.includes(tipo) },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'MediaRecorder')
})

describe('Formato de gravação de áudio', () => {
  it('deve escolher mp4 no Safari, que o WhatsApp aceita sem conversão', () => {
    simularSuporte(['audio/mp4'])
    const formato = formatoDeGravacao()
    expect(formato).toBe('audio/mp4')
    expect(podeEnviarDireto(formato!)).toBe(true)
  })

  it('deve escolher webm no Chrome, e reconhecer que precisa converter', () => {
    simularSuporte(['audio/webm;codecs=opus', 'audio/webm'])
    const formato = formatoDeGravacao()
    expect(formato).toBe('audio/webm;codecs=opus')
    expect(podeEnviarDireto(formato!)).toBe(false)
  })

  it('deve preferir o formato que não precisa de conversão quando há mais de um', () => {
    // Navegador que aceita os dois: pegar o webm faria carregar o conversor à toa.
    simularSuporte(['audio/webm;codecs=opus', 'audio/mp4'])
    expect(formatoDeGravacao()).toBe('audio/mp4')
  })

  it('deve pedir AAC explicitamente quando o navegador oferece', () => {
    // Medido no Chrome: pedir só "audio/mp4" devolve audio/mp4;codecs=opus, que o
    // WhatsApp não toca. Pedindo mp4a.40.2 ele entrega AAC de verdade.
    simularSuporte(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus'])
    expect(formatoDeGravacao()).toBe('audio/mp4;codecs=mp4a.40.2')
  })

  it('deve devolver undefined onde não existe MediaRecorder', () => {
    expect(formatoDeGravacao()).toBeUndefined()
  })
})

describe('Formatos aceitos pelo WhatsApp/Instagram', () => {
  it('deve ignorar o sufixo de codec ao comparar', () => {
    expect(tipoBase('audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4')
    expect(podeEnviarDireto('audio/mp4;codecs=mp4a.40.2')).toBe(true)
    expect(podeEnviarDireto('audio/ogg;codecs=opus')).toBe(true)
  })

  it('deve recusar webm', () => {
    expect(podeEnviarDireto('audio/webm')).toBe(false)
    expect(podeEnviarDireto('audio/webm;codecs=opus')).toBe(false)
  })

  it('deve recusar Opus dentro de MP4, mesmo o tipo base sendo aceito', () => {
    // A armadilha: audio/mp4;codecs=opus passa como "audio/mp4" numa comparação ingênua,
    // e é exatamente o que o Chrome grava quando ninguém pede o codec. Sai um arquivo com
    // cara de aceitável que o WhatsApp não toca.
    expect(podeEnviarDireto('audio/mp4;codecs=opus')).toBe(false)
    expect(podeEnviarDireto('audio/mp4;codecs=mp4a.40.2')).toBe(true)
    expect(podeEnviarDireto('audio/mp4')).toBe(true)
  })
})

describe('Nome do arquivo', () => {
  it('deve usar a extensão convencional de cada formato', () => {
    // .m4a e não .mp4: alguns provedores olham a extensão pra decidir se é áudio ou vídeo.
    expect(nomeDoArquivo('audio/mp4')).toMatch(/\.m4a$/)
    expect(nomeDoArquivo('audio/ogg;codecs=opus')).toMatch(/\.ogg$/)
    expect(nomeDoArquivo('audio/webm')).toMatch(/\.webm$/)
  })

  it('deve cair em ogg para formato desconhecido', () => {
    expect(nomeDoArquivo('audio/vnd.desconhecido')).toMatch(/\.ogg$/)
  })
})

describe('Cronômetro da gravação', () => {
  it('deve formatar minutos e segundos', () => {
    expect(formatarDuracao(0)).toBe('0:00')
    expect(formatarDuracao(7)).toBe('0:07')
    expect(formatarDuracao(65)).toBe('1:05')
    expect(formatarDuracao(600)).toBe('10:00')
  })

  it('nunca deve mostrar valor quebrado', () => {
    // O cronômetro fica visível o tempo todo — um "NaN:aN" ali é constrangedor.
    expect(formatarDuracao(-5)).toBe('0:00')
    expect(formatarDuracao(Number.NaN)).toBe('0:00')
    expect(formatarDuracao(3.7)).toBe('0:03')
  })
})
