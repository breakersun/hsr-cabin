/**
 * 桌面控制（PRD §4.2）：WASD + Pointer Lock 鼠标视角 + Shift 跑 +
 * 点击/E 交互 + F 自由飞 + N 昼夜 + Esc 菜单。
 */

export interface DesktopCallbacks {
  onLook(dx: number, dy: number): void
  onInteract(): void
  onToggleFly(): void
  onToggleDayNight(): void
  onMenu(): void
  onActivity(): void
}

export class DesktopControls {
  active = false
  private keys = new Set<string>()
  private locked = false

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: DesktopCallbacks,
  ) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('click', this.onClick)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
  }

  get pointerLocked(): boolean {
    return this.locked
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.active = true
    this.cb.onActivity()
    const k = e.key.toLowerCase()
    this.keys.add(k)
    if (k === 'f') this.cb.onToggleFly()
    else if (k === 'n') this.cb.onToggleDayNight()
    else if (k === 'e') this.cb.onInteract()
    else if (k === 'escape') this.cb.onMenu()
    else if (k === 'm') this.cb.onMenu()
    if (['w', 'a', 's', 'd', 'shift', ' ', 'e', 'f', 'n'].includes(k)) e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase())
  }

  private onClick = (): void => {
    this.active = true
    if (!this.locked) {
      this.canvas.requestPointerLock()
      return
    }
    // 锁定状态下点击 = 交互（准星射线）
    this.cb.onInteract()
  }

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) this.keys.clear()
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    this.cb.onActivity()
    this.cb.onLook(e.movementX, e.movementY)
  }

  /** 采样移动输入。 */
  input(): { forward: number; strafe: number; run: boolean; lift: number } {
    let f = 0
    let s = 0
    if (this.keys.has('w') || this.keys.has('arrowup')) f += 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) f -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) s += 1
    if (this.keys.has('a') || this.keys.has('arrowleft')) s -= 1
    let lift = 0
    if (this.keys.has('q')) lift += 1
    if (this.keys.has('r')) lift -= 1
    return { forward: f, strafe: s, run: this.keys.has('shift'), lift }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
  }
}
