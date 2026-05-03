import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FORECAST_MODEL_OPTIONS, type ForecastModelId } from '../../forecast-models'
import { asScalarProductId } from '../../manifest'
import {
  createManifestFixture,
  createScalarProductFixture,
} from '../../test/fixtures'
import { ForecastSelectionProvider } from '../../forecast-selection'
import ForecastPanel from './ForecastPanel'

function createForecastPanelProps(overrides: {
  activeModelId?: ForecastModelId
  onActiveModelChange?: (modelId: ForecastModelId) => void
} = {}) {
  return {
    activeModelId: overrides.activeModelId ?? 'gfs',
    modelOptions: FORECAST_MODEL_OPTIONS,
    onActiveModelChange: overrides.onActiveModelChange ?? vi.fn(),
  }
}

function createPanelManifest(
  scalarProducts: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface'],
  options: { model?: { id: string, label: string } } = {}
) {
  return createManifestFixture({
    cycle: '2026041100',
    model: options.model,
    scalarProducts,
    groups: [
      {
        id: 'temperature',
        kind: 'scalar',
        label: 'Temperature',
        defaultProduct: asScalarProductId('tmp_surface'),
        products: [asScalarProductId('tmp_surface')],
      },
      {
        id: 'moisture',
        kind: 'scalar',
        label: 'Moisture',
        defaultProduct: asScalarProductId('rh_surface'),
        products: [asScalarProductId('rh_surface')],
      },
    ],
    vectorProducts: ['wind10m_uv'],
    products: {
      tmp_surface: createScalarProductFixture(),
      rh_surface: createScalarProductFixture({
        label: 'Relative Humidity',
        units: '%',
        parameter: 'rh',
        valueRange: { min: 0, max: 100 },
      }),
    },
  })
}

function renderForecastPanel(scalarProducts: ['tmp_surface', 'rh_surface'] | ['rh_surface', 'tmp_surface']) {
  return render(
    <ForecastSelectionProvider manifest={createPanelManifest(scalarProducts)}>
      <ForecastPanel {...createForecastPanelProps()} />
    </ForecastSelectionProvider>
  )
}

function createInteractivePanelManifest(
  activeScalar: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface',
  cycle = '2026041118'
) {
  return createManifestFixture({
    cycle,
    scalarProducts: Array.from(new Set([activeScalar, 'tmp_surface', 'aptmp_surface', 'prmsl_surface'])),
    groups: [
      {
        id: 'temperature',
        kind: 'scalar',
        label: 'Temperature',
        defaultProduct: asScalarProductId('tmp_surface'),
        products: [asScalarProductId('tmp_surface'), asScalarProductId('aptmp_surface')],
      },
      {
        id: 'pressure',
        kind: 'scalar',
        label: 'Pressure',
        defaultProduct: asScalarProductId('prmsl_surface'),
        products: [asScalarProductId('prmsl_surface')],
      },
    ],
    vectorProducts: ['wind10m_uv', 'gust10m_uv'],
    products: {
      tmp_surface: createScalarProductFixture(),
      aptmp_surface: createScalarProductFixture({
        label: 'Apparent Temperature',
        parameter: 'aptmp',
      }),
      prmsl_surface: createScalarProductFixture({
        label: 'Pressure',
        units: 'Pa',
        parameter: 'pressure',
        valueRange: { min: 98000, max: 103500 },
      }),
    },
  })
}

function renderInteractiveForecastPanel(
  activeScalar: 'tmp_surface' | 'aptmp_surface' | 'prmsl_surface' = 'tmp_surface',
  cycle?: string
) {
  return render(
    <ForecastSelectionProvider manifest={createInteractivePanelManifest(activeScalar, cycle)}>
      <ForecastPanel {...createForecastPanelProps()} />
    </ForecastSelectionProvider>
  )
}

