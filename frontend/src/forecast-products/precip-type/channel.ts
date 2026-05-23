import type { ArtifactLoader } from '../../forecast-artifacts'
import type { ActiveForecastRun } from '../../forecast-manifest'
import type {
  LayerSpec,
  PrecipitationTypeLayerOverlay,
} from '../../forecast-catalog'
import {
  createPrecipTypeChannelKey,
} from '../keys'
import type {
  ForecastProductChannel,
  PrecipTypeTimeSliceData,
} from '../types'
import { normalizeForecastHourToken } from '../../forecast-manifest'
import {
  PRECIP_TYPE_MIX_FRACTION_COMPONENT,
  PRECIP_TYPE_COMPONENTS,
  PRECIP_TYPE_SNOW_FRACTION_COMPONENT,
} from './constants'

type CreatePrecipTypeChannelArgs = {
  artifacts: ArtifactLoader
  activeRun: ActiveForecastRun
  layer: LayerSpec
}

export function createPrecipTypeChannel(
  args: CreatePrecipTypeChannelArgs
): ForecastProductChannel<PrecipTypeTimeSliceData> | null {
  const overlay = precipitationTypeOverlayForLayer(args.layer)
  if (overlay == null) return null

  if (!args.artifacts.canLoadVectorComponents(overlay.artifactId, PRECIP_TYPE_COMPONENTS)) return null

  return {
    key: createPrecipTypeChannelKey(args.activeRun, overlay),
    load: (hourToken) => loadPrecipTypeTimeSlice({
      artifacts: args.artifacts,
      overlay,
      hourToken,
    }),
  }
}

function precipitationTypeOverlayForLayer(
  layer: LayerSpec
): PrecipitationTypeLayerOverlay | null {
  return layer.overlays.find((overlay) => overlay.kind === 'precipitation-type') ?? null
}

async function loadPrecipTypeTimeSlice(args: {
  artifacts: ArtifactLoader
  overlay: PrecipitationTypeLayerOverlay
  hourToken: string
}): Promise<PrecipTypeTimeSliceData> {
  const hourToken = normalizeForecastHourToken(args.hourToken)
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
