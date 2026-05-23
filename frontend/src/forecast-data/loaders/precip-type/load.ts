import type { ArtifactLoader } from '../../../forecast-artifacts'
import type { ActiveForecastRun } from '../../../forecast-manifest'
import type { ForecastDataLoad } from '../../loadDefinition'
import type { PrecipTypeTimeSliceData } from '../../slices'
import type { PrecipTypeSource } from '../../target'
import { normalizeForecastHourToken } from '../../../forecast-manifest'
import { scopeDataKey } from '../dataKey'
import {
  PRECIP_TYPE_MIX_FRACTION_COMPONENT,
  PRECIP_TYPE_COMPONENTS,
  PRECIP_TYPE_SNOW_FRACTION_COMPONENT,
} from './constants'

type CreatePrecipTypeDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  source: PrecipTypeSource | null
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

function createPrecipTypeDataKey(
  activeRun: ActiveForecastRun,
  source: PrecipTypeSource
): string {
  return scopeDataKey(
    activeRun,
    `precip-type:${source.id}:${source.artifactId}`
  )
}

async function loadPrecipTypeTimeSlice(args: {
  artifacts: ArtifactLoader
  source: PrecipTypeSource
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
