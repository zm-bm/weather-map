import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import {
  useAppStatus,
  useAppStatusActions,
  useAppStatusEntries,
} from './AppStatusContext'
import AppStatusProvider from './AppStatusProvider'
import { selectActiveStatus } from './state'

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppStatusProvider>{children}</AppStatusProvider>
)

describe('AppStatusProvider', () => {
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
        detail: 'Fetching forecast manifest...',
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
        detail: 'forecast manifest fetch failed',
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

  it('does not rewrite timestamps when a status payload is unchanged', () => {
    const { result } = renderHook(() => useAppStatus(), { wrapper })

    act(() => {
      result.current.setStatus('manifest', {
        mode: 'blocking',
        level: 'loading',
        title: 'Loading Forecast',
        detail: 'Fetching forecast manifest...',
      })
    })

    const firstTimestamp = result.current.entries[0]?.updatedAtMs

    act(() => {
      vi.advanceTimersByTime(1000)
      result.current.setStatus('manifest', {
        mode: 'blocking',
        level: 'loading',
        title: 'Loading Forecast',
        detail: 'Fetching forecast manifest...',
      })
    })

    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]?.updatedAtMs).toBe(firstTimestamp)
  })

  it('keeps action-only consumers from rerendering when entries change', () => {
    let actionRenders = 0
    let actionsRef: ReturnType<typeof useAppStatusActions> | null = null

    function ActionsObserver() {
      const actions = useAppStatusActions()

      useEffect(() => {
        actionsRef = actions
        actionRenders += 1
      })

      return null
    }

    function EntriesObserver() {
      useAppStatusEntries()
      return null
    }

    render(
      <AppStatusProvider>
        <ActionsObserver />
        <EntriesObserver />
      </AppStatusProvider>
    )

    expect(actionRenders).toBe(1)

    act(() => {
      actionsRef?.setStatus('manifest', {
        mode: 'blocking',
        level: 'loading',
        title: 'Loading Forecast',
        detail: 'Fetching forecast manifest...',
      })
    })

    expect(actionRenders).toBe(1)
  })
})
