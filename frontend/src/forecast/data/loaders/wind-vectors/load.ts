import type { ArtifactLoader } from '@/forecast/artifacts'
import type { ActiveForecastRun } from '@/forecast/manifest'
import type { ForecastDataLoad } from '../../loadDefinition'
import type { WindVectorSource } from '../../target'
import { scopeDataKey } from '../dataKey'
import {
  canLoadWindVector,
  loadWindVectorTimeSlice,
} from '../windVector'

type CreateWindVectorDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: WindVectorSource
}

export function createWindVectorDataLoad(
  args: CreateWindVectorDataLoadArgs
): ForecastDataLoad<'windVectors'> | null {
  if (!canLoadWindVector({
    activeRun: args.activeRun,
    artifacts: args.artifacts,
    artifactId: args.source.artifactId,
  })) {
    return null
  }

  return {
    id: 'windVectors',
    key: createWindVectorDataKey(args.activeRun, args.source),
    failurePolicy: 'required',
    loadTimeSlice: (hourToken) => loadWindVectorTimeSlice({
      artifacts: args.artifacts,
      artifactId: args.source.artifactId,
      hourToken,
    }),
  }
}

function createWindVectorDataKey(
  activeRun: ActiveForecastRun,
  source: WindVectorSource
): string {
  return scopeDataKey(
    activeRun,
    `wind-vectors:${source.id}:${source.artifactId}`
  )
}
