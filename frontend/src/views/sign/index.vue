<template>
  <section class="page sign-page">
    <header class="page-head">
      <div>
        <h2>标识牌与里程桩整组台账</h2>
        <p class="page-desc">
          按桩号勾选多处标识，一次提交补设或更换，逐块给出验收回执。同一块重复提交只保留第一次；
          存量按桩号顺序回填，早年无编号者按舱室与远近桩号推定编号。台账、巡检整改待办、完工清单同一份数据。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="armFail" title="制造一次存储故障，验证整套退回、不留中间态">模拟落库失败</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">台账标识总数</span><strong class="stat-value">{{ stats.total }}</strong></article>
      <article class="stat-card"><span class="stat-label">完好</span><strong class="stat-value">{{ stats.intact }}</strong></article>
      <article class="stat-card"><span class="stat-label">整改待办合计</span><strong class="stat-value">{{ stats.todo }}</strong></article>
      <article class="stat-card"><span class="stat-label">待派单</span><strong class="stat-value">{{ stats.waitingDispatch }}</strong></article>
      <article class="stat-card"><span class="stat-label">在办条目（待回执）</span><strong class="stat-value">{{ stats.openItems }}</strong></article>
      <article class="stat-card"><span class="stat-label">本月完工</span><strong class="stat-value">{{ stats.completedThisMonth }}</strong></article>
      <article class="stat-card"><span class="stat-label">未补成累计</span><strong class="stat-value">{{ stats.failedTotal }}</strong></article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>舱室</span>
        <select v-model="filters.cabin">
          <option value="">全部</option>
          <option v-for="c in CABINS" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>种类</span>
        <select v-model="filters.kind">
          <option value="">全部</option>
          <option value="里程桩">里程桩</option>
          <option value="标识牌">标识牌</option>
        </select>
      </label>
      <label class="filter-item">
        <span>现状</span>
        <select v-model="filters.condition">
          <option value="">全部</option>
          <option value="完好">完好</option>
          <option value="破损">破损</option>
          <option value="反光膜脱落">反光膜脱落</option>
          <option value="缺失">缺失</option>
        </select>
      </label>
      <label class="filter-item">
        <span>桩号 / 编号检索</span>
        <input v-model="filters.q" placeholder="如 K0+400 或 RQ-BS" />
      </label>
      <label class="filter-item check-line">
        <input v-model="filters.onlyTodo" type="checkbox" /> 只看待整改
      </label>
    </form>

    <div class="bulk-bar">
      <span class="foot-hint">已勾选 {{ selectedIds.length }} 处</span>
      <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="openSubmit('补设')">整组补设</button>
      <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="openSubmit('更换')">整组更换</button>
      <label class="filter-item check-line bulk-extra">
        <input type="checkbox" :checked="allVisibleChecked" @change="toggleAll" /> 勾选当前筛选全部（{{ filteredSigns.length }}）
      </label>
      <button class="btn ghost" type="button" @click="selectedIds = []">清空勾选</button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">勾选</th>
          <th>统一编号</th>
          <th>舱室</th>
          <th>种类 / 类型</th>
          <th>桩号</th>
          <th>现状</th>
          <th>反光膜到期</th>
          <th>来源 / 登记时刻</th>
          <th>派单与备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredSigns" :key="row.id" :class="{ 'row-film-warn': isOverdue(row.reflectExpiry), 'row-missing': row.condition === '缺失' }">
          <td><input v-model="selectedIds" type="checkbox" :value="row.id" :disabled="row.condition === '完好' && !todoKey(row)" /></td>
          <td>
            {{ row.code }}
            <span v-if="row.inferredCode" class="tag tag-amber" title="按舱室与远近桩号推定">推定</span>
          </td>
          <td>{{ row.cabin }}</td>
          <td>{{ row.kind }} · {{ row.subType }}</td>
          <td>{{ fmtM(row.chainageM) }}</td>
          <td :class="conditionClass(row.condition)">{{ row.condition }}</td>
          <td :class="isOverdue(row.reflectExpiry) ? 'error-text' : ''">{{ row.reflectExpiry || '空（早年缺登记）' }}</td>
          <td class="cell-small">{{ row.source }}<br />{{ fmt(row.registeredAt) }}</td>
          <td class="cell-small">
            <span v-if="todoKey(row)" class="tag tag-blue">在办 {{ todoOrderNo(row) }}</span>
            <span v-else-if="row.condition !== '完好'" class="tag tag-amber">待派单</span>
            <span v-else-if="row.lastFixedAt" class="tag tag-green">已补齐 {{ fmt(row.lastFixedAt) }}</span>
            <span v-if="row.lastFailReason" class="block-fail">上次未补成：{{ row.lastFailReason }}</span>
            <span v-if="row.notes" class="block-note" :title="row.notes">{{ row.notes }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <OrderPanel class="order-section" />

    <SubmitDialog v-if="showDialog" :initial-lines="dialogLines" @close="showDialog = false" @submitted="onSubmitted" />

    <div v-if="receiptPanel" class="receipt-modal-mask" @click.self="receiptPanel = null">
      <div class="modal">
        <header class="modal-head"><h3>整组受理回执 · {{ receiptPanel.orderNo }}</h3><button class="link" type="button" @click="receiptPanel = null">关闭</button></header>
        <div class="receipt-body">
          <p class="ok-text">已受理 {{ receiptPanel.accepted.length }} 处，已进入在办待回执，同步到巡检整改清单。</p>
          <table class="data-table">
            <thead><tr><th>桩号</th><th>编号</th><th>动作</th></tr></thead>
            <tbody>
              <tr v-for="(item, idx) in receiptPanel.accepted" :key="idx">
                <td>{{ item.chainageText }}</td><td>{{ item.code }}</td><td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="receiptPanel.deduped.length" class="warn-text">
            批内重复 {{ receiptPanel.deduped.length }} 行已折叠，只保留第一次勾选，未产生多余记录。
          </p>
          <ul class="receipt-dedup">
            <li v-for="d in receiptPanel.deduped" :key="d.lineId">{{ d.chainageText }}：并入第 {{ d.keepLineId }} 行</li>
          </ul>
          <p v-if="receiptPanel.createdMissing.length" class="foot-hint">
            巡检新发现缺牌 {{ receiptPanel.createdMissing.length }} 处，已先建档（状态“缺失”）再派单。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { useSignStore } from '@/stores/sign'
import { CABINS, formatChainage } from '@/data/sign-domain'
import type { DraftLine, SubmitReceipt } from '@/data/sign-domain'
import SubmitDialog from '@/components/sign/SubmitDialog.vue'
import OrderPanel from '@/components/sign/OrderPanel.vue'

const store = useSignStore()
const { signs, stats, todoList } = storeToRefs(store)
const selectedIds = ref<number[]>([])
const showDialog = ref(false)
const dialogLines = ref<DraftLine[]>([])
const receiptPanel = ref<SubmitReceipt | null>(null)

const filters = reactive({ cabin: '', kind: '', condition: '', q: '', onlyTodo: false })

const filteredSigns = computed(() =>
  signs.value.filter((s) => {
    if (filters.cabin && s.cabin !== filters.cabin) return false
    if (filters.kind && s.kind !== filters.kind) return false
    if (filters.condition && s.condition !== filters.condition) return false
    if (filters.q && !`${s.code} ${formatChainage(s.chainageM)}`.toUpperCase().includes(filters.q.toUpperCase())) return false
    if (filters.onlyTodo && s.condition === '完好') return false
    return true
  }),
)

const allVisibleChecked = computed(
  () => filteredSigns.value.length > 0 && filteredSigns.value.every((s) => selectedIds.value.includes(s.id)),
)

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const selectable = filteredSigns.value.filter((s) => s.condition !== '完好' || todoKey(s)).map((s) => s.id)
  if (checked) {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...selectable]))
  } else {
    const visible = new Set(filteredSigns.value.map((s) => s.id))
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id))
  }
}

