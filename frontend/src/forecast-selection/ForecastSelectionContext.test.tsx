import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asScalarVariableId, asVectorVariableId } from '../manifest'
import { createManifestFixture } from '../test/fixtures'
import { useForecastSelectionContext } from './ForecastSelectionContext'
import ForecastSelectionProvider from './ForecastSelectionProvider'

function ForecastSelectionProbe() {
  const context = useForecastSelectionContext()

  return (
    <div>
      <div data-testid="active-scalar">{context.activeScalar}</div>
      <div data-testid="active-vector">{context.activeVector}</div>
      <div data-testid="tmp-unit">{context.getScalarUnitOptionId('tmp_surface', 'celsius')}</div>
      <div data-testid="prate-unit">{context.getScalarUnitOptionId('prate_surface', 'mm_per_hour')}</div>
      <div data-testid="wind-unit">{context.getVectorUnitOptionId('wind10m_uv', 'm/s')}</div>
      <button type="button" onClick={() => context.setActiveScalar(asScalarVariableId('rh_2m'))}>
        set-scalar-rh
      </button>
      <button type="button" onClick={() => context.setActiveVector(asVectorVariableId('wind10m_uv'))}>
        set-vector-wind
      </button>
      <button type="button" onClick={() => context.setScalarUnitOptionId('tmp_surface', 'fahrenheit')}>
        set-temp-f
      </button>
      <button type="button" onClick={() => context.setScalarUnitOptionId('prate_surface', 'in_per_hour')}>
        set-prate-in
      </button>
      <button type="button" onClick={() => context.setVectorUnitOptionId('wind10m_uv', 'knots')}>
        set-wind-knots
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

  it('persists scalar unit selections per variable id and keeps vector unit defaults/readouts available', () => {
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

    expect(screen.getByTestId('tmp-unit')).toHaveTextContent('celsius')
    expect(screen.getByTestId('prate-unit')).toHaveTextContent('mm_per_hour')
    expect(screen.getByTestId('wind-unit')).toHaveTextContent('m/s')

    fireEvent.click(screen.getByRole('button', { name: 'set-temp-f' }))
    expect(screen.getByTestId('tmp-unit')).toHaveTextContent('fahrenheit')
    expect(screen.getByTestId('prate-unit')).toHaveTextContent('mm_per_hour')

    fireEvent.click(screen.getByRole('button', { name: 'set-prate-in' }))
    expect(screen.getByTestId('tmp-unit')).toHaveTextContent('fahrenheit')
    expect(screen.getByTestId('prate-unit')).toHaveTextContent('in_per_hour')

    fireEvent.click(screen.getByRole('button', { name: 'set-wind-knots' }))
    expect(screen.getByTestId('wind-unit')).toHaveTextContent('knots')
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
