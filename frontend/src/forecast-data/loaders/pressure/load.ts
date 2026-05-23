import type { ArtifactLoader } from '../../../forecast-artifacts'
import type { ActiveForecastRun } from '../../../forecast-manifest'
import type { ForecastDataLoad } from '../../loadDefinition'
import type { PressureTimeSliceData } from '../../slices'
import { normalizeForecastHourToken } from '../../../forecast-manifest'
import { scopeDataKey } from '../dataKey'
import {
  PASCALS_PER_HECTOPASCAL,
  PRESSURE_SOURCE_ARTIFACT_ID,
} from './constants'

type CreatePressureDataLoadArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
}

export function createPressureDataLoad(
  args: CreatePressureDataLoadArgs
): ForecastDataLoad<'pressure'> | null {
  if (!args.artifacts.canLoadScalar(PRESSURE_SOURCE_ARTIFACT_ID)) return null

  return {
    id: 'pressure',
    key: createPressureDataKey(args.activeRun, PRESSURE_SOURCE_ARTIFACT_ID),
    failurePolicy: 'optional',
    loadTimeSlice: (hourToken) => loadPressureTimeSlice({
      artifacts: args.artifacts,
      hourToken,
    }),
  }
}

function createPressureDataKey(
  activeRun: ActiveForecastRun,
  artifactId: string
): string {
  return scopeDataKey(
    activeRun,
    `pressure:${artifactId}`
  )
}

async function loadPressureTimeSlice(args: {
  artifacts: ArtifactLoader
  hourToken: string
}): Promise<PressureTimeSliceData> {
  const hourToken = normalizeForecastHourToken(args.hourToken)
  const data = await args.artifacts.loadScalar(PRESSURE_SOURCE_ARTIFACT_ID, hourToken)

  return {
    hourToken,
    artifactId: data.artifactId,
    grid: data.grid,
    pressureHpa: decodePressureHpa(data.values),
  }
}

function decodePressureHpa(valuesPa: Float32Array): Float32Array {
  const valuesHpa = new Float32Array(valuesPa.length)
  for (const [index, valuePa] of valuesPa.entries()) {
    valuesHpa[index] = Number.isFinite(valuePa)
      ? valuePa / PASCALS_PER_HECTOPASCAL
      : Number.NaN
  }
  return valuesHpa
}