function openSubmit(action: '补设' | '更换') {
  dialogLines.value = store.draftFromSigns(selectedIds.value, action)
  if (!dialogLines.value.length) return
  showDialog.value = true
}

function onSubmitted(receipt: SubmitReceipt) {
  showDialog.value = false
  selectedIds.value = []
  receiptPanel.value = receipt
}

function isOverdue(expiry: string): boolean {
  return expiry !== '' && expiry <= store.today
}

function todoKey(row: { cabin: string; kind: '里程桩' | '标识牌'; chainageM: number }): boolean {
  return store.todoList.some(
    (t) => t.cabin === row.cabin && t.kind === row.kind && t.chainageM === row.chainageM && t.stage === '已派单·待回执',
  )
}
function todoOrderNo(row: { cabin: string; kind: '里程桩' | '标识牌'; chainageM: number }): string {
  return store.todoList.find(
    (t) => t.cabin === row.cabin && t.kind === row.kind && t.chainageM === row.chainageM,
  )?.orderNo ?? ''
}

function conditionClass(condition: string): string {
  if (condition === '完好') return 'ok-text'
  if (condition === '缺失') return 'error-text'
  return 'warn-text'
}

function fmtM(meters: number): string {
  return formatChainage(meters)
}
function fmt(iso: string): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 16)
}

function armFail() {
  store.armWriteFailure()
}
function resetAll() {
  store.resetAll()
  selectedIds.value = []
}
</script>
