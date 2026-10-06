/**
 * 领域逻辑自检：node --loader tsx 太重，直接用 vite 的 esbuild 转一遍后跑。
 * 运行：node scripts/verify-sign-domain.mjs
 */
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entrySrc = `
export {
  backfillLegacy, LEGACY_SIGNS, precheckSubmit, applySubmit, applyAccept,
  selectTodoList, selectCompletedList, selectStats, parseChainage, formatChainage,
  signKey, openItems,
} from '@/data/sign-domain'
`
const dir = mkdtempSync(join(tmpdir(), 'sign-verify-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, entrySrc)

await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    lib: { entry, formats: ['es'], fileName: 'domain' },
    outDir: join(dir, 'dist'),
    emptyOutDir: true,
    minify: false,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
})

const domain = await import(join(dir, 'dist', 'domain.js'))

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

const NOW = new Date('2026-10-06T09:00:00Z')
const mkLine = (lineId, cabin, kind, chainageText, action, extra = {}) => ({
  lineId, signId: 0, cabin, kind,
  subType: kind === '标识牌' ? '安全警示牌' : '里程桩',
  chainageText, issue: extra.issue ?? '破损', action,
  newReflectExpiry: extra.expiry ?? '2029-10-05',
  ...extra,
})

// ---- 1. 存量：按登记时刻落库，按桩号顺序编号，缺项注明 ----
console.log('1) 存量回填')
{
  const st = domain.backfillLegacy(JSON.parse(JSON.stringify(domain.LEGACY_SIGNS)))
  check('记录条数等于种子条数', st.signs.length === domain.LEGACY_SIGNS.length, `${st.signs.length}`)
  const ts = st.signs.map((s) => s.registeredAt)
  check('id 顺序 = 登记时刻升序', ts.every((t, i) => i === 0 || ts[i - 1] <= t))
  check('最早一条是 2019 综合舱 K0+000 里程桩 LC-K0+000',
    st.signs[0].code === 'LC-K0+000' && st.signs[0].chainageM === 0, st.signs[0].code)
  const led200 = st.signs.find((s) => s.cabin === '综合舱' && s.kind === '里程桩' && s.chainageM === 200)
  check('远近桩 100~300 无偏移 → 中点 K0+200 推定', !!led200, JSON.stringify(st.signs.map(s=>s.chainageM)))
  check('推定编号 LC-K0+200', led200?.code === 'LC-K0+200', led200?.code)
  check('推定缘由写入 notes', led200?.notes.includes('推定') && led200.inferredCode === true)
  const dlNearOffset = st.signs.find((s) => s.cabin === '电力舱' && s.kind === '标识牌' && s.chainageM === 250)
  check('近桩200+偏移50 → K0+250', !!dlNearOffset)
  check('桩号直接入编号（同桩位唯一）', dlNearOffset?.code === 'DL-BS-K0+250', dlNearOffset?.code)
  const zh350 = st.signs.find((s) => s.cabin === '综合舱' && s.chainageM === 350 && s.kind === '标识牌')
  check('300~400 偏移50 → K0+350 疏散牌', zh350?.code === 'ZH-BS-K0+350', zh350?.code)
  const noExpiry = st.signs.find((s) => s.chainageM === 200)
  check('早年缺反光膜日期留空并注明', noExpiry?.reflectExpiry === '' && noExpiry?.notes.includes('缺登记'))
  // 台账展示按桩号排序
  const sorted = [...st.signs].sort((a, b) => a.chainageM - b.chainageM)
  check('桩号 0 一定排最前', st.signs[0].chainageM === 0)
  void sorted
}

