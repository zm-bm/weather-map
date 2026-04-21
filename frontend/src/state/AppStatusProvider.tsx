import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
  AppStatusActionsContext,
  AppStatusEntriesContext,
  type AppStatusActions,
  type AppStatusEntry,
  type AppStatusPayload,
} from './appStatus'

type AppStatusMap = Record<string, AppStatusEntry>

export default function AppStatusProvider({ children }: { children: ReactNode }) {
  const [statusBySource, setStatusBySource] = useState<AppStatusMap>({})

  const setStatus = useCallback((sourceId: string, payload: AppStatusPayload) => {
    setStatusBySource((prev) => {
      const existing = prev[sourceId]
      if (
        existing &&
        existing.mode === payload.mode &&
        existing.level === payload.level &&
        existing.title === payload.title &&
        existing.detail === payload.detail &&
        existing.actionLabel === payload.actionLabel &&
        existing.onAction === payload.onAction
      ) {
        return prev
      }

      return {
        ...prev,
        [sourceId]: {
          sourceId,
          updatedAtMs: Date.now(),
          ...payload,
        },
      }
    })
  }, [])

  const clearStatus = useCallback((sourceId: string) => {
    setStatusBySource((prev) => {
      if (!(sourceId in prev)) return prev
      const next = { ...prev }
      delete next[sourceId]
      return next
    })
  }, [])

  const entries = useMemo(() => Object.values(statusBySource), [statusBySource])
  const actions = useMemo<AppStatusActions>(() => ({
    setStatus,
    clearStatus,
  }), [clearStatus, setStatus])

  return (
    <AppStatusActionsContext.Provider value={actions}>
      <AppStatusEntriesContext.Provider value={entries}>
        {children}
      </AppStatusEntriesContext.Provider>
    </AppStatusActionsContext.Provider>
  )
}
