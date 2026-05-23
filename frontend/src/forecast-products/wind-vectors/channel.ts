import type { ArtifactLoader } from '../../forecast-artifacts'
import type { ActiveForecastRun } from '../../forecast-manifest'
import { createWindVectorChannelKey } from '../keys'
import type { WindVectorSource } from '../target'
import type {
  ForecastProductChannel,
  WindVectorTimeSliceData,
} from '../types'

type CreateWindVectorChannelArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: WindVectorSource
}

export function createWindVectorChannel(
  args: CreateWindVectorChannelArgs
): ForecastProductChannel<WindVectorTimeSliceData> {
  return {
    key: createWindVectorChannelKey(args.activeRun, args.source),
    load: (hourToken) => args.artifacts.loadVector(args.source.artifactId, hourToken),
  }
}
