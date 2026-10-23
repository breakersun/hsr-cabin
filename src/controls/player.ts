/**
 * 玩家代理：行走（胶囊碰撞）/ 自由飞（限制在车厢外壳内）。
 * yaw/pitch 约定：Euler YXZ；yaw=0 面向 -Z，yaw=π 面向 +Z（车头方向）。
 */

import { Euler, MathUtils, PerspectiveCamera, Quaternion } from 'three'
import type { AABB } from '../physics/collision'
import { clampPointToBox } from '../physics/collision'
import type { CollisionWorld } from '../physics/collision'

export interface MoveInput {
  /** 前后 -1..1（前为正） */
  forward: number
  /** 左右 -1..1（右为正） */
  strafe: number
  run: boolean
  /** 自由飞时：额外垂直 -1..1（升为正，桌面 Q/E 或触屏双指） */
  lift?: number
}

export class Player {
  x = 0
  z = -7.5
  yaw = Math.PI // 面向车头 +Z
  pitch = 0
  eyeY = 1.55
  radius = 0.3
  height = 1.7
  walkSpeed = 1.4
  runSpeed = 3.0
  flySpeed = 4.0
  freeFly = false
  flyY = 1.55
  /** 本次 update 是否发生位移（供闲置检测） */
  moved = false

  private euler = new Euler(0, 0, 0, 'YXZ')
  private quat = new Quaternion()

  constructor(public shell: AABB) {}

  look(dyaw: number, dpitch: number): void {
    this.yaw += dyaw
    this.pitch = MathUtils.clamp(this.pitch + dpitch, (-75 * Math.PI) / 180, (75 * Math.PI) / 180)
    if (this.yaw > Math.PI * 4 || this.yaw < -Math.PI * 4) this.yaw = this.yaw % (Math.PI * 2)
  }

  move(input: MoveInput, dt: number, world: CollisionWorld): void {
    this.moved = false
    if (input.forward === 0 && input.strafe === 0 && (input.lift ?? 0) === 0) return
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    // forward 向量 = (-sin, -cos)，right = (cos, -sin)
    const dirX = -sin * input.forward + cos * input.strafe
    const dirZ = -cos * input.forward - sin * input.strafe
    const len = Math.hypot(dirX, dirZ)
    if (this.freeFly) {
      // 3D 飞行：沿视线（含俯仰）+ 水平横移 + 垂直升降
      const cp = Math.cos(this.pitch)
      const fx = -sin * cp
      const fy = Math.sin(this.pitch)
      const fz = -cos * cp
      let vx = fx * input.forward + cos * input.strafe
      let vy = fy * input.forward + (input.lift ?? 0)
      let vz = fz * input.forward - sin * input.strafe
      const vlen = Math.hypot(vx, vy, vz)
      if (vlen > 1e-6) {
        vx /= vlen
        vy /= vlen
        vz /= vlen
      }
      const dist = this.flySpeed * dt
      const p = clampPointToBox(
        { x: this.x + vx * dist, y: this.flyY + vy * dist, z: this.z + vz * dist },
        this.shell,
        0.25,
      )
      if (p.x !== this.x || p.y !== this.flyY || p.z !== this.z) this.moved = true
      this.x = p.x
      this.flyY = p.y
      this.z = p.z
      return
    }
    if (len < 1e-6) return
    const speed = (input.run ? this.runSpeed : this.walkSpeed) * (this.freeFly ? this.flySpeed / this.walkSpeed : 1)
    const dx = (dirX / len) * speed * dt
    const dz = (dirZ / len) * speed * dt
    const res = world.resolve(this.x, this.z, dx, dz, 0, this.height, this.radius)
    if (res.x !== this.x || res.z !== this.z) this.moved = true
    this.x = res.x
    this.z = res.z
  }

  /** 跳转点位。 */
  teleport(x: number, z: number, yaw: number): void {
    this.x = x
    this.z = z
    this.yaw = yaw
    this.pitch = 0
    if (this.freeFly) this.flyY = this.eyeY
  }

  applyToCamera(camera: PerspectiveCamera): void {
    this.euler.set(this.pitch, this.yaw, 0)
    this.quat.setFromEuler(this.euler)
    camera.quaternion.copy(this.quat)
    camera.position.set(this.x, this.freeFly ? this.flyY : this.eyeY, this.z)
  }
}
