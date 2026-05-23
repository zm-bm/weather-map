import type { ArtifactLoader } from '../../forecast-artifacts'
import type {
  ScalarGridSpec,
} from '../../forecast-manifest'
import type { ForecastFieldDataSource } from '../../forecast-data-targets'
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
  source: ForecastFieldDataSource
}): Promise<FieldSourceData> {
  const { artifacts, hourToken, source } = args
  return loadSingleFieldSourceData({ artifacts, hourToken, source })
}

export function canLoadFieldSource(args: {
  artifacts: ArtifactLoader
  source: ForecastFieldDataSource
}): boolean {
  const { artifacts, source } = args
  if (source.kind === 'scalar') return artifacts.canLoadScalar(source.artifactId)
  return artifacts.canLoadVector(source.artifactId)
}

async function loadSingleFieldSourceData(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: ForecastFieldDataSource
}): Promise<FieldSourceData> {
  const { artifacts, hourToken, source } = args
  if (source.kind === 'scalar') {
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
