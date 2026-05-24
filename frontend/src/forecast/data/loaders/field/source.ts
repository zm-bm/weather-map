import type { ArtifactLoader } from '@/forecast/artifacts'
import type {
  ScalarGridSpec,
  ActiveForecastRun,
} from '@/forecast/manifest'
import type { FieldSource } from '../../target'
import type {
  FieldEncodingSpec,
} from '../../slices'
import { loadDerivedFieldRecipe } from './recipes'
import { canLoadWindVector } from '../windVector'

export type FieldSourceData = {
  hourToken: string
  grid: ScalarGridSpec
  encoding: FieldEncodingSpec
  values: Float32Array
}

export async function loadFieldSourceData(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: FieldSource
}): Promise<FieldSourceData> {
  const { artifacts, hourToken, source } = args
  return loadSingleFieldSourceData({ artifacts, hourToken, source })
}

export function canLoadFieldSource(args: {
  activeRun: ActiveForecastRun
  artifacts: ArtifactLoader
  source: FieldSource
}): boolean {
  const { activeRun, artifacts, source } = args
  if (source.kind === 'scalar') return artifacts.canLoadScalar(source.artifactId)
  if (source.recipe === 'wind-speed') {
    return canLoadWindVector({
      activeRun,
      artifacts,
      artifactId: source.artifactId,
    })
  }
  return false
}

async function loadSingleFieldSourceData(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: FieldSource
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
