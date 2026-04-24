function createFakeRequest() {
  return {
    result: undefined,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    onblocked: null,
  } as {
    result: unknown
    onerror: ((event: Event) => unknown) | null
    onsuccess: ((event: Event) => unknown) | null
    onupgradeneeded: ((event: IDBVersionChangeEvent) => unknown) | null
    onblocked: ((event: Event) => unknown) | null
  }
}

function callHandler(
  target: unknown,
  handler: ((event: Event) => unknown) | null,
  event: Event
) {
  if (!handler) return
  handler.call(target as never, event)
}

export function createFakeIndexedDb() {
  const databases = new Map<string, { stores: Map<string, Map<string, unknown>> }>()

  const createObjectStore = (
    store: Map<string, unknown>,
    transaction: { oncomplete: ((event: Event) => unknown) | null } | null
  ) => ({
    createIndex: () => ({}),
    get(key: string) {
      const request = createFakeRequest()
      queueMicrotask(() => {
        request.result = store.get(key)
        callHandler(request, request.onsuccess, {} as Event)
        callHandler(transaction, transaction?.oncomplete ?? null, {} as Event)
      })
      return request
    },
    put(value: { key: string }) {
      queueMicrotask(() => {
        store.set(value.key, value)
        callHandler(transaction, transaction?.oncomplete ?? null, {} as Event)
      })
    },
    delete(key: string) {
      queueMicrotask(() => {
        store.delete(key)
        callHandler(transaction, transaction?.oncomplete ?? null, {} as Event)
      })
    },
    openCursor() {
      const request = createFakeRequest()
      const entries = Array.from(store.entries())
      let index = 0

      const emit = () => {
        if (index >= entries.length) {
          request.result = null
          callHandler(request, request.onsuccess, {} as Event)
          callHandler(transaction, transaction?.oncomplete ?? null, {} as Event)
          return
        }

        const [key, value] = entries[index]
        request.result = {
          value,
          continue: () => {
            index += 1
            queueMicrotask(emit)
          },
          delete: () => {
            store.delete(key)
          },
        }
        callHandler(request, request.onsuccess, {} as Event)
      }

      queueMicrotask(emit)
      return request
    },
  })

  return {
    open(name: string) {
      const request = createFakeRequest()

      queueMicrotask(() => {
        let database = databases.get(name)
        const isNew = database == null
        if (!database) {
          database = { stores: new Map() }
          databases.set(name, database)
        }

        const db = {
          objectStoreNames: {
            contains(storeName: string) {
              return database?.stores.has(storeName) ?? false
            },
          },
          createObjectStore(storeName: string) {
            const store = new Map<string, unknown>()
            database?.stores.set(storeName, store)
            return createObjectStore(store, null)
          },
          deleteObjectStore(storeName: string) {
            database?.stores.delete(storeName)
          },
          transaction(storeName: string) {
            const store = database?.stores.get(storeName) ?? new Map<string, unknown>()
            database?.stores.set(storeName, store)
            const transaction = {
              onabort: null,
              oncomplete: null,
              onerror: null,
              objectStore() {
                return createObjectStore(store, transaction)
              },
            }
            return transaction
          },
          close() {
            // no-op
          },
        }

        request.result = db
        if (isNew) {
          callHandler(
            request,
            request.onupgradeneeded as ((event: Event) => unknown) | null,
            {} as IDBVersionChangeEvent
          )
        }
        callHandler(request, request.onsuccess, {} as Event)
      })

      return request
    },
    deleteDatabase(name: string) {
      const request = createFakeRequest()
      queueMicrotask(() => {
        databases.delete(name)
        callHandler(request, request.onsuccess, {} as Event)
      })
      return request
    },
  }
}
