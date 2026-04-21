import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createScalarVariableMetaFixture } from '../../test/fixtures'
import { getScalarLayerMeta } from '../../map/scalar'
import { LegendPanelView } from './LegendPanelView'

describe('LegendPanelView', () => {
  it('shows numbers-only tick labels and cycles temperature units', () => {
    const meta = getScalarLayerMeta('tmp_surface', {
      tmp_surface: createScalarVariableMetaFixture(),
    })
    const { container } = render(<LegendPanelView meta={meta} />)

    const tickLabelsBefore = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((el) => el.textContent ?? '')
      .join(' ')
    expect(tickLabelsBefore).toContain('50')
    expect(tickLabelsBefore).toContain('0')
    expect(tickLabelsBefore).not.toContain(' C')

    fireEvent.click(screen.getByRole('button', { name: /cycle temperature units/i }))

    const tickLabelsAfter = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((el) => el.textContent ?? '')
      .join(' ')
    expect(tickLabelsAfter).toContain('120')
    expect(tickLabelsAfter).toContain('0')
    expect(tickLabelsAfter).not.toContain(' F')
  })

  it('shows a static hPa unit pill for pressure', () => {
    const meta = getScalarLayerMeta('prmsl_surface', {
      prmsl_surface: createScalarVariableMetaFixture({
        units: 'Pa',
        parameter: 'pressure',
      }),
    })

    const { container } = render(<LegendPanelView meta={meta} />)

    expect(screen.queryByRole('button', { name: /units hpa/i })).not.toBeInTheDocument()
    expect(screen.getByText('hPa')).toBeInTheDocument()

    const tickLabels = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((el) => el.textContent ?? '')
      .join(' ')
    expect(tickLabels).not.toContain('hPa')
  })

  it('uses rounded precipitation tick labels without repeated units', () => {
    const meta = getScalarLayerMeta('prate_surface', {
      prate_surface: createScalarVariableMetaFixture({
        units: 'kg/m^2/s',
        parameter: 'prate',
      }),
    })

    const { container } = render(<LegendPanelView meta={meta} />)

    const tickLabels = Array.from(container.querySelectorAll('.legend-panel__tick-label'))
      .map((el) => el.textContent ?? '')
      .join(' ')

    expect(tickLabels).toContain('30')
    expect(tickLabels).toContain('15')
    expect(tickLabels).toContain('7')
    expect(tickLabels).not.toContain('mm/hr')
    expect(tickLabels).not.toContain('0.000')

    const topLabel = screen.getByText('30')
    const midHighLabel = screen.getByText('15')
    const midLabel = screen.getByText('7')

    expect(parseFloat(topLabel.style.bottom)).toBeGreaterThan(99)
    expect(parseFloat(midHighLabel.style.bottom)).toBeGreaterThan(70)
    expect(parseFloat(midLabel.style.bottom)).toBeGreaterThan(50)
  })
})
