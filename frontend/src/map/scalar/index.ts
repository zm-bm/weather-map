export { scalarLayerAdapter, SCALAR_LAYER_ID } from './adapter'
export { SCALAR_ACTIVE_OPACITY } from './engine/constants'
export {
  DEFAULT_SCALAR_RUNTIME_OPTIONS,
  scalarRuntimeOptions,
  SCALAR_COLOR_SAMPLING_MODES,
} from './options'
export type { ScalarColorSamplingMode, ScalarRuntimeOptions } from './options'
export { getScalarCatalogEntry } from './ui/catalog'
export { getScalarLayerMeta } from './ui/meta'
export type { ScalarLayerMeta } from './ui/meta'
export {
  clearScalarProbeFrame,
  getScalarProbeFrame,
  probeScalarFrame,
  setScalarProbeFrame,
} from './probe'
export type {
  ScalarProbePoint,
  ScalarProbeResult,
} from './probe'
