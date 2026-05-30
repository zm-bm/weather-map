export type UnitSystem = 'imperial' | 'metric'

export type UnitValueFormat = 'compact' | 'whole' | 'one-decimal' | 'fixed-2'

export type UnitLegendValueFormat = 'compact' | 'whole' | 'precip-rate'

export type LegendLabel = number | {
  value: number
  label: string
}

export type UnitOption = {
  id: string
  label: string
  system?: UnitSystem
  scale?: number
  offset?: number
  valueFormat?: UnitValueFormat
  legendValueFormat?: UnitLegendValueFormat
}

export type GradientUnitOption = UnitOption & {
  legendLabels: readonly LegendLabel[]
}

export type UnitDisplay<T extends UnitOption = UnitOption> = {
  options: readonly [T, ...T[]]
}

export function fromNative(value: number, option: UnitOption): number {
  return value * unitScale(option) + unitOffset(option)
}

export function toNative(value: number, option: UnitOption): number {
  return (value - unitOffset(option)) / unitScale(option)
}

export function formatUnitValue(
  value: number,
  option?: UnitOption | null,
): string {
  const format = option?.valueFormat ?? 'compact'
  if (format === 'whole') return `${Math.round(value)}`
  if (format === 'fixed-2') return value.toFixed(2)
  if (format === 'one-decimal') return trimFixed(value, 1)
  return formatCompactValue(value)
}

export function formatUnitLegendValue(
  value: number,
  option?: Pick<UnitOption, 'legendValueFormat'> | null,
): string {
  const format = option?.legendValueFormat ?? 'compact'
  if (format === 'whole') return `${Math.round(value)}`
  if (format === 'precip-rate') {
    if (Math.abs(value) >= 10) return `${Math.round(value)}`
    if (Math.abs(value) >= 1) return trimFixed(value, 1)
    if (value === 0) return '0'
    return trimFixed(value, 2)
  }
  if (Math.abs(value) >= 10) return `${Math.round(value)}`
  if (Number.isInteger(value)) return `${value}`
  return trimFixed(value, 1)
}

export function getUnitOption<T extends UnitOption>(
  display: UnitDisplay<T>,
  optionId?: string | null,
): T {
  return display.options.find((option) => option.id === optionId) ?? display.options[0]
}

export function getUnitOptionForSystem<T extends UnitOption>(
  display: UnitDisplay<T>,
  unitSystem: UnitSystem,
): T {
  return display.options.find((option) => option.system === unitSystem)
    ?? display.options[0]
}

export function canToggleUnitSystem(display: UnitDisplay): boolean {
  return display.options.some((option) => option.system === 'imperial')
    && display.options.some((option) => option.system === 'metric')
}

function unitScale(option: UnitOption): number {
  return option.scale ?? 1
}

function unitOffset(option: UnitOption): number {
  return option.offset ?? 0
}

function formatCompactValue(value: number): string {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return trimTrailingZeroes(rounded)
}

function trimFixed(value: number, maximumFractionDigits: number): string {
  return trimTrailingZeroes(value.toFixed(maximumFractionDigits))
}

function trimTrailingZeroes(value: string): string {
  const decimalIndex = value.indexOf('.')
  if (decimalIndex < 0) return value

  let endIndex = value.length
  while (endIndex > decimalIndex && value[endIndex - 1] === '0') {
    endIndex -= 1
  }
  if (endIndex > decimalIndex && value[endIndex - 1] === '.') {
    endIndex -= 1
  }

  return value.slice(0, endIndex)
}
