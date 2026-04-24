import { describe, expect, it, vi } from 'vitest'

import { clampInterpolationMix, loadFrameWindow } from './window'

describe('forecast frame window helpers', () => {
  it('loads both normalized hour tokens when interpolation is needed', async () => {
    const loadFrame = vi.fn(async (hourToken: string) => ({ hourToken }))

    const frameWindow = await loadFrameWindow({
      selection: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        lowerHourToken: '3',
        upperHourToken: '6',
        mix: 0.5,
      },
      loadFrame,
    })

    expect(loadFrame.mock.calls).toEqual([['003'], ['006']])
    expect(frameWindow.lower).toEqual({ hourToken: '003' })
    expect(frameWindow.upper).toEqual({ hourToken: '006' })
    expect(frameWindow.lowerHourToken).toBe('003')
    expect(frameWindow.upperHourToken).toBe('006')
    expect(frameWindow.mix).toBe(0.5)
  })

  it('reuses the lower frame when the effective hour pair collapses to one frame', async () => {
    const loadFrame = vi.fn(async (hourToken: string) => ({ hourToken }))

    const frameWindow = await loadFrameWindow({
      selection: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
        lowerHourToken: '003',
        upperHourToken: '003',
        mix: 0.75,
      },
      loadFrame,
    })

    expect(loadFrame).toHaveBeenCalledOnce()
    expect(frameWindow.lower).toBe(frameWindow.upper)
    expect(frameWindow.mix).toBe(0)
    expect(frameWindow.upperHourToken).toBe('003')
  })

  it('reuses the previous upper frame as the next lower frame at rollover', async () => {
    const previousWindow = {
      lower: { hourToken: '000' },
      upper: { hourToken: '001' },
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 0, 50),
      lowerHourToken: '000',
      upperHourToken: '001',
      mix: 0.5,
    }
    const loadFrame = vi.fn(async (hourToken: string) => ({ hourToken }))

    const frameWindow = await loadFrameWindow({
      selection: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 1, 10),
        lowerHourToken: '001',
        upperHourToken: '002',
        mix: 0.1,
      },
      previousWindow,
      loadFrame,
    })

    expect(loadFrame.mock.calls).toEqual([['002']])
    expect(frameWindow.lower).toBe(previousWindow.upper)
    expect(frameWindow.upper).toEqual({ hourToken: '002' })
  })

  it('clamps interpolation mix into the unit interval', () => {
    expect(clampInterpolationMix(Number.NaN)).toBe(0)
    expect(clampInterpolationMix(-1)).toBe(0)
    expect(clampInterpolationMix(0.25)).toBe(0.25)
    expect(clampInterpolationMix(2)).toBe(1)
  })
})
