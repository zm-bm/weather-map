import { forwardRef } from 'react'

import {
  formatCycleRunTimeLabel,
  formatValidTimeLabel,
  formatValidTimeTickLabel,
  useForecastTimeContext,
} from '../../forecast-time'
import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import {
  clearSpaceShortcutAllowed,
  markSpaceShortcutAllowed,
} from '../../keyboard'
import {
  isLayerAvailableForModel,
  hasAnyAvailableModelForLayer,
} from '../../forecast-manifest'
import {
  type LayerId,
} from '../../forecast-catalog'

function formatModelRunLabel(runTime: string): string {
  return runTime === '--' ? '--' : runTime
}

const ForecastPanel = forwardRef<HTMLElement>(function ForecastPanel(_props, ref) {
  const {
    activeRun,
    modelOptions,
    groups,
    layers,
    selectedLayerId,
    selectedLayerAvailability,
    selectedLayerIsRenderable,
    setActiveModel,
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
  const runLabel = formatModelRunLabel(runTime)
  const selectedValidTimeMs = pendingTimeMs ?? targetTimeMs
  const validTimeLabel = formatValidTimeTickLabel(selectedValidTimeMs) ?? '--'
  const validTimeTitle = formatValidTimeLabel(selectedValidTimeMs) ?? validTimeLabel
  const activeModelLabel = activeRun.label
  const selectedLayer = selectedLayerId == null ? null : layers[selectedLayerId]
  const showUnavailableMessage = selectedLayer != null && (
    selectedLayerAvailability?.state === 'temporarily_unavailable' ||
    selectedLayerAvailability?.state === 'unsupported' ||
    !selectedLayerIsRenderable
  )
  const unavailableMessage = selectedLayer == null
    ? null
    : selectedLayerAvailability?.state === 'unsupported'
      ? `${selectedLayer.label} is not available from ${activeModelLabel}.`
      : `${selectedLayer.label} is temporarily unavailable for this ${activeModelLabel} cycle.`

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
                onPointerDown={(event) => markSpaceShortcutAllowed(event.currentTarget)}
                onChange={(event) => {
                  setSelectedLayer(event.currentTarget.value as LayerId)
                  event.currentTarget.blur()
                }}
                onBlur={(event) => clearSpaceShortcutAllowed(event.currentTarget)}
              >
                {groups.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.layers.map((layerId) => {
                      const layer = layers[layerId]
                      const hasSource = hasAnyAvailableModelForLayer(manifest, layerId)
                      const label = layer?.label ?? String(layerId)

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
              aria-label={`Forecast source ${activeModelLabel}, forecast cycle ${runTime}`}
            >
              <label className="forecast-controls__source-field forecast-controls__source-field--model">
                <span className="forecast-controls__source-label">Source</span>
                <select
                  className="forecast-controls__quiet-select forecast-controls__model-select"
                  aria-label="Forecast source"
                  value={activeRun.modelId}
                  onPointerDown={(event) => markSpaceShortcutAllowed(event.currentTarget)}
                  onChange={(event) => {
                    setActiveModel(event.currentTarget.value)
                    event.currentTarget.blur()
                  }}
                  onBlur={(event) => clearSpaceShortcutAllowed(event.currentTarget)}
                >
                  {modelOptions.map((model) => {
                    const isUnavailableForSelectedLayer = selectedLayerId != null &&
                      !isLayerAvailableForModel(manifest, selectedLayerId, model.id)

                    return (
                      <option
                        key={model.id}
                        value={model.id}
                        disabled={isUnavailableForSelectedLayer}
                      >
                        {isUnavailableForSelectedLayer ? `${model.label} (unavailable)` : model.label}
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
