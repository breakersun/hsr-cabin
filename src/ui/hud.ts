/**
 * HUD（PRD §4.1/§4.4）：徽标、菜单（跳转/昼夜/画质/飞行/演示/全屏）、
 * 提示条、目标标签、toast、竖屏提示、虚拟摇杆 DOM。
 * 热区全部 >= 48px；safe-area + 100dvh 由 style.css 保证。
 */

export interface JumpPoint {
  id: string
  name: string
  x: number
  z: number
  yaw: number
}

export interface HudCallbacks {
  onJump(p: JumpPoint): void
  onToggleDayNight(): void
  onQuality(q: 'auto' | 'low' | 'mid' | 'high'): void
  onToggleFly(): void
  onToggleDemo(): void
  onFullscreen(): void
}

export interface HudState {
  night: boolean
  fly: boolean
  demo: boolean
  quality: 'auto' | 'low' | 'mid' | 'high'
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export const JUMP_POINTS: JumpPoint[] = [
  { id: 'front', name: '前部', x: 0, z: 7.4, yaw: Math.PI },
  { id: 'rear', name: '后部', x: 0, z: -3.4, yaw: 0 },
  { id: 'door', name: '车门', x: 0, z: 8.7, yaw: Math.PI },
  { id: 'boiler', name: '开水机', x: -0.75, z: -2.0, yaw: Math.PI / 2 },
  { id: 'vestibule', name: '通过台', x: 0, z: -8.7, yaw: 0 },
]

export class Hud {
  readonly root: HTMLElement
  readonly joyEl: HTMLElement
  readonly knobEl: HTMLElement
  private menuEl: HTMLElement
  private targetLabel: HTMLElement
  private hintEl: HTMLElement
  private dayNightBtn: HTMLElement
  private flyBtn: HTMLElement
  private demoBtn: HTMLElement
  private qualityBtns = new Map<string, HTMLElement>()
  private targetTimer = 0
  /** updateState 脏检查基准（主循环每帧调用，无变化时不触碰 DOM） */
  private lastState: HudState | null = null

