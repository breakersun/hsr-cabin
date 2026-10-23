/**
 * 触摸手势路由（纯逻辑，无 DOM，vitest 直接覆盖）：
 * - classifyTouch：pointerdown 坐标一次性判定左区（移动）/ 其余（视角），
 *   互斥且稳定——同一触点后续 move/up 不再改判。
 * - clampJoyCenter：动态摇杆生成点钳制，盘体完整可见且避开系统手势条。
 * - TouchRouter：单占槽记账（move/look 各一槽），双指并存
 *  （一指摇杆 + 一指视角），move 槽被占时左区新触点降级为 look，
 *   两槽满则忽略——杜绝两套手势抢同一触点。
 */

export interface TouchZoneGeometry {
  /** 画布 CSS 尺寸 */
  width: number
  height: number
  /** 系统安全区 insets（px，来自 env(safe-area-inset-*)） */
  safeTop: number
  safeRight: number
  safeBottom: number
  safeLeft: number
}

export type TouchRole = 'move' | 'look'

/** 激活区：左 45% 宽 × 下 50% 高 → 移动摇杆；边界（x=45%w / y=50%h）归移动区。 */
export function classifyTouch(x: number, y: number, g: TouchZoneGeometry): TouchRole {
  return x <= g.width * 0.45 && y >= g.height * 0.5 ? 'move' : 'look'
}

/** 摇杆盘心钳制：完整落在安全区内（含 8px 视觉边距），不被手势条/圆角遮住。 */
export function clampJoyCenter(
  x: number,
  y: number,
  g: TouchZoneGeometry,
  radius: number,
): { x: number; y: number } {
  const pad = radius + 8
  return {
    x: Math.min(Math.max(x, g.safeLeft + pad), Math.max(g.safeLeft + pad, g.width - g.safeRight - pad)),
    y: Math.min(Math.max(y, g.safeTop + pad), Math.max(g.safeTop + pad, g.height - g.safeBottom - pad)),
  }
}

/** 触点角色记账：move/look 各单占一槽，按 pointerId 释放。 */
export class TouchRouter {
  private roles = new Map<number, TouchRole>()
  private moveId: number | null = null
  private lookId: number | null = null

  /** 分派触点。已分派触点幂等返回原角色；两槽皆满返回 null（调用方忽略该触点）。 */
  route(id: number, x: number, y: number, g: TouchZoneGeometry): TouchRole | null {
    const known = this.roles.get(id)
    if (known !== undefined) return known
    const want = classifyTouch(x, y, g)
    let role: TouchRole
    if (want === 'move' && this.moveId === null) role = 'move'
    else if (this.lookId === null) role = 'look' // move 槽被占时左区触点降级为 look
    else return null
    this.roles.set(id, role)
    if (role === 'move') this.moveId = id
    else this.lookId = id
    return role
  }

  /** 释放触点（幂等）。返回被释放的角色，未知触点返回 null。 */
  release(id: number): TouchRole | null {
    const role = this.roles.get(id)
    if (role === undefined) return null
    this.roles.delete(id)
    if (role === 'move' && this.moveId === id) this.moveId = null
    if (role === 'look' && this.lookId === id) this.lookId = null
    return role
  }

  roleOf(id: number): TouchRole | null {
    return this.roles.get(id) ?? null
  }

  get stickPointer(): number | null {
    return this.moveId
  }

  get lookPointer(): number | null {
    return this.lookId
  }
}
