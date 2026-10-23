import { describe, expect, it } from 'vitest'
import { AdaptiveGovernor, type AdaptiveHost } from '../src/quality/adaptive'
import { qualityForTier, type QualitySettings } from '../src/quality/detect'

function makeHost(tier: 'low' | 'mid' | 'high'): AdaptiveHost & {
  dpr: number
  tier: 'low' | 'mid' | 'high'
  dprSteps: number
  tierSteps: number
} {
  const state = {
    dpr: qualityForTier(tier).dprCap,
    tier,
    dprSteps: 0,
    tierSteps: 0,
  }
  return {
    getSettings: (): QualitySettings => qualityForTier(state.tier),
    stepDownDpr(): boolean {
      if (state.dpr <= 1.001) return false
      state.dpr = Math.max(1, state.dpr - 0.25)
      state.dprSteps += 1
      return true
    },
    stepDownTier(): boolean {
      if (state.tier === 'low') return false
      state.tier = state.tier === 'high' ? 'mid' : 'low'
      state.dpr = qualityForTier(state.tier).dprCap
      state.tierSteps += 1
      return true
    },
    // getter：state 在闭包中变动，直接展开会拷贝初值
    get dpr(): number {
      return state.dpr
    },
    get tier(): 'low' | 'mid' | 'high' {
      return state.tier
    },
    get dprSteps(): number {
      return state.dprSteps
    },
    get tierSteps(): number {
      return state.tierSteps
    },
  }
}

/** 模拟 4s 窗口内的持续掉帧 */
function feed(g: AdaptiveGovernor, ms: number, seconds: number): void {
  const frames = Math.round((seconds * 1000) / ms)
  for (let i = 0; i < frames; i++) g.onFrame(ms)
}

describe('AdaptiveGovernor 自适应降档', () => {
  it('持续掉帧（>预算×1.3）先降 dpr 0.25 步进', () => {
    const host = makeHost('mid')
    const g = new AdaptiveGovernor(host, () => true)
    // 中档预算 33.3ms ×1.3 ≈ 43.3ms，喂 50ms 帧耗时
    feed(g, 50, 4.2)
    expect(host.dprSteps).toBe(1)
    expect(host.dpr).toBeCloseTo(2 - 0.25, 5)
  })

  it('dpr 到 1.0 后继续掉帧 → 降整档', () => {
    const host = makeHost('mid')
    const g = new AdaptiveGovernor(host, () => true)
    for (let round = 0; round < 5; round++) feed(g, 50, 4.3)
    expect(host.dprSteps).toBe(4) // 2 → 1.75 → 1.5 → 1.25 → 1.0
    expect(host.tierSteps).toBe(1)
    expect(host.tier).toBe('low')
  })

  it('帧率健康时不降档', () => {
    const host = makeHost('high')
    const g = new AdaptiveGovernor(host, () => true)
    feed(g, 12, 10) // 高档预算 16.7ms，12ms 健康
    expect(host.dprSteps + host.tierSteps).toBe(0)
  })

  it('手动选档（enabled=false）完全不采样', () => {
    const host = makeHost('mid')
    const g = new AdaptiveGovernor(host, () => false)
    feed(g, 60, 10)
    expect(host.dprSteps + host.tierSteps).toBe(0)
    expect(g.averageMs).toBe(0)
  })

  it('短时抖动（窗口内均值未超标）不触发', () => {
    const host = makeHost('mid')
    const g = new AdaptiveGovernor(host, () => true)
    // 交替 60ms/10ms，均值 35ms < 43.3ms
    for (let i = 0; i < 130; i++) g.onFrame(i % 2 === 0 ? 60 : 10)
    expect(host.dprSteps + host.tierSteps).toBe(0)
  })

  it('降档后有冷却窗口，不会连环降', () => {
    const host = makeHost('mid')
    const g = new AdaptiveGovernor(host, () => true)
    feed(g, 50, 4.2)
    expect(host.dprSteps).toBe(1)
    // 立刻又喂满 4s 慢帧——冷却期内只计一次
    feed(g, 50, 4.2)
    expect(host.dprSteps).toBe(2)
    expect(host.tierSteps).toBe(0)
  })
})
