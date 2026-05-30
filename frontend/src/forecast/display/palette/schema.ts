import { z } from 'zod'

export type PaletteColor =
  | readonly [number, number, number]
  | readonly [number, number, number, number]

export type PaletteColorStop = {
  readonly value: number
  readonly color: PaletteColor
}

export type RasterPaletteDefinition = {
  readonly id: string
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
}).strict()

const rasterPaletteDefinitionSchema = z.object({
  id: idSchema,
  stops: z.array(colorStopSchema).nonempty(),
}).strict().superRefine((palette, ctx) => {
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

const forecastPalettesSchema = z.array(rasterPaletteDefinitionSchema).nonempty()
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

export function parseForecastPalettes(value: unknown): RasterPaletteDefinition[] {
  return forecastPalettesSchema.parse(value) as RasterPaletteDefinition[]
}
