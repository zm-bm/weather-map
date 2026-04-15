import { createAbortError } from '../../abort'
import type { LayerAdapter } from '../shared'
import { loadScalarFrame } from './engine/frame'
import { createScalarRuntime } from './engine/runtime'
import { getScalarController } from './controller'
import { scalarRuntimeOptions } from './options'

export const SCALAR_LAYER_ID = 'scalar-layer-id'

export const scalarLayerAdapter: LayerAdapter = {
  layerId: SCALAR_LAYER_ID,
  createLayer() {
    const runtime = createScalarRuntime(scalarRuntimeOptions)
    return {
      id: SCALAR_LAYER_ID,
      type: 'custom',
      renderingMode: '2d',
      onAdd: (map, gl) => runtime.onAdd(map, gl),
      render: (gl, input) => runtime.render(gl, input),
      onRemove: (map, gl) => runtime.onRemove(map, gl),
    }
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
  },
}
