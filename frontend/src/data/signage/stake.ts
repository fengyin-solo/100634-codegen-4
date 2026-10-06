/** 桩号统一口径：K公里+米，一律折算成米用于排序、比较与推定。 */

export interface StakeValue {
  /** 折算米数，失败为 null */
  meters: number | null
  /** 统一成 K公里+米.米 文本，失败回退原串 */
  text: string
  /** 原始文本是否无法识别 */
  invalid: boolean
}

export function parseStake(raw: string): StakeValue {
  const text = (raw ?? '').trim()
  if (!text) {
    return { meters: null, text, invalid: true }
  }
  const matched = text.match(/^K?\s*(\d+)\s*\+\s*(\d+(?:\.\d+)?)$/i)
  if (!matched) {
    return { meters: null, text, invalid: true }
  }
  const km = Number(matched[1])
  const m = Number(matched[2])
  const meters = km * 1000 + m
  return { meters, text: formatStake(meters), invalid: false }
}

/** 米数 → K公里+米.米；里程桩号统一保留一位小数。 */
export function formatStake(meters: number): string {
  const km = Math.floor(meters / 1000)
  const m = (meters - km * 1000).toFixed(1)
  return `K${km}+${m.padStart(5, '0')}`
}
