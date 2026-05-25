import { z } from 'zod'

export type PaletteColor =
  | readonly [number, number, number]
  | readonly [number, number, number, number]

export type PaletteColorStop = {
  readonly value: number
  readonly color: PaletteColor
}

export type FieldPaletteDefinition = {
  readonly id: string
  readonly label: string
  readonly valueUnit: string
  readonly outOfRange: 'clamp'
  readonly boundaryMode: 'lower-bound-inclusive'
  readonly stops: readonly PaletteColorStop[]
}

const idSchema = z.string().trim().min(1)
const channelSchema = z.number().int().min(0).max(255)
const colorSchema = z.union([
  z.tuple([channelSchema, channelSchema, channelSchema]),
  z.tuple([channelSchema, channelSchema, channelSchema, channelSchema]),
])

const colorStopSchema = z.object({
  value: z.number().finite(),
  color: colorSchema,
})

const fieldPaletteDefinitionSchema = z.object({
  id: idSchema,
  label: idSchema,
  valueUnit: idSchema,
  outOfRange: z.literal('clamp'),
  boundaryMode: z.literal('lower-bound-inclusive'),
  stops: z.array(colorStopSchema).nonempty(),
}).superRefine((palette, ctx) => {
  let previousValue = Number.NEGATIVE_INFINITY
  for (const [index, stop] of palette.stops.entries()) {
    if (stop.value > previousValue) {
      previousValue = stop.value
      continue
    }
    ctx.addIssue({
      code: 'custom',
      path: ['stops', index, 'value'],
      message: `palette ${palette.id} stop values must be strictly increasing`,
    })
  }
})

const forecastPalettesSchema = z.array(fieldPaletteDefinitionSchema).nonempty()
  .superRefine((palettes, ctx) => {
    const seen = new Set<string>()
    for (const [index, palette] of palettes.entries()) {
      if (!seen.has(palette.id)) {
        seen.add(palette.id)
        continue
      }
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate palette id ${palette.id}`,
      })
    }
  })

export function parseForecastPalettes(value: unknown): FieldPaletteDefinition[] {
  return forecastPalettesSchema.parse(value) as FieldPaletteDefinition[]
}
