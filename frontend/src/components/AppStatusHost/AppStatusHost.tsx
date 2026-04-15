import { selectActiveStatus, useAppStatus } from '../../state/appStatus'

export default function AppStatusHost() {
  const { entries } = useAppStatus()
  const activeStatus = selectActiveStatus(entries)

  if (!activeStatus) return null

  return (
    <div className={activeStatus.mode === 'blocking' ? 'forecast-screen__status-overlay' : 'app-status-toast'}>
      <div className="status-card" role={activeStatus.actionLabel ? 'alert' : 'status'} aria-live="polite">
        <h1 className="status-card__title">{activeStatus.title}</h1>
        <p className="status-card__detail">{activeStatus.detail}</p>
        {activeStatus.actionLabel && activeStatus.onAction && (
          <button className="status-card__action wm-bevel-button" type="button" onClick={activeStatus.onAction}>
            {activeStatus.actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
