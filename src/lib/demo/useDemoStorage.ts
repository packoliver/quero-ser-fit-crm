'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DemoDatabase,
  DEMO_STORAGE_EVENT,
  DEMO_STORAGE_KEY,
  getDemoDatabase,
  resetDemoDatabase,
  saveStoredContact,
  updateStoredContact,
  deleteStoredContact,
  saveStoredTask,
  updateStoredTaskStatus,
  updateStoredTask,
  deleteStoredTask,
  addMessageToConversation,
  addInternalNoteToConversation,
  updateConversationAssignee,
  saveStoredMember,
  updateStoredMemberRole,
  updateStoredMemberStatus,
  deleteStoredMember,
} from './storage'

export function useDemoStorage() {
  const [db, setDb] = useState<DemoDatabase>(() => getDemoDatabase())
  const [isLoaded, setIsLoaded] = useState(false)

  const syncState = useCallback(() => {
    setDb(getDemoDatabase())
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoaded(true)
    }, 0)

    if (typeof window === 'undefined') {
      return () => clearTimeout(timer)
    }

    // Intra-tab custom event listener
    const handleCustomChange = () => {
      syncState()
    }

    // Cross-tab storage event listener
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === DEMO_STORAGE_KEY) {
        syncState()
      }
    }

    window.addEventListener(DEMO_STORAGE_EVENT, handleCustomChange)
    window.addEventListener('storage', handleStorageChange)

    return () => {
      clearTimeout(timer)
      window.removeEventListener(DEMO_STORAGE_EVENT, handleCustomChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [syncState])

  return {
    db,
    isLoaded,
    contacts: db.contacts,
    tasks: db.tasks,
    conversations: db.conversations,
    members: db.members,
    resetDatabase: resetDemoDatabase,
    addContact: saveStoredContact,
    updateContact: updateStoredContact,
    deleteContact: deleteStoredContact,
    addTask: saveStoredTask,
    updateTaskStatus: updateStoredTaskStatus,
    updateTask: updateStoredTask,
    deleteTask: deleteStoredTask,
    addMessage: addMessageToConversation,
    addInternalNote: addInternalNoteToConversation,
    updateAssignee: updateConversationAssignee,
    addMember: saveStoredMember,
    updateMemberRole: updateStoredMemberRole,
    updateMemberStatus: updateStoredMemberStatus,
    deleteMember: deleteStoredMember,
  }
}
