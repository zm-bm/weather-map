import type { ScalarMeta } from '../forecast-metadata/scalar'

export type UnitSystem = 'imperial' | 'metric'

export type UnitOption = {
  id: string
  buttonLabel: string
  units: string
  convert: (value: number) => number
  casing?: 'caps' | 'literal'
  unitSystem?: UnitSystem
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

export function formatUnitLabel(label: string): string {
  return label
    .replace(/\^2/g, '²')
    .replace(/\^3/g, '³')
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
        },
        {
          id: 'fahrenheit',
          buttonLabel: 'F',
          units: 'F',
          convert: (value) => (value * 9) / 5 + 32,
          unitSystem: 'imperial',
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
        },
        {
          id: 'in_per_hour',
          buttonLabel: 'in/hr',
          units: 'in/hr',
          convert: (value) => value / 25.4,
          casing: 'literal',
          unitSystem: 'imperial',
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
