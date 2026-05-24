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

export type AppStatus = AppStatusPayload | null
