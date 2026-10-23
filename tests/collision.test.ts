import { describe, expect, it } from 'vitest'
import {
  capsuleAabbDistance,
  substepSplit,
  capsuleHitsAabb,
  circleRectPushOut,
  clampPointToBox,
  CollisionWorld,
  makeAabb,
  pointInAabb,
  resolveMovement,
} from '../src/physics/collision'

// 玩家参数：脚 0 / 头 1.7 / 半径 0.3（与 Player 一致）
const FEET = 0
const HEAD = 1.7
const R = 0.3

const wall = makeAabb(-1.7, 1.15, 0, 0.1, 1.15, 11.5) // 左侧墙
const seatBox = makeAabb(-1.0, 0.45, 4.0, 0.68, 0.45, 0.42) // 一排三连座
const lowBin = makeAabb(-1.4, 0.36, -2.9, 0.18, 0.36, 0.18) // 垃圾桶
const highShelf = makeAabb(1.3, 2.5, 0, 0.2, 0.1, 5) // 头顶上方的假想行李架（高于头顶）

describe('capsuleAabbDistance / capsuleHitsAabb', () => {
  it('远离时不碰撞且距离正确', () => {
    const d = capsuleAabbDistance(0, 4.0, FEET, HEAD, R, seatBox)
    expect(d).toBeGreaterThan(0)
    // 过道中心（x=0，正对排中心 z=4）到三连座边缘（x=-0.32）距离 0.32，减半径 0.3 → 0.02
    expect(d).toBeCloseTo(0.02, 3)
  })

  it('贴上时碰撞（距离为负）', () => {
    const d = capsuleAabbDistance(-0.31, 4.0, FEET, HEAD, R, seatBox)
    expect(d).toBeLessThan(0)
    expect(capsuleHitsAabb(-0.31, 4.0, FEET, HEAD, R, seatBox)).toBe(true)
  })

  it('头顶高处的物体不与胶囊碰撞（y 分离）', () => {
    expect(capsuleHitsAabb(1.3, 0, FEET, HEAD, R, highShelf)).toBe(false)
  })

  it('矮物体（垃圾桶）与玩家碰撞', () => {
    expect(capsuleHitsAabb(-1.1, -2.9, FEET, HEAD, R, lowBin)).toBe(true)
  })

  it('完全嵌入时的穿入深度为负值', () => {
    const d = capsuleAabbDistance(-1.0, 4.0, FEET, HEAD, R, seatBox)
    expect(d).toBeLessThanOrEqual(-R)
  })
})

describe('circleRectPushOut', () => {
  it('圆心在矩形外：沿最近点法线推出', () => {
    const push = circleRectPushOut(-0.31, 4.0, R, seatBox)
    expect(push).not.toBeNull()
    // 圆心距矩形边 0.01，推出量 = R - 0.01 = 0.29，方向 +x（回过道）
    expect(Math.hypot(push!.dx, push!.dz)).toBeCloseTo(0.29, 3)
    expect(push!.dx).toBeGreaterThan(0)
    expect(push!.dz).toBeCloseTo(0, 5)
  })

  it('圆心在矩形内：沿最浅轴推出（本例 z 方向更浅：0.42 < 0.68）', () => {
    const push = circleRectPushOut(-1.0, 4.0, R, seatBox)
    expect(push).not.toBeNull()
    expect(push!.dx).toBeCloseTo(0, 5)
    expect(Math.abs(push!.dz)).toBeCloseTo(0.42 + R, 3)
  })

  it('不相交返回 null', () => {
    expect(circleRectPushOut(0, 0, R, seatBox)).toBeNull()
  })
})

