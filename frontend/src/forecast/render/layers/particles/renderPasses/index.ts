import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ProgramInfo } from '../../../gpu'
import type { ViewportState } from '../geo'
import type { ParticleStateStorage } from '../stateBuffers'
import type { ParticleTrailTargets } from '../trailTargets'
import type { VectorFramePair } from '../vectorFramePair'

export type ParticlePassState = {
  map?: MapLibreMap
  gl?: WebGL2RenderingContext
  viewport: ViewportState | null
  vectorFramePair: VectorFramePair | null
  particleProgramInfo: ProgramInfo | null
  trailProgramInfo: ProgramInfo | null
  particleState: ParticleStateStorage | null
  activeSourceIndex: 0 | 1
  particleCount: number
  pendingForcedRespawnFrac: number
  trailTargets: ParticleTrailTargets
}

export { runUpdatePass } from './update'
export { runParticlePass } from './particles'
export { compositeTrailToMap, runTrailPass } from './trails'
