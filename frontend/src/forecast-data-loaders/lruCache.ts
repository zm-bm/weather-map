export type LruCache<T> = {
  clear: () => void
  get: (key: string) => T | null
  set: (key: string, value: T) => void
}

export function createLruCache<T>(limit: number): LruCache<T> {
  const entries = new Map<string, T>()

  return {
    clear() {
      entries.clear()
    },
    get(key) {
      if (!entries.has(key)) return null
      const value = entries.get(key) as T

      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key, value) {
      if (entries.has(key)) {
        entries.delete(key)
      }

      entries.set(key, value)

      while (entries.size > limit) {
        const oldestKey = entries.keys().next().value
        if (oldestKey == null) return
        entries.delete(oldestKey)
      }
    },
  }
}
