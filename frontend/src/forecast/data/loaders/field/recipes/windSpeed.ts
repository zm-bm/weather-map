import type {
  ArtifactLoader,
  VectorArtifactData,
} from '@/forecast/artifacts'
import type { DerivedFieldSource } from '../../../target'
import type { DerivedFieldEncodingSpec } from '../../../slices'
import type { FieldSourceData } from '../source'

const WIND_SPEED_FIELD_ENCODING: DerivedFieldEncodingSpec = {
  id: 'wind-speed-derived-float32-v1',
  format: 'derived-float32-v1',
  dtype: 'float32',
  byteOrder: 'none',
  nodata: -9999,
}

export async function loadWindSpeedFieldSource(args: {
  artifacts: ArtifactLoader
  hourToken: string
  source: DerivedFieldSource
}): Promise<FieldSourceData> {
  const vectorFrame = await args.artifacts.loadVector(args.source.artifactId, args.hourToken)
  return {
    hourToken: vectorFrame.hourToken,
    grid: vectorFrame.grid,
    encoding: WIND_SPEED_FIELD_ENCODING,
    values: deriveWindSpeedValues(vectorFrame),
  }
}

function deriveWindSpeedValues(vectorFrame: VectorArtifactData): Float32Array {
  const { grid, offset, scale, u, v } = vectorFrame
  const cellCount = grid.nx * grid.ny
  if (u.length !== cellCount || v.length !== cellCount) {
    throw new Error(
      `Wind speed source vector cell count mismatch: u=${u.length} v=${v.length} expected=${cellCount}`
    )
  }

  const values = new Float32Array(cellCount)
  for (let idx = 0; idx < cellCount; idx += 1) {
    const uValue = (u[idx] * scale) + offset
    const vValue = (v[idx] * scale) + offset
    values[idx] = Number.isFinite(uValue) && Number.isFinite(vValue)
      ? Math.hypot(uValue, vValue)
      : Number.NaN
  }
  return values
}
