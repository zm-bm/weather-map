import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createScalarVariableMetaFixture } from '../../test/fixtures'
import { createManifestFixture } from '../../test/fixtures'
import LayerPanel from './LayerPanel'

const mocks = vi.hoisted(() => ({
  setActiveScalar: vi.fn(),
}))

vi.mock('../../state/VariableContext', () => ({
  useLoadedVariableContext: () => {
    const manifest = createManifestFixture({
      cycle: '2026041100',
      scalarVariables: ['tmp_surface', 'rh_surface'],
      vectorVariables: ['wind10m_uv'],
      variableMeta: {
        tmp_surface: createScalarVariableMetaFixture(),
        rh_surface: createScalarVariableMetaFixture({
          units: '%',
          parameter: 'rh',
          valid_min: 0,
          valid_max: 100,
        }),
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
      setActiveScalar: mocks.setActiveScalar,
      setActiveVector: vi.fn(),
    }
  },
}))

describe('LayerPanel', () => {
  it('updates active variable through radio controls', () => {
    render(<LayerPanel />)

    fireEvent.click(screen.getByLabelText('Relative Humidity'))
    expect(mocks.setActiveScalar).toHaveBeenCalledWith('rh_surface')
  })
})
