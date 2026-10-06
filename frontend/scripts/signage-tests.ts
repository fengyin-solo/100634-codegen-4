/**
 * 标识牌与里程桩整组台账 —— 口径验收用例（TS 版，和 store/service 同一模块图）。
 * 固定时钟到 2026-10-06，与业务“今天”对齐。
 */
import assert from 'node:assert/strict'

import {
  acceptItem,
  activeMarkerIds,
  backfillLegacy,
  isBackfilled,
  listAllItems,
  listBatches,
  listCompletedItems,
  listMarkers,
  listTodoItems,
  markerKey,
  precheckSubmit,
  reportReceipt,
  setClock,
  signageStats,
  submitBatch,
} from '../src/data/signage/service'
import { armWriteFailure, resetSignage } from '../src/data/signage/store'
import { LEGACY_ARCHIVE } from '../src/data/signage/legacy'

setClock(() => new Date('2026-10-06T10:00:00+08:00'))

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function reset() {
  resetSignage()
}

// ---------- 1. 存量回填：桩号顺序、无编号推定、缺项留空注明 ----------
reset()
assert.equal(isBackfilled(), false, '初始状态未回填')

backfillLegacy('2026-10-06T09:00:00+08:00')
assert.equal(isBackfilled(), true)

const markers = listMarkers()
check('回填条数与早年档案一致，按登记时刻原样入库', () => {
  assert.equal(markers.length, LEGACY_ARCHIVE.length)
})

check('存量按桩号升序排列（里程序）', () => {
  const meters = markers.map((m) => m.桩号米)
  const sorted = [...meters].sort((a, b) => a - b)
  assert.deepEqual(meters, sorted)
})

check('有编号沿用原编号，且类型不同的同桩号标识各自独立', () => {
  assert.ok(markers.find((m) => m.编号 === 'B-SP-001' && m.桩号 === 'K0+050.0' && m.类型 === '标识牌'))
  assert.ok(markers.find((m) => m.编号 === 'B-MP-001' && m.桩号 === 'K0+050.0' && m.类型 === '里程桩'))
})

check('无编号标识按远近桩中点推定桩号（K0+120~K0+140 → K0+130.0）', () => {
  const m = markers.find((x) => x.舱室 === '综合舱A' && x.类型 === '标识牌' && x.桩号米 === 130)
  assert.ok(m, '应存在 130m 的推定标识')
  assert.equal(m!.桩号, 'K0+130.0')
})

check('推定编号=舱室码-类型码-舱内桩号序位，并写明推定依据', () => {
  const inferred = markers.filter((m) => m.编号推定)
  assert.equal(inferred.length, 3, '档案里有 3 块无编号标识牌')
  // 综合舱A 标识牌按桩号序：K0+080(原 SP-001) 序位1，130 序位2，200 序位3
  const a130 = markers.find((m) => m.舱室 === '综合舱A' && m.桩号米 === 130 && m.类型 === '标识牌')!
  assert.equal(a130.编号, 'A-SP-002')
  assert.match(a130.推定依据, /等距中点/)
  const a200 = markers.find((m) => m.舱室 === '综合舱A' && m.桩号米 === 200 && m.类型 === '标识牌')!
  assert.equal(a200.编号, 'A-SP-003')
  const b100sp = markers.find((m) => m.舱室 === '电力舱B' && m.类型 === '标识牌')!
  // 电力舱B 标识牌只有一块（原 B-SP-001）+ 推定的 100m；100m 序位为2
  const inferredB = markers.filter((m) => m.舱室 === '电力舱B' && m.编号推定)
  assert.equal(inferredB.length, 1)
  assert.equal(inferredB[0].编号, 'B-SP-002')
})

check('早期条目缺项保持空串并在缺项说明中注明缘由', () => {
  const noInstall = markers.find((m) => m.编号 === 'A-SP-001')!
  assert.equal(noInstall.安装日期, '')
  assert.match(noInstall.缺项说明, /安装日期.*缺项/)
  const c2 = markers.find((m) => m.编号 === 'C-MP-002')!
  assert.equal(c2.反光膜到期日, '')
  assert.match(c2.缺项说明, /反光膜到期日.*缺项/)
})

check('登记时间沿用原档案登记时刻，不被回填时刻覆盖', () => {
  const first = markers.find((m) => m.编号 === 'A-MP-001')!
  assert.equal(first.登记时间, '2019-05-10T09:10:00+08:00')
})

check('回填只执行一次，重复调用不追加条数', () => {
  backfillLegacy('2026-10-06T11:00:00+08:00')
  assert.equal(listMarkers().length, LEGACY_ARCHIVE.length)
})

// ---------- 2. 批量提交前校验：批内去重、跨批次重复拦截、反光膜过期拦截 ----------
function idBy(code: string) {
  return listMarkers().find((m) => m.编号 === code)!.id
}

