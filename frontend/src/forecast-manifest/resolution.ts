import type {
  ActiveForecastRun,
  ArtifactKind,
  ForecastModelId,
  ForecastModelOption,
  FramePayloadRef,
  LayerModelAvailability,
  Manifest,
  ManifestArtifactSpec,
  ScalarArtifactSpec,
  VectorArtifactSpec,
} from './schema'

const FIELD_DTYPE_SUFFIX = {
  int16: 'i16',
  int8: 'i8',
} satisfies Record<ManifestArtifactSpec['encoding']['dtype'], string>

type ArtifactSpecByKind = {
  scalar: ScalarArtifactSpec
  vector: VectorArtifactSpec
}

export function modelOptionsFromManifest(
  manifest: Manifest | null
): ForecastModelOption[] {
  if (!manifest) return []

  return Object.entries(manifest.models).map(([id, model]) => ({
    id,
    label: model.label,
  }))
}

export function activeForecastRunForModel(
  manifest: Manifest | null,
  modelId: ForecastModelId | null
): ActiveForecastRun | null {
  if (!manifest || modelId == null) return null
  const model = manifest.models[modelId]
  if (!model?.latest) return null
  return {
    manifest,
    modelId,
    label: model.label,
    latest: model.latest,
  }
}

export function resolveActiveForecastRun(
  manifest: Manifest | null,
  preferredModelId: ForecastModelId | null = null
): ActiveForecastRun | null {
  const preferred = activeForecastRunForModel(manifest, preferredModelId)
  if (preferred) return preferred
  if (!manifest) return null

  for (const modelId of Object.keys(manifest.models)) {
    const activeRun = activeForecastRunForModel(manifest, modelId)
    if (activeRun) return activeRun
  }

  return null
}

export function forecastRunScopeKey(activeRun: ActiveForecastRun): string {
  return `${activeRun.modelId}:${activeRun.latest.run.cycle}:${activeRun.latest.run.revision}`
}

export function getLayerModelAvailability(
  manifest: Manifest | null,
  layerId: string | null,
  modelId: ForecastModelId | null
): LayerModelAvailability | null {
  if (!manifest || layerId == null || modelId == null) return null
  return manifest.layers[layerId]?.models[modelId] ?? null
}

export function getActiveRunLayerAvailability(
  activeRun: ActiveForecastRun | null,
  layerId: string | null
): LayerModelAvailability | null {
  if (!activeRun) return null
  return getLayerModelAvailability(activeRun.manifest, layerId, activeRun.modelId)
}

export function isLayerAvailableForModel(
  manifest: Manifest | null,
  layerId: string | null,
  modelId: ForecastModelId | null
): boolean {
  return getLayerModelAvailability(manifest, layerId, modelId)?.state === 'available'
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
  const preferredModelId = preferredRun?.modelId ?? null
  if (!manifest || layerId == null) return preferredRun
  const modelId = preferredModelId && isLayerAvailableForModel(manifest, layerId, preferredModelId)
    ? preferredModelId
    : Object.keys(manifest.models)
      .find((candidateModelId) => isLayerAvailableForModel(manifest, layerId, candidateModelId)) ?? null

  return activeForecastRunForModel(manifest, modelId)
}

export function hasAnyAvailableModelForLayer(
  manifest: Manifest | null,
  layerId: string | null
): boolean {
  return Object.keys(manifest?.models ?? {})
    .some((modelId) => isLayerAvailableForModel(manifest, layerId, modelId))
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
    throw new Error(`No ${kind} artifact metadata for model=${activeRun.modelId} artifact=${artifactId}`)
  }
  if (artifact.kind !== kind) {
    throw new Error(`Artifact ${artifactId} is not ${kind} (got ${artifact.kind})`)
  }
  return artifact as ArtifactSpecByKind[D]
}

export function resolveActiveRunFrameRef(args: {
  activeRun: ActiveForecastRun
  artifactId: string
  hourToken: string
  kind: ArtifactKind
}): FramePayloadRef {
  const artifact = resolveActiveRunArtifact(
    args.activeRun,
    args.artifactId,
    args.kind
  )
  const time = args.activeRun.latest.times.find((entry) => entry.id === args.hourToken)
  if (!time) {
    throw new Error(`No ${args.kind} frame ref for model=${args.activeRun.modelId} artifact=${args.artifactId} hour=${args.hourToken}`)
  }

  return {
    path: inferFramePayloadPath({
      artifact,
      artifactId: args.artifactId,
      cycle: args.activeRun.latest.run.cycle,
      modelId: args.activeRun.modelId,
      timeId: time.id,
    }),
    byteLength: artifact.byteLength,
  }
}

function inferFramePayloadPath(args: {
  artifact: { encoding: { dtype: ManifestArtifactSpec['encoding']['dtype'] } }
  artifactId: string
  cycle: string
  modelId: string
  timeId: string
}): string {
  return [
    'fields',
    args.modelId,
    args.cycle,
    args.timeId,
    `${args.artifactId}.field.${FIELD_DTYPE_SUFFIX[args.artifact.encoding.dtype]}.bin`,
  ].join('/')
}
