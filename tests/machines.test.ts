import { describe, expect, it } from 'vitest'
import {
  BackrestMachine,
  BoilerMachine,
  CurtainMachine,
  DoorMachine,
  TrayMachine,
} from '../src/interaction/machines'

describe('DoorMachine 通过台感应门', () => {
  it('完整开合周期：closed → opening → open（保持）→ closing → closed', () => {
    const d = new DoorMachine(0.8, 2.5)
    expect(d.state).toBe('closed')
    expect(d.isPassable).toBe(false)
    d.requestOpen()
    expect(d.state).toBe('opening')
    d.update(0.4)
    expect(d.openness).toBeCloseTo(0.5, 5)
    d.update(0.4)
    expect(d.state).toBe('open')
    expect(d.isPassable).toBe(true)
    // 保持时间内不开
    d.sensor = true
    d.update(1.0)
    expect(d.state).toBe('open')
    // 人离开 + 保持时间到 → 自动关闭
    d.sensor = false
    d.update(1.6) // holdTimer 2.5 - 1.0 = 1.5 → 再过 1.5s 关
    expect(d.state).toBe('closing')
    d.update(0.8)
    expect(d.state).toBe('closed')
    expect(d.openness).toBe(0)
    expect(d.isPassable).toBe(false)
  })

  it('防夹：关闭过程中门框有人 → 立即重新打开', () => {
    const d = new DoorMachine(0.5, 1.0)
    d.requestOpen()
    d.update(0.5)
    expect(d.state).toBe('open')
    d.sensor = false
    d.blocked = false
    d.update(1.1) // holdTime 到，开始关门
    expect(d.state).toBe('closing')
    d.blocked = true
    d.update(0.01)
    expect(d.state).toBe('opening')
  })

  it('closing 中 requestOpen 可逆转', () => {
    const d = new DoorMachine(1.0, 1.0)
    d.requestOpen()
    d.update(1.0)
    d.update(2.0) // 关门中
    expect(d.state).toBe('closing')
    d.requestOpen()
    expect(d.state).toBe('opening')
  })

  it('toggle：关→开 / 开→关', () => {
    const d = new DoorMachine()
    d.toggle()
    expect(d.state).toBe('opening')
    d.toggle()
    expect(d.state).toBe('closing')
  })

  it('通行判定阈值 openness > 0.85', () => {
    const d = new DoorMachine(1.0, 1.0)
    d.requestOpen()
    d.update(0.8)
    expect(d.openness).toBeCloseTo(0.8, 5)
    expect(d.isPassable).toBe(false)
    d.update(0.1)
    expect(d.isPassable).toBe(true)
  })
})

describe('TrayMachine 椅背小桌板', () => {
  it('收起 → 展开 → 收起 完整循环，动画中忽略连击', () => {
    const t = new TrayMachine(0.45)
    expect(t.state).toBe('stowed')
    t.toggle()
    expect(t.state).toBe('deploying')
    t.toggle() // 动画中无效
    expect(t.state).toBe('deploying')
    t.update(0.45)
    expect(t.state).toBe('deployed')
    expect(t.openness).toBe(1)
    t.toggle()
    expect(t.state).toBe('retracting')
    t.update(0.2)
    expect(t.openness).toBeCloseTo(1 - 0.2 / 0.45, 5)
    t.update(0.3)
    expect(t.state).toBe('stowed')
    expect(t.openness).toBe(0)
  })

  it('中途只走完当前方向（不越界）', () => {
    const t = new TrayMachine(1.0)
    t.toggle()
    t.update(10) // 大 dt 钳制在 1
    expect(t.openness).toBe(1)
    expect(t.state).toBe('deployed')
  })
})

describe('BackrestMachine 二等座靠背', () => {
  it('两档倾角插值：8° ⇄ 28°', () => {
    const b = new BackrestMachine(1.0, 8, 28)
    expect(b.angleDeg).toBeCloseTo(8, 5)
    b.toggle()
    expect(b.state).toBe('reclining')
    b.update(0.5)
    expect(b.angleDeg).toBeCloseTo(18, 5)
    b.update(0.5)
    expect(b.state).toBe('reclined')
    expect(b.angleDeg).toBeCloseTo(28, 5)
    b.toggle()
    expect(b.state).toBe('rising')
    b.update(1.0)
    expect(b.state).toBe('upright')
    expect(b.angleDeg).toBeCloseTo(8, 5)
  })

  it('动画中再次点击不改变方向（到档后再点才生效）', () => {
    const b = new BackrestMachine(1.0, 8, 28)
    b.toggle()
    b.update(0.2)
    b.toggle() // reclining 中无操作
    expect(b.state).toBe('reclining')
    b.update(0.8)
    expect(b.state).toBe('reclined')
    b.toggle()
    expect(b.state).toBe('rising')
  })
})

describe('BoilerMachine 开水机', () => {
  it('idle → dispensing → full → 取杯回 idle', () => {
    const k = new BoilerMachine(2.4)
    expect(k.state).toBe('idle')
    expect(k.press()).toBe(true)
    expect(k.state).toBe('dispensing')
    expect(k.isSteamVisible).toBe(true)
    expect(k.press()).toBe(false) // 出水中点击无效
    expect(k.state).toBe('dispensing')
    k.update(1.2)
    expect(k.progress).toBeCloseTo(0.5, 5)
    k.update(1.2)
    expect(k.state).toBe('full')
    expect(k.progress).toBe(1)
    expect(k.isSteamVisible).toBe(false)
    expect(k.press()).toBe(true) // 取走水杯
    expect(k.state).toBe('idle')
    expect(k.progress).toBe(0)
  })

  it('progress 永不超过 1', () => {
    const k = new BoilerMachine(1.0)
    k.press()
    k.update(5)
    expect(k.progress).toBe(1)
  })
})

describe('CurtainMachine 窗帘', () => {
  it('拉下/升起与开合比例', () => {
    const c = new CurtainMachine(0.7)
    expect(c.amount).toBe(0)
    c.toggle()
    c.update(0.35)
    expect(c.amount).toBeCloseTo(0.5, 5)
    c.update(0.35)
    expect(c.state).toBe('down')
    expect(c.amount).toBe(1)
    c.toggle()
    c.update(0.7)
    expect(c.state).toBe('up')
    expect(c.amount).toBe(0)
  })
})
