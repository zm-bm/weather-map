import type { ArtifactLoader } from '../../forecast-artifacts'
import {
  getActiveRunArtifact,
  type ActiveForecastRun,
} from '../../forecast-manifest'
import {
  createPressureContourChannelKey,
} from '../keys'
import type {
  ForecastDataChannel,
  PressureContourTimeSliceData,
} from '../types'
import { normalizeHourToken } from '../window'
import {
  PASCALS_PER_HECTOPASCAL,
  PRESSURE_CONTOUR_SOURCE_ARTIFACT_ID,
} from './constants'

type CreatePressureContourChannelArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
}

export function createPressureContourChannel(
  args: CreatePressureContourChannelArgs
): ForecastDataChannel<PressureContourTimeSliceData> | null {
  const artifact = getActiveRunArtifact(args.activeRun, PRESSURE_CONTOUR_SOURCE_ARTIFACT_ID)
  if (!artifact || artifact.kind !== 'scalar') return null

  return {
    key: createPressureContourChannelKey(args.activeRun, PRESSURE_CONTOUR_SOURCE_ARTIFACT_ID),
    load: (hourToken) => loadPressureContourTimeSlice({
      artifacts: args.artifacts,
      hourToken,
    }),
  }
}

async function loadPressureContourTimeSlice(args: {
  artifacts: ArtifactLoader
  hourToken: string
}): Promise<PressureContourTimeSliceData> {
  const hourToken = normalizeHourToken(args.hourToken)
  const data = await args.artifacts.loadScalar(PRESSURE_CONTOUR_SOURCE_ARTIFACT_ID, hourToken)

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
