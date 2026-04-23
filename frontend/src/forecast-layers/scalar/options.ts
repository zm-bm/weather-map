export const SCALAR_COLOR_SAMPLING_MODES = ['interpolated', 'banded'] as const

export type ScalarColorSamplingMode = typeof SCALAR_COLOR_SAMPLING_MODES[number]

export type ScalarRuntimeOptions = {
  colorSamplingMode: ScalarColorSamplingMode
}

export const DEFAULT_SCALAR_RUNTIME_OPTIONS: Readonly<ScalarRuntimeOptions> = {
  colorSamplingMode: 'banded',
}

export const scalarRuntimeOptions: ScalarRuntimeOptions = {
  ...DEFAULT_SCALAR_RUNTIME_OPTIONS,
}
