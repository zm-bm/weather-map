import { forwardRef } from 'react'

import { formatCycleRunTimeLabel } from '../../forecast-time'
import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import {
  isLayerAvailableForModel,
  hasAnyAvailableModelForLayer,
} from '../../forecast-manifest'
import {
  type LayerGroupSpec,
  type LayerId,
} from '../../forecast-catalog'

function getSelectedLayerGroup(
  groups: readonly LayerGroupSpec[],
  selectedLayerId: LayerId | null
): LayerGroupSpec | null {
  if (selectedLayerId == null) return groups[0] ?? null
  return groups.find((group) => group.layers.includes(selectedLayerId))
    ?? groups[0]
}

function formatModelRunLabel(runTime: string): string {
  return runTime === '--' ? 'CYCLE --' : `CYCLE ${runTime.replace(',', '').toUpperCase()}`
}

const ForecastPanel = forwardRef<HTMLElement>(function ForecastPanel(_props, ref) {
  const {
    activeRun,
    modelOptions,
    groups,
    layers,
    selectedLayerId,
    selectedLayerGroupId,
    selectedLayerAvailability,
    selectedLayerIsRenderable,
    setActiveModel,
    setSelectedLayer,
    setSelectedLayerGroup,
  } = useLoadedForecastSelectionContext()
  const manifest = activeRun.manifest
  const runTime = formatCycleRunTimeLabel(activeRun.latest.run.cycle) ?? '--'
  const runLabel = formatModelRunLabel(runTime)
  const selectedLayerGroup = groups.find((group) => group.id === selectedLayerGroupId) ??
    getSelectedLayerGroup(groups, selectedLayerId)
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
        <div
          className="forecast-controls__meta wm-mono-caps"
          aria-label={`Forecast model ${activeModelLabel}, forecast cycle initialized ${runTime}`}
          title={`Forecast cycle initialized ${runTime}`}
        >
          <select
            className="forecast-controls__quiet-select forecast-controls__model-select"
            aria-label="Forecast model"
            value={activeRun.modelId}
            onChange={(event) => setActiveModel(event.currentTarget.value)}
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
          <span className="forecast-controls__run">{runLabel}</span>
        </div>

        {selectedLayerGroup ? (
          <>
            <div
              className={
                groups.length === 1
                  ? 'forecast-controls__category-tabs forecast-controls__category-tabs--single'
                  : 'forecast-controls__category-tabs'
              }
              aria-label="Category"
            >
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="forecast-controls__category-tab wm-mono-caps"
                  aria-label={group.label}
                  aria-pressed={group.id === selectedLayerGroup.id}
                  title={group.label}
                  onClick={() => setSelectedLayerGroup(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            <select
              className="forecast-controls__select forecast-controls__measurement-select"
              aria-label="Measurement"
              value={selectedLayerId ?? ''}
              onChange={(event) => setSelectedLayer(event.currentTarget.value as LayerId)}
            >
              {selectedLayerGroup.layers.map((layerId) => {
                const layer = layers[layerId]
                const hasSource = hasAnyAvailableModelForLayer(manifest, layerId)
                const label = layer?.label ?? String(layerId)

                return (
                  <option key={layerId} value={layerId} disabled={!hasSource}>
                    {!hasSource ? `${label} (Unavailable)` : label}
                  </option>
                )
              })}
            </select>

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
