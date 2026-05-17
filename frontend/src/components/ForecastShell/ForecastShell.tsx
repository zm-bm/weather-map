import { useLayoutEffect, useRef } from 'react'

import type {
  ForecastModelId,
  ForecastModelOption,
  ModelLayerAvailabilityIndex,
} from '../../forecast-availability'
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
  availabilityIndex: ModelLayerAvailabilityIndex | null
  activeModelId: ForecastModelId | null
  modelOptions: readonly ForecastModelOption[]
  onActiveModelChange: (modelId: ForecastModelId) => void
}

const DEBUG_BASEMAP_ONLY = false
const MAP_CONTROL_PANEL_GAP_PX = 8

export default function ForecastShell({
  manifest,
  availabilityIndex,
  activeModelId,
  modelOptions,
  onActiveModelChange,
}: ForecastShellProps) {
  const forecastStageRef = useRef<HTMLDivElement | null>(null)
  const forecastPanelRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const stage = forecastStageRef.current
    const panel = forecastPanelRef.current

    if (stage == null) return
    if (manifest == null || panel == null || DEBUG_BASEMAP_ONLY) {
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
  }, [manifest])

  // Remount forecast time state whenever the manifest timeline changes so initial index
  // is computed from the new manifest synchronously during mount.
  const forecastTimeProviderKey = manifest == null
    ? 'forecast-time:none'
    : `forecast-time:${manifest.run.cycle}:${manifest.times.map((time) => `${time.id}:${time.validAt}`).join(',')}`

  return (
    <main className="forecast-screen">
      <ForecastSelectionProvider
        manifest={manifest}
        availabilityIndex={availabilityIndex}
        activeModelId={activeModelId}
        onActiveModelChange={onActiveModelChange}
      >
        <ForecastTimeProvider key={forecastTimeProviderKey} manifest={manifest}>
          <div ref={forecastStageRef} className="forecast-stage">
            <ForecastMap />

            {manifest && activeModelId != null && !DEBUG_BASEMAP_ONLY && (
              <>
                <MapSyncIndicator />
                <ForecastPanel
                  ref={forecastPanelRef}
                  activeModelId={activeModelId}
                  modelOptions={modelOptions}
                  onActiveModelChange={onActiveModelChange}
                />
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