  constructor(
    private isTouch: boolean,
    private cb: HudCallbacks,
  ) {
    this.root = document.getElementById('app') ?? document.body

    // 顶部左徽标（装饰性）
    const badge = el('div', 'hud', '')
    badge.id = 'badge'
    badge.append(el('div', 'line1', '二等座车 · 350 km/h'), el('div', 'line2', 'HSR-Cabin 致敬风格演示'))
    this.root.append(badge)

    // 菜单按钮
    const menuWrap = el('div', 'hud', '')
    menuWrap.id = 'menu-wrap'
    const menuBtn = el('button', 'hud-btn', '菜单')
    menuBtn.addEventListener('click', () => this.toggleMenu())
    menuWrap.append(menuBtn)
    this.root.append(menuWrap)

    // 菜单面板
    this.menuEl = el('div', '', '')
    this.menuEl.id = 'menu'
    this.menuEl.classList.add('hidden')
    const buildSection = (title: string): HTMLElement => {
      this.menuEl.append(el('h3', '', title))
      const row = el('div', 'row', '')
      this.menuEl.append(row)
      return row
    }
    const jumpRow = buildSection('车内跳转')
    for (const p of JUMP_POINTS) {
      const b = el('button', 'hud-btn', p.name)
      b.addEventListener('click', () => {
        this.cb.onJump(p)
        this.toggleMenu(false)
      })
      jumpRow.append(b)
    }
    const envRow = buildSection('环境')
    this.dayNightBtn = el('button', 'hud-btn', '切换夜晚')
    this.dayNightBtn.addEventListener('click', () => this.cb.onToggleDayNight())
    const fsBtn = el('button', 'hud-btn', '全屏')
    fsBtn.addEventListener('click', () => this.cb.onFullscreen())
    envRow.append(this.dayNightBtn, fsBtn)
    const qRow = buildSection('画质')
    for (const q of ['auto', 'low', 'mid', 'high'] as const) {
      const b = el('button', 'hud-btn', q === 'auto' ? '自动' : q === 'low' ? '低' : q === 'mid' ? '中' : '高')
      b.addEventListener('click', () => this.cb.onQuality(q))
      this.qualityBtns.set(q, b)
      qRow.append(b)
    }
    const flyRow = buildSection('模式')
    this.flyBtn = el('button', 'hud-btn', '自由飞行')
    this.flyBtn.addEventListener('click', () => this.cb.onToggleFly())
    this.demoBtn = el('button', 'hud-btn', '演示模式')
    this.demoBtn.addEventListener('click', () => this.cb.onToggleDemo())
    flyRow.append(this.flyBtn, this.demoBtn)
    this.root.append(this.menuEl)

    // 底部提示条 + 目标标签
    const bottom = el('div', 'hud', '')
    bottom.id = 'bottom'
    this.targetLabel = el('div', '', '')
    this.targetLabel.id = 'target-label'
    this.hintEl = el('div', '', '')
    this.hintEl.id = 'hint'
    this.setHintText()
    const x = el('span', 'x', '×')
    x.addEventListener('click', () => {
      this.hintEl.style.display = 'none'
    })
    this.hintEl.append(x)
    bottom.append(this.targetLabel, this.hintEl)
    this.root.append(bottom)

    // toast 容器
    const toasts = el('div', 'hud', '')
    toasts.id = 'toasts'
    this.root.append(toasts)
    this.toastEl = toasts

    // 竖屏提示（非阻断）
    if (this.isTouch) {
      const tip = el('div', 'hud', '')
      tip.id = 'portrait-tip'
      tip.append(el('span', '', '横屏体验更佳'))
      const tx = el('span', 'x', '×')
      tx.addEventListener('click', () => (tip.style.display = 'none'))
      tip.append(tx)
      this.root.append(tip)
      const update = (): void => {
        const portrait = window.innerHeight > window.innerWidth
        tip.style.display = portrait ? 'flex' : 'none'
      }
      update()
      window.setTimeout(() => (tip.style.display = 'none'), 6000)
      window.addEventListener('orientationchange', update)
      window.addEventListener('resize', update)
    }

    // 右下角按钮（移动端）
    if (this.isTouch) {
      const corner = el('div', 'hud', '')
      corner.id = 'corner'
      const fs = el('button', 'hud-btn', '⛶')
      fs.setAttribute('aria-label', '全屏')
      fs.addEventListener('click', () => this.cb.onFullscreen())
      const night = el('button', 'hud-btn', '◐')
      night.setAttribute('aria-label', '昼夜切换')
      night.addEventListener('click', () => this.cb.onToggleDayNight())
      corner.append(night, fs)
      this.root.append(corner)
    }

    // 虚拟摇杆
    this.joyEl = el('div', '', '')
    this.joyEl.id = 'joy'
    this.knobEl = el('div', 'knob', '')
    this.joyEl.append(this.knobEl)
    this.root.append(this.joyEl)
    if (this.isTouch) this.joyEl.style.display = 'block'
  }

  private toastEl: HTMLElement

  private setHintText(): void {
    const txt = this.isTouch
      ? '左下摇杆移动 · 右侧滑动视角 · 点击物件交互'
      : 'WASD 移动 · 鼠标视角 · 点击/E 交互 · Shift 跑 · F 飞行 · N 昼夜'
    this.hintEl.prepend(document.createTextNode(txt + '  '))
  }

  toggleMenu(force?: boolean): void {
    const show = force ?? this.menuEl.classList.contains('hidden')
    this.menuEl.classList.toggle('hidden', !show)
  }

  /** 菜单是否打开（app 层用于决定是否显示「点击继续」提示）。 */
  get menuOpen(): boolean {
    return !this.menuEl.classList.contains('hidden')
  }

  toast(text: string, ms = 2200): void {
    const t = el('div', 'toast', text)
    this.toastEl.append(t)
    window.setTimeout(() => t.remove(), ms)
  }

  showTarget(text: string): void {
    this.targetLabel.textContent = text
    this.targetLabel.classList.add('show')
    if (this.targetTimer) window.clearTimeout(this.targetTimer)
    this.targetTimer = window.setTimeout(() => this.targetLabel.classList.remove('show'), 1800)
  }

  /** 主循环每帧调用；内部脏检查，状态未变化时零 DOM 写。 */
  updateState(s: HudState): void {
    const last = this.lastState
    if (
      last &&
      last.night === s.night &&
      last.fly === s.fly &&
      last.demo === s.demo &&
      last.quality === s.quality
    ) {
      return
    }
    this.lastState = { ...s }
    this.dayNightBtn.textContent = s.night ? '切换白天' : '切换夜晚'
    this.flyBtn.classList.toggle('on', s.fly)
    this.demoBtn.classList.toggle('on', s.demo)
    for (const [q, b] of this.qualityBtns) b.classList.toggle('on', q === s.quality)
  }
}
