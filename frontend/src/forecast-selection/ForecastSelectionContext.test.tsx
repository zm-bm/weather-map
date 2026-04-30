import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asScalarVariableId, asVectorVariableId } from '../manifest'
import { createManifestFixture } from '../test/fixtures'
import { useForecastSelectionContext } from './ForecastSelectionContext'
import ForecastSelectionProvider from './ForecastSelectionProvider'

function ForecastSelectionProbe() {
  const context = useForecastSelectionContext()
  const rawContext = context as unknown as Record<string, unknown>

  return (
    <div>
      <div data-testid="active-scalar">{context.activeScalar}</div>
      <div data-testid="active-vector">{context.activeVector}</div>
      <div data-testid="unit-system">{context.unitSystem}</div>
      <div data-testid="has-scalar-unit-api">{String('getScalarUnitOptionId' in rawContext)}</div>
      <div data-testid="has-vector-unit-api">{String('getVectorUnitOptionId' in rawContext)}</div>
      <button type="button" onClick={() => context.setActiveScalar(asScalarVariableId('rh_2m'))}>
        set-scalar-rh
      </button>
      <button type="button" onClick={() => context.setActiveVector(asVectorVariableId('wind10m_uv'))}>
        set-vector-wind
      </button>
      <button type="button" onClick={() => context.setUnitSystem('metric')}>
        set-metric
      </button>
      <button type="button" onClick={context.toggleUnitSystem}>
        toggle-unit-system
      </button>
    </div>
  )
}

describe('ForecastSelectionContext', () => {
  it('resets scalar/vector defaults when forecast cycle changes', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarVariables: ['tmp_surface', 'rh_2m'],
      vectorVariables: ['wind10m_uv', 'gust10m_uv'],
    })

    const { rerender } = render(
      <ForecastSelectionProvider manifest={firstManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('active-scalar')).toHaveTextContent('tmp_surface')
    expect(screen.getByTestId('active-vector')).toHaveTextContent('wind10m_uv')

    fireEvent.click(screen.getByRole('button', { name: 'set-scalar-rh' }))
    expect(screen.getByTestId('active-scalar')).toHaveTextContent('rh_2m')

    const secondManifest = createManifestFixture({
      cycle: '2026040912',
      scalarVariables: ['tmp_surface', 'rh_2m'],
      vectorVariables: ['gust10m_uv', 'wind10m_uv'],
    })

    rerender(
      <ForecastSelectionProvider manifest={secondManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('active-scalar')).toHaveTextContent('tmp_surface')
    expect(screen.getByTestId('active-vector')).toHaveTextContent('gust10m_uv')
  })

  it('uses one global unit system and omits per-layer unit APIs', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      scalarVariables: ['tmp_surface', 'rh_2m'],
      vectorVariables: ['wind10m_uv', 'gust10m_uv'],
    })

    render(
      <ForecastSelectionProvider manifest={manifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('unit-system')).toHaveTextContent('imperial')
    expect(screen.getByTestId('has-scalar-unit-api')).toHaveTextContent('false')
    expect(screen.getByTestId('has-vector-unit-api')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'set-metric' }))
    expect(screen.getByTestId('unit-system')).toHaveTextContent('metric')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-unit-system' }))
    expect(screen.getByTestId('unit-system')).toHaveTextContent('imperial')
  })

  it('preserves active selections when the manifest changes within the same cycle', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarVariables: ['tmp_surface', 'rh_2m'],
      vectorVariables: ['gust10m_uv', 'wind10m_uv'],
    })

    const { rerender } = render(
      <ForecastSelectionProvider manifest={firstManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('active-scalar')).toHaveTextContent('tmp_surface')
    expect(screen.getByTestId('active-vector')).toHaveTextContent('gust10m_uv')

    fireEvent.click(screen.getByRole('button', { name: 'set-scalar-rh' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-vector-wind' }))

    const secondManifest = createManifestFixture({
      cycle: '2026040900',
      scalarVariables: ['tmp_surface', 'rh_2m'],
      vectorVariables: ['gust10m_uv', 'wind10m_uv'],
      revision: 'same-cycle-new-revision',
    })

    rerender(
      <ForecastSelectionProvider manifest={secondManifest}>
        <ForecastSelectionProbe />
      </ForecastSelectionProvider>
    )

    expect(screen.getByTestId('active-scalar')).toHaveTextContent('rh_2m')
    expect(screen.getByTestId('active-vector')).toHaveTextContent('wind10m_uv')
  })
})
