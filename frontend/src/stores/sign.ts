import { defineStore } from 'pinia'

import {
  LEGACY_SIGNS,
  applyAccept,
  applySubmit,
  backfillLegacy,
  formatChainage,
  precheckSubmit,
  selectCompletedList,
  selectStats,
  selectTodoList,
  suggestedFilmExpiry,
  todayISO,
} from '@/data/sign-domain'
import type {
  AcceptLineInput,
  AcceptReceipt,
  DraftLine,
  LineCheck,
  Sign,
  SignDomainState,
  SignOrder,
  SubmitOrderInput,
  SubmitReceipt,
} from '@/data/sign-domain'

// 标识牌域整块状态存同一个 key：一次事务只写一次，写失败就保留旧状态，不允许字段半落库。
const STORAGE_KEY = 'urban-utility-tunnel:sign-domain:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function buildInitial(): SignDomainState {
  return backfillLegacy(clone(LEGACY_SIGNS))
}

function loadState(): SignDomainState {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SignDomainState
        if (parsed && parsed.version === 1 && Array.isArray(parsed.signs)) {
          return parsed
        }
      } catch {
        // 数据损坏就回到回填态，避免半份数据继续流转
      }
    }
  }
  return buildInitial()
}

interface SignStateShape {
  state: SignDomainState
  /** 演示“落库失败整套退回”时打开，下一次持久化必失败 */
  failNextWrite: boolean
}

/**
 * 标识牌整组台账的唯一数据出口。台账页与巡检页都只读本 store，
 * 待办/完工清单由同一份 signs、orders 派生，两边读数天然一致。
 */
export const useSignStore = defineStore('sign-domain', {
  state: (): SignStateShape => ({
    state: loadState(),
    failNextWrite: false,
  }),
  getters: {
    signs: (s): Sign[] =>
      [...s.state.signs].sort((a, b) => a.chainageM - b.chainageM || a.cabin.localeCompare(b.cabin)),
    orders: (s): SignOrder[] => s.state.orders,
    todoList: (s) => selectTodoList(s.state),
    completedList: (s) => selectCompletedList(s.state),
    stats: (s) => selectStats(s.state),
    today: () => todayISO(),
    defaultFilmExpiry: () => suggestedFilmExpiry(),
  },
  actions: {
    /**
     * 唯一持久化入口：调用方先在草稿上把整套变更做完，最后只写这一次。
     * 写抛错（含演示故障）时调用方不得采用草稿，内存状态保持原样，不留下中间态。
     */
    commit(next: SignDomainState): void {
      if (this.failNextWrite) {
        this.failNextWrite = false
        throw new Error('模拟存储故障：本次整套退回，台账与待办均未更新')
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      }
      this.state = next
    },

    /** 在草稿上跑一整套变更；commit 失败时草稿丢弃，this.state 原样不动。 */
    mutate<T>(fn: (draft: SignDomainState) => T): T {
      const draft = clone(this.state)
      const result = fn(draft)
      this.commit(draft)
      return result
    },

    precheck(lines: DraftLine[]): LineCheck[] {
      return precheckSubmit(lines, this.state.signs, this.state.orders, todayISO())
    },

    submitOrder(input: SubmitOrderInput): SubmitReceipt {
      return this.mutate((draft) => applySubmit(draft, input, new Date()))
    },

    acceptOrder(orderId: number, rows: AcceptLineInput[]): AcceptReceipt {
      return this.mutate((draft) => applyAccept(draft, orderId, rows, new Date()))
    },

    orderById(id: number): SignOrder | undefined {
      return this.state.orders.find((o) => o.id === id)
    },

    signById(id: number): Sign | undefined {
      return this.state.signs.find((s) => s.id === id)
    },

    /** 勾选台账行，生成提交对话框的初始草稿行（桩号按统一口径回填）。 */
    draftFromSigns(ids: number[], action: '补设' | '更换'): DraftLine[] {
      return this.state.signs
        .filter((s) => ids.includes(s.id))
        .sort((a, b) => a.chainageM - b.chainageM)
        .map((s, idx): DraftLine => ({
          lineId: idx + 1,
          signId: s.id,
          cabin: s.cabin,
          kind: s.kind,
          subType: s.kind === '标识牌' ? s.subType : '里程桩',
          chainageText: formatChainage(s.chainageM),
          issue: s.condition === '完好' ? '' : s.condition,
          action,
          newReflectExpiry: suggestedFilmExpiry(),
        }))
    },

    armWriteFailure(): void {
      this.failNextWrite = true
    },

    resetAll(): void {
      this.state = buildInitial()
      this.failNextWrite = false
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
      }
    },
  },
})
