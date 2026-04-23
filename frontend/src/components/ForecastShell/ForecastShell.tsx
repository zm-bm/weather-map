import type { CycleManifest } from '../../manifest'
import ForecastSelectionProvider from '../../forecast-selection/ForecastSelectionProvider'
import { ForecastTimeProvider } from '../../forecast-time'
import MapProbeProvider from '../../map-probe/MapProbeProvider'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from '../LegendPanel'
import ProductPanel from '../ProductPanel'
import TimelinePanel from '../TimelinePanel'
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
  const mapProbeProviderKey = manifest == null
    ? 'probe:none'
    : `probe:${manifest.cycle}`

  return (
    <main className="forecast-screen">
      <ForecastSelectionProvider manifest={manifest}>
        <MapProbeProvider key={mapProbeProviderKey}>
          <ForecastTimeProvider key={forecastTimeProviderKey} manifest={manifest}>
            <div className="forecast-stage">
              <ForecastMap />

              {manifest && !DEBUG_BASEMAP_ONLY && (
                <>
                  <ForecastPanel />
                  <div className="forecast-stage__legend">
                    <LegendPanel />
                  </div>
                </>
              )}
            </div>

            {manifest && !DEBUG_BASEMAP_ONLY && (
              <div className="lower-third wm-docked-band-shell" aria-label="Forecast details">
                <ProductPanel />
                <div className="lower-third__divider" aria-hidden="true" />
                <TimelinePanel />
              </div>
            )}
          </ForecastTimeProvider>
        </MapProbeProvider>
      </ForecastSelectionProvider>
    </main>
  )
}
