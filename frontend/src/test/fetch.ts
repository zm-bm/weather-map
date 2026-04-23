import { vi } from 'vitest'

type JsonFetchResponse<T> = {
  ok: true
  json: () => Promise<T>
}

type ArrayBufferFetchResponse = {
  ok: true
  arrayBuffer: () => Promise<ArrayBuffer>
}

type ErrorFetchResponse = {
  ok: false
  status: number
  statusText: string
}

export function createFetchJsonResponse<T>(payload: T): JsonFetchResponse<T> {
  return {
    ok: true,
    json: async () => payload,
  }
}

export function createFetchArrayBufferResponse(
  payload: ArrayBuffer
): ArrayBufferFetchResponse {
  return {
    ok: true,
    arrayBuffer: async () => payload,
  }
}

export function createFetchErrorResponse(
  status: number,
  statusText: string
): ErrorFetchResponse {
  return {
    ok: false,
    status,
    statusText,
  }
}

export function stubFetchJsonOnce<T>(payload: T) {
  const fetchMock = vi.fn().mockResolvedValue(createFetchJsonResponse(payload))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function stubFetchArrayBufferOnce(payload: ArrayBuffer) {
  const fetchMock = vi.fn().mockResolvedValue(createFetchArrayBufferResponse(payload))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
