import { forwardRef } from 'react'

import { formatCycleRunTimeLabel } from '../../forecast-time'
import { useLoadedForecastSelectionContext } from '../../forecast-selection'
import {
  type ForecastModelId,
  type ForecastModelOption,
} from '../../forecast-models'
import { getLayerMeta, type LayerGroupSpec, type LayerId } from '../../forecast-catalog'

type ForecastPanelProps = {
  activeModelId: ForecastModelId
  modelOptions: readonly ForecastModelOption[]
  onActiveModelChange: (modelId: ForecastModelId) => void
}

function getSelectedLayerGroup(
  groups: LayerGroupSpec[],
  selectedLayerId: LayerId | null
): LayerGroupSpec | null {
  if (selectedLayerId == null) return groups[0] ?? null
  return groups.find((group) => group.layers.includes(selectedLayerId))
    ?? groups[0]
}

function formatModelRunLabel(runTime: string): string {
  return runTime === '--' ? 'CYCLE --' : `CYCLE ${runTime.replace(',', '').toUpperCase()}`
}

const ForecastPanel = forwardRef<HTMLElement, ForecastPanelProps>(function ForecastPanel({
  activeModelId,
  modelOptions,
  onActiveModelChange,
}, ref) {
  const {
    manifest,
    groups,
    layers,
    selectedLayerId,
    setSelectedLayer,
  } = useLoadedForecastSelectionContext()
  const runTime = formatCycleRunTimeLabel(manifest.run.cycle) ?? '--'
  const runLabel = formatModelRunLabel(runTime)
  const selectedLayerGroup = getSelectedLayerGroup(groups, selectedLayerId)
  const activeModelLabel = manifest.model.label

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
            value={activeModelId}
            onChange={(event) => onActiveModelChange(event.currentTarget.value as ForecastModelId)}
          >
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
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
                  onClick={() => setSelectedLayer(group.defaultLayer)}
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
                const meta = getLayerMeta(layerId, layers, manifest)

                return (
                  <option key={layerId} value={layerId}>
                    {meta.label}
                  </option>
                )
              })}
            </select>
          </>
        ) : null}
      </div>
    </section>
  )
})

export default ForecastPanel
