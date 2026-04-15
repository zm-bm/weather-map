import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asScalarVariableId, asVectorVariableId } from '../map/manifest'
import { createManifestFixture } from '../test/fixtures'
import { useVariableContext } from './VariableContext'
import VariableProvider from './VariableProvider'

function VariableProbe() {
  const context = useVariableContext()

  return (
    <div>
      <div data-testid="active-scalar">{context.activeScalar}</div>
      <div data-testid="active-vector">{context.activeVector}</div>
      <button type="button" onClick={() => context.setActiveScalar(asScalarVariableId('rh_2m'))}>
        set-scalar-rh
      </button>
      <button type="button" onClick={() => context.setActiveVector(asVectorVariableId('wind10m_uv'))}>
        set-vector-wind
      </button>
    </div>
  )
}

describe('VariableContext', () => {
  it('resets scalar/vector defaults when forecast cycle changes', () => {
    const firstManifest = createManifestFixture({
      cycle: '2026040900',
      scalarVariables: ['tmp_surface', 'rh_2m'],
      vectorVariables: ['wind10m_uv', 'gust10m_uv'],
    })

    const { rerender } = render(
      <VariableProvider manifest={firstManifest}>
        <VariableProbe />
      </VariableProvider>
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
      <VariableProvider manifest={secondManifest}>
        <VariableProbe />
      </VariableProvider>
    )

    expect(screen.getByTestId('active-scalar')).toHaveTextContent('tmp_surface')
    expect(screen.getByTestId('active-vector')).toHaveTextContent('gust10m_uv')
  })
})
