export const FIELD_COLOR_SAMPLING_MODES = ['interpolated', 'banded'] as const

export type FieldColorSamplingMode = typeof FIELD_COLOR_SAMPLING_MODES[number]

export type FieldRuntimeOptions = {
  colorSamplingMode: FieldColorSamplingMode
}

export const DEFAULT_FIELD_RUNTIME_OPTIONS: Readonly<FieldRuntimeOptions> = {
  colorSamplingMode: 'banded',
}

export const fieldRuntimeOptions: FieldRuntimeOptions = {
  ...DEFAULT_FIELD_RUNTIME_OPTIONS,
}
