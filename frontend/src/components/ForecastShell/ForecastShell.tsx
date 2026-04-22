import type { CycleManifest } from '../../map/manifest'
import ForecastStateProvider from '../../state/ForecastStateProvider'
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
  return (
    <main className="forecast-screen">
      <ForecastStateProvider manifest={manifest}>
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
      </ForecastStateProvider>
    </main>
  )
}
