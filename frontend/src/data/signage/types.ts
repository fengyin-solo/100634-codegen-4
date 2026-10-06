/** 标识牌与里程桩台账的领域类型。台账与巡检整改入口共用这一份口径。 */

export type SignType = '标识牌' | '里程桩'

/** 标识的物理状态：缺失=需要补设；破损/反光膜脱落=需要更换。 */
export type MarkerState = '完好' | '破损' | '缺失' | '反光膜脱落'

export type JobKind = '补设' | '更换'
export type BatchKind = JobKind | '混合'

/** 存量标识（台账主档）。早年档案缺项的字段保持空串，并在缺项说明里注明缘由。 */
export interface SignMarker {
  id: number
  编号: string
  编号推定: boolean
  推定依据: string
  舱室: string
  桩号: string
  桩号米: number
  类型: SignType
  状态: MarkerState
  反光膜到期日: string
  安装日期: string
  登记时间: string
  来源: string
  缺项说明: string
}

/**
 * 整改条目生命周期：
 * 待回执 →（回执已完成）→ 待验收（阶段记为「已完成」）→ 验收合格（闭环）
 *        →（回执未完成+缘由）→ 未完成（可重新发起）
 * 待验收 → 验收不合格（可重新发起）
 */
export type ItemPhase = '待回执' | '已完成' | '未完成' | '验收合格' | '验收不合格'

export interface RectItem {
  itemId: string
  markerId: number
  编号: string
  编号推定: boolean
  舱室: string
  桩号: string
  类型: SignType
  作业类型: JobKind
  /** 本次作业计划换上的反光膜到期日；为空表示沿用原膜。 */
  新膜到期日: string
  phase: ItemPhase
  缘由: string
  提交时间: string
  回执时间: string
  验收时间: string
}

export interface RectBatch {
  batchId: string
  巡检任务号: string
  作业类型: BatchKind
  提交时间: string
  items: RectItem[]
}

export interface SignageState {
  version: 1
  backfilled: boolean
  回填时间: string
  markers: SignMarker[]
  batches: RectBatch[]
}

/** 勾选行：页面按 markerId 勾选，新膜到期日可在批量操作台上补录。 */
export interface SelectionLine {
  markerId: number
  新膜到期日?: string
}

export type IssueLevel = '拦截' | '提示'

export interface PrecheckIssue {
  level: IssueLevel
  code: string
  舱室: string
  桩号: string
  类型: string
  message: string
}

/** 规整后的待提交行：新膜到期日已解析成最终计划值。 */
export interface NormalizedLine {
  marker: SignMarker
  新膜到期日: string
}

export interface PrecheckResult {
  ok: boolean
  normalized: NormalizedLine[]
  issues: PrecheckIssue[]
  /** 批内多勾去重掉的条数，只认第一次勾选。 */
  dedupedInBatch: number
}

export interface FlatItem extends RectItem {
  batchId: string
  巡检任务号: string
}
