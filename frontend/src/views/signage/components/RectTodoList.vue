<template>
  <div>
    <p v-if="!rows.length" class="empty-tip">暂无整改条目，标识台账整组提交后会同步到这里。</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>批次</th>
          <th>巡检任务号</th>
          <th>标识编号</th>
          <th>舱室</th>
          <th>桩号</th>
          <th>类型</th>
          <th>作业</th>
          <th>阶段</th>
          <th>新膜到期日</th>
          <th>缘由</th>
          <th>提交时间</th>
          <th>回执/验收</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.itemId" :class="phaseClass(row.phase)">
          <td>{{ row.batchId }}</td>
          <td>{{ row.巡检任务号 || '—' }}</td>
          <td>
            {{ row.编号 }}
            <span v-if="presumed(row)" class="tag presumed">推定编号</span>
          </td>
          <td>{{ row.舱室 }}</td>
          <td>{{ row.桩号 }}</td>
          <td>{{ row.类型 }}</td>
          <td>{{ row.作业类型 }}</td>
          <td><span class="phase-badge" :class="phaseClass(row.phase)">{{ row.phase }}</span></td>
          <td>{{ row.新膜到期日 || '沿用原膜' }}</td>
          <td class="reason-cell">{{ row.缘由 || '—' }}</td>
          <td class="time-cell">{{ short(row.提交时间) }}</td>
          <td class="time-cell">{{ short(row.回执时间 || row.验收时间) }}</td>
          <td class="row-actions">
            <template v-if="mode === 'receipt' && row.phase === '待回执'">
              <button class="link ok" type="button" @click="quickDone(row)">回执已完成</button>
              <button class="link bad" type="button" @click="startReason(row, 'fail-receipt')">未完成</button>
            </template>
            <template v-else-if="mode === 'accept' && row.phase === '已完成'">
              <button class="link ok" type="button" @click="accept(row, true)">验收合格</button>
              <button class="link bad" type="button" @click="startReason(row, 'fail-accept')">不合格</button>
            </template>
            <template v-else-if="row.phase === '未完成' || row.phase === '验收不合格'">
              <span class="muted">可在台账重新发起</span>
            </template>
            <template v-else>
              <span class="muted">等待施工回执</span>
            </template>
          </td>
        </tr>
        <tr v-if="editing" class="reason-row">
          <td colspan="13">
            <form class="reason-form" @submit.prevent="confirmReason">
              <label>
                <span v-if="editing.kind === 'fail-receipt'">未补成缘由（另起一行写清）：</span>
                <span v-else>验收不合格缘由：</span>
                <input
                  v-model="reasonText"
                  :placeholder="editing.kind === 'fail-receipt' ? '如：该桩号位置被临时占用，需协调后再补' : '如：桩号位置偏差，需返工'"
                />
              </label>
              <button class="btn primary" type="submit">确认</button>
              <button class="btn ghost" type="button" @click="editing = null">取消</button>
              <span v-if="reasonError" class="error-text">{{ reasonError }}</span>
            </form>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { acceptItem, reportReceipt } from '@/data/signage/service'
import type { FlatItem, ItemPhase } from '@/data/signage/types'

const props = defineProps<{ rows: FlatItem[]; mode: 'receipt' | 'accept' }>()
const emit = defineEmits<{ changed: [] }>()

interface Editing {
  row: FlatItem
  kind: 'fail-receipt' | 'fail-accept'
}
const editing = ref<Editing | null>(null)
const reasonText = ref('')
const reasonError = ref('')

function short(stamp: string): string {
  return stamp ? stamp.replace('T', ' ').slice(0, 16) : '—'
}

function presumed(row: FlatItem): boolean {
  return row.编号推定 === true
}

function phaseClass(phase: ItemPhase): string {
  if (phase === '待回执') return 'ph-wait'
  if (phase === '已完成') return 'ph-done'
  if (phase === '验收合格') return 'ph-pass'
  return 'ph-bad'
}

function quickDone(row: FlatItem) {
  reasonError.value = ''
  reportReceipt(row.itemId, true, '')
  emit('changed')
}

function startReason(row: FlatItem, kind: Editing['kind']) {
  editing.value = { row, kind }
  reasonText.value = ''
  reasonError.value = ''
}

function confirmReason() {
  if (!editing.value) {
    return
  }
  if (!reasonText.value.trim()) {
    reasonError.value = '缘由必填，不能空着退回'
    return
  }
  if (editing.value.kind === 'fail-receipt') {
    reportReceipt(editing.value.row.itemId, false, reasonText.value)
  } else {
    acceptItem(editing.value.row.itemId, false, reasonText.value)
  }
  editing.value = null
  emit('changed')
}

function accept(row: FlatItem, qualified: boolean) {
  acceptItem(row.itemId, qualified, '')
  emit('changed')
}
</script>

<style scoped>
.empty-tip {
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.phase-badge {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.ph-wait {
  background: #fef3c7;
  color: #92400e;
}
.ph-done {
  background: #dbeafe;
  color: #1e40af;
}
.ph-pass {
  background: #dcfce7;
  color: #166534;
}
.ph-bad {
  background: #fee2e2;
  color: #991b1b;
}
tr.ph-bad td {
  background: #fff7f7;
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
.link.ok {
  color: #166534;
}
.link.bad {
  color: #b42318;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.reason-cell,
.time-cell {
  font-size: 12px;
  color: var(--muted);
  max-width: 180px;
}
.reason-row td {
  background: #fffbeb;
}
.reason-form {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.reason-form label {
  flex: 1;
  min-width: 320px;
}
.reason-form label span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.reason-form input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>
