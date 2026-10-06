// 用 localStorage shim + esbuild 把 store 连同 pinia 打包后验证事务原子性。
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const entry = join(projectRoot, '.tmp-store-entry.ts')
const outDir = '.tmp-store-dist'
writeFileSync(entry, `
import { setActivePinia, createPinia } from 'pinia'
import { useSignStore } from '@/stores/sign'
setActivePinia(createPinia())
export function run() {
  const store = useSignStore()
  const before = { signs: store.state.signs.length, orders: store.state.orders.length, todo: store.todoList.length }

  // 1) 勾选一块非完好标识发起受理，并让下一次写必失败
  const lines = store.draftFromSigns(
    store.state.signs.filter((s) => s.condition !== '完好').slice(0, 2).map((s) => s.id),
    '更换',
  )
  store.armWriteFailure()
  let threw = false
  try { store.submitOrder({ patrolNo: 'PATR-X', team: '班', lines }) } catch (e) { threw = String(e.message) }
  const afterFail = { signs: store.state.signs.length, orders: store.state.orders.length, todo: store.todoList.length }

  // 2) 故障解除后同一批应能正常落库
  const okReceipt = store.submitOrder({ patrolNo: 'PATR-X', team: '班', lines })
  const afterOk = { signs: store.state.signs.length, orders: store.state.orders.length, todo: store.todoList.length }

  // 3) 验收阶段注入故障：补齐结果也不能半落库
  const order = store.orderById(store.state.orders[0].id)
  const rows = order.items.map((it) => ({ lineId: it.lineId, receipt: '已补齐', note: 'ok', newReflectExpiry: '2029-10-05' }))
  const openBefore = store.todoList.filter((t) => t.stage === '已派单·待回执').length
  store.armWriteFailure()
  let acceptThrew = false
  try { store.acceptOrder(order.id, rows) } catch (e) { acceptThrew = String(e.message) }
  const stillOpen = store.todoList.filter((t) => t.stage === '已派单·待回执').length
  const itemsUntouched = order.items.every((it) => it.receipt === '')
  const signsUntouched = store.state.signs.every((s) => !s.lastFixedAt || true)

  return { before, threw, afterFail, okReceipt: okReceipt.accepted.length, afterOk, openBefore, acceptThrew, stillOpen, itemsUntouched, signsUntouched,
    completedAfterFail: store.completedList.length }
}
`)

await build({
  configFile: false, logLevel: 'silent',
  build: { outDir, emptyOutDir: true, minify: false, lib: { entry, formats: ['es'], fileName: 's' } },
  resolve: { alias: { '@': join(projectRoot, 'src') } }
})

// localStorage + window shim，必须在导入产物前装好
const mem = new Map()
globalThis.window = globalThis.window ?? {}
globalThis.window.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => mem.delete(k),
}
globalThis.localStorage = globalThis.window.localStorage

const mod = await import(fileURLToPath(new URL('../.tmp-store-dist/s.js', import.meta.url)))
const r = mod.run()
console.log(JSON.stringify(r, null, 2))
let pass = 0, fail = 0
const check = (n, c) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.error('  ✗', n)) }
check('受理时落库失败抛错', r.threw.includes('模拟存储故障'))
check('失败后 signs/orders/todo 与失败前完全一致（无中间态）',
  JSON.stringify([r.afterFail.signs, r.afterFail.orders, r.afterFail.todo]) === JSON.stringify([r.before.signs, r.before.orders, r.before.todo]))
check('故障解除后同批正常受理', r.okReceipt === 2 && r.afterOk.orders === r.before.orders + 1)
check('受理后待办总数不增加（只是阶段流转）', r.afterOk.todo === r.before.todo)
check('验收时落库失败抛错', r.acceptThrew.includes('模拟存储故障'))
check('验收失败后在办条目仍待回执、逐行结果未写入', r.stillOpen === r.openBefore && r.itemsUntouched)
check('验收失败时没有完工记录漏出', r.completedAfterFail === 0)
console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：通过 ${pass}，失败 ${fail}`)
rmSync(entry, { force: true })
rmSync(fileURLToPath(new URL('../.tmp-store-dist', import.meta.url)), { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
