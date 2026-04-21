import type { CycleManifest } from '../../map/manifest'
import ForecastStateProvider from '../../state/ForecastStateProvider'
import LayerControls from '../LayerControls'
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
        <ForecastMap />

        {manifest && !DEBUG_BASEMAP_ONLY && (
          <>
            <LayerControls />
            <div className="lower-third" aria-label="Forecast details">
              <div className="lower-third__stack">
                <LegendPanel />
              </div>
              <TimelineTransport />
            </div>
          </>
        )}
      </ForecastStateProvider>
    </main>
  )
}
