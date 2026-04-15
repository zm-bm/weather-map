import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createManifestFixture, createScalarVariableMetaFixture } from '../../test/fixtures'
import LayerLegend from './LayerLegend'

vi.mock('../../state/VariableContext', () => ({
  useLoadedVariableContext: () => {
    const manifest = createManifestFixture({
      cycle: '2026041100',
      scalarVariables: ['tmp_surface'],
      vectorVariables: ['wind10m_uv'],
      variableMeta: {
        tmp_surface: createScalarVariableMetaFixture(),
      },
    })

    return {
      manifest,
      cycle: manifest.cycle,
      scalarVariables: manifest.scalarVariables,
      vectorVariables: manifest.vectorVariables,
      variableMeta: manifest.variableMeta,
      activeScalar: manifest.scalarVariables[0],
      activeVector: manifest.vectorVariables[0],
      setActiveScalar: () => undefined,
      setActiveVector: () => undefined,
    }
  },
}))

describe('LayerLegend', () => {
  it('toggles between converted units for temperature', () => {
    const { container } = render(<LayerLegend />)

    const tickLabelsBefore = Array.from(container.querySelectorAll('.legend-card__tick-label'))
      .map((el) => el.textContent ?? '')
      .join(' ')
    expect(tickLabelsBefore).toContain(' C')

    fireEvent.click(screen.getByRole('button', { name: 'F' }))

    const tickLabelsAfter = Array.from(container.querySelectorAll('.legend-card__tick-label'))
      .map((el) => el.textContent ?? '')
      .join(' ')
    expect(tickLabelsAfter).toContain(' F')
  })
})
