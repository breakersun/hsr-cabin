/**
 * 触摸控制（PRD §4.1）：左下大激活区动态摇杆 + 其余区域拖动视角 + 单击交互。
 * - 全部 Pointer Events（pointerType === 'touch'），canvas touch-action:none
 * - 300ms 内双击只算一次点击（防误触连发）
 * - 摇杆：静止盘仅是视觉提示（pointer-events:none，见 style.css），按下
 *   左区（≈45% 宽 × 下半屏，classifyTouch）任意处在指下生成摇杆，抬指消失
 *   ——激活区远大于可视盘，「按不到可视摇杆」类问题不存在
 * - 左/右手势在 pointerdown 一次性互斥判定（TouchRouter 单占槽），
 *   一指摇杆 + 一指视角可同时进行
 */

import { clampJoyCenter, TouchRouter, type TouchZoneGeometry } from './touchRouter'

export interface TouchCallbacks {
  onMove(nx: number, ny: number): void // 摇杆归一化向量（x 右正，y 前正）
  onLook(dx: number, dy: number): void // 视角增量（px）
  onTap(clientX: number, clientY: number): void
  onActivity(): void
}

const JOY_RADIUS = 54
const DEAD_ZONE = 0.14
const TAP_MOVE_PX = 12
const TAP_MS = 300
const DOUBLE_TAP_MS = 300

export class TouchControls {
  active = false
  private router = new TouchRouter()
  private stickOrigin = { x: 0, y: 0 }
  private lookLast = { x: 0, y: 0 }
  private tapStart = { x: 0, y: 0, t: 0, id: -1 }
  private lastTapTime = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private joyEl: HTMLElement,
    private knobEl: HTMLElement,
    private cb: TouchCallbacks,
  ) {
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
  }

  /** 当下画布几何（尺寸 + 安全区 insets）。 */
  private geometry(): TouchZoneGeometry {
    const cs = getComputedStyle(document.documentElement)
    const px = (name: string): number => parseFloat(cs.getPropertyValue(name)) || 0
    return {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
      safeTop: px('--safe-top'),
      safeRight: px('--safe-right'),
      safeBottom: px('--safe-bottom'),
      safeLeft: px('--safe-left'),
    }
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return
    this.active = true
    this.cb.onActivity()
    this.canvas.setPointerCapture?.(e.pointerId)
    const role = this.router.route(e.pointerId, e.clientX, e.clientY, this.geometry())
    if (role === 'move') {
      // 控制向量以真实指尖为原点（1:1 手感）；仅可视盘位置被钳制在安全区内
      this.stickOrigin = { x: e.clientX, y: e.clientY }
      const c = clampJoyCenter(e.clientX, e.clientY, this.geometry(), JOY_RADIUS)
      this.joyEl.classList.add('dynamic')
      this.positionJoy(c.x, c.y)
      this.joyEl.style.opacity = '1'
    } else if (role === 'look') {
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
    }
    // role === null：两槽皆满，忽略
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return
    if (this.router.roleOf(e.pointerId) === 'move') {
      let dx = e.clientX - this.stickOrigin.x
      let dy = e.clientY - this.stickOrigin.y
      const dist = Math.hypot(dx, dy)
      if (dist > JOY_RADIUS) {
        dx = (dx / dist) * JOY_RADIUS
        dy = (dy / dist) * JOY_RADIUS
      }
      this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      let nx = dx / JOY_RADIUS
      let ny = -dy / JOY_RADIUS
      const nl = Math.hypot(nx, ny)
      if (nl < DEAD_ZONE) {
        nx = 0
        ny = 0
      } else if (nl > 1) {
        nx /= nl
        ny /= nl
      }
      this.cb.onMove(nx, ny)
    } else if (this.router.roleOf(e.pointerId) === 'look') {
      const dx = e.clientX - this.lookLast.x
      const dy = e.clientY - this.lookLast.y
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.cb.onLook(dx, dy)
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return
    const role = this.router.release(e.pointerId)
    if (role === 'move') {
      this.cb.onMove(0, 0)
      this.knobEl.style.transform = 'translate(-50%, -50%)'
      // 回静止位：清掉动态摇杆的内联定位，CSS 布局（含 safe-area）接管——
      // 静止位唯一权威源是 CSS，布局变化（URL bar 展开收起/旋转）自动跟随
      this.joyEl.classList.remove('dynamic')
      this.joyEl.style.left = ''
      this.joyEl.style.top = ''
      this.joyEl.style.bottom = ''
      this.joyEl.style.opacity = ''
    } else if (role === 'look') {
      const dt = performance.now() - this.tapStart.t
      const dist = Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y)
      const now = performance.now()
      if (e.pointerId === this.tapStart.id && dt < TAP_MS && dist < TAP_MOVE_PX && now - this.lastTapTime > DOUBLE_TAP_MS) {
        this.lastTapTime = now
        this.cb.onTap(e.clientX, e.clientY)
      }
    }
  }

  private positionJoy(cx: number, cy: number): void {
    const half = this.joyEl.offsetWidth / 2 || JOY_RADIUS
    this.joyEl.style.left = `${cx - half}px`
    this.joyEl.style.top = `${cy - half}px`
    this.joyEl.style.bottom = 'auto'
  }
}
