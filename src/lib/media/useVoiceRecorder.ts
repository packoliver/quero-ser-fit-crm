'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatoDeGravacao, prepararParaEnvio } from './audio'
import type { CompressProgress } from './compress'

export type EstadoGravacao =
  /** Parado. */
  | 'idle'
  /** Pedindo o microfone ao sistema (o alerta de permissão pode estar na tela). */
  | 'requesting'
  /** Gravando. */
  | 'recording'
  /** Fechando o arquivo — e convertendo, se o navegador gravou num formato não aceito. */
  | 'processing'

/** Teto de duração. Passou disso, para sozinho e o áudio fica pronto pra enviar. */
const MAX_SEGUNDOS = 300

export interface VoiceRecorder {
  estado: EstadoGravacao
  /** Segundos gravados até agora. */
  segundos: number
  /** Este navegador grava áudio? Falso durante a renderização no servidor. */
  disponivel: boolean
  /** Mensagem pronta pra mostrar, ou null. */
  erro: string | null
  iniciar: () => void
  /** Encerra e entrega o arquivo em `onPronto`. */
  encerrar: () => void
  /** Descarta a gravação. Nada é enviado. */
  cancelar: () => void
  limparErro: () => void
}

interface Opcoes {
  /** Chamado com o áudio pronto pra enviar. Não é chamado quando a pessoa cancela. */
  onPronto: (arquivo: File) => void
  /** Progresso da conversão — só acontece em navegador que grava WebM (ver audio.ts). */
  onProgressoConversao?: (p: CompressProgress | null) => void
}

function mensagemDoErro(err: unknown): string {
  const nome = err instanceof Error ? err.name : ''
  if (nome === 'NotAllowedError' || nome === 'SecurityError') {
    return 'Permissão do microfone negada. Libere nos ajustes do navegador e tente de novo.'
  }
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') {
    return 'Nenhum microfone encontrado neste aparelho.'
  }
  if (nome === 'NotReadableError') {
    return 'O microfone está sendo usado por outro app. Feche o outro app e tente de novo.'
  }
  return 'Não foi possível gravar o áudio neste aparelho.'
}

/**
 * Gravação de áudio pelo microfone, no padrão de um toque pra começar e outro pra enviar.
 *
 * Não é segurar-pra-falar de propósito: a regra do projeto é que nada exista só por gesto,
 * e "segurar" num campo que também rola a tela é justamente o tipo de coisa que falha
 * calado. Dois toques funcionam igual em celular, em desktop e por leitor de tela.
 *
 * O microfone é desligado em toda saída — encerrar, cancelar, erro e desmontagem. Se ficar
 * uma faixa de áudio aberta, o iPhone mantém o indicador laranja de microfone ativo na
 * barra de status, e o app passa a impressão de estar escutando o tempo todo.
 */
