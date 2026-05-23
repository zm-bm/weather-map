import type { ArtifactLoader } from '../../forecast-artifacts'
import type { ActiveForecastRun } from '../../forecast-manifest'
import type { ForecastPrecipTypeDataSource } from '../../forecast-data-targets'
import {
  createPrecipTypeDataKey,
} from '../keys'
import type {
  ForecastDataLoad,
  PrecipTypeTimeSliceData,
} from '../types'
import { normalizeForecastHourToken } from '../../forecast-manifest'
import {
  PRECIP_TYPE_MIX_FRACTION_COMPONENT,
  PRECIP_TYPE_COMPONENTS,
  PRECIP_TYPE_SNOW_FRACTION_COMPONENT,
} from './constants'

type CreatePrecipTypeDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: ForecastPrecipTypeDataSource | null
}

export function createPrecipTypeDataLoad(
  args: CreatePrecipTypeDataLoadArgs
): ForecastDataLoad<'precipType'> | null {
  if (args.source == null) return null
  const source = args.source

  if (!args.artifacts.canLoadVectorComponents(source.artifactId, PRECIP_TYPE_COMPONENTS)) return null

  return {
    id: 'precipType',
    key: createPrecipTypeDataKey(args.activeRun, source),
    failurePolicy: 'optional',
    loadTimeSlice: (hourToken) => loadPrecipTypeTimeSlice({
      artifacts: args.artifacts,
      source,
      hourToken,
    }),
  }
}

async function loadPrecipTypeTimeSlice(args: {
  artifacts: ArtifactLoader
  source: ForecastPrecipTypeDataSource
  hourToken: string
}): Promise<PrecipTypeTimeSliceData> {
  const hourToken = normalizeForecastHourToken(args.hourToken)
  const data = await args.artifacts.loadVectorComponents(args.source.artifactId, hourToken)
  const snowFrac = data.components[PRECIP_TYPE_SNOW_FRACTION_COMPONENT]
  const mixFrac = data.components[PRECIP_TYPE_MIX_FRACTION_COMPONENT]
  if (!snowFrac || !mixFrac) {
    throw new Error(
      `Precipitation type overlay ${data.artifactId} missing ` +
      `${PRECIP_TYPE_SNOW_FRACTION_COMPONENT}/${PRECIP_TYPE_MIX_FRACTION_COMPONENT} components`
    )
  }

  return {
    hourToken,
    artifactId: data.artifactId,
    grid: data.grid,
    snowFrac,
    mixFrac,
  }
}
