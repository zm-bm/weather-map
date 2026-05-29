export function loadLocalStorageString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function saveLocalStorageString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore (private mode / quota / disabled storage / etc.)
  }
}

export function loadLocalStorageJson<T>(
  key: string,
  validate: (value: unknown) => T | null
): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return validate(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveLocalStorageJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore (private mode / quota / circular JSON / etc.)
  }
}
