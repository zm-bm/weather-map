import type { AppStatus } from './types'

export default function AppStatusHost({ status }: { status: AppStatus }) {
  if (!status) return null

  return (
    <div className={status.mode === 'blocking' ? 'forecast-screen__status-overlay' : 'app-status-toast'}>
      <div className="status-card" role={status.actionLabel ? 'alert' : 'status'} aria-live="polite">
        <h1 className="status-card__title">{status.title}</h1>
        <p className="status-card__detail">{status.detail}</p>
        {status.actionLabel && status.onAction && (
          <button className="status-card__action wm-bevel-button" type="button" onClick={status.onAction}>
            {status.actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
