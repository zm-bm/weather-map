export function createAbortError() {
  const error = new Error('Operation aborted')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return (error as { name?: unknown } | null)?.name === 'AbortError'
}

export function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
