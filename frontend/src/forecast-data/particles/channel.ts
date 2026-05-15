import {
  particleLayerSourceArtifactId,
  type ParticleLayerSpec,
} from '../../forecast-catalog'
import type { ArtifactLoader } from '../../forecast-artifacts'
import type { CycleManifest } from '../../manifest'
import { createParticleChannelKey } from '../keys'
import type {
  ForecastDataChannel,
  ParticleTimeSliceData,
} from '../types'

type CreateParticleChannelArgs = {
  artifacts: ArtifactLoader
  manifest: CycleManifest
  particleLayer: ParticleLayerSpec
}

export function createParticleChannel(
  args: CreateParticleChannelArgs
): ForecastDataChannel<ParticleTimeSliceData> {
  const artifactId = particleLayerSourceArtifactId(args.particleLayer)
  return {
    key: createParticleChannelKey(args.manifest, args.particleLayer),
    load: (hourToken) => args.artifacts.loadVector(artifactId, hourToken),
  }
}
