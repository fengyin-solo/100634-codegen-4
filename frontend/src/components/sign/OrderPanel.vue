<template>
  <section class="order-panel">
    <header class="block-head">
      <h3>整备单与逐条回执</h3>
      <span class="foot-hint">受理是一次整组事务，验收再做一次；未补成的行另起一行写清缘由。</span>
    </header>

    <div v-if="!orders.length" class="empty-state card-pad">还没有整备单，在上方台账按桩号勾选多处后整组提交。</div>

    <article v-for="order in orders" :key="order.id" class="order-card">
      <header class="order-head" @click="toggle(order.id)">
        <div class="order-title">
          <strong>{{ order.orderNo }}</strong>
          <span class="tag" :class="statusTag(order.status)">{{ order.status }}</span>
          <span v-if="order.patrolNo" class="tag plain">同步巡检 {{ order.patrolNo }}</span>
          <span class="tag plain">{{ order.team || '未填班组' }}</span>
        </div>
        <div class="order-meta">
          <span>{{ fmt(order.submittedAt) }} 受理</span>
          <span>·</span>
          <span>{{ order.items.length }} 处</span>
          <span>·</span>
          <span class="ok-text">{{ fixedOf(order) }} 已补齐</span>
          <span v-if="failedOfOrder(order)" class="error-text">· {{ failedOfOrder(order) }} 未补成</span>
          <span class="caret">{{ expandedId === order.id ? '收起 ▲' : '回执 ▼' }}</span>
        </div>
      </header>

      <div v-if="expandedId === order.id" class="order-body">
        <table class="data-table">
          <thead>
            <tr>
              <th>统一编号</th><th>桩号</th><th>舱室/种类</th><th>动作</th><th>受理现状</th>
              <th>验收结果</th><th>新膜到期日</th><th>缘由 / 备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in rowsOf(order)" :key="item.lineId" :class="{ 'row-fixed': item.receipt === '已补齐', 'row-failed': item.receipt === '未补成' }">
              <td>{{ item.code }}</td>
              <td>{{ fmtM(item.chainageM) }}</td>
              <td>{{ item.cabin }} · {{ item.kind }}</td>
              <td>{{ item.action }}</td>
              <td>{{ item.issue }}</td>
              <td>
                <select
                  :value="draftOf(order, item.lineId).receipt"
                  :disabled="item.receipt !== ''"
                  @change="setReceipt(order, item.lineId, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">待验收</option>
                  <option value="已补齐">已补齐</option>
                  <option value="未补成">未补成</option>
                </select>
              </td>
              <td>
                <input
                  v-if="item.receipt === ''"
                  v-model="draftOf(order, item.lineId).newReflectExpiry"
                  type="date"
                />
                <span v-else>{{ item.newReflectExpiry || '—' }}</span>
              </td>
              <td class="note-cell">
                <input
                  v-if="item.receipt === ''"
                  v-model="draftOf(order, item.lineId).note"
                  :placeholder="draftOf(order, item.lineId).receipt === '未补成' ? '未补成缘由必填' : '备注（选填）'"
                />
                <span v-else>{{ item.resultNote || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="acceptErrorOf(order)" class="submit-error">{{ acceptErrorOf(order) }}</p>

        <footer v-if="hasOpen(order)" class="order-foot">
          <span class="foot-hint">一次验收整套原子落库；任一行缘由缺失，整套退回。</span>
          <button class="btn primary" type="button" @click="accept(order)">提交验收结果</button>
        </footer>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { useSignStore } from '@/stores/sign'
import { formatChainage } from '@/data/sign-domain'
import type { AcceptLineInput, ReceiptKind, SignOrder } from '@/data/sign-domain'

const store = useSignStore()
const { orders } = storeToRefs(store)
const expandedId = ref<number | null>(orders.value.length ? orders.value[orders.value.length - 1].id : null)
const drafts = reactive<Record<number, AcceptLineInput[]>>({})
const acceptErrors = reactive<Record<number, string>>({})

function rowsOf(order: SignOrder) {
  return [...order.items].sort((a, b) => a.chainageM - b.chainageM)
}

function draftOf(order: SignOrder, lineId: number): AcceptLineInput {
  if (!drafts[order.id]) {
    drafts[order.id] = order.items.map((it) => ({
      lineId: it.lineId,
      receipt: it.receipt,
      note: it.resultNote,
      newReflectExpiry: it.newReflectExpiry,
    }))
  }
  let row = drafts[order.id].find((r) => r.lineId === lineId)
  if (!row) {
    row = { lineId, receipt: '', note: '', newReflectExpiry: store.defaultFilmExpiry }
    drafts[order.id].push(row)
  }
  return row
}

function setReceipt(order: SignOrder, lineId: number, value: string) {
  draftOf(order, lineId).receipt = value as '' | ReceiptKind
}

function hasOpen(order: SignOrder): boolean {
  return order.items.some((it) => it.receipt === '')
}

function fixedOf(order: SignOrder): number {
  return order.items.filter((it) => it.receipt === '已补齐').length
}
function failedOfOrder(order: SignOrder): number {
  return order.items.filter((it) => it.receipt === '未补成').length
}

function accept(order: SignOrder) {
  acceptErrors[order.id] = ''
  try {
    store.acceptOrder(order.id, drafts[order.id])
    expandedId.value = order.id
  } catch (error) {
    acceptErrors[order.id] = error instanceof Error ? error.message : '验收失败，整套退回'
  }
}

function acceptErrorOf(order: SignOrder): string {
  return acceptErrors[order.id] ?? ''
}

function toggle(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function fmtM(meters: number): string {
  return formatChainage(meters)
}

function fmt(iso: string): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 16)
}

function statusTag(status: SignOrder['status']): string {
  if (status === '已闭环') return 'tag-green'
  if (status === '部分补齐') return 'tag-amber'
  return 'tag-blue'
}
</script>
