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

/** 解锁归因（真机反馈 #4：意外解锁需区分良性失焦与真异常）。
 *  - escape：150ms 内有 ESC 键 → 用户主动
 *  - blur：解锁时页面已隐藏/失焦（切窗、截图热键等）→ 良性，不报警
 *  - unexpected：页面可见且聚焦下自发释放 → 真异常信号
 *    （若历史上每次崩溃前都有一次这种静默解锁，即 #3「标签页消失」的前驱事件——落盘可见） */
export type UnlockCause = 'escape' | 'blur' | 'unexpected'

/** 纯函数（vitest 直测）。wasLocked=false（本来就没锁）返回 null。 */
export function classifyUnlock(
  wasLocked: boolean,
  msSinceEscape: number,
  visible: boolean,
  focused: boolean,
): UnlockCause | null {
  if (!wasLocked) return null
  if (msSinceEscape <= 150) return 'escape'
  if (!visible || !focused) return 'blur'
  return 'unexpected'
}

export class DesktopControls {
  active = false
  private keys = new Set<string>()
  private locked = false
  private lastEscapeAt = 0
  /** 最近一次解锁归因（null = 未发生/已消费）：unexpected 供 app 层报警落盘 */
  unlockCause: UnlockCause | null = null
  /** 真机取证钩子（反馈 #5）：IME 组合键（e.key='Process'/kc229）在输入层天然不可见
   *  ——headless 已证实该事件形态移动输入恒为 0。检测到即一次性回调（app 层落盘，
   *  ?debug=1 可见），用于判别真机「按键不响应」是否 IME 吞键。 */
  onImeKey: (() => void) | null = null
  private imeReported = false
  /** input() 复用对象（主循环每帧调用，避免每帧分配） */
  private inputState = { forward: 0, strafe: 0, run: false, lift: 0 }

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
    // IME 组合期间按键（含 kc229）：一次性取证回调。移动键在组合期间收不到
    // 真实 e.key（headless 实测 Δ=0），这是「按键不响应」唯一已证实的输入层机制。
    if ((e.isComposing || e.keyCode === 229) && !this.imeReported) {
      this.imeReported = true
      this.onImeKey?.()
    }
    this.active = true
    this.cb.onActivity()
    const k = e.key.toLowerCase()
    this.keys.add(k)
    if (k === 'f') this.cb.onToggleFly()
    else if (k === 'n') this.cb.onToggleDayNight()
    else if (k === 'e') this.cb.onInteract()
    else if (k === 'escape') {
      this.lastEscapeAt = performance.now()
      this.cb.onMenu()
    } else if (k === 'm') this.cb.onMenu()
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
    const was = this.locked
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) {
      // 解锁瞬间采集旁证：页面可见且聚焦下自发释放才是真异常（详见 classifyUnlock）
      this.unlockCause = classifyUnlock(
        was,
        performance.now() - this.lastEscapeAt,
        document.visibilityState === 'visible',
        document.hasFocus(),
      )
      this.keys.clear()
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    this.cb.onActivity()
    this.cb.onLook(e.movementX, e.movementY)
  }

  /** 采样移动输入（写入预分配对象并返回同一引用，主循环零分配）。 */
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
    const st = this.inputState
    st.forward = f
    st.strafe = s
    st.run = this.keys.has('shift')
    st.lift = lift
    return st
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
  }
}
