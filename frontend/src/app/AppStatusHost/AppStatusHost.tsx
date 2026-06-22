type AppLoadingStatus = {
  kind: 'loading'
  title: string
}

type AppErrorStatus = {
  kind: 'error'
  title: string
  detail: string
  hint?: string
  actionLabel?: string
  onAction?: () => void
}

export type AppStatus = AppLoadingStatus | AppErrorStatus | null

export default function AppStatusHost({ status }: { status: AppStatus }) {
  if (!status) return null
  if (status.kind === 'loading') {
    return (
      <div className="app-status-toast app-status-toast--loading">
        <div
          className="app-status-chip"
          role="status"
          aria-live="polite"
          aria-label={status.title}
        >
          <span className="app-status-chip__indicator" aria-hidden="true" />
          <span className="app-status-chip__title wm-display-caps">{status.title}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="forecast-screen__status-overlay forecast-screen__status-overlay--error">
      <div className="status-card status-card--error" role="alert" aria-live="assertive">
        <h1 className="status-card__title">{status.title}</h1>
        <p className="status-card__detail">{status.detail}</p>
        {status.hint ? (
          <p className="status-card__hint">{status.hint}</p>
        ) : null}
        {status.actionLabel && status.onAction && (
          <button className="status-card__action wm-bevel-button" type="button" onClick={status.onAction}>
            {status.actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
