import { isAbortError } from '@/core/abort'
import { clamp01 } from '@/core/math'
import type {
  ArtifactLoader,
  RawRasterBands,
} from '@/forecast/artifacts'
import { normalizeFrameId } from '@/forecast/manifest'
import type { ForecastFrameSelection } from '@/forecast/time'
import type {
  EncodedRasterFrame,
  ForecastFrameMap,
  ForecastWindowId,
  ForecastWindows,
  FrameWindow,
  RasterLayerFrame,
} from '@/forecast/frames'
import type {
  ForecastFramePlan,
  ForecastWindowPlan,
} from '../plan'

export function clampInterpolationMix(mix: number): number {
  if (!Number.isFinite(mix)) return 0
  return clamp01(mix)
}

export async function loadFrameWindow<T>(args: {
  selection: ForecastFrameSelection
  previousWindow?: FrameWindow<T> | null
  loadFrame: (frameId: string) => Promise<T>
}): Promise<FrameWindow<T>> {
  const { selection, previousWindow, loadFrame } = args
  const lowerFrameId = normalizeFrameId(selection.lowerFrameId)
  const upperFrameId = normalizeFrameId(selection.upperFrameId)
  const mix = clampInterpolationMix(selection.mix)
  const reuseFrame = (frameId: string): T | null => {
    if (!previousWindow) return null
    if (previousWindow.lowerFrameId === frameId) return previousWindow.lower
    if (previousWindow.upperFrameId === frameId) return previousWindow.upper
    return null
  }

  if (lowerFrameId === upperFrameId || mix === 0) {
    const lower = reuseFrame(lowerFrameId) ?? await loadFrame(lowerFrameId)
    return {
      lower,
      upper: lower,
      selectedValidTimeMs: selection.selectedValidTimeMs,
      lowerFrameId,
      upperFrameId: lowerFrameId,
      mix: 0,
    }
  }

  const reusableLower = reuseFrame(lowerFrameId)
  const reusableUpper = reuseFrame(upperFrameId)
  const [lower, upper] = await Promise.all([
    reusableLower ?? loadFrame(lowerFrameId),
    reusableUpper ?? loadFrame(upperFrameId),
  ])

  return {
    lower,
    upper,
    selectedValidTimeMs: selection.selectedValidTimeMs,
    lowerFrameId,
    upperFrameId,
    mix,
  }
}

export async function loadWindows(args: {
  selection: ForecastFrameSelection
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
  selection: ForecastFrameSelection
  windowPlan: ForecastWindowPlan
  artifacts: ArtifactLoader
  previousWindow: FrameWindow<ForecastFrameMap[ForecastWindowId]> | null
}): Promise<readonly [ForecastWindowId, FrameWindow<ForecastFrameMap[ForecastWindowId]> | null]> {
  try {
    const window = await loadFrameWindow<ForecastFrameMap[ForecastWindowId]>({
      selection: args.selection,
      previousWindow: args.previousWindow,
      loadFrame: (frameId) => loadWindowFrame(
        args.artifacts,
        args.windowPlan,
        frameId
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
  frameId: string,
): Promise<ForecastFrameMap[ForecastWindowId]> {
  if (windowPlan.id === 'overlay') {
    return loadArrayWindowFrame({
      artifacts,
      frames: windowPlan.frames,
      frameId,
    })
  }

  const frame = await loadForecastFramePlan(artifacts, windowPlan.frames[0], frameId)
  return frame as ForecastFrameMap[ForecastWindowId]
}

async function loadArrayWindowFrame(args: {
  artifacts: ArtifactLoader
  frames: readonly ForecastFramePlan[]
  frameId: string
}): Promise<ForecastFrameMap['overlay']> {
  const loadedFrames = await Promise.all(
    args.frames.map((frame) => loadForecastFramePlan(
      args.artifacts,
      frame,
      args.frameId,
    ).catch((error) => {
      if (frame.failurePolicy === 'optional') return null
      throw error
    }))
  )

  return loadedFrames.filter((frame): frame is RasterLayerFrame<ForecastFramePlan['source']> => (
    frame != null
  )) as ForecastFrameMap['overlay']
}

async function loadForecastFramePlan(
  artifacts: ArtifactLoader,
  frame: ForecastFramePlan,
  frameId: string,
): Promise<RasterLayerFrame<ForecastFramePlan['source']>> {
  const data = await artifacts.loadRawRasterBands(
    frame.artifactId,
    frameId,
    frame.bandIds,
    { order: frame.order }
  )
  return {
    source: frame.source,
    raster: buildEncodedRasterFrame(data, `${frame.cacheKeyPrefix}:${data.frameId}`),
  }
}

function buildEncodedRasterFrame(
  data: RawRasterBands,
  cacheKey = `${data.artifactId}:${data.frameId}`
): EncodedRasterFrame {
  return {
    frameId: data.frameId,
    artifactId: data.artifactId,
    cacheKey,
    grid: data.grid,
    encoding: data.encoding,
    bandIds: [...data.bandIds],
    bands: [...data.bands],
  }
}
