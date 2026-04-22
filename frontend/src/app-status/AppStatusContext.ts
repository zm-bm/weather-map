import { createContext, useContext } from 'react'

import type { AppStatusEntry, AppStatusPayload } from './state'

export type AppStatusActions = {
  setStatus: (sourceId: string, payload: AppStatusPayload) => void
  clearStatus: (sourceId: string) => void
}

export type AppStatusContextValue = AppStatusActions & {
  entries: AppStatusEntry[]
}

export const AppStatusEntriesContext = createContext<AppStatusEntry[] | null>(null)
export const AppStatusActionsContext = createContext<AppStatusActions | null>(null)

export function useAppStatus(): AppStatusContextValue {
  const entries = useAppStatusEntries()
  const actions = useAppStatusActions()

  return {
    entries,
    ...actions,
  }
}

export function useAppStatusEntries(): AppStatusEntry[] {
  const value = useContext(AppStatusEntriesContext)
  if (!value) {
    throw new Error('useAppStatusEntries must be used within an AppStatusProvider')
  }
  return value
}

export function useAppStatusActions(): AppStatusActions {
  const value = useContext(AppStatusActionsContext)
  if (!value) {
    throw new Error('useAppStatusActions must be used within an AppStatusProvider')
  }
  return value
}
