import type { ForecastProductRequest } from './request'
import type {
  ForecastProductId,
  ForecastProductWindows,
  LoadedForecastProducts,
  PreviousForecastProductWindows,
} from './types'
import { setForecastProductWindow } from './productWindows'

type ProductKeyMap = Partial<Record<ForecastProductId, string>>

type CommittedLoadedForecastProducts = {
  productKeys: ProductKeyMap
  probeProductKey: string | null
  loadedProducts: LoadedForecastProducts
}

type ForecastProductMemory = {
  reusableWindowsFor: (request: ForecastProductRequest) => PreviousForecastProductWindows
  shouldClearProbeField: (request: ForecastProductRequest) => boolean
  commit: (request: ForecastProductRequest, data: LoadedForecastProducts) => void
  reset: () => void
}

export function createForecastProductMemory(): ForecastProductMemory {
  let committed: CommittedLoadedForecastProducts | null = null

  return {
    reusableWindowsFor(request) {
      if (committed == null) return {}

      const reusableWindows: ForecastProductWindows = {}
      for (const product of request.products) {
        if (committed.productKeys[product.id] !== product.key) continue
        const window = committed.loadedProducts.products[product.id]
        if (window == null) continue
        setForecastProductWindow(reusableWindows, product.id, window)
      }
      return reusableWindows
    },
    shouldClearProbeField(request) {
      return committed != null && committed.probeProductKey !== probeProductKey(request)
    },
    commit(request, data) {
      committed = {
        productKeys: productKeysFor(request),
        probeProductKey: probeProductKey(request),
        loadedProducts: data,
      }
    },
    reset() {
      committed = null
    },
  }
}

function productKeysFor(request: ForecastProductRequest): ProductKeyMap {
  const productKeys: ProductKeyMap = {}
  for (const product of request.products) {
    productKeys[product.id] = product.key
  }
  return productKeys
}

function probeProductKey(request: ForecastProductRequest): string | null {
  return request.products.find((product) => product.toProbeField != null)?.key ?? null
}