const bMP002 = idBy('B-MP-002') // 缺失 K0+100 电力舱，膜 2026-02-28 已过期
const aMP002 = idBy('A-MP-002') // 破损，膜 2024-08-31 过期
const aMP004 = idBy('A-MP-004') // 膜脱落，膜 2023-11-30 过期
const aSP002 = idBy('A-SP-002') // 推定 130m 缺失，膜缺项
const cMP002 = idBy('C-MP-002') // 缺失，膜缺项
const cMP001 = idBy('C-MP-001') // 完好，不应参与
const bSP002 = idBy('B-SP-002') // 推定，电力舱 100m 膜脱落，与 B-MP-002 同桩号不同类型

check('反光膜过期/缺项且未登记新膜到期日：拦截，不允许落库', () => {
  const pre = precheckSubmit([{ markerId: bMP002 }, { markerId: aMP002 }, { markerId: aSP002 }])
  assert.equal(pre.ok, false)
  const codes = pre.issues.map((i) => i.code)
  assert.ok(codes.includes('film-expired'))
  assert.equal(pre.normalized.length, 0)
})

check('登记晚于今天的新膜到期日后放行；今天当天的日期不放行', () => {
  const blocked = precheckSubmit([{ markerId: bMP002, 新膜到期日: '2026-10-06' }])
  assert.equal(blocked.ok, false, '新膜到期日等于今天不算有效')
  const ok = precheckSubmit([
    { markerId: bMP002, 新膜到期日: '2029-10-06' },
    { markerId: aSP002, 新膜到期日: '2029-12-31' },
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.normalized.length, 2)
  assert.equal(ok.issues.length, 0)
})

check('批内同一块标识多勾只保留第一次，提示合并数，不增加记录', () => {
  const pre = precheckSubmit([
    { markerId: bMP002, 新膜到期日: '2029-10-06' },
    { markerId: bMP002, 新膜到期日: '2030-01-01' },
  ])
  assert.equal(pre.dedupedInBatch, 1)
  assert.equal(pre.normalized.length, 1)
  assert.equal(pre.normalized[0].新膜到期日, '2029-10-06', '以第一次勾选为准')
})

check('同桩号不同类型不是重复，可同时整组提交', () => {
  const pre = precheckSubmit([
    { markerId: bMP002, 新膜到期日: '2029-10-06' },
    { markerId: bSP002, 新膜到期日: '2029-10-06' },
  ])
  assert.equal(pre.ok, true)
  assert.equal(pre.normalized.length, 2)
})

// ---------- 3. 整组提交：逐条回执、未完成另起缘由 ----------
const submit1 = submitBatch(
  [
    { markerId: bMP002, 新膜到期日: '2029-10-06' },
    { markerId: aMP002, 新膜到期日: '2029-11-01' },
    { markerId: aMP004, 新膜到期日: '2029-11-01' },
  ],
  'PATROL-20261006-01',
)
check('整组提交成功，返回批次与逐条条目，全部进入待回执', () => {
  assert.ok(submit1.batch, '应生成批次')
  assert.equal(submit1.batch.items.length, 3)
  assert.ok(submit1.batch.items.every((i) => i.phase === '待回执'))
  assert.match(submit1.batch.batchId, /^SB-20261006-\d{3}$/)
})

check('作业类型按主档状态推定：缺失→补设，破损/脱落→更换', () => {
  const byId = new Map(submit1.batch.items.map((i) => [i.markerId, i]))
  assert.equal(byId.get(bMP002)!.作业类型, '补设')
  assert.equal(byId.get(aMP002)!.作业类型, '更换')
  assert.equal(byId.get(aMP004)!.作业类型, '更换')
})

check('提交后同步出现在巡检整改清单（另一入口读同一份）', () => {
  const todo = listTodoItems()
  for (const item of submit1.batch.items) {
    assert.ok(todo.find((t) => t.itemId === item.itemId))
  }
})

check('标识进入在办后，重复提交整条退回：拦截且条数不叠加', () => {
  const pre = precheckSubmit([{ markerId: bMP002, 新膜到期日: '2030-01-01' }])
  assert.equal(pre.ok, false)
  assert.equal(pre.normalized.length, 0)
  assert.equal(pre.issues[0].code, 'duplicate-active')
  const all = listAllItems()
  assert.equal(all.filter((i) => i.markerId === bMP002).length, 1, '同一块标识仍只有 1 条记录')
})

// 逐条回执：第一块完成，第二块完成，第三块没补成写缘由
const [item1, item2, item3] = submit1.batch.items
reportReceipt(item1.itemId, true, '')
reportReceipt(item2.itemId, true, '')
check('回执已完成：阶段转待验收，主档状态与新膜到期日同步', () => {
  const all = new Map(listAllItems().map((i) => [i.itemId, i]))
  assert.equal(all.get(item1.itemId)!.phase, '已完成')
  const m = listMarkers().find((x) => x.id === bMP002)!
  assert.equal(m.状态, '完好')
  assert.equal(m.反光膜到期日, '2029-10-06')
})

reportReceipt(item3.itemId, false, '该桩位上方有临时吊装作业，现场无法停点，顺延至次日')
check('没补成的另起一行写缘由：阶段未完成、留在整改清单，可重新发起', () => {
  const all = new Map(listAllItems().map((i) => [i.itemId, i]))
  assert.equal(all.get(item3.itemId)!.phase, '未完成')
  assert.match(all.get(item3.itemId)!.缘由, /吊装作业/)
  assert.ok(listTodoItems().find((t) => t.itemId === item3.itemId))
  // 未完成不再算在办，可以重新发起
  const pre = precheckSubmit([{ markerId: aMP004, 新膜到期日: '2029-12-01' }])
  assert.equal(pre.ok, true)
  // 主档未完成的补设不动状态、不改膜
  const m = listMarkers().find((x) => x.id === aMP004)!
  assert.equal(m.状态, '反光膜脱落')
})

// ---------- 4. 验收：完工清单两入口同源，不合格可重发 ----------
acceptItem(item1.itemId, true, '')
acceptItem(item2.itemId, false, '更换后桩号位置偏 20cm')
check('验收合格进完工清单；不合格写缘由退回，两边取到同一份', () => {
  const done = listCompletedItems()
  assert.equal(done.length, 1)
  assert.equal(done[0].itemId, item1.itemId)
  const all = new Map(listAllItems().map((i) => [i.itemId, i]))
  assert.equal(all.get(item2.itemId)!.phase, '验收不合格')
  assert.match(all.get(item2.itemId)!.缘由, /偏 20cm/)
})

check('验收合格闭环后该标识可按新缺陷重新发起；待验收期间重复仍被拦', () => {
  // item2 待验收阶段曾拦截；现在不合格退回，可重新发起
  const pre = precheckSubmit([{ markerId: aMP002, 新膜到期日: '2030-03-01' }])
  assert.equal(pre.ok, true)
  // item1 已合格、主档完好，前端不可勾选（状态完好），服务层校验只拦截在办的
  assert.ok(!activeMarkerIds().has(bMP002))
})

// ---------- 5. 待办与台账读数一致 ----------
check('待办清单与台账统计同源：读数一致', () => {
  const s = signageStats()
  assert.equal(s.待回执, listAllItems().filter((i) => i.phase === '待回执').length)
  assert.equal(s.待验收, listTodoItems().filter((i) => i.phase === '已完成').length)
  assert.equal(s.未完成, listTodoItems().filter((i) => i.phase === '未完成' || i.phase === '验收不合格').length)
  assert.equal(s.已完工, listCompletedItems().length)
})

// ---------- 6. 落库失败整套退回，无中间态 ----------
const beforeBatches = listBatches().length
const beforeItems = listAllItems().length
const beforeMarkerFilm = listMarkers().find((m) => m.id === cMP002)!.反光膜到期日
armWriteFailure()
let threw = false
try {
  // 这批 2 条：cMP002 缺失膜缺项需带新膜；bSP002 膜脱落，校验都通过、在写入阶段失败
  submitBatch(
    [
      { markerId: cMP002, 新膜到期日: '2030-01-01' },
      { markerId: bSP002, 新膜到期日: '2030-01-01' },
    ],
    'PATROL-FAIL',
  )
} catch (error) {
  threw = true
  assert.match((error as Error).message, /整套退回/)
}
check('落库抛错时整套退回：批次、条目、主档全部保持提交前', () => {
  assert.ok(threw, '必须把写入失败抛出来')
  assert.equal(listBatches().length, beforeBatches)
  assert.equal(listAllItems().length, beforeItems)
  assert.equal(listMarkers().find((m) => m.id === cMP002)!.反光膜到期日, beforeMarkerFilm)
})

check('故障只生效一次，恢复后可正常提交', () => {
  const r = submitBatch([{ markerId: cMP002, 新膜到期日: '2030-01-01' }], 'PATROL-RETRY')
  assert.ok(r.batch)
  assert.equal(listAllItems().length, beforeItems + 1)
})

// ---------- 7. 唯一键口径 ----------
check('markerKey：同舱同桩同类型才是同一块', () => {
  assert.equal(markerKey('电力舱B', 'K0+100.0', '里程桩'), markerKey('电力舱B', 'K0+100.0', '里程桩'))
  assert.notEqual(markerKey('电力舱B', 'K0+100.0', '里程桩'), markerKey('电力舱B', 'K0+100.0', '标识牌'))
})

console.log(`\n标识台账口径验收全部通过：${passed} 项`)
