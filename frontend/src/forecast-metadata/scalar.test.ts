import { describe, expect, it } from 'vitest'

import { asProductId } from '../manifest'
import { asScalarLayerId, type ScalarLayerSpec } from '../forecast-catalog'
import { createScalarProductFixture } from '../test/fixtures'
import { getScalarMeta, getScalarStyleByPaletteId } from './scalar'

describe('scalar metadata palettes', () => {
  it('resolves scalar colortables from frontend catalog palette ids', () => {
    const layer: ScalarLayerSpec = {
      id: asScalarLayerId('custom_pressure'),
      artifactId: asProductId('prmsl_surface'),
      label: 'Custom Pressure',
      groupId: 'wind',
      paletteId: 'pressure.msl.pa.v1',
      displayRange: { min: 98_000, max: 103_500 },
    }
    const product = createScalarProductFixture({
      id: 'prmsl_surface',
      units: 'Pa',
      parameter: 'prmsl',
    })

    const meta = getScalarMeta('custom_pressure', { custom_pressure: layer }, { prmsl_surface: product })

    expect(meta.label).toBe('Custom Pressure')
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

  it('rejects scalar layers with unknown palette ids', () => {
    const layer: ScalarLayerSpec = {
      id: asScalarLayerId('custom_scalar'),
      artifactId: asProductId('tmp_surface'),
      label: 'Custom Scalar',
      groupId: 'temperature',
      paletteId: 'missing.palette.v1',
      displayRange: { min: 0, max: 1 },
    }

    expect(() => getScalarMeta('custom_scalar', { custom_scalar: layer }, {
      tmp_surface: createScalarProductFixture(),
    })).toThrow('Unknown scalar paletteId: missing.palette.v1')
  })
})
