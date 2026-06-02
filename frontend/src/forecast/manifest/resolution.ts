import type {
  ActiveForecastRun,
  ArtifactKind,
  ForecastDatasetId,
  ForecastDatasetOption,
  LayerDatasetAvailability,
  Manifest,
  ManifestArtifactSpec,
  ScalarArtifactSpec,
  VectorArtifactSpec,
} from './schema'

type ArtifactSpecByKind = {
  scalar: ScalarArtifactSpec
  vector: VectorArtifactSpec
}

export function datasetOptionsFromManifest(
  manifest: Manifest | null
): ForecastDatasetOption[] {
  if (!manifest) return []

  return Object.entries(manifest.datasets).map(([id, dataset]) => ({
    id,
    label: dataset.label,
  }))
}

export function activeForecastRunForDataset(
  manifest: Manifest | null,
  datasetId: ForecastDatasetId | null
): ActiveForecastRun | null {
  if (!manifest || datasetId == null) return null
  const dataset = manifest.datasets[datasetId]
  if (!dataset?.latest) return null
  return {
    manifest,
    datasetId,
    label: dataset.label,
    latest: dataset.latest,
  }
}

export function resolveActiveForecastRun(
  manifest: Manifest | null,
  preferredDatasetId: ForecastDatasetId | null = null
): ActiveForecastRun | null {
  const preferred = activeForecastRunForDataset(manifest, preferredDatasetId)
  if (preferred) return preferred
  if (!manifest) return null

  for (const datasetId of Object.keys(manifest.datasets)) {
    const activeRun = activeForecastRunForDataset(manifest, datasetId)
    if (activeRun) return activeRun
  }

  return null
}

export function forecastRunScopeKey(activeRun: ActiveForecastRun): string {
  const { cycle, revision, run_id } = activeRun.latest.run
  return `${activeRun.datasetId}:${cycle}:${run_id}:${revision}`
}

export function normalizeFrameId(value: string): string {
  return value.trim().padStart(3, '0')
}

export function getLayerDatasetAvailability(
  manifest: Manifest | null,
  layerId: string | null,
  datasetId: ForecastDatasetId | null
): LayerDatasetAvailability | null {
  if (!manifest || layerId == null || datasetId == null) return null
  return manifest.layers[layerId]?.datasets[datasetId] ?? null
}

export function getActiveRunLayerAvailability(
  activeRun: ActiveForecastRun | null,
  layerId: string | null
): LayerDatasetAvailability | null {
  if (!activeRun) return null
  return getLayerDatasetAvailability(activeRun.manifest, layerId, activeRun.datasetId)
}

export function isLayerAvailableForDataset(
  manifest: Manifest | null,
  layerId: string | null,
  datasetId: ForecastDatasetId | null
): boolean {
  return getLayerDatasetAvailability(manifest, layerId, datasetId)?.state === 'available'
}

export function isLayerAvailableForActiveRun(
  activeRun: ActiveForecastRun | null,
  layerId: string | null
): boolean {
  return getActiveRunLayerAvailability(activeRun, layerId)?.state === 'available'
}

export function resolveCompatibleActiveForecastRun(
  preferredRun: ActiveForecastRun | null,
  layerId: string | null
): ActiveForecastRun | null {
  const manifest = preferredRun?.manifest ?? null
  const preferredDatasetId = preferredRun?.datasetId ?? null
  if (!manifest || layerId == null) return preferredRun
  const datasetId = preferredDatasetId && isLayerAvailableForDataset(manifest, layerId, preferredDatasetId)
    ? preferredDatasetId
    : Object.keys(manifest.datasets)
      .find((candidateDatasetId) => isLayerAvailableForDataset(manifest, layerId, candidateDatasetId)) ?? null

  return activeForecastRunForDataset(manifest, datasetId)
}

export function hasAnyAvailableDatasetForLayer(
  manifest: Manifest | null,
  layerId: string | null
): boolean {
  return Object.keys(manifest?.datasets ?? {})
    .some((datasetId) => isLayerAvailableForDataset(manifest, layerId, datasetId))
}

export function getActiveRunArtifact(
  activeRun: ActiveForecastRun,
  artifactId: string
): ManifestArtifactSpec | null {
  return activeRun.latest.artifacts[artifactId] ?? null
}

export function hasActiveRunArtifact(
  activeRun: ActiveForecastRun,
  artifactId: string
): boolean {
  return getActiveRunArtifact(activeRun, artifactId) != null
}

export function resolveActiveRunArtifact<D extends ArtifactKind>(
  activeRun: ActiveForecastRun,
  artifactId: string,
  kind: D
): ArtifactSpecByKind[D] {
  const artifact = getActiveRunArtifact(activeRun, artifactId)
  if (!artifact) {
    throw new Error(`No ${kind} artifact metadata for dataset_id=${activeRun.datasetId} artifact=${artifactId}`)
  }
  if (artifact.kind !== kind) {
    throw new Error(`Artifact ${artifactId} is not ${kind} (got ${artifact.kind})`)
  }
  return artifact as ArtifactSpecByKind[D]
}
