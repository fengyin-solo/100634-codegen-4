/**
 * 标识牌与里程桩整组台账 —— 纯领域逻辑。
 *
 * 本文件不碰 localStorage、不碰 Vue，只做：
 * 1. 桩号解析/格式化、编号推定、存量回填；
 * 2. 整组提交前的预检（阻断项 / 提示项）；
 * 3. 受理落库、验收落库两段事务的纯函数（先在草稿上改，任何一条不通过就抛错，由持久层保证“整套退回”）；
 * 4. 整改待办、完工清单的同源派生（台账入口与巡检入口取的是同一份）。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type SignKind = '里程桩' | '标识牌'
export type SignCondition = '完好' | '破损' | '反光膜脱落' | '缺失'
export type OrderAction = '补设' | '更换'
export type ReceiptKind = '已补齐' | '未补成'
export type OrderStatus = '待回执' | '部分补齐' | '已闭环'

/** 台账中的一块标识（或一个历史缺牌桩位）。 */
export interface Sign {
  id: number
  /** 统一编号，里程桩 LC-K0+200；标识牌 ZH-BS-K0+200-01 */
  code: string
  /** 编号是否由早年登记按舱室与远近桩号推定 */
  inferredCode: boolean
  kind: SignKind
  /** 标识牌细分：舱室指示牌 / 安全警示牌 / 禁止烟火牌 ……；里程桩固定“里程桩” */
  subType: string
  cabin: string
  /** 里程（米），台账一律按它排序 */
  chainageM: number
  /** 反光膜到期日 yyyy-mm-dd，'' 表示早年缺登记，空着 */
  reflectExpiry: string
  condition: SignCondition
  source: '存量回填' | '巡检登记'
  /** 登记时刻（存量按登记时刻落库） */
  registeredAt: string
  /** 缺项与推定缘由都写在这里 */
  notes: string
  lastOrderNo: string
  lastFixedAt: string
  lastFailReason: string
}

/** 整组工单里的一行（一次巡检勾选的多处标识之一）。 */
export interface OrderItem {
  lineId: number
  signId: number
  signKey: string
  code: string
  cabin: string
  kind: SignKind
  subType: string
  chainageM: number
  action: OrderAction
  issue: string
  /** 受理时登记的新反光膜到期日，验收写入台账 */
  newReflectExpiry: string
  /** '' 尚未回执；已补齐 / 未补成 */
  receipt: '' | ReceiptKind
  resultNote: string
  receivedAt: string
}

export interface SignOrder {
  id: number
  orderNo: string
  /** 来源巡检编号（巡检班组带单时填写） */
  patrolNo: string
  team: string
  submittedAt: string
  acceptedAt: string
  status: OrderStatus
  items: OrderItem[]
}

export interface SignDomainState {
  version: 1
  signs: Sign[]
  orders: SignOrder[]
  seqSign: number
  seqOrder: number
  seqLine: number
}

/** 提交对话框里可编辑的一行草稿。 */
export interface DraftLine {
  lineId: number
  signId: number
  cabin: string
  kind: SignKind
  subType: string
  chainageText: string
  issue: SignCondition | ''
  action: OrderAction
  newReflectExpiry: string
}

export type CheckLevel = 'ok' | 'warn' | 'error'

export interface LineCheck {
  lineId: number
  level: CheckLevel
  code:
    | 'OK'
    | 'INVALID_CHAINAGE'
    | 'DUP_IN_BATCH'
    | 'ACTIVE_DUP'
    | 'ALREADY_FIXED'
    | 'ACTION_MISMATCH'
    | 'NEW_FILM_MISSING'
    | 'NEW_FILM_EXPIRED'
    | 'FILM_OVERDUE_SHOULD_REPLACE'
    | 'UNKNOWN_MUST_INSTALL'
    | 'SUBTYPE_MISSING'
  message: string
  /** 批内重复时，指向第一次出现的那一行 */
  keepLineId?: number
}