describe('resolveMovement 贴墙滑行', () => {
  it('朝墙走被挡住，不穿透', () => {
    const r = resolveMovement(-1.2, 0, -1.0, 0, FEET, HEAD, R, [wall])
    expect(r.x).toBeGreaterThanOrEqual(wall.maxX + R - 1e-6)
  })

  it('沿墙方向走可以滑行（垂直分量保留）', () => {
    // 在墙边向 -z 且稍向 -x 挤着走：z 分量应前进，x 被钳制
    const start = { x: wall.maxX + R, z: 5 }
    const r = resolveMovement(start.x, start.z, -0.5, -1.0, FEET, HEAD, R, [wall])
    expect(r.x).toBeCloseTo(wall.maxX + R, 4)
    expect(r.z).toBeLessThan(start.z - 0.9)
  })

  it('座椅阻挡：不能横穿三连座', () => {
    const r = resolveMovement(0.0, 4.0, -1.5, 0, FEET, HEAD, R, [seatBox])
    expect(r.x).toBeGreaterThanOrEqual(seatBox.maxX + R - 0.02)
    // 推出后不应再碰撞
    expect(capsuleHitsAabb(r.x, r.z, FEET, HEAD, R, seatBox)).toBe(false)
  })

  it('解算后与所有碰撞体均不穿透', () => {
    const boxes = [wall, seatBox, lowBin]
    const r = resolveMovement(-1.0, -2.5, -0.8, -1.2, FEET, HEAD, R, boxes)
    for (const b of boxes) {
      expect(capsuleHitsAabb(r.x, r.z, FEET, HEAD, R, b)).toBe(false)
    }
  })
})

describe('CollisionWorld 动态碰撞体（门）', () => {
  it('门关闭时阻挡，打开（移除）后可通行', () => {
    const w = new CollisionWorld()
    w.addStatic(wall)
    const doorZ = 9.2
    const doorCollider = makeAabb(0, 1.0, doorZ, 0.5, 1.0, 0.08)
    w.setDynamic('doorF', doorCollider)
    // 从客室走向通过台
    const blocked = w.resolve(0, doorZ - 1.0, 0, 1.2, FEET, HEAD, R)
    expect(blocked.z).toBeLessThan(doorCollider.minZ - R + 0.01)
    // 门开：动态碰撞体移除
    w.setDynamic('doorF', null)
    const passed = w.resolve(0, doorZ - 1.0, 0, 1.2, FEET, HEAD, R)
    expect(passed.z).toBeGreaterThan(doorZ)
  })

  it('active() 汇总静态与生效中的动态碰撞体', () => {
    const w = new CollisionWorld()
    w.addStatic(seatBox)
    w.setDynamic('a', lowBin)
    w.setDynamic('b', null)
    expect(w.active()).toHaveLength(2)
  })
})

describe('辅助函数', () => {
  it('pointInAabb', () => {
    expect(pointInAabb(-1.0, 0.45, 4.0, seatBox)).toBe(true) // 盒中心
    expect(pointInAabb(0, 1, 4, seatBox)).toBe(false) // 过道方向盒外
    expect(pointInAabb(3, 1, 4, seatBox)).toBe(false)
  })

  it('clampPointToBox 自由飞限制在车厢内', () => {
    const shell = makeAabb(0, 1.15, 0, 1.6, 1.75, 11.4)
    const p = clampPointToBox({ x: 99, y: 0.1, z: -99 }, shell, 0.25)
    expect(p.x).toBeCloseTo(1.35, 5)
    expect(p.y).toBeCloseTo(0.1, 5) // 盒内的 y 不动
    expect(p.z).toBeCloseTo(-11.15, 5)
    const q = clampPointToBox({ x: 0, y: 99, z: 0 }, shell, 0.25)
    expect(q.y).toBeCloseTo(2.9 - 0.25, 5) // 顶板内表面
  })
})

