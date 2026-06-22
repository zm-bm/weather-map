import {
  activeForecastRunForDataset,
  getActiveRunArtifact,
  getActiveRunLayerAvailability,
  isLayerAvailableForDataset,
  type ActiveForecastRun,
} from '@/forecast/manifest'
import { useLoadedForecastSelectionContext } from '@/forecast/selection'

export default function ForecastRunStatus() {
  const {
    activeRun,
    activeDatasetId,
    datasetOptions,
    selectedLayerId,
    setActiveDataset,
  } = useLoadedForecastSelectionContext()
  const manifest = activeRun.manifest
  const activeDatasetLabel = activeRun.label
  const resolutionLabel = selectedLayerResolutionLabel(activeRun, selectedLayerId)
  const availableSourceOptions = datasetOptions.flatMap((dataset) => {
    const datasetRun = activeForecastRunForDataset(manifest, dataset.id)
    if (datasetRun == null) return []
    if (
      selectedLayerId != null &&
      !isLayerAvailableForDataset(manifest, selectedLayerId, dataset.id)
    ) {
      return []
    }

    const optionResolutionLabel = selectedLayerResolutionLabel(datasetRun, selectedLayerId)

    return [{
      ...dataset,
      resolutionLabel: optionResolutionLabel,
    }]
  })
  const visibleSourceOptions = availableSourceOptions.length > 0
    ? availableSourceOptions
    : [{
        id: activeRun.datasetId,
        label: activeDatasetLabel,
        resolutionLabel,
      }]

  return (
    <section className="forecast-run-status">
      <div
        className="forecast-run-status__selector"
        role="radiogroup"
        aria-label="Forecast source"
      >
        {visibleSourceOptions.map((dataset) => (
          <label
            className="forecast-run-status__option wm-mono-caps"
            key={dataset.id}
          >
            <input
              className="forecast-run-status__option-input"
              type="radio"
              name="forecast-source"
              value={dataset.id}
              checked={activeDatasetId === dataset.id}
              aria-label={dataset.label}
              onChange={() => {
                if (dataset.id !== activeDatasetId) {
                  setActiveDataset(dataset.id)
                }
              }}
            />
            <span className="forecast-run-status__value" aria-hidden="true">
              {dataset.label}
            </span>
            <span className="forecast-run-status__detail" aria-hidden="true">
              {dataset.resolutionLabel}
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}

function selectedLayerResolutionLabel(
  activeRun: ActiveForecastRun,
  selectedLayerId: string | null
): string | null {
  const availability = getActiveRunLayerAvailability(activeRun, selectedLayerId)
  const artifactId = availability?.required_artifacts.find((candidate) => (
    getActiveRunArtifact(activeRun, candidate) != null
  ))
  if (artifactId == null) return null

  const artifact = getActiveRunArtifact(activeRun, artifactId)
  if (!artifact) return null

  const dx = Math.abs(artifact.grid.dx)
  const dy = Math.abs(artifact.grid.dy)
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx === 0 || dy === 0) return null

  return nearlyEqual(dx, dy)
    ? `${formatDegreeResolution(dx)} deg`
    : `${formatDegreeResolution(dx)} x ${formatDegreeResolution(dy)} deg`
}

function formatDegreeResolution(value: number): string {
  const precision = value >= 1 ? 1 : 3
  return value.toFixed(precision).replace(/(?:\\.0+|0+)$/, '')
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6
}
