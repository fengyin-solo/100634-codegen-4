<template>
  <section class="page signage-page">
    <header class="page-head">
      <div>
        <h2>标识牌与里程桩整组台账</h2>
        <p class="page-desc">
          按桩号勾选多处标识一次提交；批内重复只认第一次，桩号重复/反光膜过期先拦下，校验通过才落库；
          逐条回执，没补成的另起一行写缘由。补设合格的同步到巡检整改入口的完工清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost danger" type="button" @click="armFailure">模拟下一次落库失败（整套退回演练）</button>
      </div>
    </header>

    <div v-if="!backfilled" class="backfill-banner">
      <div>
        <strong>存量标识尚未回填。</strong>
        <span class="muted">回填按桩号升序逐条入库；早年无编号标识按舱室与远近桩号中点推定编号，缺项留空并注明缘由。</span>
      </div>
      <button class="btn primary" type="button" @click="runBackfill">执行存量回填</button>
    </div>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
        <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </div>

    <!-- 整组提交 -->
    <div v-if="activeTab === 'submit'">
      <form class="batch-bar" @submit.prevent>
        <label class="batch-field">
          <span>对应巡检任务号</span>
          <input v-model="patrolTaskNo" placeholder="如 PATROL-20261006-01，可留空" />
        </label>
        <label class="batch-field">
          <span>统一登记新膜到期日（可选）</span>
          <input v-model="bulkFilmDate" type="date" />
          <button class="btn" type="button" @click="applyBulkFilm">批量填入勾选行</button>
        </label>
        <label class="batch-field check">
          <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          <span>全选待处理标识</span>
        </label>
        <div class="batch-actions">
          <button class="btn primary" type="button" :disabled="!selected.size" @click="runPrecheck">
            提交前校验（已勾 {{ selected.size }} 处）
          </button>
        </div>
      </form>

      <div v-if="precheck" class="precheck-panel">
        <h3>批量校验结果</h3>
        <p class="merge-tip" v-if="precheck.dedupedInBatch">
          批内重复勾选 {{ precheck.dedupedInBatch }} 处已合并，只保留第一次勾选，不会多生成记录。
        </p>
        <table v-if="precheck.issues.length" class="data-table issue-table">
          <thead>
            <tr><th>级别</th><th>舱室</th><th>桩号</th><th>类型</th><th>问题与处置要求</th></tr>
          </thead>
          <tbody>
            <tr v-for="(issue, i) in precheck.issues" :key="i" class="issue-block">
              <td><span class="level-tag block">拦截退回</span></td>
              <td>{{ issue.舱室 }}</td>
              <td>{{ issue.桩号 }}</td>
              <td>{{ issue.类型 }}</td>
              <td>{{ issue.message }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="merge-tip ok">未发现桩号重复、反光膜过期等问题，可以落库。</p>
        <div class="precheck-foot">
          <button
            v-if="precheck.ok"
            class="btn primary"
            type="button"
            :disabled="submitting"
            @click="confirmSubmit"
          >
            {{ submitting ? '提交中…' : `确认整组提交（${precheck.normalized.length} 处）` }}
          </button>
          <button class="btn ghost" type="button" @click="precheck = null">取消</button>
          <span v-if="submitError" class="error-text">{{ submitError }}</span>
        </div>
      </div>

      <div v-if="lastReceipt" class="receipt-panel">
        <h3>上一批次提交回执 · {{ lastReceipt.batchId }}</h3>
        <p class="merge-tip ok">
          已一次落库 {{ lastReceipt.items.length }} 条，同步进入巡检整改清单；
          同一块标识只保留一条，重复不会叠加。
        </p>
        <table class="data-table">
          <thead>
            <tr><th>回执行</th><th>标识编号</th><th>舱室</th><th>桩号</th><th>类型</th><th>作业</th><th>当前阶段</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in lastReceipt.items" :key="item.itemId">
              <td>{{ item.itemId }}</td>
              <td>
                {{ item.编号 }}
                <span v-if="item.编号推定" class="tag presumed">推定</span>
              </td>
              <td>{{ item.舱室 }}</td>
              <td>{{ item.桩号 }}</td>
              <td>{{ item.类型 }}</td>
              <td>{{ item.作业类型 }}</td>
              <td><strong>待施工回执</strong>（已进整改清单，逐块补设后回报，再由班组验收）</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table class="data-table marker-table">
        <thead>
          <tr>
            <th>勾选</th>
            <th>编号</th>
            <th>舱室</th>
            <th>桩号</th>
            <th>类型</th>
            <th>当前状态</th>
            <th>推定作业</th>
            <th>现膜到期日</th>
            <th>本次新膜到期日</th>
            <th>登记时间</th>
            <th>缺项/推定说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="marker in markers" :key="marker.id" :class="{ selectable: selectable(marker) }">
            <td>
              <input
                type="checkbox"
                :value="marker.id"
                :checked="selected.has(marker.id)"
                :disabled="!selectable(marker)"
                @change="toggle(marker.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td>
              {{ marker.编号 }}
              <span v-if="marker.编号推定" class="tag presumed">推定编号</span>
            </td>
            <td>{{ marker.舱室 }}</td>
            <td>{{ marker.桩号 }}</td>
            <td>{{ marker.类型 }}</td>
            <td>
              <span class="state-dot" :class="stateClass(marker.状态)"></span>{{ marker.状态 }}
            </td>
            <td>{{ selectable(marker) ? (marker.状态 === '缺失' ? '补设' : '更换') : '—' }}</td>
            <td :class="{ expired: filmExpired(marker) }">{{ marker.反光膜到期日 || '缺项' }}</td>
            <td>
              <input
                class="film-input"
                type="date"
                :value="filmOverrides.get(marker.id) ?? ''"
                :disabled="!selected.has(marker.id)"
                @input="setFilm(marker.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="time-cell">{{ short(marker.登记时间) }}</td>
            <td class="note-cell">
              <span v-if="marker.推定依据">{{ marker.推定依据 }}</span>
              <span v-if="marker.缺项说明">（{{ marker.缺项说明 }}）</span>
              <span v-if="!marker.推定依据 && !marker.缺项说明">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 逐条回执 -->
    <div v-if="activeTab === 'receipt'">
      <p class="tab-note">逐块回报补设/更换结果；没补成的另起一行写清缘由，条目退回待办，可再次整组发起。</p>
      <RectTodoList :rows="todoRows" mode="receipt" @changed="reload" />
    </div>

    <!-- 完工清单 -->
    <div v-if="activeTab === 'done'">
      <CompletedList :rows="completedRows" />
    </div>

    <!-- 存量台账 -->
    <div v-if="activeTab === 'inventory'">
      <p class="tab-note">
        存量按桩号升序回填，登记时间沿用原档案登记时刻；{{ backfillTime ? `回填时间 ${short(backfillTime)}` : '尚未回填' }}。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th><th>舱室</th><th>桩号(米)</th><th>类型</th><th>状态</th>
            <th>反光膜到期日</th><th>安装日期</th><th>登记时间</th><th>来源</th><th>缺项说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="marker in markers" :key="`inv-${marker.id}`">
            <td>
              {{ marker.编号 }}
              <span v-if="marker.编号推定" class="tag presumed">推定</span>
            </td>
            <td>{{ marker.舱室 }}</td>
            <td>{{ marker.桩号 }}（{{ marker.桩号米 }}m）</td>
            <td>{{ marker.类型 }}</td>
            <td>{{ marker.状态 }}</td>
            <td>{{ marker.反光膜到期日 || '空（早年缺项）' }}</td>
            <td>{{ marker.安装日期 || '空（早年缺项）' }}</td>
            <td class="time-cell">{{ short(marker.登记时间) }}</td>
            <td>{{ marker.来源 }}</td>
            <td class="note-cell">{{ marker.缺项说明 || '—' }}</td>
          </tr>
          <tr v-if="!markers.length">
            <td colspan="10" class="empty-state">先执行存量回填</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>待办 {{ stats.待回执 + stats.待验收 + stats.未完成 }} · 已完工 {{ stats.已完工 }}（巡检入口读数相同）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import RectTodoList from './components/RectTodoList.vue'
import CompletedList from './components/CompletedList.vue'
import { armWriteFailure } from '@/data/signage/store'
import {
  activeMarkerIds,
  backfillLegacy,
  backfillStamp,
  isBackfilled,
  listCompletedItems,
  listMarkers,
  listTodoItems,
  precheckSubmit,
  signageStats,
  submitBatch,
} from '@/data/signage/service'
import type { SignageStats } from '@/data/signage/service'
import type {
  FlatItem,
  MarkerState,
  PrecheckResult,
  RectBatch,
  SignMarker,
} from '@/data/signage/types'

type TabKey = 'submit' | 'receipt' | 'done' | 'inventory'
const activeTab = ref<TabKey>('submit')

const markers = ref<SignMarker[]>([])
const todoRows = ref<FlatItem[]>([])
const completedRows = ref<FlatItem[]>([])
const stats = ref<SignageStats>({
  存量标识: 0,
  推定编号: 0,
  缺失: 0,
  待回执: 0,
  待验收: 0,
  未完成: 0,
  已完工: 0,
})
const backfilled = ref(false)
const backfillTime = ref('')
const errorMessage = ref('')

const selected = ref<Set<number>>(new Set())
const filmOverrides = ref<Map<number, string>>(new Map())
const activeIds = ref<Set<number>>(new Set())
const patrolTaskNo = ref('')
const bulkFilmDate = ref('')
const precheck = ref<PrecheckResult | null>(null)
const lastReceipt = ref<RectBatch | null>(null)
const submitting = ref(false)
const submitError = ref('')

const tabs = computed(() => [
  { key: 'submit' as TabKey, label: '整组提交', badge: 0 },
  {
    key: 'receipt' as TabKey,
    label: '整改回执与待办',
    badge: stats.value.待回执 + stats.value.待验收 + stats.value.未完成,
  },
  { key: 'done' as TabKey, label: '完工清单', badge: stats.value.已完工 },
  { key: 'inventory' as TabKey, label: '存量台账', badge: 0 },
])

const statCards = computed(() => [
  { label: '存量标识', value: stats.value.存量标识 },
  { label: '其中推定编号', value: stats.value.推定编号 },
  { label: '待回执', value: stats.value.待回执 },
  { label: '待验收', value: stats.value.待验收 },
  { label: '未完成/不合格', value: stats.value.未完成 },
  { label: '已完工', value: stats.value.已完工 },
])

const selectableMarkers = computed(() =>
  markers.value.filter((m) => m.状态 !== '完好' && !activeIds.value.has(m.id)),
)
const allChecked = computed(
  () => selectableMarkers.value.length > 0
    && selectableMarkers.value.every((m) => selected.value.has(m.id)),
)

function short(stamp: string): string {
  return stamp ? stamp.replace('T', ' ').slice(0, 16) : '—'
}

function selectable(marker: SignMarker): boolean {
  return marker.状态 !== '完好' && !activeIds.value.has(marker.id)
}

function stateClass(state: MarkerState): string {
  if (state === '完好') return 'ok'
  if (state === '缺失') return 'missing'
  return 'bad'
}

function filmExpired(marker: SignMarker): boolean {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return !marker.反光膜到期日 || marker.反光膜到期日 < today
}

function toggle(id: number, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  selected.value = next
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selected.value = checked ? new Set(selectableMarkers.value.map((m) => m.id)) : new Set()
}

function setFilm(id: number, value: string) {
  const next = new Map(filmOverrides.value)
  if (value) {
    next.set(id, value)
  } else {
    next.delete(id)
  }
  filmOverrides.value = next
}

function applyBulkFilm() {
  if (!bulkFilmDate.value) {
    return
  }
  const next = new Map(filmOverrides.value)
  for (const id of selected.value) {
    next.set(id, bulkFilmDate.value)
  }
  filmOverrides.value = next
}

function buildLines() {
  return [...selected.value].map((markerId) => ({
    markerId,
    新膜到期日: filmOverrides.value.get(markerId) ?? '',
  }))
}

function runPrecheck() {
  submitError.value = ''
  precheck.value = precheckSubmit(buildLines())
}

function confirmSubmit() {
  if (!precheck.value) {
    return
  }
  submitting.value = true
  submitError.value = ''
  try {
    // 作业类型逐条按主档状态推定（缺失→补设，破损/膜脱落→更换）。
    const result = submitBatch(buildLines(), patrolTaskNo.value)
    if (!result.batch) {
      submitError.value = '校验已不再通过，请重新核对后再提交'
      precheck.value = result.precheck
      return
    }
    lastReceipt.value = result.batch
    selected.value = new Set()
    filmOverrides.value = new Map()
    precheck.value = null
    reload()
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '落库失败，整套退回'
  } finally {
    submitting.value = false
  }
}

function runBackfill() {
  errorMessage.value = ''
  try {
    backfillLegacy()
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '回填失败，已整套退回'
  }
}

function armFailure() {
  armWriteFailure()
  errorMessage.value = '已注入一次写入故障：下一次提交/回执/验收将整套退回，可借此核对无中间态'
}

function switchTab(key: TabKey) {
  activeTab.value = key
  reload()
}

function reload() {
  backfilled.value = isBackfilled()
  markers.value = listMarkers()
  todoRows.value = listTodoItems()
  completedRows.value = listCompletedItems()
  stats.value = signageStats()
  backfillTime.value = backfillStamp()
  // 已闭环/已在办的标识不再可勾选，避免重复发起。
  activeIds.value = activeMarkerIds()
  const cleaned = new Set([...selected.value].filter((id) => {
    const marker = markers.value.find((m) => m.id === id)
    return marker && selectable(marker)
  }))
  selected.value = cleaned
}

onMounted(reload)
</script>

<style scoped>
.backfill-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
  font-size: 13px;
}
.btn.danger {
  color: #b42318;
  border-color: #fecaca;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.tab {
  border: none;
  background: none;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}
