import { describe, expect, it } from 'vitest'
import { clampDpr, detectTier, qualityForTier, type DeviceSignals } from '../src/quality/detect'

/** 生成一份基线信号（中端安卓），按用例覆写关键字段 */
function signals(over: Partial<DeviceSignals> = {}): DeviceSignals {
  return {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    devicePixelRatio: 2.6,
    effectiveType: '4g',
    isWebView: false,
    isDesktop: false,
    hasWebGPU: false,
    ...over,
  }
}

describe('detectTier 设备分级', () => {
  it('中端安卓手机 → 中档（默认档）', () => {
    expect(detectTier(signals())).toBe('mid')
  })

  it('cores <= 4 → 低档', () => {
    expect(detectTier(signals({ hardwareConcurrency: 4 }))).toBe('low')
    expect(detectTier(signals({ hardwareConcurrency: 2 }))).toBe('low')
  })

  it('deviceMemory <= 4GB → 低档', () => {
    expect(detectTier(signals({ deviceMemory: 4 }))).toBe('low')
    expect(detectTier(signals({ deviceMemory: 2 }))).toBe('low')
  })

  it('微信/内嵌 WebView → 低档', () => {
    expect(detectTier(signals({ isWebView: true }))).toBe('low')
  })

  it('2g/3g 网络 → 低档；4g 不降', () => {
    expect(detectTier(signals({ effectiveType: '3g' }))).toBe('low')
    expect(detectTier(signals({ effectiveType: '2g' }))).toBe('low')
    expect(detectTier(signals({ effectiveType: '4g' }))).toBe('mid')
  })

  it('桌面 UA → 高档', () => {
    expect(detectTier(signals({ isDesktop: true }))).toBe('high')
  })

  it('WebGPU 可用 → 高档', () => {
    expect(detectTier(signals({ hasWebGPU: true }))).toBe('high')
  })

  it('低档条件优先于高档（老桌面 WebView 仍为低档）', () => {
    expect(detectTier(signals({ isDesktop: true, hardwareConcurrency: 4 }))).toBe('low')
  })

  it('信号缺失（undefined）按较好规格处理，不误降档', () => {
    expect(detectTier(signals({ hardwareConcurrency: undefined, deviceMemory: undefined }))).toBe('mid')
  })
})

describe('qualityForTier 档位预算', () => {
  it('低档：dpr<=1.5、无阴影、1 层窗外景、无晃动、30fps 上限', () => {
    const q = qualityForTier('low')
    expect(q.dprCap).toBeLessThanOrEqual(1.5)
    expect(q.shadows).toBe(false)
    expect(q.sceneryLayers).toBe(1)
    expect(q.sway).toBe(0)
    expect(q.fpsCap).toBe(30)
  })

  it('中档：dpr<=2、512 低分辨率阴影贴图', () => {
    const q = qualityForTier('mid')
    expect(q.dprCap).toBeLessThanOrEqual(2)
    expect(q.shadows).toBe(true)
    expect(q.shadowMapSize).toBeLessThanOrEqual(512)
  })

  it('高档：全开（1024 阴影、3 层景、60fps 目标），dpr 仍硬性 <= 2（平板红线）', () => {
    const q = qualityForTier('high')
    expect(q.shadows).toBe(true)
    expect(q.shadowMapSize).toBeGreaterThanOrEqual(1024)
    expect(q.sceneryLayers).toBe(3)
    expect(q.sway).toBeGreaterThan(0)
    expect(q.dprCap).toBeLessThanOrEqual(2)
  })
})

describe('clampDpr', () => {
  it('高分屏 dpr 被档位上限截断', () => {
    expect(clampDpr(3.5, 2)).toBe(2)
    expect(clampDpr(1.2, 1.5)).toBe(1.2)
    expect(clampDpr(2.8, 1.5)).toBe(1.5)
  })
})
