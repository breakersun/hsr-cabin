import { describe, expect, it } from 'vitest'
import { DAY_CHANNELS, DayNightController, NIGHT_CHANNELS } from '../src/interaction/dayNight'

describe('DayNightController 昼夜切换', () => {
  it('初始为白天，通道取白天值', () => {
    const d = new DayNightController(0.8)
    expect(d.mode).toBe('day')
    expect(d.isNight).toBe(false)
    const ch = d.sample()
    expect(ch.ambient).toBeCloseTo(DAY_CHANNELS.ambient, 5)
    expect(ch.sun).toBeCloseTo(DAY_CHANNELS.sun, 5)
    expect(ch.strips).toBeCloseTo(DAY_CHANNELS.strips, 5)
    expect(ch.townLights).toBeCloseTo(0, 5)
  })

  it('切换夜晚在 1 秒内完成（验收标准 <1s）', () => {
    const d = new DayNightController(0.8)
    d.toggle()
    expect(d.mode).toBe('night')
    expect(d.transitioning).toBe(true)
    let t = 0
    while (d.transitioning && t < 2) {
      d.update(1 / 60)
      t += 1 / 60
    }
    expect(d.transitioning).toBe(false)
    expect(t).toBeLessThan(1.0)
    expect(d.blend).toBe(1)
    expect(d.isNight).toBe(true)
  })

  it('过渡期间通道连续插值（无跳变）', () => {
    const d = new DayNightController(0.8)
    d.toggle()
    let prev = d.sample().sun
    for (let i = 0; i < 30; i++) {
      d.update(0.8 / 30)
      const cur = d.sample().sun
      expect(cur).toBeLessThanOrEqual(prev + 1e-9) // 单调向夜晚值收敛
      prev = cur
    }
    expect(prev).toBeCloseTo(NIGHT_CHANNELS.sun, 5)
  })

  it('夜间：窗外暗、灯带亮、屏幕亮', () => {
    const d = new DayNightController(0.8)
    d.toggle()
    d.update(1.0)
    const ch = d.sample()
    expect(ch.windowWorld).toBeLessThan(DAY_CHANNELS.windowWorld)
    expect(ch.strips).toBeGreaterThan(DAY_CHANNELS.strips)
    expect(ch.screen).toBeGreaterThan(DAY_CHANNELS.screen)
    expect(ch.glassReflect).toBeGreaterThan(DAY_CHANNELS.glassReflect)
  })

  it('过渡中途反向切换从当前值回退，不瞬移', () => {
    const d = new DayNightController(1.0)
    d.toggle()
    d.update(0.4) // blend ≈ 0.4
    expect(d.blend).toBeCloseTo(0.4, 3)
    d.toggle() // 回白天
    expect(d.mode).toBe('day')
    d.update(0.05)
    expect(d.blend).toBeCloseTo(0.35, 3)
    expect(d.blend).toBeGreaterThan(0)
  })

  it('isNight 在 blend>=0.5 翻转', () => {
    const d = new DayNightController(1.0)
    d.toggle()
    d.update(0.49)
    expect(d.isNight).toBe(false)
    d.update(0.02)
    expect(d.isNight).toBe(true)
  })
})
