import { describe, expect, it } from 'vitest'

import {
  createCatalogManifestFixture,
  createMultiDatasetManifestFixture,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'
import {
  getActiveRunLayerAvailability,
  getLayerDatasetAvailability,
  hasAnyAvailableDatasetForLayer,
  isLayerAvailableForActiveRun,
  isLayerAvailableForDataset,
  forecastRunScopeKey,
  resolveActiveForecastRun,
  resolveCompatibleActiveForecastRun,
} from './resolution'

describe('manifest index active run resolution', () => {
  it('uses the preferred dataset when it has a latest run', () => {
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createSingleTimeManifestFixture({
        dataset: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      }),
      iconManifest: createSingleTimeManifestFixture({
        dataset: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      }),
    })

    const activeRun = resolveActiveForecastRun(manifest, 'icon')

    expect(activeRun?.datasetId).toBe('icon')
    expect(activeRun?.label).toBe('ICON')
    expect(activeRun?.latest.run.cycle).toBe('2026040912')
  })

  it('falls back to the first dataset with latest data when the preferred dataset is empty', () => {
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: null,
      iconManifest: createSingleTimeManifestFixture({
        dataset: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      }),
    })

    const activeRun = resolveActiveForecastRun(manifest, 'gfs')

    expect(activeRun?.datasetId).toBe('icon')
    expect(activeRun?.latest.run.cycle).toBe('2026040912')
  })

  it('returns null when no dataset has latest data', () => {
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: null,
      iconManifest: null,
    })

    expect(resolveActiveForecastRun(manifest, 'gfs')).toBeNull()
  })

  it('includes run id in cache scope when present', () => {
    const activeRun = resolveActiveForecastRun(createSingleTimeManifestFixture({
      run: {
        cycle: '2026040912',
        run_id: '20260409T130000Z-abcdef12',
        payload_root: 'runs/gfs/2026040912/20260409T130000Z-abcdef12/payloads',
        generated_at: '2026-04-09T13:00:00Z',
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

    expect(getLayerDatasetAvailability(manifest, 'temperature', 'gfs')?.state).toBe('available')
    expect(getActiveRunLayerAvailability(activeRun, 'temperature')?.state).toBe('available')
    expect(isLayerAvailableForDataset(manifest, 'visibility', 'icon')).toBe(false)
    expect(isLayerAvailableForActiveRun(activeRun, 'visibility')).toBe(true)
    expect(hasAnyAvailableDatasetForLayer(manifest, 'visibility')).toBe(true)
    expect(hasAnyAvailableDatasetForLayer(manifest, 'missing_layer')).toBe(false)
  })

  it('resolves a compatible active run for a plain layer id', () => {
    const manifest = createCatalogManifestFixture()
    const iconRun = resolveActiveForecastRun(manifest, 'icon')
    if (!iconRun) throw new Error('Expected icon run fixture')

    const compatibleRun = resolveCompatibleActiveForecastRun(iconRun, 'visibility')

    expect(compatibleRun?.datasetId).toBe('gfs')
  })

})
