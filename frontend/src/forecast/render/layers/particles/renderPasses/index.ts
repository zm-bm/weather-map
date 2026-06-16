import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ProgramInfo } from '../../../gpu'
import type { ViewportState } from '../geo'
import type { ParticleStateBufferPair } from '../stateBuffers'
import type { ParticleTrailTargets } from '../trailTargets'
import type { PackedVectorFramePair } from '../vectorTexture'

export type ParticlePassState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  viewport: ViewportState | null
  vectorFramePair: PackedVectorFramePair | null
  updateProgramInfo: ProgramInfo | null
  particleProgramInfo: ProgramInfo | null
  trailProgramInfo: ProgramInfo | null
  stateBufferInfos: ParticleStateBufferPair
  activeSourceIndex: 0 | 1
  transformFeedback: WebGLTransformFeedback | null
  particleCount: number
  pendingForcedRespawnFrac: number
  trailTargets: ParticleTrailTargets
}

export { runUpdatePass } from './update'
export { runParticlePass } from './particles'
export { compositeTrailToMap, runTrailPass } from './trails'
