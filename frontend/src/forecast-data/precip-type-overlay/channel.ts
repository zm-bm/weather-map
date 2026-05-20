import type { ArtifactLoader } from '../../forecast-artifacts'
import {
  getActiveRunArtifact,
  type ActiveForecastRun,
} from '../../forecast-manifest'
import type {
  LayerSpec,
  PrecipitationTypeLayerOverlay,
} from '../../forecast-catalog'
import {
  createPrecipTypeOverlayChannelKey,
} from '../keys'
import type {
  ForecastDataChannel,
  PrecipTypeOverlayTimeSliceData,
} from '../types'
import { normalizeHourToken } from '../window'
import {
  PRECIP_TYPE_MIX_FRACTION_COMPONENT,
  PRECIP_TYPE_OVERLAY_COMPONENTS,
  PRECIP_TYPE_SNOW_FRACTION_COMPONENT,
} from './constants'

type CreatePrecipTypeOverlayChannelArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  layer: LayerSpec
}

export function createPrecipTypeOverlayChannel(
  args: CreatePrecipTypeOverlayChannelArgs
): ForecastDataChannel<PrecipTypeOverlayTimeSliceData> | null {
  const overlay = precipitationTypeOverlayForLayer(args.layer)
  if (overlay == null) return null

  const artifact = getActiveRunArtifact(args.activeRun, String(overlay.artifactId))
  if (!artifact || artifact.kind !== 'vector') return null
  if (!hasPrecipTypeOverlayComponents(artifact.components)) return null

  return {
    key: createPrecipTypeOverlayChannelKey(args.activeRun, overlay),
    load: (hourToken) => loadPrecipTypeOverlayTimeSlice({
      artifacts: args.artifacts,
      overlay,
      hourToken,
    }),
  }
}

function hasPrecipTypeOverlayComponents(componentIds: readonly string[]): boolean {
  const available = new Set(componentIds)
  return PRECIP_TYPE_OVERLAY_COMPONENTS.every((componentId) => available.has(componentId))
}

function precipitationTypeOverlayForLayer(
  layer: LayerSpec
): PrecipitationTypeLayerOverlay | null {
  return layer.overlays.find((overlay) => overlay.kind === 'precipitation-type') ?? null
}

async function loadPrecipTypeOverlayTimeSlice(args: {
  artifacts: ArtifactLoader
  overlay: PrecipitationTypeLayerOverlay
  hourToken: string
}): Promise<PrecipTypeOverlayTimeSliceData> {
  const hourToken = normalizeHourToken(args.hourToken)
  const data = await args.artifacts.loadVectorComponents(args.overlay.artifactId, hourToken)
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