describe('substepSplit 子步长不变量（旧 max-axis 实现必红）', () => {
  it('任意方向：每子步欧氏位移 ≤ maxStep', () => {
    const maxStep = 0.27 // r=0.3 时的实际值
    const dirs: Array<[number, number]> = [
      [1, 1],
      [3, 1],
      [1, 3],
      [-2, 2],
      [2.4, 1.4],
      [0.5, 0.5],
      [5, 0.001],
      [-1.6, 1.6],
    ]
    for (const [dx, dz] of dirs) {
      const { steps, sx, sz } = substepSplit(dx, dz, maxStep)
      expect(steps).toBeGreaterThanOrEqual(1)
      expect(Math.hypot(sx, sz)).toBeLessThanOrEqual(maxStep + 1e-12)
    }
  })

  it('45° 锚定：dx=dz=1、maxStep=0.27 → 步数按 hypot 取 6（旧 max-axis 实现取 4，每步 0.354>上限，本用例必红）', () => {
    const s = substepSplit(1, 1, 0.27)
    expect(s.steps).toBe(Math.ceil(Math.hypot(1, 1) / 0.27)) // = 6；旧实现 ceil(1/0.27)=4
    expect(s.steps).toBe(6)
    expect(Math.hypot(s.sx, s.sz)).toBeLessThanOrEqual(0.27)
    // 旧实现反算：steps=4 时每步 hypot(0.25,0.25)=0.354，超出上限即历史缺陷
    const legacySteps = Math.ceil(Math.max(Math.abs(1), Math.abs(1)) / 0.27)
    expect(legacySteps).toBe(4)
    expect(Math.hypot(1 / legacySteps, 1 / legacySteps)).toBeGreaterThan(0.27)
  })

  it('退化：零位移不产生除零', () => {
    const s = substepSplit(0, 0, 0.27)
    expect(s.steps).toBe(1)
    expect(s.sx).toBe(0)
    expect(s.sz).toBe(0)
  })
})

describe('resolveMovement 斜向子步进（欧氏距离回归）', () => {
  // 行为级补充：长薄墙 + 斜向大位移不穿越（与上面的步长不变量共同构成回归保护） {
  // 子步数按 hypot(dx,dz) 决定：45° 斜向移动每步实际位移 = hypot(sx,sz)，
  // 按坐标分量最大值估算会低估 ~1.41 倍。薄门板 + 大斜向位移不得隧穿。
  const doorPanel = makeAabb(0, 1.0, 0, 0.04, 1.0, 2.0) // 8cm 薄板（z 向加长：斜向路径无法绕过端部，只能穿过或被挡）
  const cases: Array<[string, number, number]> = [
    ['左前 45°', -1.6, 1.6],
    ['右前 45°', 1.6, 1.6],
    ['左后 45°', -1.6, -1.6],
    ['右后 45°', 1.6, -1.6],
    ['浅角 30°', -2.4, 1.4],
    ['浅角 60°', -1.1, 1.9],
  ]
  for (const [name, dx, dz] of cases) {
    it(`${name} 大位移（hypot≈${Math.hypot(dx, dz).toFixed(2)}m）不穿过薄门板`, () => {
      // 从移动方向的对侧出发（dx>0 → 左侧出发），斜向跨越门板所在平面
      const startX = dx > 0 ? -0.6 : 0.6
      const res = resolveMovement(startX, -dz, dx, dz, FEET, HEAD, R, [doorPanel])
      // 终点不得越过门板平面到另一侧（被推出停在门板 + 半径之外）
      const crossed = Math.sign(res.x) !== Math.sign(startX) && Math.abs(res.x) > 0.05
      expect(crossed).toBe(false)
      expect(capsuleHitsAabb(res.x, res.z, FEET, HEAD, R, doorPanel)).toBe(false)
    })
  }

  it('active() 缓存：注册表变化后重建，返回值随动态体更新', () => {
    const w = new CollisionWorld()
    w.addStatic(seatBox)
    const a1 = w.active()
    expect(a1).toHaveLength(1)
    w.setDynamic('door', lowBin)
    const a2 = w.active()
    expect(a2).toHaveLength(2)
    expect(a1).toHaveLength(1) // 旧快照不被追加污染
    w.setDynamic('door', null)
    expect(w.active()).toHaveLength(1)
  })
})
