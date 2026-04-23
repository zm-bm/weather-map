import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStartupState } from './useStartupState'

describe('useStartupState', () => {
  it('transitions from pending to error and retries back into loading', () => {
    const { result } = renderHook(() => useStartupState())

    expect(result.current.status.startupPhase).toBe('idle')
    expect(result.current.retryToken).toBe(0)
    expect(result.current.isBlocked).toBe(false)

    act(() => {
      result.current.handlePending()
    })

    expect(result.current.status.startupPhase).toBe('loading')

    act(() => {
      result.current.handleError(new Error('wind failed'))
    })

    expect(result.current.status.startupPhase).toBe('error')
    expect(result.current.status.startupErrorMessage).toBe('wind failed')
    expect(result.current.isBlocked).toBe(true)

    act(() => {
      result.current.status.retry()
    })

    expect(result.current.status.startupPhase).toBe('loading')
    expect(result.current.status.startupErrorMessage).toBeNull()
    expect(result.current.retryToken).toBe(1)
    expect(result.current.isBlocked).toBe(false)
  })

  it('locks into ready after startup applies and ignores later pending/error calls', () => {
    const { result } = renderHook(() => useStartupState())

    act(() => {
      result.current.handlePending()
      result.current.handleApplied()
    })

    expect(result.current.status.startupPhase).toBe('ready')
    expect(result.current.status.startupErrorMessage).toBeNull()

    act(() => {
      result.current.handlePending()
      result.current.handleError(new Error('too late'))
    })

    expect(result.current.status.startupPhase).toBe('ready')
    expect(result.current.status.startupErrorMessage).toBeNull()
    expect(result.current.isBlocked).toBe(false)
  })

  it('resets all startup state when disabled', () => {
    const { result } = renderHook(() => useStartupState())

    act(() => {
      result.current.handlePending()
      result.current.handleError(new Error('wind failed'))
      result.current.status.retry()
    })

    expect(result.current.retryToken).toBe(1)

    act(() => {
      result.current.handleDisabled()
    })

    expect(result.current.status.startupPhase).toBe('idle')
    expect(result.current.status.startupErrorMessage).toBeNull()
    expect(result.current.retryToken).toBe(0)
    expect(result.current.isBlocked).toBe(false)
  })
})
