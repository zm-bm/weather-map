import type { ArtifactLoader } from '../../forecast-artifacts'
import type { LayerSpec } from '../../forecast-catalog'
import type { ScalarGridSpec } from '../../manifest'
import type { FieldFrameEncodingSpec } from '../types'
import { loadDerivedFieldRecipe } from './recipes'

export type FieldSourceData = {
  hourToken: string
  grid: ScalarGridSpec
  encoding: FieldFrameEncodingSpec
  values: Float32Array
}

export async function loadFieldSourceData(args: {
  artifacts: ArtifactLoader
  hourToken: string
  layer: LayerSpec
}): Promise<FieldSourceData> {
  const { artifacts, hourToken, layer } = args
  if (layer.source.kind === 'artifact') {
    return artifacts.loadScalar(layer.source.artifactId, hourToken)
  }

  if (layer.source.kind === 'derived') {
    return loadDerivedFieldRecipe({
      artifacts,
      hourToken,
      source: layer.source,
    })
  }

  throw new Error(`Unsupported layer source for ${layer.id}: ${layer.source.kind}`)
}
