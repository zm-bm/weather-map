import type { ScalarMeta } from '../forecast-metadata/scalar'

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

type UnitRule = {
  units?: string[]
  labelIncludes?: string[]
  display: UnitDisplay
}

const WHOLE_VALUE_FORMAT: UnitValueFormat = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}

const PRECIPITATION_VALUE_FORMAT: UnitValueFormat = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

const UNIT_RULES: UnitRule[] = [
  {
    labelIncludes: ['temperature'],
    display: {
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
  },
  {
    units: ['%'],
    display: {
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
  },
  {
    labelIncludes: ['pressure'],
    display: {
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
  },
  {
    labelIncludes: ['precipitation rate'],
    display: {
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
  },
]

export function getUnitDisplay(meta: ScalarMeta): UnitDisplay {
  const normalizedLabel = meta.label.toLowerCase()
  const normalizedUnits = meta.units.trim()

  const matchedRule = UNIT_RULES.find((rule) => {
    const unitsMatch = rule.units?.includes(normalizedUnits) ?? false
    const labelMatch = rule.labelIncludes?.some((fragment) => normalizedLabel.includes(fragment)) ?? false
    return unitsMatch || labelMatch
  })

  if (matchedRule) return matchedRule.display

  return {
    defaultOptionId: normalizedUnits || 'default',
    options: [
      {
        id: normalizedUnits || 'default',
        buttonLabel: normalizedUnits || '--',
        units: normalizedUnits || '--',
        convert: (value) => value,
      },
    ],
  }
}

function formatCompactValue(value: number): string {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded
}
