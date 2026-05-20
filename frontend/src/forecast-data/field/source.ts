import type { ArtifactLoader } from '../../forecast-artifacts'
import type {
  LayerSource,
  LayerSpec,
} from '../../forecast-catalog'
import type {
  ScalarGridSpec,
} from '../../forecast-manifest'
import type {
  FieldEncodingSpec,
} from '../types'
import { loadDerivedFieldRecipe } from './recipes'

export type FieldSourceData = {
  hourToken: string
  grid: ScalarGridSpec
  encoding: FieldEncodingSpec
  values: Float32Array
}

export async function loadFieldSourceData(args: {
  artifacts: ArtifactLoader
  hourToken: string
  layer: LayerSpec
}): Promise<FieldSourceData> {
  const { artifacts, hourToken, layer } = args
  return loadSingleFieldSourceData({ artifacts, hourToken, source: layer.source })
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

  throw new Error(`Unsupported field source kind: ${(source as { kind?: string }).kind ?? 'unknown'}`)
}
