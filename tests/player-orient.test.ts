import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { Player } from '../src/controls/player'
import { CollisionWorld, makeAabb } from '../src/physics/collision'

/** 回归背景：线上真机反馈「出生瞬间天花板和地面上下颠倒」。
 *  本组用例从数学层锁定相机姿态契约：出生正立、抬头=天花板（dir.y>0）、
 *  低头=地面（dir.y<0）、up 恒朝上、欧拉序恒 YXZ、晃动 roll 不翻转画面。 */
describe('Player 相机姿态方向契约', () => {
  const shell = makeAabb(0, 1.15, 0, 1.6, 1.75, 11.45)
  const dirOf = (cam: PerspectiveCamera): Vector3 => cam.getWorldDirection(new Vector3())

  it('出生姿态正立：视线水平朝车头（+Z），up 朝上，pitch=0', () => {
    const p = new Player(shell)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam)
    const dir = dirOf(cam)
    expect(p.pitch).toBe(0)
    expect(Math.abs(dir.y)).toBeLessThan(1e-9)
    expect(dir.z).toBeGreaterThan(0.99) // yaw=π → 面向 +Z 车头
    expect(dir.x).toBeCloseTo(0, 6)
    expect(cam.up.y).toBeGreaterThan(0.99)
    expect(cam.up.x).toBeCloseTo(0, 6)
    expect(cam.up.z).toBeCloseTo(0, 6)
  })

  it('抬头看天花板：pitch 为正 → 视线上仰 dir.y>0；低头看地面相反', () => {
    const p = new Player(shell)
    const cam = new PerspectiveCamera()
    p.look(0, 1.2)
    p.applyToCamera(cam)
    expect(dirOf(cam).y).toBeGreaterThan(0.5)
    p.look(0, -2.4) // 抬 1.2 再低 2.4 → pitch=-1.2
    p.applyToCamera(cam)
    expect(dirOf(cam).y).toBeLessThan(-0.5)
  })

  it('触摸/鼠标输入映射方向契约：上滑（dy<0）经 look(-dy*sens) 后抬头', () => {
    // app.ts 接线：onLook(dx,dy) → player.look(-dx*sens, -dy*sens)
    const sens = 0.0032
    const p = new Player(shell)
    p.look(0, -(-100) * sens) // dy=-100px 上滑 → dpitch=+0.32
    expect(p.pitch).toBeGreaterThan(0)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam)
    expect(dirOf(cam).y).toBeGreaterThan(0)
  })

  it('yaw=π 且带俯仰时姿态不被欧拉序翻转（XYZ 同步陷阱回归）', () => {
    // 旧实现：YXZ 四元数 copy 进 camera.quaternion 后，three 会按 camera.rotation
    // 的默认 XYZ 序同步欧拉——yaw=π 时分解出的 x 分量与 pitch 反号（姿态等价但
    // 符号不可预期），再被外部对 rotation 的写入放大。现直写 YXZ，pitch 符号保真。
    const p = new Player(shell)
    p.look(0, 0.8) // pitch≈0.8，yaw 出生即 π
    expect(p.yaw).toBeCloseTo(Math.PI, 6)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam)
    expect(cam.rotation.order).toBe('YXZ')
    expect(cam.rotation.x).toBeCloseTo(p.pitch, 6)
    expect(cam.rotation.y).toBeCloseTo(Math.PI, 6)
    expect(cam.rotation.z).toBe(0)
    // 直接视线验证：pitch>0 必须真的在向上看
    expect(dirOf(cam).y).toBeGreaterThan(0.4)
  })

  it('车体晃动 roll 仅微滚转，不改变 up 与俯仰方向', () => {
    const p = new Player(shell)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam, 0.05) // 远大于真实晃动幅度 0.0045 的极限值
    expect(cam.up.y).toBeGreaterThan(0.99)
    expect(Math.abs(dirOf(cam).y)).toBeLessThan(0.02) // pitch=0 时视线仍近似水平
    expect(cam.rotation.z).toBeCloseTo(0.05, 6)
  })

  it('四元数与欧拉一致性：rotation(YXZ) 与 quaternion 表示同一姿态', () => {
    const p = new Player(shell)
    p.look(0.3, Math.PI * 0.9)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam)
    const q1 = cam.quaternion.clone()
    const cam2 = new PerspectiveCamera()
    cam2.quaternion.copy(q1)
    const d1 = cam.getWorldDirection(new Vector3())
    const d2 = cam2.getWorldDirection(new Vector3())
    expect(d1.x).toBeCloseTo(d2.x, 9)
    expect(d1.y).toBeCloseTo(d2.y, 9)
    expect(d1.z).toBeCloseTo(d2.z, 9)
  })
})