// ---- 2. 预检：桩号非法 / 批内重复 / 在办重复 / 动作不符 / 新膜过期 ----
console.log('2) 预检规则')
{
  const st = domain.backfillLegacy(JSON.parse(JSON.stringify(domain.LEGACY_SIGNS)))
  // 桩号非法
  let c = domain.precheckSubmit([mkLine(1, '电力舱', '里程桩', 'K1+99', '更换')], st.signs, st.orders, '2026-10-06')
  check('米段不足三位 K1+99 判非法阻断', c[0].level === 'error' && c[0].code === 'INVALID_CHAINAGE')
  // 合法格式
  c = domain.precheckSubmit([mkLine(1, '电力舱', '里程桩', 'K1+050', '更换')], st.signs, st.orders, '2026-10-06')
  check('K1+050 可解析（台账无此桩→必须补设）', c.some((x) => x.code === 'UNKNOWN_MUST_INSTALL'))
  c = domain.precheckSubmit([mkLine(1, '电力舱', '里程桩', 'K1+050', '补设')], st.signs, st.orders, '2026-10-06')
  check('新桩位走补设则通过', c[0].level === 'ok', c[0].message)
  // 批内重复（勾选两遍）
  c = domain.precheckSubmit([
    mkLine(1, '燃气舱', '里程桩', 'K1+500', '更换'),
    mkLine(2, '燃气舱', '里程桩', 'K1+500', '更换'),
  ], st.signs, st.orders, '2026-10-06')
  check('批内重复第二行 warn 且指向第一行', c[1].level === 'warn' && c[1].code === 'DUP_IN_BATCH' && c[1].keepLineId === 1)
  // 动作与现状不符（缺失必须补设）
  const missing = st.signs.find((s) => s.condition === '缺失' && s.kind === '标识牌')
  c = domain.precheckSubmit([mkLine(1, missing.cabin, '标识牌', domain.formatChainage(missing.chainageM), '更换', { issue: '缺失' })], st.signs, st.orders, '2026-10-06')
  check('缺失却选更换 → ACTION_MISMATCH', c[0].code === 'ACTION_MISMATCH', c[0].message)
  // 存量膜过期且只补设（破损+过期牌）
  const filmBad = st.signs.find((s) => s.condition === '破损' && s.reflectExpiry && s.reflectExpiry < '2026-10-06')
  c = domain.precheckSubmit([mkLine(1, filmBad.cabin, filmBad.kind, domain.formatChainage(filmBad.chainageM), '更换')], st.signs, st.orders, '2026-10-06')
  check('破损+膜过期走更换 → 通过', c[0].level === 'ok', c[0].message)
  // 新膜过期
  c = domain.precheckSubmit([mkLine(1, '电力舱', '里程桩', 'K1+050', '补设', { expiry: '2020-01-01' })], st.signs, st.orders, '2026-10-06')
  check('新膜已过期阻断', c[0].code === 'NEW_FILM_EXPIRED')
  // 新膜空
  c = domain.precheckSubmit([mkLine(1, '电力舱', '里程桩', 'K1+050', '补设', { expiry: '' })], st.signs, st.orders, '2026-10-06')
  check('新膜日期缺失阻断', c[0].code === 'NEW_FILM_MISSING')
}

