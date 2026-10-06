<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>廊内巡检任务管理</h2>
        <p class="page-desc">巡检班组的另一处入口：巡检任务、标识牌整改待办、补设完工清单。后两个标签页与「标识牌与里程桩整组台账」取同一份数据。</p>
      </div>
    </header>

    <nav class="tab-bar">
      <button v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: activeTab === tab.key }" type="button" @click="activeTab = tab.key">
        {{ tab.label }}
        <span v-if="tab.badge !== undefined" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </nav>

    <div v-if="activeTab === 'tasks'">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无廊内巡检任务数据</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条廊内巡检任务记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </div>

    <div v-else-if="activeTab === 'rectify'">
      <p class="page-desc same-source-hint">
        班组视角：凡台账里非完好的桩号都在这里。整组台账受理后立即出现为「已派单·待回执」；未补成的行保留缘由并回到「待派单」，可重新勾选派单。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>桩号</th><th>统一编号</th><th>舱室</th><th>种类 / 类型</th><th>现状问题</th><th>整改阶段</th><th>整备单号</th><th>上次未补成缘由</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in signStore.todoList" :key="row.key">
            <td>{{ row.chainageText }}</td>
            <td>{{ row.code }}<span v-if="row.inferredCode" class="tag tag-amber">推定</span></td>
            <td>{{ row.cabin }}</td>
            <td>{{ row.kind }} · {{ row.subType }}</td>
            <td :class="row.condition === '缺失' ? 'error-text' : 'warn-text'">{{ row.condition }}</td>
            <td>
              <span class="tag" :class="row.stage === '待派单' ? 'tag-amber' : 'tag-blue'">{{ row.stage }}</span>
            </td>
            <td>{{ row.orderNo || '—' }}</td>
            <td class="cell-small">{{ row.failReason || '—' }}</td>
          </tr>
          <tr v-if="!signStore.todoList.length">
            <td colspan="8" class="empty-state">整改待办为空，各桩号标识均已补齐。</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>待办 {{ signStore.stats.todo }} 处 · 待派单 {{ signStore.stats.waitingDispatch }} 处 · 在办待回执 {{ signStore.stats.openItems }} 处（与台账读数一致）</span>
        <RouterLink class="link" to="/sign">前往整组台账勾选派单 →</RouterLink>
      </footer>
    </div>

    <div v-else>
      <p class="page-desc same-source-hint">
        验收结果落到本完工清单：只认整备单里“已补齐”的回执，与整组台账入口是同一份派生数据，不会各记各的。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>完工时间</th><th>整备单号</th><th>来源巡检</th><th>施工班组</th><th>桩号</th><th>统一编号</th><th>舱室/种类</th><th>动作</th><th>新膜到期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in signStore.completedList" :key="`${row.orderNo}-${row.signId}`">
            <td>{{ fmt(row.receivedAt) }}</td>
            <td>{{ row.orderNo }}</td>
            <td>{{ row.patrolNo || '—' }}</td>
            <td>{{ row.team || '—' }}</td>
            <td>{{ row.chainageText }}</td>
            <td>{{ row.code }}</td>
            <td>{{ row.cabin }} · {{ row.kind }}</td>
            <td>{{ row.action }}</td>
            <td>{{ row.reflectExpiry }}</td>
          </tr>
          <tr v-if="!signStore.completedList.length">
            <td colspan="9" class="empty-state">暂无完工记录，整备单验收“已补齐”后自动出现在这里。</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>累计完工 {{ signStore.completedList.length }} 处 · 本月 {{ signStore.stats.completedThisMonth }} 处（与台账读数一致）</span>
      </footer>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSignStore } from '@/stores/sign'

const signStore = useSignStore()

const meta = moduleMeta('patrol')
const columns = ["巡检编号", "巡检路线", "巡检班组", "计划日期", "完成时间", "发现问题数", "巡检人员", "巡检状态"]
const actions = ["开始巡检", "确认完成", "上报问题"]
const statuses = ["待巡检", "巡检中", "已完成", "已上报"]

const activeTab = ref<'tasks' | 'rectify' | 'completed'>('rectify')
const tabs = computed(() => [
  { key: 'tasks' as const, label: '巡检任务', badge: undefined },
  { key: 'rectify' as const, label: '标识牌整改待办', badge: signStore.stats.todo },
  { key: 'completed' as const, label: '补设完工清单', badge: signStore.completedList.length },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = computed(() => [
  { label: '待巡检任务', value: rows.value.filter((r) => r.status === '待巡检').length },
  { label: '巡检中任务', value: rows.value.filter((r) => r.status === '巡检中').length },
  { label: '整改待办（标识牌）', value: signStore.stats.todo },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}
void exportRows

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '廊内巡检任务列表读取失败'
  }
}

function fmt(iso: string): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 16)
}

onMounted(reload)
</script>