/** 真机反馈 #5：「按 D/S 不响应，有时标签页直接消失（形态 D）」。
 *  键位接线与向量数学在数学层证伪（WASD 对称用例）；NaN→GPU→驱动重置路径
 *  由有限性守卫封堵：非有限姿态回退最近良好值 + onCorrupt 取证回调。 */
describe('相机有限性守卫（真机反馈 #5）', () => {
  const shellAabb = makeAabb(0, 1.15, 0, 1.6, 1.75, 11.45)
  it('位置非有限 → 回退最近良好姿态，相机不收脏值，onCorrupt 触发（旧实现 NaN 直写相机）', () => {
    const p = new Player(shellAabb)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam) // 基线 (0, -7.5)
    p.teleport(1.2, -4, Math.PI)
    p.applyToCamera(cam) // (1.2, -4) 入 lastGood
    let corrupt = 0
    p.onCorrupt = () => {
      corrupt++
    }
    p.x = Number.NaN
    p.applyToCamera(cam)
    expect(corrupt).toBe(1)
    expect(Number.isFinite(cam.position.x)).toBe(true) // 旧实现此处为 NaN（杀旧）
    expect(cam.position.x).toBeCloseTo(1.2, 6) // 回退到最近良好 x
    expect(p.x).toBeCloseTo(1.2, 6)
  })

  it('姿态分量（pitch/yaw）非有限同样拦截；恢复后良好值继续更新、不误报', () => {
    const p = new Player(shellAabb)
    const cam = new PerspectiveCamera()
    p.applyToCamera(cam)
    let corrupt = 0
    p.onCorrupt = () => {
      corrupt++
    }
    p.pitch = Number.POSITIVE_INFINITY
    p.applyToCamera(cam, 0)
    expect(corrupt).toBe(1)
    expect(Number.isFinite(cam.rotation.x)).toBe(true)
    expect(p.pitch).toBe(0) // 回退基线 pitch
    p.teleport(0.5, -6, Math.PI)
    p.look(0, 0.3)
    p.applyToCamera(cam)
    expect(corrupt).toBe(1) // 有限帧不触发
    p.yaw = Number.NaN
    p.applyToCamera(cam)
    expect(corrupt).toBe(2)
    expect(Number.isFinite(cam.rotation.y)).toBe(true)
    expect(cam.rotation.y).toBeCloseTo(Math.PI, 6) // 回退 lastGood yaw
  })

  it('WASD 四向位移对称（S/D 接线与向量数学回归锁定，真机「D/S 不响应」在数学层证伪）', () => {
    const empty = new CollisionWorld() // 无碰撞体：纯移动数学
    const dt = 0.5
    const dist = (forward: number, strafe: number): number => {
      const p = new Player(shellAabb)
      p.move({ forward, strafe, run: false }, dt, empty)
      return Math.hypot(p.x, p.z + 7.5) // 出生 (0, -7.5)
    }
    const w = dist(1, 0)
    const s = dist(-1, 0)
    const a = dist(0, -1)
    const d = dist(0, 1)
    expect(w).toBeCloseTo(s, 9) // S 后退 == W 前进
    expect(a).toBeCloseTo(d, 9) // D 右移 == A 左移
    expect(w).toBeCloseTo(a, 9)
    expect(w).toBeCloseTo(1.4 * dt, 9) // walkSpeed·dt
  })
})
