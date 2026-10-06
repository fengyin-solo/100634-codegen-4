import { LEGACY_ARCHIVE, type LegacyArchiveRow } from './legacy'
import { commitState, getState } from './store'
import { formatStake, parseStake } from './stake'
import type {
  FlatItem,
  ItemPhase,
  JobKind,
  MarkerState,
  NormalizedLine,
  PrecheckIssue,
  PrecheckResult,
  RectBatch,
  RectItem,
  SelectionLine,
  SignMarker,
  SignType,
} from './types'

/**
 * 标识牌 / 里程桩整组台账服务。
 * 台账入口与巡检整改入口都只通过这里读数，保证两边读到同一份。
 */

// 时钟可替换：验收脚本里用固定“今天”，页面上用真实时间。
let clock: () => Date = () => new Date()

export function setClock(impl: () => Date): void {
  clock = impl
}

function now(): Date {
  return clock()
}

function todayStr(): string {
  return toDateStr(now())
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function nowStamp(): string {
  const d = now()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`
}

/** 物理标识唯一键：舱室 + 桩号 + 类型。同桩号的里程桩与标识牌是两块，不冲突。 */
export function markerKey(cabin: string, stake: string, type: SignType): string {
  return `${cabin}|${stake}|${type}`
}

function cabinCode(cabin: string): string {
  const tail = cabin.match(/([A-Za-z])$/)
  if (tail) {
    return tail[1].toUpperCase()
  }
  // 无名舱室兜底：取舱室名字符编码，保证同舱稳定、不同舱不撞码。
  let sum = 0
  for (const ch of cabin) {
    sum += ch.charCodeAt(0)
  }
  return `X${(sum % 26).toString(26).toUpperCase()}`
}

function typeCode(type: SignType): string {
  return type === '标识牌' ? 'SP' : 'MP'
}

function normalizeState(raw: string): MarkerState {
  if (raw === '破损' || raw === '缺失' || raw === '反光膜脱落') {
    return raw
  }
  return '完好'
}

/** 解析区间桩号（近桩~远桩），返回两端米数与中点。 */
function parseRange(text: string): { near: number; far: number; mid: number } | null {
  const parts = text.split(/[~～-]/).map((s) => s.trim()).filter(Boolean)
  if (parts.length !== 2) {
    return null
  }
  const a = parseStake(parts[0])
  const b = parseStake(parts[1])
  if (a.meters === null || b.meters === null || b.meters <= a.meters) {
    return null
  }
  return { near: a.meters, far: b.meters, mid: (a.meters + b.meters) / 2 }
}

interface ResolvedLegacy {
  row: LegacyArchiveRow
  meters: number
  stakeText: string
  inferred: boolean
}

/**
 * 存量回填：
 * 1. 全部条目先折算桩号（区间按远近桩中点推定），按桩号升序、同桩号按登记时刻升序排列；
 * 2. 无编号的，编号 = 舱室码-类型码-该舱该类型序位（桩号序），序位按桩号升序排定；
 * 3. 早年缺项（安装日期/反光膜到期日）保持空串，缺项说明里注明缘由；
 * 4. 登记时间沿用原档案登记时刻，回填只记一次回填时间。
 */
export function backfillLegacy(backfilledAt: string = nowStamp()): void {
  const state = getState()
  if (state.backfilled) {
    return
  }

  const resolved: ResolvedLegacy[] = LEGACY_ARCHIVE.map((row) => {
    if (row.编号) {
      const stake = parseStake(row.桩号)
      return {
        row,
        meters: stake.meters ?? 0,
        stakeText: stake.invalid ? row.桩号 : stake.text,
        inferred: false,
      }
    }
    const range = parseRange(row.桩号)
    if (range) {
      return {
        row,
        meters: range.mid,
        stakeText: formatStake(range.mid),
        inferred: true,
      }
    }
    const stake = parseStake(row.桩号)
    return {
      row,
      meters: stake.meters ?? Number.POSITIVE_INFINITY,
      stakeText: row.桩号,
      inferred: true,
    }
  })

  resolved.sort((a, b) =>
    a.meters - b.meters !== 0
      ? a.meters - b.meters
      : a.row.登记时间.localeCompare(b.row.登记时间),
  )

  // 序位按舱室+类型独立计数，所有条目（含已有编号）一起占序位，保证推定编号不与原编号撞。
  const seq = new Map<string, number>()
  const nextSeq = (cabin: string, type: SignType) => {
    const k = `${cabin}|${type}`
    const value = (seq.get(k) ?? 0) + 1
    seq.set(k, value)
    return value
  }

  const markers: SignMarker[] = resolved.map((item, index) => {
    const { row } = item
    const code = cabinCode(row.舱室)
    const order = nextSeq(row.舱室, row.类型)
    const inferredCode = `${code}-${typeCode(row.类型)}-${String(order).padStart(3, '0')}`
    const missing: string[] = []
    if (!row.安装日期) {
      missing.push('安装日期为早年档案缺项，保持空缺')
    }
    if (!row.反光膜到期日) {
      missing.push('反光膜到期日为早年档案缺项，保持空缺')
    }
    const basis: string[] = []
    if (!row.编号) {
      basis.push(`原档案无编号，桩号取近桩至远桩等距中点 ${row.桩号} 推定，编号按所在舱室与桩号序位推定`)
    }
    if (item.inferred) {
      basis.push(`推定桩号为 ${item.stakeText}`)
    }

    return {
      id: index + 1,
      编号: row.编号 || inferredCode,
      编号推定: !row.编号,
      推定依据: basis.join('；'),
      舱室: row.舱室,
      桩号: item.stakeText,
      桩号米: Number.isFinite(item.meters) ? item.meters : 0,
      类型: row.类型,
      状态: normalizeState(row.状态),
      反光膜到期日: row.反光膜到期日,
      安装日期: row.安装日期,
      登记时间: row.登记时间,
      来源: '早年档案回填',
      缺项说明: missing.join('；'),
    }
  })

  commitState((draft) => {
    draft.backfilled = true
    draft.回填时间 = backfilledAt
    draft.markers = markers
  })
}

/** 未闭环阶段：存在这些阶段时，同一标识不允许再次提交，后到整条退回。 */
const ACTIVE_PHASES: ItemPhase[] = ['待回执', '已完成']

export function isActive(phase: ItemPhase): boolean {
  return ACTIVE_PHASES.includes(phase)
}

function activeItemFor(
  batches: RectBatch[],
  markerId: number,
): RectItem | null {
  for (const batch of batches) {
    const hit = batch.items.find(
      (item) => item.markerId === markerId && isActive(item.phase),
    )
    if (hit) {
      return hit
    }
  }
  return null
}

/**
 * 批量提交前校验。两类问题分开报：
 * - 桩号重复（同舱同桩同类型已有未闭环整改）：拦截，后到整条退回；
 * - 反光膜过期：拦截，补设/更换都必须登记一个晚于今天的新膜到期日，补上即放行；
 * 批内同一标识多勾的，只保留第一次勾选（提示合并，不增加任何记录）。
 */
export function precheckSubmit(lines: SelectionLine[]): PrecheckResult {
  const state = getState()
  const issues: PrecheckIssue[] = []
  const seen = new Map<string, SelectionLine>()
  let dedupedInBatch = 0

  for (const line of lines) {
    const marker = state.markers.find((m) => m.id === line.markerId)
    if (!marker) {
      issues.push({
        level: '拦截',
        code: 'marker-missing',
        舱室: '—',
        桩号: `id:${line.markerId}`,
        类型: '—',
        message: '勾选的标识在台账中不存在，已整条退回',
      })
      continue
    }
    const key = markerKey(marker.舱室, marker.桩号, marker.类型)
    if (seen.has(key)) {
      dedupedInBatch += 1
      continue
    }
    seen.set(key, line)
  }

  const normalized: NormalizedLine[] = []
  const today = todayStr()

  for (const line of seen.values()) {
    const marker = state.markers.find((m) => m.id === line.markerId)!
    const stake = parseStake(marker.桩号)
    if (stake.invalid) {
      issues.push({
        level: '拦截',
        code: 'stake-invalid',
        舱室: marker.舱室,
        桩号: marker.桩号,
        类型: marker.类型,
        message: '桩号无法识别，不能落库，请先在台账中订正桩号',
      })
      continue
    }

    const active = activeItemFor(state.batches, marker.id)
    if (active) {
      issues.push({
        level: '拦截',
        code: 'duplicate-active',
        舱室: marker.舱室,
        桩号: marker.桩号,
        类型: marker.类型,
        message: `该标识已有未闭环整改（批次 ${active.itemId}，当前阶段「${active.phase}」），重复提交整条退回，条数不叠加`,
      })
      continue
    }

    const newFilm = (line.新膜到期日 ?? '').trim()
    const filmExpired = !marker.反光膜到期日 || marker.反光膜到期日 <= today
    if (filmExpired && (!newFilm || newFilm <= today)) {
      const reason = !marker.反光膜到期日 ? '反光膜到期日缺项' : `反光膜已于 ${marker.反光膜到期日} 过期`
      issues.push({
        level: '拦截',
        code: 'film-expired',
        舱室: marker.舱室,
        桩号: marker.桩号,
        类型: marker.类型,
        message: `${reason}，${marker.状态 === '缺失' ? '补设' : '更换'}须登记晚于今天（${today}）的新膜到期日`,
      })
      continue
    }

    normalized.push({ marker, 新膜到期日: newFilm })
  }

  return {
    ok: !issues.some((issue) => issue.level === '拦截'),
    normalized,
    issues,
    dedupedInBatch,
  }
}

function inferJob(marker: SignMarker): JobKind {
  return marker.状态 === '缺失' ? '补设' : '更换'
}

/**
 * 整组提交：校验通过后一次原子落库。
 * 作业类型逐条按主档状态推定（缺失→补设；破损/反光膜脱落→更换）。
 * 落库失败由 commitState 抛错，整套退回，不产生任何半截批次。
 */
export function submitBatch(
  lines: SelectionLine[],
  巡检任务号: string,
): { batch: RectBatch | null; precheck: PrecheckResult } {
  const precheck = precheckSubmit(lines)
  if (!precheck.ok) {
    return { batch: null, precheck }
  }

  const stamp = nowStamp()
  const state = getState()
  const batchId = `SB-${stamp.slice(0, 10).replace(/-/g, '')}-${String(state.batches.length + 1).padStart(3, '0')}`

  const items: RectItem[] = precheck.normalized.map((line, index) => ({
    itemId: `${batchId}-${String(index + 1).padStart(2, '0')}`,
    markerId: line.marker.id,
    编号: line.marker.编号,
    编号推定: line.marker.编号推定,
    舱室: line.marker.舱室,
    桩号: line.marker.桩号,
    类型: line.marker.类型,
    作业类型: inferJob(line.marker),
    新膜到期日: line.新膜到期日,
    phase: '待回执',
    缘由: '',
    提交时间: stamp,
    回执时间: '',
    验收时间: '',
  }))

  const batch: RectBatch = {
    batchId,
    巡检任务号: 巡检任务号.trim(),
    作业类型: items.every((it) => it.作业类型 === '补设')
      ? '补设'
      : items.every((it) => it.作业类型 === '更换')
        ? '更换'
        : '混合',
    提交时间: stamp,
    items,
  }

  commitState((draft) => {
    draft.batches.push(batch)
  })

  return { batch, precheck }
}

/** 逐条回执：已完成 → 待验收并同步主档；未完成 → 另起缘由，条目留在整改清单里可再发起。 */
export function reportReceipt(
  itemId: string,
  done: boolean,
  reason: string,
): void {
  const stamp = nowStamp()
  commitState((draft) => {
    for (const batch of draft.batches) {
      const item = batch.items.find((it) => it.itemId === itemId)
      if (!item) {
        continue
      }
      if (item.phase !== '待回执') {
        return
      }
      if (done) {
        item.phase = '已完成'
        item.缘由 = ''
        item.回执时间 = stamp
        const marker = draft.markers.find((m) => m.id === item.markerId)
        if (marker) {
          marker.状态 = '完好'
          if (item.新膜到期日) {
            marker.反光膜到期日 = item.新膜到期日
          }
        }
      } else {
        item.phase = '未完成'
        item.缘由 = reason.trim() || '未填明缘由'
        item.回执时间 = stamp
      }
      return
    }
  })
}

/** 验收：合格进完工清单；不合格写清缘由退回，可重新发起。台账与巡检入口都能调。 */
export function acceptItem(itemId: string, qualified: boolean, reason: string): void {
  const stamp = nowStamp()
  commitState((draft) => {
    for (const batch of draft.batches) {
      const item = batch.items.find((it) => it.itemId === itemId)
      if (!item) {
        continue
      }
      if (item.phase !== '已完成') {
        return
      }
      item.phase = qualified ? '验收合格' : '验收不合格'
      item.缘由 = qualified ? '' : reason.trim() || '未填明缘由'
      item.验收时间 = stamp
      return
    }
  })
}

function flatten(batches: RectBatch[]): FlatItem[] {
  return batches.flatMap((batch) =>
    batch.items.map((item) => ({
      ...item,
      batchId: batch.batchId,
      巡检任务号: batch.巡检任务号,
    })),
  )
}

/** 巡检整改清单（另一入口读这里）：待回执 + 待验收（已完成待验）+ 未完成 + 验收不合格。 */
export function listTodoItems(): FlatItem[] {
  return flatten(getState().batches)
    .filter((item) => item.phase !== '验收合格')
    .sort((a, b) => b.提交时间.localeCompare(a.提交时间))
}

/** 完工清单（两边取同一份）：只有验收合格。 */
export function listCompletedItems(): FlatItem[] {
  return flatten(getState().batches)
    .filter((item) => item.phase === '验收合格')
    .sort((a, b) => (b.验收时间 || '').localeCompare(a.验收时间 || ''))
}

export function listAllItems(): FlatItem[] {
  return flatten(getState().batches).sort((a, b) =>
    b.提交时间.localeCompare(a.提交时间),
  )
}

export function listBatches(): RectBatch[] {
  return [...getState().batches].sort((a, b) =>
    b.提交时间.localeCompare(a.提交时间),
  )
}

export function listMarkers(): SignMarker[] {
  return [...getState().markers].sort((a, b) =>
    a.桩号米 - b.桩号米 !== 0
      ? a.桩号米 - b.桩号米
      : a.舱室.localeCompare(b.舱室),
  )
}

export interface SignageStats {
  存量标识: number
  推定编号: number
  缺失: number
  待回执: number
  待验收: number
  未完成: number
  已完工: number
}

/** 两边读数一致：概览、待办、完工都用这同一个函数的结果。 */
export function signageStats(): SignageStats {
  const items = flatten(getState().batches)
  const count = (phase: ItemPhase) => items.filter((it) => it.phase === phase).length
  return {
    存量标识: getState().markers.length,
    推定编号: getState().markers.filter((m) => m.编号推定).length,
    缺失: getState().markers.filter((m) => m.状态 === '缺失').length,
    待回执: count('待回执'),
    待验收: count('已完成'),
    未完成: count('未完成') + count('验收不合格'),
    已完工: count('验收合格'),
  }
}

export function isBackfilled(): boolean {
  return getState().backfilled
}

export function backfillStamp(): string {
  return getState().回填时间
}

/** 当前仍有未闭环整改的标识 id 集合，页面据此禁用勾选，后到的重复提交进不来。 */
export function activeMarkerIds(): Set<number> {
  const ids = new Set<number>()
  for (const batch of getState().batches) {
    for (const item of batch.items) {
      if (isActive(item.phase)) {
        ids.add(item.markerId)
      }
    }
  }
  return ids
}
