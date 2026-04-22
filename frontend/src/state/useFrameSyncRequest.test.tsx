import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifestFixture } from '../test/fixtures'
import { useFrameSyncRequest } from './useFrameSyncRequest'

const mocks = vi.hoisted(() => ({
  useProductContext: vi.fn(),
  useTimelineContext: vi.fn(),
}))

vi.mock('./ProductContext', () => ({
  useProductContext: () => mocks.useProductContext(),
}))

vi.mock('./TimelineContext', () => ({
  useTimelineContext: () => mocks.useTimelineContext(),
}))

describe('useFrameSyncRequest', () => {
  let timelineContextValue: ReturnType<typeof mocks.useTimelineContext>

  beforeEach(() => {
    vi.clearAllMocks()

    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
    })

    mocks.useProductContext.mockReturnValue({
      manifest,
      cycle: manifest.cycle,
      scalarVariables: manifest.scalarVariables,
      vectorVariables: manifest.vectorVariables,
      variableMeta: manifest.variableMeta,
      activeScalar: manifest.scalarVariables[0],
      activeVector: manifest.vectorVariables[0],
      scalarUnitOptionIds: {},
      vectorUnitOptionIds: {},
      setActiveScalar: vi.fn(),
      setActiveVector: vi.fn(),
      getScalarUnitOptionId: vi.fn(),
      getVectorUnitOptionId: vi.fn(),
      setScalarUnitOptionId: vi.fn(),
      setVectorUnitOptionId: vi.fn(),
    })

    timelineContextValue = {
      cycle: manifest.cycle,
      forecastHours: manifest.forecastHours,
      state: {
        appliedHourIndex: 1,
        targetHourIndex: 1,
        pendingHourIndex: null,
        isInFlight: false,
        isPlaying: false,
      },
      controls: {
        requestHour: vi.fn(),
        requestNext: vi.fn(),
        requestPrev: vi.fn(),
        togglePlay: vi.fn(),
      },
      sync: {
        onRequestStart: vi.fn(),
        onRequestApplied: vi.fn(),
        onRequestError: vi.fn(),
      },
    }

    mocks.useTimelineContext.mockReturnValue(timelineContextValue)
  })

  it('returns null when manifest is unavailable', () => {
    mocks.useProductContext.mockReturnValue({
      manifest: null,
      cycle: null,
      scalarVariables: [],
      vectorVariables: [],
      variableMeta: null,
      activeScalar: null,
      activeVector: null,
      scalarUnitOptionIds: {},
      vectorUnitOptionIds: {},
      setActiveScalar: vi.fn(),
      setActiveVector: vi.fn(),
      getScalarUnitOptionId: vi.fn(),
      getVectorUnitOptionId: vi.fn(),
      setScalarUnitOptionId: vi.fn(),
      setVectorUnitOptionId: vi.fn(),
    })

    const { result } = renderHook(() => useFrameSyncRequest(0))
    expect(result.current).toBeNull()
  })

  it('builds request from the manifest timeline hour', () => {
    const { result } = renderHook(() => useFrameSyncRequest(0))

    expect(result.current).toEqual(expect.objectContaining({
      activeHourIndex: 1,
      hourToken: '003',
      syncKey: expect.stringContaining(':003:0'),
    }))
  })
})
