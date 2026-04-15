import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { AppStatusContext, type AppStatusContextValue, type AppStatusEntry, type AppStatusPayload } from './appStatus'

type AppStatusMap = Record<string, AppStatusEntry>

export default function AppStatusProvider({ children }: { children: ReactNode }) {
  const [statusBySource, setStatusBySource] = useState<AppStatusMap>({})

  const setStatus = useCallback((sourceId: string, payload: AppStatusPayload) => {
    setStatusBySource((prev) => ({
      ...prev,
      [sourceId]: {
        sourceId,
        updatedAtMs: Date.now(),
        ...payload,
      },
    }))
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

  const value = useMemo<AppStatusContextValue>(() => ({
    entries,
    setStatus,
    clearStatus,
  }), [clearStatus, entries, setStatus])

  return (
    <AppStatusContext.Provider value={value}>
      {children}
    </AppStatusContext.Provider>
  )
}