describe('ForecastPanel', () => {
  it('renders forecast controls without probe readouts', () => {
    renderForecastPanel(['tmp_surface', 'rh_surface'])

    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Measurement')).toHaveValue('tmp_surface')
    expect(screen.getByLabelText('Forecast model GFS, forecast cycle initialized Apr 11, 00Z')).toHaveTextContent(/CYCLE APR 11 00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('gfs')
    expect(screen.getByText('CYCLE APR 11 00Z')).toBeInTheDocument()
    expect(screen.queryByLabelText('Forecast level')).not.toBeInTheDocument()
    expect(screen.queryByText('Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
    expect(screen.queryByText('-- / --')).not.toBeInTheDocument()
    expect(screen.queryByText('Click map')).not.toBeInTheDocument()
  })

  it('updates the active forecast model from the model selector', () => {
    const onActiveModelChange = vi.fn()

    render(
      <ForecastSelectionProvider
        manifest={createPanelManifest(['tmp_surface', 'rh_surface'], {
          model: { id: 'icon', label: 'ICON' },
        })}
      >
        <ForecastPanel
          {...createForecastPanelProps({
            activeModelId: 'icon',
            onActiveModelChange,
          })}
        />
      </ForecastSelectionProvider>
    )

    expect(screen.getByLabelText('Forecast model ICON, forecast cycle initialized Apr 11, 00Z')).toHaveTextContent(/ICONCYCLE APR 11 00Z/)
    expect(screen.getByLabelText('Forecast model')).toHaveValue('icon')

    fireEvent.change(screen.getByLabelText('Forecast model'), {
      target: { value: 'gfs' },
    })

    expect(onActiveModelChange).toHaveBeenCalledWith('gfs')
  })

  it('updates active scalar through category and measurement controls without rendering unit controls', () => {
    renderInteractiveForecastPanel('tmp_surface')

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveTextContent('Temperature')
    expect(measurement.value).toBe('tmp_surface')
    expect(screen.getByRole('option', { name: 'Temperature' })).toHaveValue('tmp_surface')
    expect(screen.getByRole('option', { name: 'Apparent Temperature' })).toHaveValue('aptmp_surface')
    expect(screen.queryByRole('option', { name: 'tmp_surface' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'aptmp_surface' })).not.toBeInTheDocument()

    fireEvent.change(measurement, {
      target: { value: 'aptmp_surface' },
    })
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('aptmp_surface')

    fireEvent.click(screen.getByRole('button', { name: 'Pressure' }))
    expect(screen.getByRole('button', { name: 'Pressure' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('prmsl_surface')

    fireEvent.click(screen.getByRole('button', { name: 'Temperature' }))
    expect(screen.getByRole('button', { name: 'Temperature' })).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByLabelText('Measurement') as HTMLSelectElement).value).toBe('tmp_surface')

    expect(screen.queryByLabelText('Scalar units')).not.toBeInTheDocument()
  })

  it('keeps scalar selection controls after the probe readout moves onto the map', () => {
    renderForecastPanel(['rh_surface', 'tmp_surface'])

    expect(screen.getByText('Relative Humidity')).toBeInTheDocument()
    expect(screen.queryByText('Lat / Lon')).not.toBeInTheDocument()
    expect(screen.queryByText('Value')).not.toBeInTheDocument()
  })

  it('shows cloud layers as a Clouds measurement option', () => {
    render(
      <ForecastSelectionProvider
        manifest={createManifestFixture({
          cycle: '2026041118',
          scalarProducts: ['tcdc', 'cloud_layers'],
          groups: [
            {
              id: 'clouds',
              kind: 'scalar',
              label: 'Clouds',
              defaultProduct: asScalarProductId('tcdc'),
              products: [asScalarProductId('tcdc'), asScalarProductId('cloud_layers')],
            },
          ],
          vectorProducts: ['wind10m_uv'],
          products: {
            tcdc: createScalarProductFixture({
              label: 'Total Cloud Cover',
              units: '%',
              parameter: 'tcdc',
              valueRange: { min: 0, max: 100 },
            }),
            cloud_layers: createScalarProductFixture({
              label: 'Cloud Layers',
              units: '%',
              parameter: 'cloud_layers',
              valueRange: { min: 0, max: 100 },
            }),
          },
        })}
      >
        <ForecastPanel {...createForecastPanelProps()} />
      </ForecastSelectionProvider>
    )

    const measurement = screen.getByLabelText('Measurement') as HTMLSelectElement
    expect(screen.getByRole('button', { name: 'Clouds' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('option', { name: 'Cloud Layers' })).toHaveValue('cloud_layers')

    fireEvent.change(measurement, {
      target: { value: 'cloud_layers' },
    })

    expect(measurement.value).toBe('cloud_layers')
  })
})
