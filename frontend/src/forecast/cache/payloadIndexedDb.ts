export type PayloadCacheMeta = {
  key: string
  scopeKey: string
  byteLength: number
  lastAccessedAt: number
}

type IndexedDbPayloadRecord = {
  key: string
  payload: ArrayBuffer
}

export type PayloadCacheLookup = {
  meta: PayloadCacheMeta | null
  payload: ArrayBuffer | null
}

export type PayloadCacheUpdate = {
  meta: PayloadCacheMeta
  payload: ArrayBuffer | null
}

export type PayloadIndexedDb = {
  deleteKeys(keys: Iterable<string>): Promise<void>
  listMetadata(): Promise<PayloadCacheMeta[]>
  pruneScope(scopeKey: string): Promise<void>
  readEntry(key: string): Promise<PayloadCacheLookup>
  reset(): Promise<void>
  writeUpdates(updates: PayloadCacheUpdate[]): Promise<void>
}

export function createPayloadIndexedDb(args: {
  dbName: string
  storeName: string
  dbVersion?: number
}): PayloadIndexedDb {
  const dbVersion = args.dbVersion ?? 2
  const payloadStoreName = args.storeName
  const metaStoreName = `${args.storeName}-meta`

  async function withOpenDb<T>(
    fallback: T,
    run: (db: IDBDatabase) => Promise<T>
  ): Promise<T> {
    const db = await openDb()
    if (!db) return fallback

    try {
      return await run(db)
    } finally {
      db.close()
    }
  }

  function openDb(): Promise<IDBDatabase | null> {
    const indexedDb = globalThis.indexedDB
    if (!indexedDb) return Promise.resolve(null)

    return new Promise((resolve) => {
      const request = indexedDb.open(args.dbName, dbVersion)

      request.onupgradeneeded = () => {
        const db = request.result
        const hasPayloadStore = db.objectStoreNames.contains(payloadStoreName)
        const hasMetaStore = db.objectStoreNames.contains(metaStoreName)

        // This is a cache. When upgrading from the old single-store schema,
        // clear persisted payloads so future eviction scans only touch metadata.
        if (hasPayloadStore && !hasMetaStore) {
          db.deleteObjectStore(payloadStoreName)
        }
        if (!db.objectStoreNames.contains(payloadStoreName)) {
          db.createObjectStore(payloadStoreName, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(metaStoreName)) {
          db.createObjectStore(metaStoreName, { keyPath: 'key' })
        }
      }
      request.onerror = () => resolve(null)
      request.onsuccess = () => resolve(request.result)
    })
  }

  function getStoreRecord<T>(
    db: IDBDatabase,
    storeName: string,
    key: string
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const transaction = db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      request.onerror = () => resolve(null)
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    })
  }

  function listStoreRecords<T>(
    db: IDBDatabase,
    storeName: string
  ): Promise<T[]> {
    return new Promise((resolve) => {
      const transaction = db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.openCursor()
      const records: T[] = []

      request.onerror = () => resolve(records)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(records)
          return
        }

        records.push(cursor.value as T)
        cursor.continue()
      }
    })
  }

  function putStoreRecords<T extends { key: string }>(
    db: IDBDatabase,
    storeName: string,
    records: T[]
  ): Promise<void> {
    if (records.length === 0) return Promise.resolve()

    return new Promise((resolve) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      for (const record of records) {
        store.put(record)
      }

      transaction.onabort = () => resolve()
      transaction.onerror = () => resolve()
      transaction.oncomplete = () => resolve()
    })
  }

  function deleteStoreKeys(
    db: IDBDatabase,
    storeName: string,
    keys: Iterable<string>
  ): Promise<void> {
    const keyList = Array.from(keys)
    if (keyList.length === 0) return Promise.resolve()

    return new Promise((resolve) => {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      for (const key of keyList) {
        store.delete(key)
      }

      transaction.onabort = () => resolve()
      transaction.onerror = () => resolve()
      transaction.oncomplete = () => resolve()
    })
  }

  function toPayloadBlobs(
    updates: PayloadCacheUpdate[]
  ): IndexedDbPayloadRecord[] {
    return updates.flatMap((update) => (
      update.payload == null
        ? []
        : [{ key: update.meta.key, payload: update.payload }]
    ))
  }

  return {
    async deleteKeys(keys) {
      const keyList = Array.from(keys)
      await withOpenDb(undefined, async (db) => {
        await Promise.all([
          deleteStoreKeys(db, payloadStoreName, keyList),
          deleteStoreKeys(db, metaStoreName, keyList),
        ])
      })
    },

    async listMetadata() {
      return withOpenDb<PayloadCacheMeta[]>([], (db) => (
        listStoreRecords<PayloadCacheMeta>(db, metaStoreName)
      ))
    },

    async pruneScope(scopeKey) {
      await withOpenDb(undefined, async (db) => {
        const metadata = await listStoreRecords<PayloadCacheMeta>(db, metaStoreName)
        const staleKeys = new Set(
          metadata
            .filter((record) => record.scopeKey !== scopeKey)
            .map((record) => record.key)
        )

        await Promise.all([
          deleteStoreKeys(db, payloadStoreName, staleKeys),
          deleteStoreKeys(db, metaStoreName, staleKeys),
        ])
      })
    },

    async readEntry(key) {
      return withOpenDb<PayloadCacheLookup>(
        { payload: null, meta: null },
        async (db) => {
          const [payloadRecord, metaRecord] = await Promise.all([
            getStoreRecord<IndexedDbPayloadRecord>(db, payloadStoreName, key),
            getStoreRecord<PayloadCacheMeta>(db, metaStoreName, key),
          ])

          return {
            payload: payloadRecord?.payload ?? null,
            meta: metaRecord,
          }
        }
      )
    },

    async reset() {
      const indexedDb = globalThis.indexedDB
      if (!indexedDb) return

      await new Promise<void>((resolve) => {
        const request = indexedDb.deleteDatabase(args.dbName)
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
        request.onsuccess = () => resolve()
      })
    },

    async writeUpdates(updates) {
      await withOpenDb(undefined, async (db) => {
        const payloadRecords = toPayloadBlobs(updates)
        const metaRecords = updates.map((update) => update.meta)

        await Promise.all([
          putStoreRecords(db, payloadStoreName, payloadRecords),
          putStoreRecords(db, metaStoreName, metaRecords),
        ])
      })
    },
  }
}
