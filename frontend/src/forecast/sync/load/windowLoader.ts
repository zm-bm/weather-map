import { isAbortError } from '@/core/abort'
import { clamp01 } from '@/core/math'
import type {
  ArtifactLoader,
  RawRasterBands,
} from '@/forecast/artifacts'
import { normalizeForecastHourToken } from '@/forecast/manifest'
import type { ForecastTimeSliceSelection } from '@/forecast/time'
import type {
  EncodedRasterFrame,
  ForecastFrameMap,
  ForecastWindowId,
  ForecastWindows,
  FrameWindow,
  RasterLayerFrame,
} from '@/forecast/frames'
import type {
  ForecastWindowPlan,
  RasterFramePlan,
} from '../plan'

export function clampInterpolationMix(mix: number): number {
  if (!Number.isFinite(mix)) return 0
  return clamp01(mix)
}

export async function loadFrameWindow<T>(args: {
  selection: ForecastTimeSliceSelection
  previousWindow?: FrameWindow<T> | null
  loadFrame: (hourToken: string) => Promise<T>
}): Promise<FrameWindow<T>> {
  const { selection, previousWindow, loadFrame } = args
  const lowerHourToken = normalizeForecastHourToken(selection.lowerHourToken)
  const upperHourToken = normalizeForecastHourToken(selection.upperHourToken)
  const mix = clampInterpolationMix(selection.mix)
  const reuseFrame = (hourToken: string): T | null => {
    if (!previousWindow) return null
    if (previousWindow.lowerHourToken === hourToken) return previousWindow.lower
    if (previousWindow.upperHourToken === hourToken) return previousWindow.upper
    return null
  }

  if (lowerHourToken === upperHourToken || mix === 0) {
    const lower = reuseFrame(lowerHourToken) ?? await loadFrame(lowerHourToken)
    return {
      lower,
      upper: lower,
      selectedValidTimeMs: selection.selectedValidTimeMs,
      lowerHourToken,
      upperHourToken: lowerHourToken,
      mix: 0,
    }
  }

  const reusableLower = reuseFrame(lowerHourToken)
  const reusableUpper = reuseFrame(upperHourToken)
  const [lower, upper] = await Promise.all([
    reusableLower ?? loadFrame(lowerHourToken),
    reusableUpper ?? loadFrame(upperHourToken),
  ])

  return {
    lower,
    upper,
    selectedValidTimeMs: selection.selectedValidTimeMs,
    lowerHourToken,
    upperHourToken,
    mix,
  }
}

export async function loadWindows(args: {
  selection: ForecastTimeSliceSelection
  windowPlans: readonly ForecastWindowPlan[]
  artifacts: ArtifactLoader
  previousWindows?: ForecastWindows
}): Promise<ForecastWindows> {
  const loadedWindows = await Promise.all(
    args.windowPlans.map((windowPlan) => loadWindow({
      selection: args.selection,
      windowPlan,
      artifacts: args.artifacts,
      previousWindow: args.previousWindows?.[windowPlan.id] ?? null,
    }))
  )
  const windows: ForecastWindows = {}
  const mutableWindows = windows as Record<
    ForecastWindowId,
    FrameWindow<ForecastFrameMap[ForecastWindowId]>
  >
  for (const [id, window] of loadedWindows) {
    if (window == null) continue
    mutableWindows[id] = window
  }

  return windows
}

async function loadWindow(args: {
  selection: ForecastTimeSliceSelection
  windowPlan: ForecastWindowPlan
  artifacts: ArtifactLoader
  previousWindow: FrameWindow<ForecastFrameMap[ForecastWindowId]> | null
}): Promise<readonly [ForecastWindowId, FrameWindow<ForecastFrameMap[ForecastWindowId]> | null]> {
  try {
    const window = await loadFrameWindow<ForecastFrameMap[ForecastWindowId]>({
      selection: args.selection,
      previousWindow: args.previousWindow,
      loadFrame: (hourToken) => loadWindowFrame(
        args.artifacts,
        args.windowPlan,
        hourToken
      ),
    })
    return [args.windowPlan.id, window]
  } catch (error) {
    if (isAbortError(error) || args.windowPlan.failurePolicy === 'required') throw error
    return [args.windowPlan.id, null]
  }
}

export async function loadWindowFrame(
  artifacts: ArtifactLoader,
  windowPlan: ForecastWindowPlan,
  hourToken: string,
): Promise<ForecastFrameMap[ForecastWindowId]> {
  if (windowPlan.output === 'single') {
    return loadSingleFrame(
      artifacts,
      windowPlan.frames[0],
      hourToken
    )
  }

  return loadArrayWindowFrame({
    artifacts,
    frames: windowPlan.frames,
    hourToken,
  })
}

async function loadSingleFrame(
  artifacts: ArtifactLoader,
  frame: RasterFramePlan,
  hourToken: string,
): Promise<ForecastFrameMap[ForecastWindowId]> {
  return loadRasterFramePlan(
    artifacts,
    frame,
    hourToken
  ) as Promise<ForecastFrameMap[ForecastWindowId]>
}

async function loadArrayWindowFrame(args: {
  artifacts: ArtifactLoader
  frames: readonly RasterFramePlan[]
  hourToken: string
}): Promise<ForecastFrameMap[ForecastWindowId]> {
  const loadedFrames = await Promise.all(
    args.frames.map((frame) => loadRasterFramePlan(
      args.artifacts,
      frame,
      args.hourToken,
    ).catch((error) => {
      if (frame.failurePolicy === 'optional') return null
      throw error
    }))
  )

  return loadedFrames.filter((frame): frame is RasterLayerFrame<unknown> => (
    frame != null
  )) as ForecastFrameMap[ForecastWindowId]
}

async function loadRasterFramePlan(
  artifacts: ArtifactLoader,
  frame: RasterFramePlan,
  hourToken: string,
): Promise<RasterLayerFrame<unknown>> {
  const data = await artifacts.loadRawRasterBands(
    frame.artifactId,
    hourToken,
    frame.bandIds,
    { order: frame.order }
  )
  return {
    source: frame.source,
    raster: buildEncodedRasterFrame(data, `${frame.cacheKeyPrefix}:${data.hourToken}`),
  }
}

function buildEncodedRasterFrame(
  data: RawRasterBands,
  cacheKey = `${data.artifactId}:${data.hourToken}`
): EncodedRasterFrame {
  return {
    hourToken: data.hourToken,
    artifactId: data.artifactId,
    cacheKey,
    grid: data.grid,
    encoding: data.encoding,
    bandIds: [...data.bandIds],
    bands: [...data.bands],
  }
}
