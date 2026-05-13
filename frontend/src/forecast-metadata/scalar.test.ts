import { describe, expect, it } from 'vitest'

import { createScalarProductFixture } from '../test/fixtures'
import { getScalarMeta, getScalarStyleByPaletteId } from './scalar'

describe('scalar metadata palettes', () => {
  it('resolves scalar colortables by product style paletteId', () => {
    const product = createScalarProductFixture({
      id: 'custom_pressure',
      label: 'Custom Pressure',
      units: 'Pa',
      parameter: 'prmsl',
      valueRange: { min: 98_000, max: 103_500 },
      style: {
        layerId: 'scalar',
        paletteId: 'pressure.msl.pa.v1',
      },
    })

    const meta = getScalarMeta('custom_pressure', { custom_pressure: product })

    expect(meta.paletteId).toBe('pressure.msl.pa.v1')
    expect(meta.colortable).toBe(getScalarStyleByPaletteId('pressure.msl.pa.v1').colortable)
  })

  it('resolves first-pass direct-band product palettes', () => {
    expect(getScalarStyleByPaletteId('snow.depth.m.v1').colortable.length).toBeGreaterThan(0)
    expect(getScalarStyleByPaletteId('atmosphere.visibility.m.v1').colortable.length).toBeGreaterThan(0)
    expect(getScalarStyleByPaletteId('atmosphere.freezing_level.m.v1').colortable.length).toBeGreaterThan(0)
    expect(getScalarStyleByPaletteId('atmosphere.precipitable_water.mm.v1').colortable.length).toBeGreaterThan(0)
    expect(getScalarStyleByPaletteId('severe.cape.jkg.v1').colortable.length).toBeGreaterThan(0)
  })

  it('rejects scalar products with unknown palette ids', () => {
    const product = createScalarProductFixture({
      id: 'custom_scalar',
      style: {
        layerId: 'scalar',
        paletteId: 'missing.palette.v1',
      },
    })

    expect(() => getScalarMeta('custom_scalar', { custom_scalar: product }))
      .toThrow('Unknown scalar paletteId: missing.palette.v1')
  })
})
