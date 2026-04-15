export type VectorRuntimeOptions = {
  reseedOnFrameChange: boolean
}

export const DEFAULT_VECTOR_RUNTIME_OPTIONS: Readonly<VectorRuntimeOptions> = {
  reseedOnFrameChange: false,
}

export const vectorRuntimeOptions: VectorRuntimeOptions = {
  ...DEFAULT_VECTOR_RUNTIME_OPTIONS,
}