.tab.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  font-weight: 600;
}
.tab-badge {
  background: #e2e8f0;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
  margin-left: 4px;
}
.tab.active .tab-badge {
  background: var(--brand);
  color: #fff;
}
.batch-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.batch-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.batch-field input[type='text'],
.batch-field input:not([type]) {
  width: 220px;
}
.batch-field input[type='date'] {
  width: 160px;
}
.batch-field.check {
  display: flex;
  align-items: center;
  gap: 6px;
}
.batch-field.check input {
  margin: 0;
}
.batch-actions {
  margin-left: auto;
}
.precheck-panel,
.receipt-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.precheck-panel h3,
.receipt-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.merge-tip {
  font-size: 13px;
  color: #92400e;
  margin: 0 0 8px;
}
.merge-tip.ok {
  color: #166534;
}
.issue-table {
  margin-bottom: 10px;
}
.level-tag {
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 12px;
}
.level-tag.block {
  background: #fee2e2;
  color: #991b1b;
}
.precheck-foot {
  display: flex;
  gap: 10px;
  align-items: center;
}
.marker-table tr.selectable:hover {
  background: #f8fbff;
}
.film-input {
  width: 140px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.state-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}
.state-dot.ok {
  background: #16a34a;
}
.state-dot.missing {
  background: #dc2626;
}
.state-dot.bad {
  background: #d97706;
}
td .expired,
.expired {
  color: #b42318;
  font-weight: 600;
}
.tag {
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  margin-left: 4px;
}
.tag.presumed {
  background: #ede9fe;
  color: #5b21b6;
}
.time-cell,
.note-cell {
  font-size: 12px;
  color: var(--muted);
}
.note-cell {
  max-width: 260px;
}
.tab-note {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 10px;
}
</style>
