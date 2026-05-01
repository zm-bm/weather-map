import type { CycleManifest } from '../../manifest'
import { ForecastSelectionProvider } from '../../forecast-selection'
import { ForecastTimeProvider } from '../../forecast-time'
import TimelineBar from '../TimelineBar'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from '../LegendPanel'
import MapSyncIndicator from '../MapSyncIndicator'
import ForecastMap from '../ForecastMap/ForecastMap'

type ForecastShellProps = {
  manifest: CycleManifest | null
}

const DEBUG_BASEMAP_ONLY = false

export default function ForecastShell({
  manifest,
}: ForecastShellProps) {
  // Remount forecast time state whenever cycle/hour list changes so initial index
  // is computed from the new manifest synchronously during mount.
  const forecastTimeProviderKey = manifest == null
    ? 'forecast-time:none'
    : `forecast-time:${manifest.cycle}:${manifest.forecastHours.join(',')}`

  return (
    <main className="forecast-screen">
      <ForecastSelectionProvider manifest={manifest}>
        <ForecastTimeProvider key={forecastTimeProviderKey} manifest={manifest}>
          <div className="forecast-stage">
            <ForecastMap />

            {manifest && !DEBUG_BASEMAP_ONLY && (
              <>
                <MapSyncIndicator />
                <ForecastPanel />
                <div className="forecast-stage__legend">
                  <LegendPanel />
                </div>
              </>
            )}
          </div>

          {manifest && !DEBUG_BASEMAP_ONLY && (
            <TimelineBar />
          )}
        </ForecastTimeProvider>
      </ForecastSelectionProvider>
    </main>
  )
}
