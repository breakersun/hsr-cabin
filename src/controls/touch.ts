/**
 * 触摸控制（PRD §4.1）：左下虚拟摇杆行走 + 右半屏拖动视角 + 单击交互。
 * - 全部 Pointer Events（pointerType === 'touch'），canvas touch-action:none
 * - 300ms 内双击只算一次点击（防误触连发）
 * - 摇杆：固定基础位置 + 按下点出现在触摸原点（动态原点更顺手）
 */

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
  private stickPointer: number | null = null
  private lookPointer: number | null = null
  private stickOrigin = { x: 0, y: 0 }
  private lookLast = { x: 0, y: 0 }
  private tapStart = { x: 0, y: 0, t: 0, id: -1 }
  private lastTapTime = 0
  private baseX = 0
  private baseY = 0

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
    const rect = joyEl.getBoundingClientRect()
    this.baseX = rect.left + rect.width / 2
    this.baseY = rect.top + rect.height / 2
  }

  private isStickZone(x: number, y: number): boolean {
    // 左下 42% 宽 / 60% 高为摇杆区（含固定摇杆盘附近）
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    return x < w * 0.42 && y > h * 0.4
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return
    this.active = true
    this.cb.onActivity()
    this.canvas.setPointerCapture?.(e.pointerId)
    if (this.isStickZone(e.clientX, e.clientY) && this.stickPointer === null) {
      this.stickPointer = e.pointerId
      this.stickOrigin = { x: e.clientX, y: e.clientY }
      this.joyEl.classList.add('dynamic')
      this.positionJoy(e.clientX, e.clientY)
      this.joyEl.style.opacity = '1'
    } else if (this.lookPointer === null) {
      this.lookPointer = e.pointerId
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
    }
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return
    if (e.pointerId === this.stickPointer) {
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
    } else if (e.pointerId === this.lookPointer) {
      const dx = e.clientX - this.lookLast.x
      const dy = e.clientY - this.lookLast.y
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.cb.onLook(dx, dy)
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null
      this.cb.onMove(0, 0)
      this.knobEl.style.transform = 'translate(-50%, -50%)'
      this.joyEl.classList.remove('dynamic')
      this.positionJoy(this.baseX, this.baseY)
      this.joyEl.style.opacity = ''
    } else if (e.pointerId === this.lookPointer) {
      this.lookPointer = null
      const dt = performance.now() - this.tapStart.t
      const dist = Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y)
      const now = performance.now()
      if (dt < TAP_MS && dist < TAP_MOVE_PX && now - this.lastTapTime > DOUBLE_TAP_MS) {
        this.lastTapTime = now
        this.cb.onTap(e.clientX, e.clientY)
      }
    }
  }

  private positionJoy(cx: number, cy: number): void {
    this.joyEl.style.left = `${cx - 54}px`
    this.joyEl.style.top = `${cy - 54}px`
    this.joyEl.style.bottom = 'auto'
  }
}
