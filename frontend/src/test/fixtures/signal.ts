export function createSignalFixture(): AbortSignal {
  return new AbortController().signal
}
