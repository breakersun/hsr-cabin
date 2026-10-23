import { describe, expect, it } from 'vitest'
import {
  clampJoyCenter,
  classifyTouch,
  TouchRouter,
  type TouchZoneGeometry,
} from '../src/controls/touchRouter'

/** 真机反馈「摇杆经常按不到」回归：激活区几何、左右互斥分流、
 *  双指并存、safe-area 钳制。几何以 390×844 竖屏为基准。 */
const G: TouchZoneGeometry = { width: 390, height: 844, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0 }
const GESTURE_BAR: TouchZoneGeometry = { ...G, safeBottom: 24, safeLeft: 0 } // 安卓手势条 24px

describe('classifyTouch 激活区几何（左 45% 宽 × 下 50% 高 → move）', () => {
  it('左下区域内为 move（含可视摇杆盘中心与盘外远处）', () => {
    expect(classifyTouch(80, 780, G)).toBe('move') // 可视摇杆盘附近
    expect(classifyTouch(10, 843, G)).toBe('move') // 左下角
    expect(classifyTouch(170, 600, G)).toBe('move') // 区域内空白
  })

  it('区域外为 look：右半屏 / 上半屏 / 右下角', () => {
    expect(classifyTouch(300, 700, G)).toBe('look') // 右侧（视角区）
    expect(classifyTouch(100, 300, G)).toBe('look') // 左上
    expect(classifyTouch(385, 840, G)).toBe('look') // 右下角
  })

  it('边界归属：x=45%w / y=50%h 为 move（左/下侧闭合）', () => {
    expect(classifyTouch(390 * 0.45, 700, G)).toBe('move')
    expect(classifyTouch(100, 844 * 0.5, G)).toBe('move')
    expect(classifyTouch(390 * 0.45 + 0.01, 700, G)).toBe('look')
    expect(classifyTouch(100, 844 * 0.5 - 0.01, G)).toBe('look')
  })

  it('激活区面积远大于可视摇杆盘（连通「按不到」的量级验证）', () => {
    const zone = (390 * 0.45) * (844 * 0.5)
    const disc = Math.PI * 54 * 54
    expect(zone / disc).toBeGreaterThan(7) // 激活区 ≥ 7 倍盘面积
  })
})

describe('TouchRouter 左右互斥分流', () => {
  it('pointerdown 一次性判定：左区 → move，右区 → look，互不抢占', () => {
    const r = new TouchRouter()
    expect(r.route(1, 80, 780, G)).toBe('move')
    expect(r.route(2, 300, 400, G)).toBe('look')
    expect(r.stickPointer).toBe(1)
    expect(r.lookPointer).toBe(2)
  })

  it('move 槽被占时，左区第二个触点降级为 look（不抢占摇杆）', () => {
    const r = new TouchRouter()
    expect(r.route(1, 80, 780, G)).toBe('move')
    expect(r.route(2, 100, 700, G)).toBe('look') // 左区降级
    // look 槽也被占后，第三个触点无论落点都被忽略
    expect(r.route(3, 50, 800, G)).toBeNull()
    expect(r.route(4, 300, 400, G)).toBeNull()
  })

  it('双指并存：一指摇杆 + 一指视角同时有效', () => {
    const r = new TouchRouter()
    r.route(1, 80, 780, G) // 摇杆
    r.route(2, 320, 500, G) // 视角
    expect(r.roleOf(1)).toBe('move')
    expect(r.roleOf(2)).toBe('look')
    // 释放摇杆不影响视角指
    expect(r.release(1)).toBe('move')
    expect(r.roleOf(2)).toBe('look')
    // 摇杆槽空出后新左区触点可再次成为 move
    expect(r.route(3, 90, 790, G)).toBe('move')
  })

  it('release 幂等且未知触点安全', () => {
    const r = new TouchRouter()
    r.route(7, 300, 400, G)
    expect(r.release(7)).toBe('look')
    expect(r.release(7)).toBeNull()
    expect(r.release(99)).toBeNull()
  })

  it('已分派触点重复 route 幂等返回原角色（后续事件不改判）', () => {
    const r = new TouchRouter()
    r.route(1, 80, 780, G) // move
    expect(r.route(1, 300, 200, G)).toBe('move') // 滑到右上也仍是摇杆
  })
})

describe('clampJoyCenter safe-area 钳制', () => {
  it('指尖落在手势条区：盘心上抬，盘体完整可见', () => {
    const c = clampJoyCenter(80, 838, GESTURE_BAR, 54)
    expect(c.y).toBe(844 - 24 - 54 - 8) // 758
    expect(c.x).toBe(80) // x 无需钳制
  })

  it('指尖在屏幕左缘：盘心右移不出安全区', () => {
    const c = clampJoyCenter(2, 700, G, 54)
    expect(c.x).toBe(54 + 8)
  })

  it('区域中心点不被动', () => {
    const c = clampJoyCenter(150, 700, G, 54)
    expect(c.x).toBe(150)
    expect(c.y).toBe(700)
  })

  it('顶部安全区（刘海屏横屏）同样钳制', () => {
    const landscape: TouchZoneGeometry = { width: 844, height: 390, safeTop: 44, safeRight: 0, safeBottom: 0, safeLeft: 0 }
    const c = clampJoyCenter(100, 10, landscape, 54)
    expect(c.y).toBe(44 + 54 + 8)
  })
})
