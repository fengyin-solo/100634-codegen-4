<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>廊内巡检任务管理</h2>
        <p class="page-desc">
          巡检任务台账与标识整改班组入口：台账侧整组提交的补设/更换会同步到本页整改清单，
          班组在另一个入口逐条验收，完工清单两边取到同一份。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出廊内巡检任务清单</button>
      </div>
    </header>

    <div class="tabs">
      <button
        class="tab"
        :class="{ active: tab === 'patrol' }"
        type="button"
        @click="tab = 'patrol'"
      >
        巡检任务
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'rect' }"
        type="button"
        @click="switchRect"
      >
        标识整改清单（班组入口）
        <span v-if="todoCount" class="tab-badge">{{ todoCount }}</span>
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'done' }"
        type="button"
        @click="switchDone"
      >
        标识完工清单
        <span v-if="stats.已完工" class="tab-badge ok">{{ stats.已完工 }}</span>
      </button>
    </div>

    <div v-if="tab === 'patrol'">
      <div class="stat-row">
        <article v-for="item in statsPatrol" :key="item.label" class="stat-card">
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
            <td :colspan="columns.length + 2" class="empty-state">暂无廊内巡检任务数据，可先登记巡检任务</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条廊内巡检任务记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </div>

    <div v-else-if="tab === 'rect'">
      <div class="stat-row sign-stats">
        <article class="stat-card">
          <span class="stat-label">待施工回执</span>
          <strong class="stat-value">{{ stats.待回执 }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待班组验收</span>
          <strong class="stat-value">{{ stats.待验收 }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">未完成/验收不合格</span>
          <strong class="stat-value">{{ stats.未完成 }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已完工（同步台账）</span>
          <strong class="stat-value">{{ stats.已完工 }}</strong>
        </article>
      </div>
      <p class="tab-note">
        本清单由标识台账整组提交同步生成；班组在此对「已完成（待验收）」的桩号逐条验收，
        合格即进完工清单，不合格写明缘由退回。读数与台账页一致。
      </p>
      <RectTodoList :rows="todoRows" mode="accept" @changed="reloadSignage" />
    </div>

    <div v-else>
      <p class="tab-note">验收合格的桩号统一落到这里，与标识台账页取到同一份完工清单。</p>
      <CompletedList :rows="completedRows" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import RectTodoList from '@/views/signage/components/RectTodoList.vue'
import CompletedList from '@/views/signage/components/CompletedList.vue'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  listCompletedItems,
  listTodoItems,
  signageStats,
} from '@/data/signage/service'
import type { SignageStats } from '@/data/signage/service'
import type { FlatItem } from '@/data/signage/types'

const meta = moduleMeta('patrol')
const columns = ["巡检编号", "巡检路线", "巡检班组", "计划日期", "完成时间", "发现问题数", "巡检人员", "巡检状态"]
const actions = ["开始巡检", "确认完成", "上报问题"]
const statuses = ["待巡检", "巡检中", "已完成", "已上报"]
const statsPatrol = [{"label": "待巡检任务", "value": 0}, {"label": "巡检中任务", "value": 0}, {"label": "本月发现问题数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const tab = ref<'patrol' | 'rect' | 'done'>('patrol')
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
const todoCount = computed(() => stats.value.待回执 + stats.value.待验收 + stats.value.未完成)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

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

function reloadSignage() {
  todoRows.value = listTodoItems()
  completedRows.value = listCompletedItems()
  stats.value = signageStats()
}

function switchRect() {
  tab.value = 'rect'
  reloadSignage()
}

function switchDone() {
  tab.value = 'done'
  reloadSignage()
}

onMounted(() => {
  reload()
  reloadSignage()
})
</script>

<style scoped>
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
.tab-badge.ok {
  background: #dcfce7;
  color: #166534;
}
.tab-note {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 10px;
}
.sign-stats .stat-card {
  max-width: 220px;
}
</style>
