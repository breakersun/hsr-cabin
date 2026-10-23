/**
 * 碰撞检测数学（PRD §4.3）：玩家胶囊体（垂直线段 + 半径）vs AABB。
 * 纯函数实现，vitest 覆盖；世界注册表 CollisionWorld 管理静态/动态碰撞体
 * （车门关闭时注入、打开时移除）。
 */

export interface AABB {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/** 中心 + 半尺寸构造 AABB。 */
export function makeAabb(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): AABB {
  return { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy, minZ: cz - hz, maxZ: cz + hz }
}

/**
 * 胶囊体（轴对齐、垂直）到 AABB 的距离。
 * 胶囊：轴心线段 y ∈ [feetY + r, headY - r]，(x, z) 为轴心，半径 r。
 * 返回负值表示穿入深度。距离 < 0 判定为碰撞。
 */
export function capsuleAabbDistance(
  x: number,
  z: number,
  feetY: number,
  headY: number,
  r: number,
  b: AABB,
): number {
  const segMin = feetY + r
  const segMax = headY - r
  // 1) 线段与盒子的 y 范围是否有交叠（含球体半径扩张）
  const dySeg = Math.max(b.minY - segMax, segMin - b.maxY)
  if (dySeg > r) return dySeg - r // y 方向已分离（不含半径扩张）
  const yOverlap = dySeg <= 0
  // 2) 轴心 (x,z) 在盒子 XZ 矩形上的最近点
  const cx = Math.min(Math.max(x, b.minX), b.maxX)
  const cz = Math.min(Math.max(z, b.minZ), b.maxZ)
  const dx = x - cx
  const dz = z - cz
  const distSq = dx * dx + dz * dz
  if (yOverlap) {
    // y 有重叠：XZ 平面上圆 vs 矩形
    return Math.sqrt(distSq) - r
  }
  // y 不重叠但扩张后可能相交：球面 vs 棱
  const dist = Math.sqrt(distSq + dySeg * dySeg)
  return dist - r
}

/** 胶囊与 AABB 是否相交。 */
export function capsuleHitsAabb(
  x: number,
  z: number,
  feetY: number,
  headY: number,
  r: number,
  b: AABB,
): boolean {
  return capsuleAabbDistance(x, z, feetY, headY, r, b) < 0
}

/**
 * 圆 (x,z,r) vs 矩形的推出向量（XZ 平面）。不相交返回 null。
 * 圆心在矩形内部时沿最浅穿透轴推出。
 */
export function circleRectPushOut(x: number, z: number, r: number, b: AABB): { dx: number; dz: number } | null {
  const cx = Math.min(Math.max(x, b.minX), b.maxX)
  const cz = Math.min(Math.max(z, b.minZ), b.maxZ)
  const dx = x - cx
  const dz = z - cz
  const distSq = dx * dx + dz * dz
  if (distSq > r * r) return null
  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq)
    const push = r - dist
    return { dx: (dx / dist) * push, dz: (dz / dist) * push }
  }
  // 圆心在矩形内：沿最浅轴推出
  const left = x - b.minX
  const right = b.maxX - x
  const back = z - b.minZ
  const front = b.maxZ - z
  const m = Math.min(left, right, back, front)
  if (m === left) return { dx: -(left + r), dz: 0 }
  if (m === right) return { dx: right + r, dz: 0 }
  if (m === back) return { dx: 0, dz: -(back + r) }
  return { dx: 0, dz: front + r }
}

/**
 * 解算移动后的位置：目标位置 (x+dx, z+dz) 对所有碰撞体做迭代推出。
 * 天然形成贴墙滑行（推力只作用于穿入分量）。
 * 大步长（低帧率/闲置降频时一帧可移动 >0.3m）按胶囊半径子步进，
 * 防止一帧跨过薄墙/门板造成隧穿。返回修正后的位置。
 */
export function resolveMovement(
  x: number,
  z: number,
  dx: number,
  dz: number,
  feetY: number,
  headY: number,
  r: number,
  boxes: readonly AABB[],
): { x: number; z: number } {
  const maxStep = Math.max(r * 0.9, 0.05)
  const dist = Math.max(Math.abs(dx), Math.abs(dz))
  const steps = Math.max(1, Math.ceil(dist / maxStep))
  const sx = dx / steps
  const sz = dz / steps
  let px = x
  let pz = z
  for (let s = 0; s < steps; s++) {
    px += sx
    pz += sz
    for (let iter = 0; iter < 3; iter++) {
      let moved = false
      for (const b of boxes) {
        if (!capsuleHitsAabb(px, pz, feetY, headY, r, b)) continue
        const push = circleRectPushOut(px, pz, r, b)
        if (push) {
          px += push.dx
          pz += push.dz
          moved = true
        }
      }
      if (!moved) break
    }
  }
  return { x: px, z: pz }
}

/** 点是否在 AABB 内（XZ + Y 范围）。 */
export function pointInAabb(x: number, y: number, z: number, b: AABB): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ
}

/** 将一个三维点钳制在盒子内（自由飞相机限制在车厢外壳之内），margin 为内缩量。 */
export function clampPointToBox(
  p: { x: number; y: number; z: number },
  b: AABB,
  margin: number,
): { x: number; y: number; z: number } {
  return {
    x: Math.min(Math.max(p.x, b.minX + margin), b.maxX - margin),
    y: Math.min(Math.max(p.y, b.minY + margin), b.maxY - margin),
    z: Math.min(Math.max(p.z, b.minZ + margin), b.maxZ - margin),
  }
}

/** 碰撞世界：静态 + 动态（门等可开关碰撞体）。 */
export class CollisionWorld {
  private statics: AABB[] = []
  private dynamics = new Map<string, AABB | null>()

  addStatic(box: AABB): void {
    this.statics.push(box)
  }

  /** 动态碰撞体：设为 null 表示移除（门打开）。 */
  setDynamic(id: string, box: AABB | null): void {
    this.dynamics.set(id, box)
  }

  getDynamic(id: string): AABB | null | undefined {
    return this.dynamics.get(id)
  }

  /** 当前生效的全部碰撞体。 */
  active(): AABB[] {
    const out = this.statics.slice()
    for (const b of this.dynamics.values()) if (b) out.push(b)
    return out
  }

  resolve(
    x: number,
    z: number,
    dx: number,
    dz: number,
    feetY: number,
    headY: number,
    r: number,
  ): { x: number; z: number } {
    return resolveMovement(x, z, dx, dz, feetY, headY, r, this.active())
  }
}
