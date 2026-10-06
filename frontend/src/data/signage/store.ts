import type { SignageState } from './types'

/**
 * 标识台账存储：与模块台账同一个 localStorage，单独一个键、一份状态。
 * 所有写操作走 commitState：先序列化到存储，存储抛错就回滚、缓存保持旧值，
 * 不允许字段落了一半的中间态出现。
 */

const STORAGE_KEY = 'urban-utility-tunnel:signage'

function emptyState(): SignageState {
  return { version: 1, backfilled: false, 回填时间: '', markers: [], batches: [] }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 测试用的内存 localStorage 兜底；浏览器里直接用 window.localStorage。 */
const memoryStore = new Map<string, string>()

function storage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  return {
    getItem: (key: string) => (memoryStore.has(key) ? memoryStore.get(key)! : null),
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value)
    },
    removeItem: (key: string) => {
      memoryStore.delete(key)
    },
    clear: () => memoryStore.clear(),
    key: (index: number) => [...memoryStore.keys()][index] ?? null,
    get length() {
      return memoryStore.size
    },
  }
}

/** 故障注入开关：打开后下一次提交会在写入阶段抛错，用来验证整套退回。 */
let failNextWrite = false

export function armWriteFailure(): void {
  failNextWrite = true
}

function persist(next: SignageState): void {
  if (failNextWrite) {
    failNextWrite = false
    throw new Error('模拟存储写入失败：本次整套退回')
  }
  storage()!.setItem(STORAGE_KEY, JSON.stringify(next))
}

let cache: SignageState | null = null

function readState(): SignageState {
  const raw = storage()!.getItem(STORAGE_KEY)
  if (!raw) {
    return emptyState()
  }
  try {
    const parsed = JSON.parse(raw) as SignageState
    if (parsed.version !== 1 || !Array.isArray(parsed.markers) || !Array.isArray(parsed.batches)) {
      return emptyState()
    }
    return parsed
  } catch {
    return emptyState()
  }
}

export function getState(): SignageState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

/**
 * 原子提交：全程在克隆快照上改，最后一次 persist。
 * persist 抛错时缓存仍是旧状态，调用方收到异常，没有任何中间态留在外面。
 */
export function commitState(mutate: (draft: SignageState) => void): void {
  const snapshot = getState()
  const draft = clone(snapshot)
  mutate(draft)
  persist(draft)
  cache = draft
}

export function resetSignage(): void {
  storage()!.removeItem(STORAGE_KEY)
  cache = emptyState()
}
