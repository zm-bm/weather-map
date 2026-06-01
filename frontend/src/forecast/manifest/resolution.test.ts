import { describe, expect, it } from 'vitest'

import {
  createCatalogManifestFixture,
  createMultiModelManifestFixture,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'
import {
  getActiveRunLayerAvailability,
  getLayerModelAvailability,
  hasAnyAvailableModelForLayer,
  isLayerAvailableForActiveRun,
  isLayerAvailableForModel,
  forecastRunScopeKey,
  resolveActiveForecastRun,
  resolveCompatibleActiveForecastRun,
} from './resolution'

describe('forecast manifest active run resolution', () => {
  it('uses the preferred model when it has a latest run', () => {
    const manifest = createMultiModelManifestFixture({
      gfsManifest: createSingleTimeManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      }),
      iconManifest: createSingleTimeManifestFixture({
        model: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      }),
    })

    const activeRun = resolveActiveForecastRun(manifest, 'icon')

    expect(activeRun?.modelId).toBe('icon')
    expect(activeRun?.label).toBe('ICON')
    expect(activeRun?.latest.run.cycle).toBe('2026040912')
  })

  it('falls back to the first model with latest data when the preferred model is empty', () => {
    const manifest = createMultiModelManifestFixture({
      gfsManifest: null,
      iconManifest: createSingleTimeManifestFixture({
        model: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      }),
    })

    const activeRun = resolveActiveForecastRun(manifest, 'gfs')

    expect(activeRun?.modelId).toBe('icon')
    expect(activeRun?.latest.run.cycle).toBe('2026040912')
  })

  it('returns null when no model has latest data', () => {
    const manifest = createMultiModelManifestFixture({
      gfsManifest: null,
      iconManifest: null,
    })

    expect(resolveActiveForecastRun(manifest, 'gfs')).toBeNull()
  })

  it('includes run id in cache scope when present', () => {
    const activeRun = resolveActiveForecastRun(createSingleTimeManifestFixture({
      run: {
        cycle: '2026040912',
        runId: '20260409T130000Z-abcdef12',
        payloadRoot: 'runs/gfs/2026040912/20260409T130000Z-abcdef12/fields',
        generatedAt: '2026-04-09T13:00:00Z',
        revision: 'rev-1',
      },
    }), 'gfs')
    if (!activeRun) throw new Error('Expected active run fixture')

    expect(forecastRunScopeKey(activeRun)).toBe('gfs:2026040912:20260409T130000Z-abcdef12:rev-1')
  })

  it('reads layer availability with plain manifest layer ids', () => {
    const manifest = createCatalogManifestFixture()
    const activeRun = resolveActiveForecastRun(manifest, 'gfs')
    if (!activeRun) throw new Error('Expected active run fixture')

    expect(getLayerModelAvailability(manifest, 'temperature', 'gfs')?.state).toBe('available')
    expect(getActiveRunLayerAvailability(activeRun, 'temperature')?.state).toBe('available')
    expect(isLayerAvailableForModel(manifest, 'visibility', 'icon')).toBe(false)
    expect(isLayerAvailableForActiveRun(activeRun, 'visibility')).toBe(true)
    expect(hasAnyAvailableModelForLayer(manifest, 'visibility')).toBe(true)
    expect(hasAnyAvailableModelForLayer(manifest, 'missing_layer')).toBe(false)
  })

  it('resolves a compatible active run for a plain layer id', () => {
    const manifest = createCatalogManifestFixture()
    const iconRun = resolveActiveForecastRun(manifest, 'icon')
    if (!iconRun) throw new Error('Expected icon run fixture')

    const compatibleRun = resolveCompatibleActiveForecastRun(iconRun, 'visibility')

    expect(compatibleRun?.modelId).toBe('gfs')
  })

})