export function useVoiceRecorder({ onPronto, onProgressoConversao }: Opcoes): VoiceRecorder {
  const [estado, setEstado] = useState<EstadoGravacao>('idle')
  const [segundos, setSegundos] = useState(0)
  const [disponivel, setDisponivel] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const gravadorRef = useRef<MediaRecorder | null>(null)
  const faixasRef = useRef<MediaStream | null>(null)
  const pedacosRef = useRef<Blob[]>([])
  const canceladoRef = useRef(false)
  // Callbacks em ref pra que trocar a função a cada renderização não recrie iniciar/encerrar.
  const onProntoRef = useRef(onPronto)
  const onProgressoRef = useRef(onProgressoConversao)

  // Atualizados em efeito, e não no corpo da função: escrever em ref durante a
  // renderização é justamente o que a regra react-hooks proíbe, porque o React pode
  // descartar e refazer uma renderização e a escrita já teria acontecido.
  useEffect(() => {
    onProntoRef.current = onPronto
    onProgressoRef.current = onProgressoConversao
  })

  // `MediaRecorder` não existe na renderização do servidor; checar aqui (e não no corpo do
  // componente) evita diferença entre o HTML do servidor e o do navegador.
  //
  // setTimeout(0) é o mesmo padrão já usado no Inbox, no Funil e nas Tarefas: mexer no
  // estado direto no corpo do efeito dispara renderização em cascata (regra
  // react-hooks/set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => {
      setDisponivel(
        typeof window !== 'undefined' &&
          typeof MediaRecorder !== 'undefined' &&
          !!navigator.mediaDevices?.getUserMedia
      )
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const desligarMicrofone = useCallback(() => {
    faixasRef.current?.getTracks().forEach((faixa) => faixa.stop())
    faixasRef.current = null
  }, [])

  const iniciar = useCallback(() => {
    if (gravadorRef.current) return
    setErro(null)
    setSegundos(0)
    setEstado('requesting')
    canceladoRef.current = false

    void (async () => {
      try {
        const faixas = await navigator.mediaDevices.getUserMedia({ audio: true })

        // Descartar enquanto o sistema ainda pedia permissão: as faixas chegam DEPOIS da
        // desistência. Sem fechar aqui, o microfone abriria mesmo tendo sido cancelado —
        // e no iPhone ficaria o indicador laranja aceso, sem nada na tela explicando.
        if (canceladoRef.current) {
          faixas.getTracks().forEach((faixa) => faixa.stop())
          setEstado('idle')
          return
        }

        const formato = formatoDeGravacao()
        const gravador = new MediaRecorder(faixas, formato ? { mimeType: formato } : undefined)
        pedacosRef.current = []

        gravador.ondataavailable = (evento) => {
          if (evento.data.size > 0) pedacosRef.current.push(evento.data)
        }

        gravador.onstop = () => {
          desligarMicrofone()
          gravadorRef.current = null
          const pedacos = pedacosRef.current
          pedacosRef.current = []

          if (canceladoRef.current || pedacos.length === 0) {
            setEstado('idle')
            return
          }

          setEstado('processing')
          void (async () => {
            try {
              const bruto = new Blob(pedacos, { type: gravador.mimeType || formato || 'audio/webm' })
              const arquivo = await prepararParaEnvio(bruto, (p) => onProgressoRef.current?.(p))
              // Descartar durante o preparo também vale: converter pode demorar, e enviar
              // um áudio que a pessoa acabou de jogar fora seria pior que não enviar nada.
              if (canceladoRef.current) return
              onProntoRef.current(arquivo)
            } catch {
              setErro('Não foi possível preparar o áudio para envio.')
            } finally {
              onProgressoRef.current?.(null)
              setEstado('idle')
            }
          })()
        }

        gravador.start()
        gravadorRef.current = gravador
        faixasRef.current = faixas
        setEstado('recording')
      } catch (err) {
        desligarMicrofone()
        setEstado('idle')
        setErro(mensagemDoErro(err))
      }
    })()
  }, [desligarMicrofone])

  const encerrar = useCallback(() => {
    const gravador = gravadorRef.current
    if (!gravador || gravador.state === 'inactive') return
    canceladoRef.current = false
    gravador.stop()
  }, [])

  const cancelar = useCallback(() => {
    const gravador = gravadorRef.current
    canceladoRef.current = true
    if (gravador && gravador.state !== 'inactive') {
      gravador.stop()
      return
    }
    // Cancelado antes de o microfone abrir: não há gravador pra parar, mas pode haver
    // faixa aberta e o estado precisa voltar sozinho.
    desligarMicrofone()
    setEstado('idle')
  }, [desligarMicrofone])

  // Cronômetro.
  useEffect(() => {
    if (estado !== 'recording') return
    const intervalo = setInterval(() => setSegundos((atual) => atual + 1), 1000)
    return () => clearInterval(intervalo)
  }, [estado])

  // Teto de duração: gravação esquecida ligada viraria um arquivo enorme com o microfone
  // aberto sem ninguém ver. Fica separado do cronômetro de propósito — chamar encerrar()
  // de dentro do atualizador de `setSegundos` o tornaria impuro, e o React tem liberdade
  // pra executar um atualizador mais de uma vez.
  useEffect(() => {
    if (estado === 'recording' && segundos >= MAX_SEGUNDOS) encerrar()
  }, [estado, segundos, encerrar])

  // Sair da tela no meio de uma gravação não pode deixar o microfone ligado.
  useEffect(() => {
    return () => {
      const gravador = gravadorRef.current
      canceladoRef.current = true
      if (gravador && gravador.state !== 'inactive') gravador.stop()
      faixasRef.current?.getTracks().forEach((faixa) => faixa.stop())
      faixasRef.current = null
    }
  }, [])

  const limparErro = useCallback(() => setErro(null), [])

  return { estado, segundos, disponivel, erro, iniciar, encerrar, cancelar, limparErro }
}
