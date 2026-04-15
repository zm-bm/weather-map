import { createContext, useContext } from 'react'

export type AppStatusMode = 'blocking' | 'toast'
export type AppStatusLevel = 'loading' | 'error' | 'info'

export type AppStatusPayload = {
  title: string
  detail: string
  actionLabel?: string
  onAction?: () => void
  mode: AppStatusMode
  level: AppStatusLevel
}

export type AppStatusEntry = AppStatusPayload & {
  sourceId: string
  updatedAtMs: number
}

export type AppStatusContextValue = {
  entries: AppStatusEntry[]
  setStatus: (sourceId: string, payload: AppStatusPayload) => void
  clearStatus: (sourceId: string) => void
}

export const AppStatusContext = createContext<AppStatusContextValue | null>(null)

function statusPriority(entry: AppStatusEntry): number {
  if (entry.mode === 'blocking' && entry.level === 'error') return 30
  if (entry.mode === 'blocking' && entry.level === 'loading') return 20
  if (entry.mode === 'blocking') return 10
  return 0
}

export function selectActiveStatus(entries: AppStatusEntry[]): AppStatusEntry | null {
  if (entries.length === 0) return null

  let activeStatus = entries[0]

  for (let idx = 1; idx < entries.length; idx += 1) {
    const entry = entries[idx]
    const entryPriority = statusPriority(entry)
    const activePriority = statusPriority(activeStatus)

    if (entryPriority > activePriority) {
      activeStatus = entry
      continue
    }

    if (entryPriority === activePriority && entry.updatedAtMs > activeStatus.updatedAtMs) {
      activeStatus = entry
    }
  }

  return activeStatus
}

export function useAppStatus(): AppStatusContextValue {
  const value = useContext(AppStatusContext)
  if (!value) {
    throw new Error('useAppStatus must be used within an AppStatusProvider')
  }
  return value
}
