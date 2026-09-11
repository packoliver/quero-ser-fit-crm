'use client'

import { useSyncExternalStore } from 'react'

const ENTER_TO_SEND_KEY = 'qsf:enterToSend'

/**
 * Igual o WhatsApp Desktop: "Enter envia a mensagem" é um hábito de digitação da PESSOA,
 * não um dado da organização — por isso mora no localStorage do aparelho, e não no banco.
 * Cada atendente pode preferir um jeito diferente no próprio computador/celular sem afetar
 * ninguém mais. Shift+Enter sempre quebra linha, independente dessa preferência (ver
 * onKeyDown no composer do Inbox).
 */
export function getEnterToSend(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const stored = window.localStorage.getItem(ENTER_TO_SEND_KEY)
    // Sem valor salvo ainda = comportamento atual/padrão (Enter envia), pra não mudar o
    // hábito de ninguém sem a pessoa ter escolhido isso.
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

const listeners = new Set<() => void>()

export function setEnterToSend(value: boolean): void {
  try {
    window.localStorage.setItem(ENTER_TO_SEND_KEY, value ? '1' : '0')
  } catch {
    // Navegação privada ou storage bloqueado: a troca vale só pra sessão atual em memória
    // (os componentes assinados ainda são avisados logo abaixo), sem quebrar a digitação.
  }
  listeners.forEach((notify) => notify())
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  // Também escuta troca feita em OUTRA aba/janela (evento nativo 'storage' só dispara
  // fora da aba que escreveu) — assim duas abas do mesmo atendente ficam em sincronia.
  const onStorage = (e: StorageEvent) => {
    if (e.key === ENTER_TO_SEND_KEY) onStoreChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener('storage', onStorage)
  }
}

// SSR não tem localStorage: usa o mesmo padrão de getEnterToSend (Enter envia) pro HTML do
// servidor bater com o primeiro render do cliente, e o React troca pro valor real sozinho
// logo depois de montar — sem isso, cai no aviso de hydration mismatch.
function getServerSnapshot(): boolean {
  return true
}

/** Lê a preferência (client-only) e devolve um setter que já persiste e avisa quem mais
 * estiver com o hook montado, nesta aba ou em outra. */
export function useEnterToSend(): [boolean, (value: boolean) => void] {
  const enterToSend = useSyncExternalStore(subscribe, getEnterToSend, getServerSnapshot)
  return [enterToSend, setEnterToSend]
}
