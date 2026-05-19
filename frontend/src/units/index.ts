import type { LayerMeta } from '../forecast-catalog'

export type UnitSystem = 'imperial' | 'metric'

export type UnitValueFormat = {
  minimumFractionDigits: number
  maximumFractionDigits: number
}

export type UnitOption = {
  id: string
  buttonLabel: string
  units: string
  convert: (value: number) => number
  casing?: 'caps' | 'literal'
  unitSystem?: UnitSystem
  valueFormat?: UnitValueFormat
}

export type UnitDisplay = {
  defaultOptionId: string
  options: UnitOption[]
}

const WHOLE_VALUE_FORMAT: UnitValueFormat = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}

const ONE_DECIMAL_VALUE_FORMAT: UnitValueFormat = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
}

const PRECIPITATION_VALUE_FORMAT: UnitValueFormat = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

const PRECIPITATION_TOTAL_VALUE_FORMAT: UnitValueFormat = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
}

export function formatUnitLabel(label: string): string {
  return label
    .replace(/\^2/g, '²')
    .replace(/\^3/g, '³')
}

export function formatUnitValue(
  value: number,
  option?: UnitOption | null,
): string {
  const format = option?.valueFormat
  if (format == null) return formatCompactValue(value)

  const fixedValue = value.toFixed(format.maximumFractionDigits)
  if (format.minimumFractionDigits >= format.maximumFractionDigits) return fixedValue

  const decimalIndex = fixedValue.indexOf('.')
  if (decimalIndex < 0) return fixedValue

  const minimumLength = decimalIndex + 1 + format.minimumFractionDigits
  let endIndex = fixedValue.length
  while (endIndex > minimumLength && fixedValue[endIndex - 1] === '0') {
    endIndex -= 1
  }
  if (endIndex > decimalIndex && fixedValue[endIndex - 1] === '.') {
    endIndex -= 1
  }

  return fixedValue.slice(0, endIndex)
}

export function getUnitOption(
  display: UnitDisplay,
  optionId?: string | null
): UnitOption {
  const requestedOptionId = optionId ?? display.defaultOptionId
  return display.options.find((option) => option.id === requestedOptionId) ?? display.options[0]!
}

export function getUnitOptionForSystem(
  display: UnitDisplay,
  unitSystem: UnitSystem
): UnitOption {
  return display.options.find((option) => option.unitSystem === unitSystem)
    ?? getUnitOption(display, display.defaultOptionId)
}

export function canToggleUnitSystem(display: UnitDisplay): boolean {
  return display.options.some((option) => option.unitSystem === 'imperial')
    && display.options.some((option) => option.unitSystem === 'metric')
}

const UNIT_DISPLAYS: Record<LayerMeta['unitBehavior'], UnitDisplay> = {
  temperature: {
    defaultOptionId: 'fahrenheit',
    options: [
      {
        id: 'celsius',
        buttonLabel: 'C',
        units: 'C',
        convert: (value) => value,
        unitSystem: 'metric',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
      {
        id: 'fahrenheit',
        buttonLabel: 'F',
        units: 'F',
        convert: (value) => (value * 9) / 5 + 32,
        unitSystem: 'imperial',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  'wind-speed': {
    defaultOptionId: 'miles_per_hour',
    options: [
      {
        id: 'meters_per_second',
        buttonLabel: 'm/s',
        units: 'm/s',
        convert: (value) => value,
        casing: 'literal',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
      {
        id: 'kilometers_per_hour',
        buttonLabel: 'km/h',
        units: 'km/h',
        convert: (value) => value * 3.6,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
      {
        id: 'miles_per_hour',
        buttonLabel: 'mph',
        units: 'mph',
        convert: (value) => value * 2.2369362920544,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  percent: {
    defaultOptionId: 'percent',
    options: [
      {
        id: 'percent',
        buttonLabel: '%',
        units: '%',
        convert: (value) => value,
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  pressure: {
    defaultOptionId: 'hectopascal',
    options: [
      {
        id: 'hectopascal',
        buttonLabel: 'hPa',
        units: 'hPa',
        convert: (value) => value / 100,
        casing: 'literal',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  'precip-rate': {
    defaultOptionId: 'in_per_hour',
    options: [
      {
        id: 'mm_per_hour',
        buttonLabel: 'mm/hr',
        units: 'mm/hr',
        convert: (value) => value,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: PRECIPITATION_VALUE_FORMAT,
      },
      {
        id: 'in_per_hour',
        buttonLabel: 'in/hr',
        units: 'in/hr',
        convert: (value) => value / 25.4,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: PRECIPITATION_VALUE_FORMAT,
      },
    ],
  },
  'precip-total': {
    defaultOptionId: 'inches',
    options: [
      {
        id: 'millimeters',
        buttonLabel: 'mm',
        units: 'mm',
        convert: (value) => value,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: PRECIPITATION_TOTAL_VALUE_FORMAT,
      },
      {
        id: 'inches',
        buttonLabel: 'in',
        units: 'in',
        convert: (value) => value / 25.4,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: PRECIPITATION_TOTAL_VALUE_FORMAT,
      },
    ],
  },
  'snow-depth': {
    defaultOptionId: 'inches',
    options: [
      {
        id: 'centimeters',
        buttonLabel: 'cm',
        units: 'cm',
        convert: (value) => value * 100,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
      {
        id: 'inches',
        buttonLabel: 'in',
        units: 'in',
        convert: (value) => value * 39.37007874015748,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  visibility: {
    defaultOptionId: 'miles',
    options: [
      {
        id: 'kilometers',
        buttonLabel: 'km',
        units: 'km',
        convert: (value) => value / 1000,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: ONE_DECIMAL_VALUE_FORMAT,
      },
      {
        id: 'miles',
        buttonLabel: 'mi',
        units: 'mi',
        convert: (value) => value / 1609.344,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: ONE_DECIMAL_VALUE_FORMAT,
      },
    ],
  },
  height: {
    defaultOptionId: 'feet',
    options: [
      {
        id: 'meters',
        buttonLabel: 'm',
        units: 'm',
        convert: (value) => value,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
      {
        id: 'feet',
        buttonLabel: 'ft',
        units: 'ft',
        convert: (value) => value * 3.280839895013123,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  'water-depth': {
    defaultOptionId: 'inches',
    options: [
      {
        id: 'millimeters',
        buttonLabel: 'mm',
        units: 'mm',
        convert: (value) => value,
        casing: 'literal',
        unitSystem: 'metric',
        valueFormat: PRECIPITATION_TOTAL_VALUE_FORMAT,
      },
      {
        id: 'inches',
        buttonLabel: 'in',
        units: 'in',
        convert: (value) => value / 25.4,
        casing: 'literal',
        unitSystem: 'imperial',
        valueFormat: PRECIPITATION_TOTAL_VALUE_FORMAT,
      },
    ],
  },
  cape: {
    defaultOptionId: 'joules_per_kilogram',
    options: [
      {
        id: 'joules_per_kilogram',
        buttonLabel: 'J/kg',
        units: 'J/kg',
        convert: (value) => value,
        casing: 'literal',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
  reflectivity: {
    defaultOptionId: 'dbz',
    options: [
      {
        id: 'dbz',
        buttonLabel: 'dBZ',
        units: 'dBZ',
        convert: (value) => value,
        casing: 'literal',
        valueFormat: WHOLE_VALUE_FORMAT,
      },
    ],
  },
}

export function getUnitDisplay(meta: LayerMeta): UnitDisplay {
  return UNIT_DISPLAYS[meta.unitBehavior]
}

function formatCompactValue(value: number): string {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded
}