export interface SubmitReceipt {
  orderNo: string
  accepted: { lineId: number; signKey: string; chainageText: string; code: string; action: OrderAction }[]
  /** 批内重复被折叠（只保留第一次）的行，不会新增记录 */
  deduped: { lineId: number; signKey: string; chainageText: string; keepLineId: number }[]
  /** 巡检新发现、台账原本没有的缺牌桩位（受理时已建档） */
  createdMissing: { signKey: string; chainageText: string }[]
}

export interface AcceptReceiptItem {
  lineId: number
  chainageText: string
  code: string
  receipt: ReceiptKind
  note: string
}
export interface AcceptReceipt {
  orderNo: string
  status: OrderStatus
  items: AcceptReceiptItem[]
}

export interface AcceptLineInput {
  lineId: number
  receipt: '' | ReceiptKind
  note: string
  newReflectExpiry: string
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const CABINS = ['综合舱', '电力舱', '燃气舱', '水信舱', '热力舱']
export const SIGN_SUBTYPES = ['舱室指示牌', '安全警示牌', '禁止烟火牌', '方向指示牌', '疏散指示牌', '高温警示牌']
export const ISSUES: SignCondition[] = ['缺失', '破损', '反光膜脱落']

const CABIN_SHORT: Record<string, string> = {
  综合舱: 'ZH',
  电力舱: 'DL',
  燃气舱: 'RQ',
  水信舱: 'SX',
  热力舱: 'RL',
}

export function signKey(cabin: string, kind: SignKind, chainageM: number): string {
  return `${cabin}|${kind}|${chainageM}`
}

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 建议的新反光膜到期日：自当天起三年。 */
export function suggestedFilmExpiry(now: Date = new Date()): string {
  const d = new Date(now)
  d.setFullYear(d.getFullYear() + 3)
  return todayISO(d)
}

// ---------------------------------------------------------------------------
// 桩号与编号（统一口径）
// ---------------------------------------------------------------------------

/** 解析桩号：K0+250 / 0+250 / K1+050 / 纯米数 800；米段必须三位且 0~999，失败返回 null。 */
export function parseChainage(text: string): number | null {
  const t = text.trim().toUpperCase().replace(/^K/, '')
  const plus = /^(\d+)\+(\d{3})$/.exec(t)
  if (plus) {
    return Number(plus[1]) * 1000 + Number(plus[2])
  }
  if (/^\d+$/.test(t)) {
    return Number(t)
  }
  return null
}

/** 格式化里程（米）：800 -> K0+800，1250 -> K1+250。 */
export function formatChainage(meters: number): string {
  const q = Math.floor(meters / 1000)
  const m = String(meters % 1000).padStart(3, '0')
  return `K${q}+${m}`
}

/** 舱室简码，未知舱室统一归 GL（管廊公用）。 */
export function cabinShort(cabin: string): string {
  return CABIN_SHORT[cabin] ?? 'GL'
}

/**
 * 给一块标识取下一个统一编号（桩号直接入编号，编号与桩位一一对应）：
 * - 里程桩：LC-K0+200；同桩位再出现一块里程桩时才追加 -02
 * - 标识牌：{舱室码}-BS-K0+200；同一桩位有多块牌时追加 -02、-03（按桩号顺序推定）
 *
 * 计数时只认已经拿到编号的条目，回填阶段同一批未编号对象不会互相占位。
 */
export function nextCodeFor(existing: Sign[], cabin: string, kind: SignKind, chainageM: number): string {
  const fmt = formatChainage(chainageM)
  const base = kind === '里程桩' ? `LC-${fmt}` : `${cabinShort(cabin)}-BS-${fmt}`
  const taken = existing
    .filter(
      (s) =>
        s.code !== '' &&
        s.kind === kind &&
        s.chainageM === chainageM &&
        (kind === '里程桩' || s.cabin === cabin),
    )
    .map((s) => s.code)
  if (!taken.includes(base)) {
    return base
  }
  let n = 2
  while (taken.includes(`${base}-${String(n).padStart(2, '0')}`)) {
    n += 1
  }
  return `${base}-${String(n).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// 存量回填
// ---------------------------------------------------------------------------

/** 种子里的早年原始登记：允许没有编号、缺反光膜日期、只记远近桩号。 */
export interface LegacySignInput {
  registeredAt: string
  cabin: string
  kind: SignKind
  subType: string
  /** 早年已有的编号，留 '' 表示无编号需要推定 */
  code?: string
  /** 明确登记的里程（米）；与远近桩号二选一 */
  chainageM?: number
  /** 近桩里程（米） */
  nearM?: number
  /** 远桩里程（米） */
  farM?: number
  /** 距近桩的偏移（米）；不填则按远近桩中点推定 */
  nearOffsetM?: number
  reflectExpiry?: string
  condition: SignCondition
}

/**
 * 按远近桩号推定里程：
 * - 登记了距近桩偏移：近桩 + 偏移（偏移夹在 [0, 间距] 内）；
 * - 否则取两桩中点四舍五入到米（等距情形天然落中点，编号归近桩一侧的百米段）。
 */
export function inferChainageM(input: Pick<LegacySignInput, 'chainageM' | 'nearM' | 'farM' | 'nearOffsetM'>): number {
  if (typeof input.chainageM === 'number') {
    return input.chainageM
  }
  const near = input.nearM ?? 0
  const far = input.farM ?? near
  const span = Math.max(0, far - near)
  if (typeof input.nearOffsetM === 'number') {
    const offset = Math.min(Math.max(0, input.nearOffsetM), span)
    return near + offset
  }
  return near + Math.round(span / 2)
}

/**
 * 存量清单按登记时刻落库（id 顺序 = 登记先后）；无编号者再按桩号顺序推定编号；
 * 缺项空着并在 notes 注明缘由。
 */
export function backfillLegacy(rows: LegacySignInput[]): SignDomainState {
  const ordered = rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => (a.row.registeredAt < b.row.registeredAt ? -1 : a.row.registeredAt > b.row.registeredAt ? 1 : a.idx - b.idx))

  const signs: Sign[] = []
  let seqSign = 0
  for (const { row } of ordered) {
    seqSign += 1
    const chainageM = inferChainageM(row)
    const notes: string[] = []
    if (typeof row.nearM === 'number' && typeof row.farM === 'number' && typeof row.chainageM !== 'number') {
      notes.push(
        `早年无编号，按${row.cabin}与远近桩号${formatChainage(row.nearM)}~${formatChainage(row.farM)}${
          typeof row.nearOffsetM === 'number' ? `、距近桩${row.nearOffsetM}m` : '中点等距取近桩一侧'
        }推定桩位${formatChainage(chainageM)}`,
      )
    }
    if (!row.reflectExpiry) {
      notes.push('反光膜到期日早年缺登记，暂空')
    }
    signs.push({
      id: seqSign,
      code: row.code ?? '',
      inferredCode: !row.code,
      kind: row.kind,
      subType: row.subType,
      cabin: row.cabin,
      chainageM,
      reflectExpiry: row.reflectExpiry ?? '',
      condition: row.condition,
      source: '存量回填',
      registeredAt: row.registeredAt,
      notes: notes.join('；'),
      lastOrderNo: '',
      lastFixedAt: '',
      lastFailReason: '',
    })
  }

  // 编号口径：按桩号顺序为无编号者推定（近桩、同桩号按登记先后）。
  const byChainage = [...signs].sort((a, b) => a.chainageM - b.chainageM || a.registeredAt.localeCompare(b.registeredAt))
  for (const sign of byChainage) {
    if (!sign.code) {
      sign.code = nextCodeFor(signs, sign.cabin, sign.kind, sign.chainageM)
      sign.notes = sign.notes ? `${sign.notes}；推定编号${sign.code}` : `推定编号${sign.code}`
    }
  }

  return { version: 1, signs, orders: [], seqSign, seqOrder: 0, seqLine: 0 }
}

// ---------------------------------------------------------------------------
// 预检
// ---------------------------------------------------------------------------

function isFilmOverdue(expiry: string, today: string): boolean {
  return expiry !== '' && expiry <= today
}

/** 尚未回执（没有任何结果）的在办条目。 */
export function openItems(orders: SignOrder[]): OrderItem[] {
  return orders.flatMap((o) => o.items.filter((it) => it.receipt === ''))
}

export function findSign(signs: Sign[], cabin: string, kind: SignKind, chainageM: number): Sign | undefined {
  const key = signKey(cabin, kind, chainageM)
  return signs.find((s) => signKey(s.cabin, s.kind, s.chainageM) === key)
}

/**
 * 整组提交预检。逐行给出结论：
 * - error：阻断项，必须就地改对或剔除该行，否则整套不落库；
 * - warn：提示项（批内勾选重复会折叠、存量膜过期提示走更换），不阻断。
 */
export function precheckSubmit(lines: DraftLine[], signs: Sign[], orders: SignOrder[], today: string): LineCheck[] {
  const checks: LineCheck[] = []
  const firstSeen = new Map<string, number>()
  const activeKeys = new Set(openItems(orders).map((it) => it.signKey))

  for (const line of lines) {
    const meters = parseChainage(line.chainageText)
    if (meters === null || meters < 0) {
      checks.push({ lineId: line.lineId, level: 'error', code: 'INVALID_CHAINAGE', message: `桩号「${line.chainageText}」无法识别，应形如 K0+250` })
      continue
    }
    if (line.kind === '标识牌' && !line.subType) {
      checks.push({ lineId: line.lineId, level: 'error', code: 'SUBTYPE_MISSING', message: '标识牌需选择牌面类型' })
      continue
    }

    const key = signKey(line.cabin, line.kind, meters)

    // 批内重复：同一块多勾一遍，只认第一次。
    const keep = firstSeen.get(key)
    if (keep !== undefined) {
      checks.push({
        lineId: line.lineId,
        level: 'warn',
        code: 'DUP_IN_BATCH',
        keepLineId: keep,
        message: `与本批第 ${keep} 行是同一块（${line.cabin}·${line.kind}·${formatChainage(meters)}），只保留第一次勾选，不会多出记录`,
      })
      continue
    }
    firstSeen.set(key, line.lineId)

    // 跨批重复：在办工单里还没回执，后到的整条退回。
    if (activeKeys.has(key)) {
      checks.push({ lineId: line.lineId, level: 'error', code: 'ACTIVE_DUP', message: '该标识已有在办整备单尚未回执，后到的提交整条退回，条数不叠加' })
      continue
    }

    const sign = findSign(signs, line.cabin, line.kind, meters)
    if (!sign) {
      // 台账没有：只能是巡检新发现缺牌、走补设。
      if (line.action !== '补设') {
        checks.push({ lineId: line.lineId, level: 'error', code: 'UNKNOWN_MUST_INSTALL', message: '台账中无此桩位标识，只能按「补设」处理新发现缺牌' })
        continue
      }
    } else {
      if (sign.condition === '完好') {
        checks.push({ lineId: line.lineId, level: 'error', code: 'ALREADY_FIXED', message: '该标识现状完好且无在办单，重复整备整条退回' })
        continue
      }
      const expectAction: OrderAction = sign.condition === '缺失' ? '补设' : '更换'
      if (line.action !== expectAction) {
        checks.push({
          lineId: line.lineId,
          level: 'error',
          code: 'ACTION_MISMATCH',
          message: `现状为「${sign.condition}」，应走「${expectAction}」而非「${line.action}」`,
        })
        continue
      }
      if (isFilmOverdue(sign.reflectExpiry, today) && line.action === '补设') {
        checks.push({ lineId: line.lineId, level: 'error', code: 'FILM_OVERDUE_SHOULD_REPLACE', message: '存量反光膜已过期，不能只补牌，应改为「更换」连膜一起换' })
        continue
      }
    }

    // 新膜是整备材料，日期必填且不得拿过期膜施工。
    if (!line.newReflectExpiry) {
      checks.push({ lineId: line.lineId, level: 'error', code: 'NEW_FILM_MISSING', message: '请填写新反光膜到期日' })
      continue
    }
    if (isFilmOverdue(line.newReflectExpiry, today)) {
      checks.push({ lineId: line.lineId, level: 'error', code: 'NEW_FILM_EXPIRED', message: `新反光膜到期日 ${line.newReflectExpiry} 已过期，过期膜不能落库` })
      continue
    }

    checks.push({ lineId: line.lineId, level: 'ok', code: 'OK', message: '校验通过' })
  }
  return checks
}

// ---------------------------------------------------------------------------
// 事务 1：整组受理落库
// ---------------------------------------------------------------------------

export interface SubmitOrderInput {
  patrolNo: string
  team: string
  lines: DraftLine[]
}

function nextOrderNo(seqOrder: number, now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `BL${y}${m}${d}-${String(seqOrder).padStart(3, '0')}`
}

/**
 * 在草稿 state 上执行受理。权威地再跑一遍预检：
 * 有任何阻断项直接抛错（草稿随后丢弃，调用方不得持久化）；
 * 批内重复在此再折叠一次，保证同一块绝不会落两条。
 */
export function applySubmit(
  draft: SignDomainState,
  input: SubmitOrderInput,
  now: Date,
): SubmitReceipt {
  const today = todayISO(now)
  const checks = precheckSubmit(input.lines, draft.signs, draft.orders, today)
  const blocking = checks.filter((c) => c.level === 'error')
  if (blocking.length > 0) {
    throw new Error(['预检未通过，整套暂不落库：', ...blocking.map((c) => `· ${c.message}`)].join('\n'))
  }

  const receipt: SubmitReceipt = { orderNo: '', accepted: [], deduped: [], createdMissing: [] }
  const seen = new Set<string>()
  const items: OrderItem[] = []

  for (const line of input.lines) {
    const meters = parseChainage(line.chainageText) as number
    const key = signKey(line.cabin, line.kind, meters)
    if (seen.has(key)) {
      // 批内重复折叠：只保留第一次，不产生 item。
      const keepLine = checks.find((c) => c.lineId === line.lineId)?.keepLineId ?? 0
      receipt.deduped.push({ lineId: line.lineId, signKey: key, chainageText: formatChainage(meters), keepLineId: keepLine })
      continue
    }
    seen.add(key)

    let sign = findSign(draft.signs, line.cabin, line.kind, meters)
    if (!sign) {
      // 巡检新发现缺牌桩位：先以“缺失”建档再派单，两边台账始终是同一份。
      draft.seqSign += 1
      sign = {
        id: draft.seqSign,
        code: '',
        inferredCode: false,
        kind: line.kind,
        subType: line.kind === '里程桩' ? '里程桩' : line.subType,
        cabin: line.cabin,
        chainageM: meters,
        reflectExpiry: '',
        condition: '缺失',
        source: '巡检登记',
        registeredAt: now.toISOString(),
        notes: `巡检${input.patrolNo ? `（${input.patrolNo}）` : ''}新发现缺牌桩位，补设受理时建档`,
        lastOrderNo: '',
        lastFixedAt: '',
        lastFailReason: '',
      }
      sign.code = nextCodeFor(draft.signs, sign.cabin, sign.kind, sign.chainageM)
      draft.signs.push(sign)
      receipt.createdMissing.push({ signKey: key, chainageText: formatChainage(meters) })
    }

    draft.seqLine += 1
    items.push({
      lineId: draft.seqLine,
      signId: sign.id,
      signKey: key,
      code: sign.code,
      cabin: line.cabin,
      kind: line.kind,
      subType: sign.subType,
      chainageM: meters,
      action: line.action,
      issue: sign.condition,
      newReflectExpiry: line.newReflectExpiry,
      receipt: '',
      resultNote: '',
      receivedAt: '',
    })
    receipt.accepted.push({
      lineId: line.lineId,
      signKey: key,
      chainageText: formatChainage(meters),
      code: sign.code,
      action: line.action,
    })
  }

  draft.seqOrder += 1
  const orderNo = nextOrderNo(draft.seqOrder, now)
  const order: SignOrder = {
    id: draft.seqOrder,
    orderNo,
    patrolNo: input.patrolNo,
    team: input.team,
    submittedAt: now.toISOString(),
    acceptedAt: '',
    status: '待回执',
    items,
  }
  draft.orders.push(order)
  receipt.orderNo = orderNo
  return receipt
}

// ---------------------------------------------------------------------------
// 事务 2：逐条回执、验收落库
// ---------------------------------------------------------------------------

/**
 * 在草稿上执行验收。每条必须给出已补齐/未补成；未补成缘由必填。
 * 任一条不合法即抛错，整套不写。
 */
export function applyAccept(
  draft: SignDomainState,
  orderId: number,
  rows: AcceptLineInput[],
  now: Date,
): AcceptReceipt {
  const order = draft.orders.find((o) => o.id === orderId)
  if (!order) {
    throw new Error('没有找到这张整备单')
  }
  const today = todayISO(now)
  const byLine = new Map(rows.map((r) => [r.lineId, r]))

  const problems: string[] = []
  for (const item of order.items) {
    const row = byLine.get(item.lineId)
    if (!row || row.receipt === '') {
      problems.push(`· ${item.code} ${formatChainage(item.chainageM)}：还没选验收结果`)
      continue
    }
    if (row.receipt === '未补成' && !row.note.trim()) {
      problems.push(`· ${item.code} ${formatChainage(item.chainageM)}：未补成必须另起一行写清缘由`)
    }
    if (row.receipt === '已补齐') {
      const expiry = row.newReflectExpiry || item.newReflectExpiry
      if (!expiry) {
        problems.push(`· ${item.code} ${formatChainage(item.chainageM)}：缺少新反光膜到期日`)
      } else if (isFilmOverdue(expiry, today)) {
        problems.push(`· ${item.code} ${formatChainage(item.chainageM)}：新反光膜 ${expiry} 已过期，不能验收`)
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(['验收未通过，整套暂不落库：', ...problems].join('\n'))
  }

  const receiptItems: AcceptReceiptItem[] = []
  for (const item of order.items) {
    const row = byLine.get(item.lineId)!
    const receiptKind: ReceiptKind = row.receipt === '已补齐' ? '已补齐' : '未补成'
    const sign = draft.signs.find((s) => s.id === item.signId)
    item.receipt = receiptKind
    item.resultNote = row.note.trim()
    item.receivedAt = now.toISOString()
    if (receiptKind === '已补齐') {
      item.newReflectExpiry = row.newReflectExpiry || item.newReflectExpiry
      if (sign) {
        sign.condition = '完好'
        sign.reflectExpiry = item.newReflectExpiry
        sign.lastFixedAt = now.toISOString()
        sign.lastOrderNo = order.orderNo
        sign.lastFailReason = ''
      }
    } else {
      if (sign) {
        sign.lastOrderNo = order.orderNo
        sign.lastFailReason = row.note.trim()
      }
    }
    receiptItems.push({
      lineId: item.lineId,
      chainageText: formatChainage(item.chainageM),
      code: item.code,
      receipt: receiptKind,
      note: row.note.trim(),
    })
  }

  const allFixed = order.items.every((it) => it.receipt === '已补齐')
  order.status = allFixed ? '已闭环' : '部分补齐'
  order.acceptedAt = now.toISOString()

  return { orderNo: order.orderNo, status: order.status, items: receiptItems }
}

// ---------------------------------------------------------------------------
// 同源派生视图：台账入口与巡检入口取的是同一份
// ---------------------------------------------------------------------------

export interface TodoViewRow {
  signId: number
  key: string
  code: string
  cabin: string
  kind: SignKind
  subType: string
  chainageM: number
  chainageText: string
  condition: SignCondition
  stage: '待派单' | '已派单·待回执'
  orderNo: string
  failReason: string
  inferredCode: boolean
}

/** 整改待办：一块标识无论在台账还是在办单里，合并为一行，派单只改阶段不叠加条数。 */
export function selectTodoList(state: SignDomainState): TodoViewRow[] {
  const openByKey = new Map<string, SignOrder>()
  for (const order of state.orders) {
    for (const item of order.items) {
      if (item.receipt === '') {
        openByKey.set(item.signKey, order)
      }
    }
  }
  return state.signs
    .filter((s) => s.condition !== '完好')
    .map((s) => {
      const key = signKey(s.cabin, s.kind, s.chainageM)
      const order = openByKey.get(key)
      return {
        signId: s.id,
        key,
        code: s.code,
        cabin: s.cabin,
        kind: s.kind,
        subType: s.subType,
        chainageM: s.chainageM,
        chainageText: formatChainage(s.chainageM),
        condition: s.condition,
        stage: order ? ('已派单·待回执' as const) : ('待派单' as const),
        orderNo: order?.orderNo ?? '',
        failReason: s.lastFailReason,
        inferredCode: s.inferredCode,
      }
    })
    .sort((a, b) => a.chainageM - b.chainageM || a.cabin.localeCompare(b.cabin))
}

export interface CompletedViewRow {
  orderNo: string
  patrolNo: string
  team: string
  signId: number
  code: string
  cabin: string
  kind: SignKind
  chainageM: number
  chainageText: string
  action: OrderAction
  reflectExpiry: string
  receivedAt: string
  note: string
}

/** 完工清单：只认验收“已补齐”的回执，两个入口取同一个派生结果。 */
export function selectCompletedList(state: SignDomainState): CompletedViewRow[] {
  return state.orders
    .flatMap((o) =>
      o.items
        .filter((it) => it.receipt === '已补齐')
        .map((it): CompletedViewRow => ({
          orderNo: o.orderNo,
          patrolNo: o.patrolNo,
          team: o.team,
          signId: it.signId,
          code: it.code,
          cabin: it.cabin,
          kind: it.kind,
          chainageM: it.chainageM,
          chainageText: formatChainage(it.chainageM),
          action: it.action,
          reflectExpiry: it.newReflectExpiry,
          receivedAt: it.receivedAt,
          note: it.resultNote,
        })),
    )
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
}

export interface SignStats {
  total: number
  intact: number
  todo: number
  waitingDispatch: number
  openOrders: number
  openItems: number
  completedThisMonth: number
  failedTotal: number
}

export function selectStats(state: SignDomainState, now: Date = new Date()): SignStats {
  const todoList = selectTodoList(state)
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return {
    total: state.signs.length,
    intact: state.signs.filter((s) => s.condition === '完好').length,
    todo: todoList.length,
    waitingDispatch: todoList.filter((t) => t.stage === '待派单').length,
    openOrders: state.orders.filter((o) => o.status !== '已闭环').length,
    openItems: openItems(state.orders).length,
    completedThisMonth: selectCompletedList(state).filter((c) => c.receivedAt.startsWith(month)).length,
    failedTotal: state.orders.flatMap((o) => o.items).filter((it) => it.receipt === '未补成').length,
  }
}

// ---------------------------------------------------------------------------
// 存量原始登记（顺序故意按登记时刻打乱，回填时按登记时刻落库）
// ---------------------------------------------------------------------------

export const LEGACY_SIGNS: LegacySignInput[] = [
  { registeredAt: '2023-05-08T09:10:00', cabin: '热力舱', kind: '标识牌', subType: '高温警示牌', chainageM: 1050, reflectExpiry: '2024-05-07', condition: '反光膜脱落' },
  { registeredAt: '2019-03-12T08:00:00', cabin: '综合舱', kind: '里程桩', subType: '里程桩', chainageM: 0, reflectExpiry: '2027-03-11', condition: '完好' },
  { registeredAt: '2025-08-21T15:40:00', cabin: '燃气舱', kind: '里程桩', subType: '里程桩', chainageM: 1200, reflectExpiry: '2026-08-20', condition: '破损' },
  { registeredAt: '2019-03-12T08:30:00', cabin: '综合舱', kind: '里程桩', subType: '里程桩', chainageM: 100, condition: '完好' },
  { registeredAt: '2021-09-20T10:00:00', cabin: '燃气舱', kind: '里程桩', subType: '里程桩', chainageM: 500, reflectExpiry: '2028-09-19', condition: '完好' },
  { registeredAt: '2019-03-12T09:00:00', cabin: '综合舱', kind: '里程桩', subType: '里程桩', nearM: 100, farM: 300, condition: '完好' },
  { registeredAt: '2022-01-15T11:20:00', cabin: '水信舱', kind: '里程桩', subType: '里程桩', chainageM: 800, reflectExpiry: '2029-01-14', condition: '完好' },
  { registeredAt: '2020-06-01T09:30:00', cabin: '电力舱', kind: '标识牌', subType: '安全警示牌', chainageM: 150, reflectExpiry: '2023-05-31', condition: '反光膜脱落' },
  { registeredAt: '2024-02-19T14:00:00', cabin: '综合舱', kind: '标识牌', subType: '疏散指示牌', nearM: 300, farM: 400, nearOffsetM: 50, reflectExpiry: '2026-06-30', condition: '完好' },
  { registeredAt: '2020-06-01T10:15:00', cabin: '电力舱', kind: '标识牌', subType: '舱室指示牌', nearM: 200, farM: 300, reflectExpiry: '2026-12-31', condition: '破损' },
  { registeredAt: '2025-04-10T16:05:00', cabin: '电力舱', kind: '标识牌', subType: '安全警示牌', chainageM: 450, condition: '缺失' },
  { registeredAt: '2021-09-20T10:40:00', cabin: '燃气舱', kind: '标识牌', subType: '禁止烟火牌', chainageM: 520, reflectExpiry: '2025-09-19', condition: '破损' },
  { registeredAt: '2022-08-03T09:00:00', cabin: '综合舱', kind: '里程桩', subType: '里程桩', chainageM: 600, reflectExpiry: '2027-08-02', condition: '完好' },
  { registeredAt: '2022-01-15T11:00:00', cabin: '水信舱', kind: '标识牌', subType: '方向指示牌', chainageM: 800, reflectExpiry: '2027-01-14', condition: '完好' },
  { registeredAt: '2026-03-30T10:25:00', cabin: '水信舱', kind: '标识牌', subType: '舱室指示牌', chainageM: 1500, reflectExpiry: '2025-03-29', condition: '反光膜脱落' },
  { registeredAt: '2024-11-02T13:30:00', cabin: '综合舱', kind: '里程桩', subType: '里程桩', chainageM: 400, condition: '缺失' },
  { registeredAt: '2023-05-08T09:40:00', cabin: '热力舱', kind: '里程桩', subType: '里程桩', chainageM: 1100, reflectExpiry: '2030-05-07', condition: '完好' },
  { registeredAt: '2022-11-16T09:45:00', cabin: '综合舱', kind: '标识牌', subType: '舱室指示牌', chainageM: 700, reflectExpiry: '2028-11-15', condition: '完好' },
]
