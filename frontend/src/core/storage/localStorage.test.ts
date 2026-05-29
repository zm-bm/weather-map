import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loadLocalStorageJson,
  loadLocalStorageString,
  saveLocalStorageJson,
  saveLocalStorageString,
} from './localStorage'

describe('localStorage helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('loads and saves strings', () => {
    saveLocalStorageString('test:string', 'value')

    expect(loadLocalStorageString('test:string')).toBe('value')
  })

  it('loads and saves validated JSON', () => {
    saveLocalStorageJson('test:json', { value: 42 })

    const loaded = loadLocalStorageJson('test:json', (value) => {
      if (!isRecord(value) || value.value !== 42) return null
      return { value: value.value }
    })

    expect(loaded).toEqual({ value: 42 })
  })

  it('returns null for malformed JSON', () => {
    localStorage.setItem('test:json', '{')

    expect(loadLocalStorageJson('test:json', () => ({ value: 42 }))).toBeNull()
  })

  it('returns null when JSON validation rejects the value', () => {
    saveLocalStorageJson('test:json', { value: '42' })

    const loaded = loadLocalStorageJson('test:json', (value) => {
      if (!isRecord(value) || typeof value.value !== 'number') return null
      return { value: value.value }
    })

    expect(loaded).toBeNull()
  })

  it('returns null when localStorage reads throw', () => {
    vi.spyOn(storagePrototype(), 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    expect(loadLocalStorageString('test:string')).toBeNull()
    expect(loadLocalStorageJson('test:json', () => ({ value: 42 }))).toBeNull()
  })

  it('ignores localStorage write and serialization errors', () => {
    vi.spyOn(storagePrototype(), 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => saveLocalStorageString('test:string', 'value')).not.toThrow()
    expect(() => saveLocalStorageJson('test:json', circular)).not.toThrow()
  })
})

function storagePrototype(): Storage {
  return Object.getPrototypeOf(localStorage) as Storage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
