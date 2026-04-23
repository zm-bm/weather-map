import { createAbortError } from '../../abort'
import { FORECAST_LAYER_BEFORE_ID, type ForecastLayer } from '../types'
import { loadScalarFrame } from './engine/frame'
import { createScalarRuntime } from './engine/runtime'
import { getScalarController } from './controller'
import { setProbeFrame } from '../../map-probe/frame'
import { scalarRuntimeOptions } from './options'

export const SCALAR_LAYER_ID = 'scalar-layer-id'

export const scalarLayerAdapter: ForecastLayer = {
  layerId: SCALAR_LAYER_ID,
  install(map) {
    if (map.getLayer(SCALAR_LAYER_ID)) return
    map.addLayer(createScalarCustomLayer(), FORECAST_LAYER_BEFORE_ID)
  },
  async applySync(args) {
    if (args.signal.aborted) throw createAbortError()

    const frame = await loadScalarFrame({
      config: args.config,
      manifest: args.manifest,
      hourToken: args.hourToken,
      variable: args.activeScalar,
      signal: args.signal,
    })

    if (args.signal.aborted) throw createAbortError()

    const controller = getScalarController(args.map)
    if (!controller?.isAvailable()) {
      throw new Error('Scalar runtime unavailable (WebGL2 required)')
    }

    controller.applyFrame(frame)
    setProbeFrame(frame)
  },
}

function createScalarCustomLayer() {
  const runtime = createScalarRuntime(scalarRuntimeOptions)
  return {
    id: SCALAR_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
