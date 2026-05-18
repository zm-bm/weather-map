import type {
  AvailabilityManifestArtifactSpec,
  ForecastModelId,
  ModelLayerAvailabilityIndex,
} from '../forecast-availability'
import { parseCycleManifest } from '../manifest/parse'
import type {
  CycleManifest,
  ManifestArtifactSpec,
} from '../manifest'

const FIELD_DTYPE_SUFFIX = {
  int16: 'i16',
  int8: 'i8',
} satisfies Record<AvailabilityManifestArtifactSpec['encoding']['dtype'], string>

export function createCycleManifestFromAvailability(args: {
  availabilityIndex: ModelLayerAvailabilityIndex
  modelId: ForecastModelId
}): CycleManifest {
  const model = args.availabilityIndex.models[args.modelId]
  if (!model) {
    throw new Error(`Forecast availability did not list model ${args.modelId}.`)
  }
  if (!model.latest) {
    throw new Error(`No latest ${model.label} forecast render data is listed in forecast availability.`)
  }

  const latest = model.latest
  const cycle = latest.run.cycle
  const timeIds = latest.times.map((time) => time.id)

  return parseCycleManifest({
    ...latest,
    model: {
      id: args.modelId,
      label: model.label,
    },
    artifacts: Object.fromEntries(
      Object.entries(latest.artifacts).map(([artifactId, artifact]) => [
        artifactId,
        createManifestArtifact({
          artifact,
          artifactId,
          cycle,
          modelId: args.modelId,
          timeIds,
        }),
      ])
    ),
  })
}

function createManifestArtifact(args: {
  artifact: AvailabilityManifestArtifactSpec
  artifactId: string
  cycle: string
  modelId: string
  timeIds: string[]
}): ManifestArtifactSpec {
  const {
    artifact,
    artifactId,
    cycle,
    modelId,
    timeIds,
  } = args
  const { byteLength, ...artifactWithoutByteLength } = artifact

  return {
    ...artifactWithoutByteLength,
    frames: Object.fromEntries(
      timeIds.map((timeId) => [
        timeId,
        {
          path: inferFramePayloadPath({ artifact, artifactId, cycle, modelId, timeId }),
          byteLength,
        },
      ])
    ),
  } as ManifestArtifactSpec
}

function inferFramePayloadPath(args: {
  artifact: { encoding: { dtype: AvailabilityManifestArtifactSpec['encoding']['dtype'] } }
  artifactId: string
  cycle: string
  modelId: string
  timeId: string
}): string {
  return [
    'fields',
    args.modelId,
    args.cycle,
    args.timeId,
    `${args.artifactId}.field.${FIELD_DTYPE_SUFFIX[args.artifact.encoding.dtype]}.bin`,
  ].join('/')
}