// ---- 3. 受理落库：同一块只保留一次；跨批重复整条退回 ----
console.log('3) 受理与去重')
{
  const st = domain.backfillLegacy(JSON.parse(JSON.stringify(domain.LEGACY_SIGNS)))
  const input = {
    patrolNo: 'PATR-0007', team: '机电一班',
    lines: [
      mkLine(1, '电力舱', '标识牌', 'K0+150', '更换'),
      mkLine(2, '电力舱', '标识牌', 'K0+150', '更换'), // 批内重复
      mkLine(3, '综合舱', '里程桩', 'K0+400', '补设', { issue: '缺失' }),
      mkLine(4, '水信舱', '标识牌', 'K1+900', '补设'), // 台账没有：巡检新发现缺牌
    ],
  }
  const r = domain.applySubmit(st, JSON.parse(JSON.stringify(input)), NOW)
  check('受理 3 条（折叠 1 条）', r.accepted.length === 3, `${r.accepted.length}`)
  check('deduped 1 条且指向 line 1', r.deduped.length === 1 && r.deduped[0].keepLineId === 1)
  check('新缺牌自动建档 1 处', r.createdMissing.length === 1 && st.signs.some((s) => s.chainageM === 1900 && s.condition === '缺失'))
  check('台账该新桩编号已推定', st.signs.find((s) => s.chainageM === 1900)?.code === 'SX-BS-K1+900', st.signs.find((s) => s.chainageM === 1900)?.code)
  const orderCount = st.orders.length
  const itemCount = st.orders[0].items.length
  check('只生成一张单 3 个条目，条数不叠加', orderCount === 1 && itemCount === 3, `${orderCount}/${itemCount}`)
  // 同一块再提（在办未回执）→ 阻断
  const c = domain.precheckSubmit([mkLine(1, '电力舱', '标识牌', 'K0+150', '更换')], st.signs, st.orders, '2026-10-06')
  check('在办重复提交 → ACTIVE_DUP 整条退回', c[0].code === 'ACTIVE_DUP')
  let threw = false
  try { domain.applySubmit(st, { patrolNo: '', team: '', lines: JSON.parse(JSON.stringify(input.lines.slice(0, 1))) }, NOW) } catch { threw = true }
  check('带阻断项 applySubmit 直接抛错，不落库', threw && st.orders.length === 1)
}

// ---- 4. 验收：逐块结果；未补成缘由必填；原子整套退回 ----
console.log('4) 验收落库')
{
  const st = domain.backfillLegacy(JSON.parse(JSON.stringify(domain.LEGACY_SIGNS)))
  domain.applySubmit(st, {
    patrolNo: 'PATR-0007', team: '机电一班',
    lines: [
      mkLine(1, '电力舱', '标识牌', 'K0+150', '更换'),
      mkLine(2, '综合舱', '里程桩', 'K0+400', '补设', { issue: '缺失' }),
    ],
  }, NOW)
  const order = st.orders[0]
  const rows = order.items.map((it, i) => ({
    lineId: it.lineId, receipt: i === 0 ? '已补齐' : '未补成',
    note: i === 0 ? '已更换并复测反光' : '', newReflectExpiry: '2029-10-05',
  }))
  let threw = false
  try { domain.applyAccept(st, order.id, rows, NOW) } catch (e) { threw = true }
  check('未补成缘由缺失 → 整套退回抛错', threw)
  check('退回后状态保持“待回执”，无中间态', order.status === '待回执' && order.items.every((it) => it.receipt === ''))
  const fixed = st.signs.find((s) => s.id === order.items[0].signId)
  check('退回后台账现状未被改（仍非完好）', fixed.condition !== '完好')
  // 补缘由再验收
  rows[1].note = '管片渗漏水作业面未交出，顺延下周'
  const ar = domain.applyAccept(st, order.id, rows, NOW)
  check('回执逐行 2 条，一补齐一未补成', ar.items.length === 2 && ar.items[0].receipt === '已补齐' && ar.items[1].receipt === '未补成')
  check('工单状态“部分补齐”', order.status === '部分补齐')
  check('补齐行台账变完好、新膜写入', fixed.condition === '完好' && fixed.reflectExpiry === '2029-10-05')
  const failedSign = st.signs.find((s) => s.id === order.items[1].signId)
  check('未补成行台账保留缘由', failedSign.lastFailReason.includes('顺延下周'))
  // 未补成的那块可重新派单（在办无未回执条目）
  const c = domain.precheckSubmit([mkLine(1, '综合舱', '里程桩', 'K0+400', '补设', { issue: '缺失' })], st.signs, st.orders, '2026-10-06')
  check('部分补齐后未补成项可再次派单', c[0].level === 'ok', c[0].message)
  // 全部补齐 → 已闭环
  const st2 = domain.backfillLegacy(JSON.parse(JSON.stringify(domain.LEGACY_SIGNS)))
  domain.applySubmit(st2, { patrolNo: '', team: '甲班', lines: [mkLine(1, '电力舱', '标识牌', 'K0+150', '更换')] }, NOW)
  const o2 = st2.orders[0]
  const ar2 = domain.applyAccept(st2, o2.id, [{ lineId: o2.items[0].lineId, receipt: '已补齐', note: '完成', newReflectExpiry: '2029-10-05' }], NOW)
  check('全部补齐 → 已闭环', ar2.status === '已闭环')
  // 闭环后再提同一块：现状完好 → ALREADY_FIXED
  const c2 = domain.precheckSubmit([mkLine(1, '电力舱', '标识牌', 'K0+150', '更换')], st2.signs, st2.orders, '2026-10-06')
  check('已补齐后再提 → ALREADY_FIXED 退回', c2[0].code === 'ALREADY_FIXED')
}

