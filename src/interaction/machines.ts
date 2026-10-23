/**
 * 可交互物件状态机（纯逻辑，vitest 覆盖）。
 * 场景层根据各机器的 openness/progress 驱动实例矩阵与材质。
 */

/** ---------- 通过台感应滑门 ---------- */
export type DoorState = 'closed' | 'opening' | 'open' | 'closing'

export class DoorMachine {
  state: DoorState = 'closed'
  /** 0 关 → 1 开，用于滑门面板插值 */
  openness = 0
  private holdTimer = 0
  /** 感应区域内有人（保持开门） */
  sensor = false
  /** 门框处有人（防夹：不允许关门 / 关门中要重新打开） */
  blocked = false

  constructor(
    public moveTime = 0.8,
    public holdTime = 2.5,
  ) {}

  requestOpen(): void {
    if (this.state === 'closed' || this.state === 'closing') this.state = 'opening'
  }

  requestClose(): void {
    if (this.state === 'open' || this.state === 'opening') this.state = 'closing'
  }

  update(dt: number): void {
    switch (this.state) {
      case 'opening':
        this.openness = Math.min(1, this.openness + dt / this.moveTime)
        if (this.openness >= 1) {
          this.state = 'open'
          this.holdTimer = this.holdTime
        }
        break
      case 'open':
        this.holdTimer -= dt
        // 感应无人 + 保持时间到 + 门框无人 → 自动关闭
        if (!this.sensor && this.holdTimer <= 0 && !this.blocked) this.state = 'closing'
        break
      case 'closing':
        // 防夹：门框有人立即重新打开
        if (this.blocked) {
          this.state = 'opening'
          break
        }
        this.openness = Math.max(0, this.openness - dt / this.moveTime)
        if (this.openness <= 0) this.state = 'closed'
        break
      case 'closed':
        break
    }
  }

  /** 通行判定：门足够开才可穿过（碰撞体据此移除）。 */
  get isPassable(): boolean {
    return this.openness > 0.85
  }

  /** 点击门面板：开 ⇄ 关。 */
  toggle(): void {
    if (this.state === 'closed') this.requestOpen()
    else this.requestClose()
  }
}

/** ---------- 椅背小桌板 ---------- */
export type TrayState = 'stowed' | 'deploying' | 'deployed' | 'retracting'

export class TrayMachine {
  state: TrayState = 'stowed'
  /** 0 收起贴背 → 1 展开水平 */
  openness = 0

  constructor(public moveTime = 0.45) {}

  toggle(): void {
    if (this.state === 'stowed') this.state = 'deploying'
    else if (this.state === 'deployed') this.state = 'retracting'
    // 动画中忽略连击
  }

  update(dt: number): void {
    switch (this.state) {
      case 'deploying':
        this.openness = Math.min(1, this.openness + dt / this.moveTime)
        if (this.openness >= 1) this.state = 'deployed'
        break
      case 'retracting':
        this.openness = Math.max(0, this.openness - dt / this.moveTime)
        if (this.openness <= 0) this.state = 'stowed'
        break
      default:
        break
    }
  }
}

/** ---------- 二等座靠背（两档倾角插值） ---------- */
export type BackrestState = 'upright' | 'reclining' | 'reclined' | 'rising'

export class BackrestMachine {
  state: BackrestState = 'upright'
  /** 0 直立档 → 1 后仰档 */
  progress = 0

  constructor(
    public moveTime = 0.9,
    public uprightDeg = 8,
    public reclinedDeg = 28,
  ) {}

  toggle(): void {
    if (this.state === 'upright') this.state = 'reclining'
    else if (this.state === 'reclined') this.state = 'rising'
  }

  update(dt: number): void {
    switch (this.state) {
      case 'reclining':
        this.progress = Math.min(1, this.progress + dt / this.moveTime)
        if (this.progress >= 1) this.state = 'reclined'
        break
      case 'rising':
        this.progress = Math.max(0, this.progress - dt / this.moveTime)
        if (this.progress <= 0) this.state = 'upright'
        break
      default:
        break
    }
  }

  /** 当前倾角（度）。 */
  get angleDeg(): number {
    return this.uprightDeg + (this.reclinedDeg - this.uprightDeg) * this.progress
  }
}

/** ---------- 开水机（热水机） ---------- */
export type BoilerState = 'idle' | 'dispensing' | 'full'

export class BoilerMachine {
  state: BoilerState = 'idle'
  /** 出水进度 0..1（水位/蒸汽动画驱动） */
  progress = 0

  constructor(public dispenseTime = 2.4) {}

  /** 点击：空闲→开始出水；满杯→取走水杯回到空闲；出水中忽略。 */
  press(): boolean {
    if (this.state === 'idle') {
      this.state = 'dispensing'
      this.progress = 0
      return true
    }
    if (this.state === 'full') {
      this.state = 'idle'
      this.progress = 0
      return true
    }
    return false
  }

  update(dt: number): void {
    if (this.state === 'dispensing') {
      this.progress += dt / this.dispenseTime
      if (this.progress >= 1) {
        this.progress = 1
        this.state = 'full'
      }
    }
  }

  get isSteamVisible(): boolean {
    return this.state === 'dispensing'
  }
}

/** ---------- 窗帘（下拉式）---------- */
export type CurtainState = 'up' | 'lowering' | 'down' | 'rising'

export class CurtainMachine {
  state: CurtainState = 'up'
  /** 0 收起 → 1 完全拉下 */
  amount = 0

  constructor(public moveTime = 0.7) {}

  toggle(): void {
    if (this.state === 'up') this.state = 'lowering'
    else if (this.state === 'down') this.state = 'rising'
  }

  update(dt: number): void {
    switch (this.state) {
      case 'lowering':
        this.amount = Math.min(1, this.amount + dt / this.moveTime)
        if (this.amount >= 1) this.state = 'down'
        break
      case 'rising':
        this.amount = Math.max(0, this.amount - dt / this.moveTime)
        if (this.amount <= 0) this.state = 'up'
        break
      default:
        break
    }
  }
}
