import type { CycleManifest } from '../../map/manifest'
import ForecastStateProvider from '../../state/ForecastStateProvider'
import LayerDeck from '../LayerDeck'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from '../LegendPanel'
import TimelineTransport from '../TimelineTransport'
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
          <div className="lower-third" aria-label="Forecast details">
            <LayerDeck />
            <TimelineTransport />
          </div>
        )}
      </ForecastStateProvider>
    </main>
  )
}
