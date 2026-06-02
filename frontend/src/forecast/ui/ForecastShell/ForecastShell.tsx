import { useLayoutEffect, useRef } from 'react'

import { ForecastSettingsProvider } from '@/forecast/settings'
import type { ForecastManifestData } from '@/forecast/manifest'
import {
  ForecastSelectionProvider,
  useForecastSelectionContext,
} from '@/forecast/selection'
import type { ForecastSyncInitialStatus } from '@/forecast/sync'
import { ForecastTimeProvider } from '@/forecast/time'
import TimelineBar from '../TimelineBar'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from '../LegendPanel'
import MapSyncIndicator from '../MapSyncIndicator'
import ForecastMap from '../ForecastMap/ForecastMap'

type ForecastShellProps = {
  forecast: ForecastManifestData | null
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
}

const MAP_CONTROL_PANEL_GAP_PX = 8

export default function ForecastShell({
  forecast,
  onInitialSyncStatusChange,
}: ForecastShellProps) {
  return (
    <main className="forecast-screen">
      <ForecastSettingsProvider>
        <ForecastSelectionProvider
          key={forecast?.manifest == null ? 'loading' : 'ready'}
          manifest={forecast?.manifest ?? null}
          datasetOptions={forecast?.datasetOptions ?? []}
        >
          <ForecastShellStage onInitialSyncStatusChange={onInitialSyncStatusChange} />
        </ForecastSelectionProvider>
      </ForecastSettingsProvider>
    </main>
  )
}

function ForecastShellStage({
  onInitialSyncStatusChange,
}: {
  onInitialSyncStatusChange?: (status: ForecastSyncInitialStatus | null) => void
}) {
  const forecastStageRef = useRef<HTMLDivElement | null>(null)
  const forecastPanelRef = useRef<HTMLElement | null>(null)
  const { activeRun } = useForecastSelectionContext()

  useLayoutEffect(() => {
    const stage = forecastStageRef.current
    const panel = forecastPanelRef.current

    if (stage == null) return
    if (activeRun == null || panel == null) {
      stage.style.removeProperty('--wm-map-control-rail-top')
      return
    }

    const updateMapControlOffset = () => {
      const stageRect = stage.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const panelBottom = Math.max(0, panelRect.bottom - stageRect.top)
      stage.style.setProperty(
        '--wm-map-control-rail-top',
        `${Math.ceil(panelBottom + MAP_CONTROL_PANEL_GAP_PX)}px`
      )
    }

    updateMapControlOffset()

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateMapControlOffset)
      : null
    resizeObserver?.observe(stage)
    resizeObserver?.observe(panel)
    window.addEventListener('resize', updateMapControlOffset)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMapControlOffset)
      stage.style.removeProperty('--wm-map-control-rail-top')
    }
  }, [activeRun])

  return (
    <ForecastTimeProvider activeRun={activeRun}>
      <div ref={forecastStageRef} className="forecast-stage">
        <ForecastMap onInitialSyncStatusChange={onInitialSyncStatusChange} />

        {activeRun && (
          <>
            <MapSyncIndicator />
            <ForecastPanel ref={forecastPanelRef} />
            <div className="forecast-stage__legend">
              <LegendPanel />
            </div>
          </>
        )}
      </div>

      {activeRun && (
        <TimelineBar />
      )}
    </ForecastTimeProvider>
  )
}