// ---- 5. 同源派生：待办、完工、两边读数一致 ----
console.log('5) 同源派生视图')
{
  const st = domain.backfillLegacy(JSON.parse(JSON.stringify(domain.LEGACY_SIGNS)))
  const todo0 = domain.selectTodoList(st)
  check('待办条数 = 台账非完好数', todo0.length === st.signs.filter((s) => s.condition !== '完好').length)
  check('待办按桩号排序', todo0.every((t, i) => i === 0 || todo0[i - 1].chainageM <= t.chainageM))
  domain.applySubmit(st, {
    patrolNo: 'PATR-0009', team: '乙班',
    lines: [mkLine(1, '电力舱', '标识牌', 'K0+150', '更换'), mkLine(2, '电力舱', '标识牌', 'K0+450', '补设', { issue: '缺失' })],
  }, NOW)
  const todoAfter = domain.selectTodoList(st)
  check('派单后待办总数不变（只改阶段，不叠加）', todoAfter.length === todo0.length, `${todoAfter.length} vs ${todo0.length}`)
  check('两块阶段变为已派单·待回执', todoAfter.filter((t) => t.stage === '已派单·待回执').length === 2)
  const order = st.orders[0]
  domain.applyAccept(st, order.id, order.items.map((it) => ({ lineId: it.lineId, receipt: '已补齐', note: 'ok', newReflectExpiry: '2029-10-05' })), NOW)
  const done = domain.selectCompletedList(st)
  check('完工清单 2 条且带巡检编号/班组', done.length === 2 && done.every((d) => d.patrolNo === 'PATR-0009'))
  check('完工清单按完工时间倒序', done[0].receivedAt >= done[1].receivedAt)
  const todoFinal = domain.selectTodoList(st)
  check('补齐后待办对应桩号消失', todoFinal.length === todo0.length - 2 && !todoFinal.some((t) => t.chainageM === 150 && t.cabin === '电力舱'))
  const sstat = domain.selectStats(st, NOW)
  check('统计：待办与待派单自洽', sstat.todo === todoFinal.length && sstat.todo === sstat.waitingDispatch + sstat.openItems
    ? true
    : (() => { console.log(`   todo=${sstat.todo} wait=${sstat.waitingDispatch} open=${sstat.openItems}`); return false })())
  check('本月完工 2', sstat.completedThisMonth === 2, `${sstat.completedThisMonth}`)
}

// ---- 6. 桩号工具 ----
console.log('6) 桩号口径')
{
  check('K0+005 → 5', domain.parseChainage('K0+005') === 5)
  check('1+250 → 1250', domain.parseChainage('1+250') === 1250)
  check('800 → 800', domain.parseChainage('800') === 800)
  check('abc → null', domain.parseChainage('abc') === null)
  check('5 → K0+005', domain.formatChainage(5) === 'K0+005')
  check('1250 → K1+250', domain.formatChainage(1250) === 'K1+250')
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
