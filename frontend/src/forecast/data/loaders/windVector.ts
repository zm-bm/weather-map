import type {
  ArtifactLoader,
  RawVectorComponentArtifactData,
} from '@/forecast/artifacts'
import type {
  ActiveForecastRun,
  VectorArtifactSpec,
} from '@/forecast/manifest'
import type { WindVectorTimeSliceData } from '../slices'

const WIND_VECTOR_COMPONENTS = ['u', 'v'] as const
const WIND_VECTOR_SCALE = 1
const WIND_VECTOR_OFFSET = 0

export function canLoadWindVector(args: {
  activeRun: ActiveForecastRun
  artifacts: ArtifactLoader
  artifactId: string
}): boolean {
  if (!args.artifacts.canLoadVectorComponents(args.artifactId, WIND_VECTOR_COMPONENTS)) {
    return false
  }

  const artifact = args.activeRun.latest.artifacts[args.artifactId]
  return artifact?.kind === 'vector' && isSupportedWindVectorArtifact(artifact)
}

export async function loadWindVectorTimeSlice(args: {
  artifacts: ArtifactLoader
  artifactId: string
  hourToken: string
}): Promise<WindVectorTimeSliceData> {
  const sourceData = await args.artifacts.loadRawVectorComponents(args.artifactId, args.hourToken)
  return materializeWindVectorTimeSlice(sourceData)
}

export function materializeWindVectorTimeSlice(
  sourceData: RawVectorComponentArtifactData
): WindVectorTimeSliceData {
  if (!isSupportedWindVectorComponentData(sourceData)) {
    throw new Error(`Unsupported wind vector artifact ${sourceData.artifactId}`)
  }
  const cellCount = sourceData.grid.nx * sourceData.grid.ny
  const u = requiredWindComponent(sourceData, 'u')
  const v = requiredWindComponent(sourceData, 'v')
  if (u.length !== cellCount || v.length !== cellCount) {
    throw new Error(
      `Wind vector component cell count mismatch for ${sourceData.artifactId}: ` +
      `u=${u.length} v=${v.length} expected=${cellCount}`
    )
  }

  return {
    artifactId: sourceData.artifactId,
    hourToken: sourceData.hourToken,
    scale: sourceData.encoding.scale,
    offset: sourceData.encoding.offset,
    u,
    v,
    grid: sourceData.grid,
  }
}

function isSupportedWindVectorArtifact(artifact: VectorArtifactSpec): boolean {
  return hasOrderedWindComponents(artifact.components) &&
    artifact.encoding.scale === WIND_VECTOR_SCALE &&
    artifact.encoding.offset === WIND_VECTOR_OFFSET
}

function isSupportedWindVectorComponentData(
  sourceData: RawVectorComponentArtifactData
): boolean {
  return hasOrderedWindComponents(sourceData.componentIds) &&
    sourceData.encoding.scale === WIND_VECTOR_SCALE &&
    sourceData.encoding.offset === WIND_VECTOR_OFFSET
}

function hasOrderedWindComponents(components: readonly string[]): boolean {
  return components.length === WIND_VECTOR_COMPONENTS.length &&
    WIND_VECTOR_COMPONENTS.every((component, index) => components[index] === component)
}

function requiredWindComponent(
  sourceData: RawVectorComponentArtifactData,
  componentId: typeof WIND_VECTOR_COMPONENTS[number]
): Int8Array {
  const component = sourceData.components[componentId]
  if (!component) {
    throw new Error(`Wind vector missing component ${componentId}`)
  }
  return component
}
