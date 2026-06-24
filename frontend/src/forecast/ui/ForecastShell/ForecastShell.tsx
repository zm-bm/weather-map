import { useState } from 'react'

import { ForecastSettingsProvider } from '@/forecast/settings'
import type { ForecastManifestData } from '@/forecast/manifest'
import {
  ForecastSelectionProvider,
  useForecastSelectionContext,
} from '@/forecast/selection'
import type { ForecastSyncInitialStatus } from '@/forecast/sync'
import { ForecastTimeProvider } from '@/forecast/time'
import TimelineBar from '../TimelineBar'
import LegendPanel from '../LegendPanel'
import ForecastMapReadout from '../ForecastMapReadout'
import ForecastPlaceProbes from '../ForecastPlaceProbes'
import ForecastSourceSelector from '../ForecastSourceSelector'
import MapControlRail, { type MapControlRailPanel } from '../MapControlRail'
import WeatherCategoryBar from '../WeatherCategoryBar'
import type { MapPoint } from '../mapPoint'
import { useForecastMapRuntime } from './useForecastMapRuntime'

type ForecastPanel = 'weather-maps' | MapControlRailPanel

type ForecastShellProps = {
  forecast: ForecastManifestData | null
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
  onFieldLoadingChange?: (isLoading: boolean) => void
}

export default function ForecastShell({
  forecast,
  onInitialSyncStatusChange,
  onFieldLoadingChange,
}: ForecastShellProps) {
  return (
    <main className="forecast-screen">
      <ForecastSettingsProvider>
        <ForecastSelectionProvider
          key={forecast?.manifest == null ? 'loading' : 'ready'}
          manifest={forecast?.manifest ?? null}
          datasetOptions={forecast?.datasetOptions ?? []}
        >
          <StageScope
            onInitialSyncStatusChange={onInitialSyncStatusChange}
            onFieldLoadingChange={onFieldLoadingChange}
          />
        </ForecastSelectionProvider>
      </ForecastSettingsProvider>
    </main>
  )
}

function StageScope({
  onInitialSyncStatusChange,
  onFieldLoadingChange,
}: {
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
  onFieldLoadingChange?: (isLoading: boolean) => void
}) {
  const { activeRun } = useForecastSelectionContext()

  return (
    <ForecastTimeProvider activeRun={activeRun}>
      <ForecastStage
        onInitialSyncStatusChange={onInitialSyncStatusChange}
        onFieldLoadingChange={onFieldLoadingChange}
      />
    </ForecastTimeProvider>
  )
}

function ForecastStage({
  onInitialSyncStatusChange,
  onFieldLoadingChange,
}: {
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
  onFieldLoadingChange?: (isLoading: boolean) => void
}) {
  const { activeRun } = useForecastSelectionContext()
  const {
    map,
    probeFrameChannel,
  } = useForecastMapRuntime({
    onInitialSyncStatusChange,
    onFieldLoadingChange,
  })
  const hasRun = activeRun != null
  const [activePanel, setActivePanel] = useState<ForecastPanel | null>(null)
  const [point, setSelectedPoint] = useState<MapPoint | null>(null)
  const weatherMapsOpen = activePanel === 'weather-maps'
  const railPanel = activePanel === 'weather-maps' ? null : activePanel
  const suppressReadout = activePanel != null

  const setWeatherMapsOpen = (isOpen: boolean) => {
    setActivePanel((panel) => (isOpen ? 'weather-maps' : panel === 'weather-maps' ? null : panel))
    if (isOpen) setSelectedPoint(null)
  }

  const setRailPanel = (panel: MapControlRailPanel | null) => {
    setActivePanel(panel)
    if (panel != null) setSelectedPoint(null)
  }

  const setPoint = ({ lon, lat }: MapPoint) => {
    setActivePanel(null)
    setSelectedPoint({ lon, lat })
  }

  return (
    <div className="forecast-stage">
      <div className="map-stage">
        <div id="map" className="map-stage__viewport" />
        <ForecastPlaceProbes
          map={map}
          probeFrameChannel={probeFrameChannel}
        />
      </div>

      <div className="forecast-stage__chrome">
        {hasRun && (
          <>
            <div className="forecast-stage__top-left">
              <div className="forecast-stage__primary wm-panel-shell">
                <WeatherCategoryBar
                  isOpen={weatherMapsOpen}
                  onOpenChange={setWeatherMapsOpen}
                />
              </div>
              <div className="forecast-stage__source wm-panel-shell">
                <ForecastSourceSelector />
              </div>
            </div>
            <div className="forecast-stage__legend">
              <LegendPanel />
            </div>
            <div className="forecast-stage__timeline">
              <TimelineBar />
            </div>
          </>
        )}
        <div className="forecast-stage__right-rail">
          <MapControlRail
            map={map}
            onMapPointSelect={setPoint}
            activePanel={railPanel}
            onActivePanelChange={setRailPanel}
          />
        </div>
        <ForecastMapReadout
          map={map}
          probeFrameChannel={probeFrameChannel}
          point={point}
          onPoint={setPoint}
          onClose={() => setSelectedPoint(null)}
          suppressed={suppressReadout}
        />
      </div>
    </div>
  )
}
