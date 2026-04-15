import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../map/manifest'

export type FrameSyncCallbacks = {
  onRequestStart?: (hourIndex: number) => void
  onRequestApplied?: (hourIndex: number) => void
  onRequestError?: (hourIndex: number, error?: Error) => void
}

export type FrameSyncInput = {
  manifest: CycleManifest
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  targetHourIndex: number
}

export type FrameSyncSelectionInput = FrameSyncInput & {
  sync: FrameSyncCallbacks
}

export type FrameSyncRequest = {
  manifest: CycleManifest
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  activeHourIndex: number
  hourToken: string
  syncKey: string
  sync: FrameSyncCallbacks
}
