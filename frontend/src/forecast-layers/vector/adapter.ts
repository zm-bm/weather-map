import { createAbortError } from '../../abort'
import { FORECAST_LAYER_BEFORE_ID, type ForecastLayer } from '../types'
import { loadVectorFrameWindow } from './engine/frame'
import { createVectorRuntime } from './engine/runtime'
import { getVectorController } from './controller'
import { vectorRuntimeOptions } from './options'
import type { VectorFrameWindowData } from './engine/types'

export const VECTOR_LAYER_ID = 'vector-layer-id'

const vectorFrameWindowByMap = new WeakMap<object, {
  reuseKey: string
  frameWindow: VectorFrameWindowData
}>()

export const vectorLayerAdapter: ForecastLayer = {
  layerId: VECTOR_LAYER_ID,
  install(map) {
    if (map.getLayer(VECTOR_LAYER_ID)) return
    map.addLayer(createVectorCustomLayer(), FORECAST_LAYER_BEFORE_ID)
  },
  async applySync(args) {
    if (args.signal.aborted) throw createAbortError()
    const variable = args.activeVector
    const reuseKey = `${args.manifest.cycle}:${args.manifest.revision}:${variable}`
    const previousFrameWindow = vectorFrameWindowByMap.get(args.map)

    const frame = await loadVectorFrameWindow({
      config: args.config,
      manifest: args.manifest,
      previousWindow: previousFrameWindow?.reuseKey === reuseKey
        ? previousFrameWindow.frameWindow
        : null,
      lowerHourToken: args.lowerHourToken,
      upperHourToken: args.upperHourToken,
      selectedValidTimeMs: args.selectedValidTimeMs,
      mix: args.mix,
      variable,
      signal: args.signal,
    })

    if (args.signal.aborted) throw createAbortError()

    const controller = getVectorController(args.map)
    if (!controller?.isAvailable()) {
      throw new Error('Vector runtime unavailable (WebGL2 required)')
    }

    controller.applyFrame(frame)
    vectorFrameWindowByMap.set(args.map, { reuseKey, frameWindow: frame })
  },
}

function createVectorCustomLayer() {
  const runtime = createVectorRuntime(vectorRuntimeOptions)
  return {
    id: VECTOR_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
