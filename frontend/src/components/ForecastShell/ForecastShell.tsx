import { useLayoutEffect, useRef } from 'react'

import { ForecastSettingsProvider } from '../../forecast-settings'
import type { ForecastManifestData } from '../../forecast-manifest'
import { ForecastSelectionProvider } from '../../forecast-selection'
import { ForecastTimeProvider, forecastTimeProviderKey } from '../../forecast-time'
import TimelineBar from '../TimelineBar'
import ForecastPanel from '../ForecastPanel'
import LegendPanel from '../LegendPanel'
import MapSyncIndicator from '../MapSyncIndicator'
import ForecastMap from '../ForecastMap/ForecastMap'

type ForecastShellProps = {
  forecast: ForecastManifestData | null
}

const MAP_CONTROL_PANEL_GAP_PX = 8

export default function ForecastShell({ forecast }: ForecastShellProps) {
  const forecastStageRef = useRef<HTMLDivElement | null>(null)
  const forecastPanelRef = useRef<HTMLElement | null>(null)
  const activeRun = forecast?.activeRun ?? null

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
    <main className="forecast-screen">
      <ForecastSettingsProvider>
        <ForecastSelectionProvider
          activeRun={activeRun}
          modelOptions={forecast?.modelOptions ?? []}
          onActiveModelChange={forecast?.setActiveModel}
        >
          <ForecastTimeProvider key={forecastTimeProviderKey(activeRun)} activeRun={activeRun}>
            <div ref={forecastStageRef} className="forecast-stage">
              <ForecastMap />

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
        </ForecastSelectionProvider>
      </ForecastSettingsProvider>
    </main>
  )
}
