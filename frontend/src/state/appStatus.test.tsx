import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import AppStatusProvider from './AppStatusProvider'
import {
  selectActiveStatus,
  useAppStatus,
} from './appStatus'

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppStatusProvider>{children}</AppStatusProvider>
)

describe('appStatus state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-14T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('upserts statuses by source and clears entries by source id', () => {
    const { result } = renderHook(() => useAppStatus(), { wrapper })

    act(() => {
      result.current.setStatus('manifest', {
        mode: 'blocking',
        level: 'loading',
        title: 'Loading Forecast',
        detail: 'Fetching manifest...',
      })
    })

    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]?.sourceId).toBe('manifest')
    expect(result.current.entries[0]?.title).toBe('Loading Forecast')

    act(() => {
      result.current.setStatus('manifest', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: 'manifest fetch failed',
      })
    })

    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]?.level).toBe('error')
    expect(result.current.entries[0]?.title).toBe('Forecast Load Failed')

    act(() => {
      result.current.clearStatus('manifest')
    })

    expect(result.current.entries).toHaveLength(0)
  })

  it('selects active status by severity priority before timestamp recency', () => {
    const active = selectActiveStatus([
      {
        sourceId: 'toastInfo',
        updatedAtMs: 100,
        mode: 'toast',
        level: 'info',
        title: 'Info',
        detail: 'Info',
      },
      {
        sourceId: 'blockingLoading',
        updatedAtMs: 200,
        mode: 'blocking',
        level: 'loading',
        title: 'Loading',
        detail: 'Loading',
      },
      {
        sourceId: 'blockingError',
        updatedAtMs: 150,
        mode: 'blocking',
        level: 'error',
        title: 'Error',
        detail: 'Error',
      },
    ])

    expect(active?.sourceId).toBe('blockingError')
  })

  it('breaks ties with latest update timestamp inside the same priority tier', () => {
    const { result } = renderHook(() => useAppStatus(), { wrapper })

    act(() => {
      result.current.setStatus('startupSyncA', {
        mode: 'blocking',
        level: 'error',
        title: 'A',
        detail: 'A',
      })
    })

    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.setStatus('startupSyncB', {
        mode: 'blocking',
        level: 'error',
        title: 'B',
        detail: 'B',
      })
    })

    const active = selectActiveStatus(result.current.entries)
    expect(active?.sourceId).toBe('startupSyncB')
  })
})
