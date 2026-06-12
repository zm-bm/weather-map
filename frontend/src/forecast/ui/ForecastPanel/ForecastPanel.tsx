import { forwardRef } from 'react'

import {
  formatCycleRunTimeLabel,
  formatValidTimeLabel,
  formatValidTimeTickLabel,
  useForecastTimeContext,
} from '@/forecast/time'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'
import {
  getActiveRunLayerAvailability,
  isLayerAvailableForDataset,
  hasAnyAvailableDatasetForLayer,
} from '@/forecast/manifest'
import {
  FORECAST_RASTER_LAYER_GROUPS,
  FORECAST_RASTER_LAYERS_BY_ID,
  forecastRasterLayerLabel,
  resolveRenderableRasterLayer,
} from '@/forecast/catalog'
import {
  clearPointerShortcut,
  markPointerShortcut,
} from '@/core/keyboard'

function formatDatasetRunLabel(runTime: string): string {
  return runTime === '--' ? '--' : runTime
}

const ForecastPanel = forwardRef<HTMLElement>(function ForecastPanel(_props, ref) {
  const {
    activeRun,
    activeDatasetId,
    datasetOptions,
    selectedLayerId,
    setActiveDataset,
    setSelectedLayer,
  } = useLoadedForecastSelectionContext()
  const {
    state: {
      pendingTimeMs,
      targetTimeMs,
    },
  } = useForecastTimeContext()
  const manifest = activeRun.manifest
  const runTime = formatCycleRunTimeLabel(activeRun.latest.run.cycle) ?? '--'
  const runLabel = formatDatasetRunLabel(runTime)
  const selectedValidTimeMs = pendingTimeMs ?? targetTimeMs
  const validTimeLabel = formatValidTimeTickLabel(selectedValidTimeMs) ?? '--'
  const validTimeTitle = formatValidTimeLabel(selectedValidTimeMs) ?? validTimeLabel
  const activeDatasetLabel = activeRun.label
  const groups = FORECAST_RASTER_LAYER_GROUPS
  const layers = FORECAST_RASTER_LAYERS_BY_ID
  const selectedLayer = selectedLayerId == null ? null : layers[selectedLayerId]
  const selectedLayerAvailability = getActiveRunLayerAvailability(activeRun, selectedLayerId)
  const selectedLayerIsRenderable = resolveRenderableRasterLayer(activeRun, selectedLayerId) != null
  const showUnavailableMessage = selectedLayer != null && (
    selectedLayerAvailability?.state === 'temporarily_unavailable' ||
    selectedLayerAvailability?.state === 'unsupported' ||
    !selectedLayerIsRenderable
  )
  const unavailableMessage = selectedLayer == null
    ? null
    : selectedLayerAvailability?.state === 'unsupported'
      ? `${forecastRasterLayerLabel(selectedLayer)} is not available from ${activeDatasetLabel}.`
      : `${forecastRasterLayerLabel(selectedLayer)} is temporarily unavailable for this ${activeDatasetLabel} cycle.`

  return (
    <section ref={ref} className="forecast-panel wm-panel-shell" aria-label="Local forecast panel">
      <div className="forecast-controls" aria-label="Forecast controls">
        {groups.length > 0 ? (
          <>
            <div className="forecast-controls__primary">
              <select
                className="forecast-controls__select forecast-controls__measurement-select"
                aria-label="Measurement"
                value={selectedLayerId ?? ''}
                onPointerDown={(event) => markPointerShortcut(event.currentTarget)}
                onBlur={(event) => clearPointerShortcut(event.currentTarget)}
                onChange={(event) => {
                  setSelectedLayer(event.currentTarget.value)
                  event.currentTarget.blur()
                }}
              >
                {groups.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.rasterLayerIds.map((layerId) => {
                      const layer = layers[layerId]
                      const hasSource = hasAnyAvailableDatasetForLayer(manifest, layerId)
                      const label = layer == null ? String(layerId) : forecastRasterLayerLabel(layer)

                      return (
                        <option key={layerId} value={layerId} disabled={!hasSource}>
                          {!hasSource ? `${label} (Unavailable)` : label}
                        </option>
                      )
                    })}
                  </optgroup>
                ))}
              </select>

              <div
                className="forecast-controls__valid-time"
                aria-label={`Forecast valid time ${validTimeTitle}`}
                title={`Forecast valid time ${validTimeTitle}`}
              >
                <span className="forecast-controls__valid-time-label">Valid</span>
                <span className="forecast-controls__valid-time-value">{validTimeLabel}</span>
              </div>
            </div>

            <div
              className="forecast-controls__source-row"
              aria-label={`Forecast source ${activeDatasetLabel}, forecast cycle ${runTime}`}
            >
              <label className="forecast-controls__source-field forecast-controls__source-field--dataset">
                <span className="forecast-controls__source-label">Source</span>
                <select
                  className="forecast-controls__quiet-select forecast-controls__dataset-select"
                  aria-label="Forecast source"
                  value={activeDatasetId}
                  onPointerDown={(event) => markPointerShortcut(event.currentTarget)}
                  onBlur={(event) => clearPointerShortcut(event.currentTarget)}
                  onChange={(event) => {
                    setActiveDataset(event.currentTarget.value)
                    event.currentTarget.blur()
                  }}
                >
                  {datasetOptions.map((dataset) => {
                    const isUnavailableForSelectedLayer = selectedLayerId != null &&
                      !isLayerAvailableForDataset(manifest, selectedLayerId, dataset.id)

                    return (
                      <option
                        key={dataset.id}
                        value={dataset.id}
                        disabled={isUnavailableForSelectedLayer}
                      >
                        {isUnavailableForSelectedLayer ? `${dataset.label} (unavailable)` : dataset.label}
                      </option>
                    )
                  })}
                </select>
              </label>

              <div
                className="forecast-controls__source-field forecast-controls__source-field--cycle"
                title={`Forecast cycle initialized ${runTime}`}
              >
                <span className="forecast-controls__source-label">Cycle</span>
                <span className="forecast-controls__source-value">{runLabel}</span>
              </div>
            </div>

            {showUnavailableMessage && unavailableMessage ? (
              <div className="forecast-controls__availability wm-mono-caps" role="status">
                {unavailableMessage}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
})

export default ForecastPanel
