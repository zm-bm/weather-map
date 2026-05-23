import type { ArtifactLoader } from '../../forecast-artifacts'
import type { ActiveForecastRun } from '../../forecast-manifest'
import type { ForecastWindVectorDataSource } from '../../forecast-data-targets'
import { createWindVectorDataKey } from '../keys'
import type { ForecastDataLoad } from '../types'

type CreateWindVectorDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: ForecastWindVectorDataSource
}

export function createWindVectorDataLoad(
  args: CreateWindVectorDataLoadArgs
): ForecastDataLoad<'windVectors'> | null {
  if (!args.artifacts.canLoadVector(args.source.artifactId)) return null

  return {
    id: 'windVectors',
    key: createWindVectorDataKey(args.activeRun, args.source),
    failurePolicy: 'required',
    loadTimeSlice: (hourToken) => args.artifacts.loadVector(args.source.artifactId, hourToken),
  }
}
