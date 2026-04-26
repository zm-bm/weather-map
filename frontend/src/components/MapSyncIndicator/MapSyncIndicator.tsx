import { useEffect, useState } from 'react'

import { useForecastTimeContext } from '../../forecast-time/ForecastTimeContext'

const MAP_SYNC_INDICATOR_DELAY_MS = 150

export default function MapSyncIndicator() {
  const {
    state: { isInFlight },
  } = useForecastTimeContext()

  if (!isInFlight) return null

  return <DelayedMapSyncIndicator />
}

function DelayedMapSyncIndicator() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setVisible(true)
    }, MAP_SYNC_INDICATOR_DELAY_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="map-sync-indicator wm-mono-caps" role="status" aria-live="polite">
      <span className="map-sync-indicator__spinner" aria-hidden="true" />
      <span>Updating map</span>
    </div>
  )
}
