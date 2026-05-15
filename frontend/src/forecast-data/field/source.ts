import type { ArtifactLoader } from '../../forecast-artifacts'
import type {
  CompositeLayerOverlaySource,
  LayerSource,
  LayerSpec,
} from '../../forecast-catalog'
import type {
  CycleManifest,
  ScalarGridSpec,
} from '../../manifest'
import { isAbortError } from '../../abort'
import type {
  FieldEncodingSpec,
  FieldOverlayData,
} from '../types'
import { loadDerivedFieldRecipe } from './recipes'

export type FieldSourceData = {
  hourToken: string
  grid: ScalarGridSpec
  encoding: FieldEncodingSpec
  values: Float32Array
  overlays?: readonly FieldOverlayData[]
}

export async function loadFieldSourceData(args: {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  hourToken: string
  layer: LayerSpec
}): Promise<FieldSourceData> {
  const { artifacts, manifest, hourToken, layer } = args
  if (layer.source.kind !== 'composite') {
    return loadSingleFieldSourceData({ artifacts, hourToken, source: layer.source })
  }

  const base = await loadSingleFieldSourceData({
    artifacts,
    hourToken,
    source: layer.source.base,
  })
  const overlays = await loadCompositeOverlays({
    artifacts,
    manifest,
    hourToken,
    overlays: layer.source.overlays,
  })

  return {
    ...base,
    overlays,
  }
}

async function loadSingleFieldSourceData(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: LayerSource
}): Promise<FieldSourceData> {
  const { artifacts, hourToken, source } = args
  if (source.kind === 'artifact') {
    return artifacts.loadScalar(source.artifactId, hourToken)
  }

  if (source.kind === 'derived') {
    return loadDerivedFieldRecipe({
      artifacts,
      hourToken,
      source,
    })
  }

  throw new Error(`Nested composite field sources are not supported`)
}

async function loadCompositeOverlays(args: {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  hourToken: string
  overlays: readonly CompositeLayerOverlaySource[]
}): Promise<FieldOverlayData[]> {
  const loaded = await Promise.all(
    args.overlays.map((overlay) => loadCompositeOverlay({
      artifacts: args.artifacts,
      manifest: args.manifest,
      hourToken: args.hourToken,
      overlay,
    }))
  )
  return loaded.filter((overlay): overlay is FieldOverlayData => overlay != null)
}

async function loadCompositeOverlay(args: {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  hourToken: string
  overlay: CompositeLayerOverlaySource
}): Promise<FieldOverlayData | null> {
  if (!args.manifest.artifacts[args.overlay.source.artifactId]) {
    if (args.overlay.optional) return null
    throw new Error(`Missing required overlay artifact ${args.overlay.source.artifactId}`)
  }

  try {
    const artifact = await args.artifacts.loadScalar(args.overlay.source.artifactId, args.hourToken)
    return {
      id: args.overlay.id,
      artifactId: artifact.artifactId,
      hourToken: artifact.hourToken,
      grid: artifact.grid,
      encoding: artifact.encoding,
      values: artifact.values,
    }
  } catch (error) {
    if (isAbortError(error)) throw error
    if (!args.overlay.optional) throw error
    return null
  }
}
