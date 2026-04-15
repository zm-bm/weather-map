import { createAbortError } from '../../abort'
import type { LayerAdapter } from '../shared'
import { loadVectorFrame } from './engine/frame'
import {
  createVectorRuntime,
  getVectorRuntimeController,
} from './engine/runtime'
import { vectorRuntimeOptions } from './options'

export const VECTOR_LAYER_ID = 'vector-layer-id'

export const vectorLayerAdapter: LayerAdapter = {
  layerId: VECTOR_LAYER_ID,
  createLayer() {
    const runtime = createVectorRuntime(vectorRuntimeOptions)
    return {
      id: VECTOR_LAYER_ID,
      type: 'custom',
      renderingMode: '2d',
      onAdd: (map, gl) => runtime.onAdd(map, gl),
      render: (gl, input) => runtime.render(gl, input),
      onRemove: (map, gl) => runtime.onRemove(map, gl),
    }
  },
  async applySync(args) {
    if (args.signal.aborted) throw createAbortError()
    const variable = args.activeVector

    const frame = await loadVectorFrame({
      config: args.config,
      manifest: args.manifest,
      hourToken: args.hourToken,
      variable,
      signal: args.signal,
    })

    if (args.signal.aborted) throw createAbortError()

    const runtimeController = getVectorRuntimeController(args.map)
    if (!runtimeController?.isAvailable()) {
      throw new Error('Vector runtime unavailable (WebGL2 required)')
    }

    runtimeController.applyFrame(frame)
  },
}
