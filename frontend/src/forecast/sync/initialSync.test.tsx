import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useInitialSyncController } from './initialSync'

describe('useInitialSyncController', () => {
  it('transitions from pending to error and retries back into loading', () => {
    const { result } = renderHook(() => useInitialSyncController())

    expect(result.current.status.phase).toBe('idle')
    expect(result.current.retryToken).toBe(0)
    expect(result.current.isBlocked).toBe(false)

    act(() => {
      result.current.handlePending()
    })

    expect(result.current.status.phase).toBe('loading')

    act(() => {
      result.current.handleError(new Error('wind failed'))
    })

    expect(result.current.status.phase).toBe('error')
    expect(result.current.status.errorMessage).toBe('wind failed')
    expect(result.current.isBlocked).toBe(true)

    act(() => {
      result.current.status.retry()
    })

    expect(result.current.status.phase).toBe('loading')
    expect(result.current.status.errorMessage).toBeNull()
    expect(result.current.retryToken).toBe(1)
    expect(result.current.isBlocked).toBe(false)
  })

  it('locks into ready after initial sync applies and ignores later pending/error calls', () => {
    const { result } = renderHook(() => useInitialSyncController())

    act(() => {
      result.current.handlePending()
      result.current.handleApplied()
    })

    expect(result.current.status.phase).toBe('ready')
    expect(result.current.status.errorMessage).toBeNull()

    act(() => {
      result.current.handlePending()
      result.current.handleError(new Error('too late'))
    })

    expect(result.current.status.phase).toBe('ready')
    expect(result.current.status.errorMessage).toBeNull()
    expect(result.current.isBlocked).toBe(false)
  })

  it('resets all initial sync state when disabled', () => {
    const { result } = renderHook(() => useInitialSyncController())

    act(() => {
      result.current.handlePending()
      result.current.handleError(new Error('wind failed'))
      result.current.status.retry()
    })

    expect(result.current.retryToken).toBe(1)

    act(() => {
      result.current.handleDisabled()
    })

    expect(result.current.status.phase).toBe('idle')
    expect(result.current.status.errorMessage).toBeNull()
    expect(result.current.retryToken).toBe(0)
    expect(result.current.isBlocked).toBe(false)
  })
})
