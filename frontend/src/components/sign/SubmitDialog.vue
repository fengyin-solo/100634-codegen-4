<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal dialog-wide">
      <header class="modal-head">
        <h3>整组提交补设 / 更换</h3>
        <button class="link" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="form-grid">
        <label class="filter-item">
          <span>来源巡检编号（同步整改清单）</span>
          <input v-model="patrolNo" placeholder="如 PATR-0007，可不填" />
        </label>
        <label class="filter-item">
          <span>施工 / 巡检班组</span>
          <input v-model="team" placeholder="如 机电一班" />
        </label>
      </div>

      <table class="data-table dialog-table">
        <thead>
          <tr>
            <th>行</th><th>舱室</th><th>种类</th><th>类型</th><th>桩号</th><th>现状问题</th>
            <th>动作</th><th>新反光膜到期日</th><th>预检结论</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in lines" :key="line.lineId">
            <td>{{ line.lineId }}</td>
            <td>
              <select v-model="line.cabin">
                <option v-for="c in CABINS" :key="c" :value="c">{{ c }}</option>
              </select>
            </td>
            <td>
              <select v-model="line.kind">
                <option value="里程桩">里程桩</option>
                <option value="标识牌">标识牌</option>
              </select>
            </td>
            <td>
              <select v-if="line.kind === '标识牌'" v-model="line.subType">
                <option value="" disabled>选择牌面</option>
                <option v-for="t in SIGN_SUBTYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <span v-else>里程桩</span>
            </td>
            <td><input v-model="line.chainageText" class="chainage-input" placeholder="K0+250" /></td>
            <td>
              <select v-model="line.issue">
                <option value="">—</option>
                <option v-for="i in ISSUES" :key="i" :value="i">{{ i }}</option>
              </select>
            </td>
            <td>
              <select v-model="line.action">
                <option value="补设">补设</option>
                <option value="更换">更换</option>
              </select>
            </td>
            <td><input v-model="line.newReflectExpiry" type="date" /></td>
            <td>
              <span :class="checkClass(checkOf(line.lineId))">{{ checkOf(line.lineId)?.message ?? '—' }}</span>
            </td>
            <td><button class="link danger" type="button" @click="removeLine(line.lineId)">剔除</button></td>
          </tr>
        </tbody>
      </table>

      <div class="dialog-toolbar">
        <button class="btn" type="button" @click="addLine">增加一行（巡检新发现、台账没有的缺牌桩位）</button>
        <span class="foot-hint">新桩位动作须为「补设」，受理时自动按舱室与桩号建档、推定编号</span>
      </div>

      <div class="check-summary">
        <p v-if="errorChecks.length" class="error-text">
          阻断 {{ errorChecks.length }} 行（红）：桩号非法 / 在办重复 / 动作不符 / 新膜过期等，请改对或剔除，否则整套不落库。
        </p>
        <p v-if="warnChecks.length" class="warn-text">
          提示 {{ warnChecks.length }} 行（黄）：批内重复勾选将自动折叠，只保留第一次；同一块不会多出一条记录。
        </p>
        <p v-if="!errorChecks.length && !warnChecks.length && lines.length" class="ok-text">预检全部通过，可整组提交。</p>
      </div>

      <div v-if="submitError" class="submit-error">{{ submitError }}</div>

      <footer class="modal-foot">
        <span class="foot-hint">共 {{ lines.length }} 行 · 提交后逐行回执</span>
        <span>
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button class="btn primary" type="button" :disabled="!canSubmit" @click="submit">整组提交并落库</button>
        </span>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useSignStore } from '@/stores/sign'
import { CABINS, ISSUES, SIGN_SUBTYPES } from '@/data/sign-domain'
import type { DraftLine, LineCheck, SubmitReceipt } from '@/data/sign-domain'

const props = defineProps<{ initialLines: DraftLine[] }>()
const emit = defineEmits<{ close: []; submitted: [receipt: SubmitReceipt] }>()

const store = useSignStore()
const lines = ref<DraftLine[]>(props.initialLines.map((line, idx) => ({ ...line, lineId: idx + 1 })))
const patrolNo = ref('')
const team = ref('机电一班')
const submitError = ref('')

const checks = computed<LineCheck[]>(() => store.precheck(lines.value))
const checkOf = (lineId: number) => checks.value.find((c) => c.lineId === lineId)
const errorChecks = computed(() => checks.value.filter((c) => c.level === 'error'))
const warnChecks = computed(() => checks.value.filter((c) => c.level === 'warn'))
const canSubmit = computed(() => lines.value.length > 0 && errorChecks.value.length === 0)

function checkClass(check?: LineCheck): string {
  if (!check || check.level === 'ok') return 'check-ok'
  return check.level === 'error' ? 'error-text' : 'warn-text'
}

function removeLine(lineId: number) {
  lines.value = lines.value.filter((line) => line.lineId !== lineId).map((line, idx) => ({ ...line, lineId: idx + 1 }))
}

let seqForNew = lines.value.reduce((max, line) => Math.max(max, line.lineId), 0)
function addLine() {
  seqForNew += 1
  lines.value.push({
    lineId: seqForNew,
    signId: 0,
    cabin: lines.value[0]?.cabin ?? '综合舱',
    kind: '里程桩',
    subType: '里程桩',
    chainageText: '',
    issue: '缺失',
    action: '补设',
    newReflectExpiry: store.defaultFilmExpiry,
  })
  // 行号对用户只表示顺序，重新排一下；预检按行号给提示
  lines.value = lines.value.map((line, idx) => ({ ...line, lineId: idx + 1 }))
  seqForNew = lines.value.length
}

function submit() {
  submitError.value = ''
  try {
    const receipt = store.submitOrder({ patrolNo: patrolNo.value.trim(), team: team.value.trim(), lines: lines.value })
    emit('submitted', receipt)
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '整组提交失败，已整套退回'
  }
}
</script>
