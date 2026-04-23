import { describe, expect, it } from 'vitest'

import { selectActiveStatus } from './state'

describe('app-status state', () => {
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
})
