<template>
  <div>
    <p v-if="!rows.length" class="empty-tip">完工清单还是空的，验收合格的桩号会落到这里，台账与巡检两边取到同一份。</p>
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
          <th>新膜到期日</th>
          <th>回执时间</th>
          <th>验收时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.itemId">
          <td>{{ row.batchId }}</td>
          <td>{{ row.巡检任务号 || '—' }}</td>
          <td>
            {{ row.编号 }}
            <span v-if="row.编号推定" class="tag presumed">推定编号</span>
          </td>
          <td>{{ row.舱室 }}</td>
          <td>{{ row.桩号 }}</td>
          <td>{{ row.类型 }}</td>
          <td>{{ row.作业类型 }}</td>
          <td>{{ row.新膜到期日 || '沿用原膜' }}</td>
          <td class="time-cell">{{ short(row.回执时间) }}</td>
          <td class="time-cell">{{ short(row.验收时间) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="readout">完工清单读数：{{ rows.length }} 块（与台账页为同一份数据源）</p>
  </div>
</template>

<script setup lang="ts">
import type { FlatItem } from '@/data/signage/types'

defineProps<{ rows: FlatItem[] }>()

function short(stamp: string): string {
  return stamp ? stamp.replace('T', ' ').slice(0, 16) : '—'
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
.time-cell {
  font-size: 12px;
  color: var(--muted);
}
.readout {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
