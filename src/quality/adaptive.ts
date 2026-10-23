/**
 * 帧率监测自适应降档（PRD §6）。
 * 连续 4s 平均帧耗时超预算 1.3× → 先按 0.25 步进降 dpr（下限 1.0），再降整档。
 * 用户手动选档时 governor 直接不采样（暂停逻辑不受影响）。
 * 纯逻辑（无 DOM/three），由 onFrame(dtMs) 驱动，可单测。
 */

import type { QualitySettings, Tier } from './detect'

export type DowngradeAction = 'none' | 'dpr' | 'tier'

export interface AdaptiveHost {
  /** 当前生效画质（档位可能已被降过） */
  getSettings(): QualitySettings
  /** dpr 步进下降一档（内部有下限），返回是否成功 */
  stepDownDpr(): boolean
  /** 整档下降（low 到底则无操作），返回是否成功 */
  stepDownTier(): boolean
}

const WINDOW_MS = 4000 // 统计窗口
const OVER_BUDGET = 1.3 // 平均帧耗时 > 预算 × 1.3 触发

function frameBudgetMs(tier: Tier): number {
  // 低/中档目标 30fps，高档目标 60fps
  return tier === 'high' ? 1000 / 60 : 1000 / 30
}

export class AdaptiveGovernor {
  private windowSum = 0
  private windowSpan = 0
  private windowCount = 0
  private cooldown = 0 // 降档后的冷却，避免连环降
  downgradeCount = 0

  constructor(private host: AdaptiveHost, private enabled: () => boolean) {}

  /** 每帧喂入帧耗时（ms）。返回本次是否触发了降档动作。 */
  onFrame(dtMs: number): DowngradeAction {
    if (!this.enabled()) {
      this.reset()
      return 'none'
    }
    this.windowSum += dtMs
    this.windowSpan += dtMs
    this.windowCount += 1
    if (this.cooldown > 0) {
      // 冷却期内照常采样但不评估；冷却一到期即可用积累的窗口判断
      this.cooldown -= dtMs
      return 'none'
    }
    if (this.windowSpan < WINDOW_MS || this.windowCount < 8) return 'none'

    const avg = this.windowSum / this.windowCount
    const budget = frameBudgetMs(this.host.getSettings().tier)
    if (avg > budget * OVER_BUDGET) {
      this.reset()
      this.cooldown = WINDOW_MS
      this.downgradeCount += 1
      if (this.host.stepDownDpr()) return 'dpr'
      if (this.host.stepDownTier()) return 'tier'
      return 'none' // 已到底
    }
    this.reset()
    return 'none'
  }

  get averageMs(): number {
    return this.windowCount > 0 ? this.windowSum / this.windowCount : 0
  }

  reset(): void {
    this.windowSum = 0
    this.windowSpan = 0
    this.windowCount = 0
  }
}
