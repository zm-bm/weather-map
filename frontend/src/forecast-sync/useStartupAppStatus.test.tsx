import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StartupStatus } from './types'
import { useStartupAppStatus } from './useStartupAppStatus'

const mocks = vi.hoisted(() => ({
  setStatus: vi.fn(),
  clearStatus: vi.fn(),
}))

vi.mock('../app-status', () => ({
  useAppStatusActions: () => ({
    setStatus: mocks.setStatus,
    clearStatus: mocks.clearStatus,
  }),
}))

function createStatus(
  overrides: Partial<StartupStatus> = {}
): StartupStatus {
  return {
    startupPhase: 'idle',
    startupErrorMessage: null,
    retry: vi.fn(),
    ...overrides,
  }
}

describe('useStartupAppStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('clears startup status while idle', () => {
    renderHook(({ status }) => useStartupAppStatus(status), {
      initialProps: {
        status: createStatus(),
      },
    })

    expect(mocks.clearStatus).toHaveBeenCalledWith('startupSync')
    expect(mocks.setStatus).not.toHaveBeenCalled()
  })

  it('publishes loading status while startup is pending', () => {
    renderHook(({ status }) => useStartupAppStatus(status), {
      initialProps: {
        status: createStatus({ startupPhase: 'loading' }),
      },
    })

    expect(mocks.setStatus).toHaveBeenCalledWith('startupSync', {
      mode: 'blocking',
      level: 'loading',
      title: 'Initializing Forecast Map',
      detail: 'Loading initial forecast frames.',
    })
  })

  it('publishes retryable error status when startup fails', () => {
    const retry = vi.fn()

    renderHook(({ status }) => useStartupAppStatus(status), {
      initialProps: {
        status: createStatus({
          startupPhase: 'error',
          startupErrorMessage: 'wind failed',
          retry,
        }),
      },
    })

    expect(mocks.setStatus).toHaveBeenCalledWith('startupSync', {
      mode: 'blocking',
      level: 'error',
      title: 'Forecast Startup Failed',
      detail: 'wind failed',
      actionLabel: 'Retry',
      onAction: retry,
    })
  })

  it('clears startup status on unmount', () => {
    const { unmount } = renderHook(({ status }) => useStartupAppStatus(status), {
      initialProps: {
        status: createStatus({ startupPhase: 'loading' }),
      },
    })

    mocks.clearStatus.mockClear()
    unmount()

    expect(mocks.clearStatus).toHaveBeenCalledWith('startupSync')
  })
})
