/**
 * 崩溃诊断加固（真机反馈「浏览一阵自动退出」）：永不无声死亡。
 * - window.onerror / unhandledrejection → 可关闭错误横幅（非 debug 也显示），
 *   记录（时间戳+消息+堆栈）持久化 localStorage（hsr:lasterror，环形上限），
 *   下次打开 ?debug=1 可见
 * - 纯逻辑核心（ErrorLog/BannerState/ContextTracker）与 DOM 薄壳分离，vitest 直测
 */

export interface GuardRecord {
  /** 相对页面加载的毫秒时间戳（Date.now() 取样一次，便于跨会话阅读用 ISO 串） */
  at: number
  kind: string
  message: string
  stack?: string
  /** 同错误在短窗口内重复出现的次数（风暴去重） */
  count?: number
}

export const STORAGE_KEY = 'hsr:lasterror'
const MAX_RECORDS = 10
/** 同 kind+message 在该窗口内重复 → 只累计 count，不重复弹横幅/落盘 */
const DEDUPE_MS = 5000
/** context lost 超过该时长未恢复 → 升级为错误横幅（建议刷新） */
export const CTX_RESTORE_TIMEOUT_MS = 8000

/**
 * 会话心跳（真机「标签页直接消失」形态的取证）：定期把 heap/档位落盘。
 * 渲染进程死亡时 JS 无从拦截，崩前最后一次心跳就是唯一的现场——
 * 下次打开 ?debug=1 可看堆轨迹：爬升 ⇒ OOM，平坦 ⇒ 外因（驱动/浏览器）。
 */
export interface SessionProbe {
  at: number
  heapMB: number | null
  tier: string
}
export const SESSION_KEY = 'hsr:session'
export const HEARTBEAT_MS = 30_000
const MAX_PROBES = 8

/** 持久化读取容错（损坏/缺失/错形状 → []）。 */
export function loadProbes(raw: string | null): SessionProbe[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: SessionProbe[] = []
    for (const p of parsed.slice(-MAX_PROBES)) {
      if (typeof p !== 'object' || p === null) continue
      const r = p as Partial<SessionProbe>
      if (typeof r.tier !== 'string') continue
      out.push({ at: typeof r.at === 'number' ? r.at : 0, heapMB: typeof r.heapMB === 'number' ? r.heapMB : null, tier: r.tier })
    }
    return out
  } catch {
    return []
  }
}

/** 纯逻辑：心跳节流 + 环形落盘。tick 由调用方周期驱动（时间显式注入，vitest 直测）。 */
export class Heartbeat {
  /** -Infinity：首次 tick 必落盘（startHeartbeat 立即写首条，不留空档） */
  private lastAt = Number.NEGATIVE_INFINITY
  constructor(
    private getProbe: () => { heapMB: number | null; tier: string },
    private storage: GuardStorage,
  ) {}

  /** 距上次落盘不足 intervalMs 时跳过（返回 false）。 */
  tick(now = Date.now(), intervalMs = HEARTBEAT_MS): boolean {
    if (now - this.lastAt < intervalMs) return false
    this.lastAt = now
    const list = loadProbes(safeGet(this.storage, SESSION_KEY))
    list.push({ ...this.getProbe(), at: now })
    safeSet(this.storage, SESSION_KEY, JSON.stringify(list.slice(-MAX_PROBES)))
    return true
  }
}

/** 纯逻辑：错误记录日志（风暴去重 / 环形上限 / 序列化）。 */
export class ErrorLog {
  private records: GuardRecord[] = []
  private lastAt = 0

  /** 新增记录。落入去重窗口时只累计 count 并返回 false（无新记录）。 */
  add(rec: GuardRecord, now = Date.now()): boolean {
    const last = this.records[this.records.length - 1]
    if (
      last &&
      last.kind === rec.kind &&
      last.message === rec.message &&
      now - this.lastAt < DEDUPE_MS
    ) {
      last.count = (last.count ?? 1) + 1
      return false
    }
    this.records.push({ ...rec })
    this.lastAt = now
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS)
    return true
  }

  list(): readonly GuardRecord[] {
    return this.records
  }

  toJSON(): string {
    return JSON.stringify(this.records)
  }

  /** 从持久化恢复；损坏/缺失/超限返回空数组（不抛）。 */
  static load(raw: string | null): GuardRecord[] {
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      const out: GuardRecord[] = []
      for (const p of parsed.slice(-MAX_RECORDS)) {
        if (typeof p !== 'object' || p === null) continue
        const r = p as Partial<GuardRecord>
        if (typeof r.kind !== 'string' || typeof r.message !== 'string') continue
        out.push({ at: typeof r.at === 'number' ? r.at : 0, kind: r.kind, message: r.message, stack: typeof r.stack === 'string' ? r.stack : undefined, count: typeof r.count === 'number' ? r.count : undefined })
      }
      return out
    } catch {
      return []
    }
  }
}

/** 纯逻辑：横幅状态机。hidden → shown ⇄ dismissed；
 *  dismiss 只针对当前 kind+message，新错误重新拉起。 */
export type BannerPhase = 'hidden' | 'shown' | 'dismissed'

export class BannerState {
  phase: BannerPhase = 'hidden'
  currentKey = ''
  private dismissedKey = ''
  /** count（同一错误风暴计数）随 report 同步 */
  count = 0

  report(kind: string, message: string, count: number): boolean {
    const key = `${kind}::${message}`
    if (this.phase === 'dismissed' && this.dismissedKey === key) return false
    this.currentKey = key
    this.count = count
    this.phase = 'shown'
    return true
  }

  dismiss(): void {
    if (this.phase !== 'shown') return
    this.dismissedKey = this.currentKey
    this.phase = 'dismissed'
  }

  /** 信息类横幅（如恢复渲染）用完即收。 */
  hide(): void {
    if (this.phase === 'shown') this.phase = 'hidden'
  }
}

/** 纯逻辑：WebGL 上下文丢失跟踪。
 *  lost →（restored ⇒ 恢复；超时 ⇒ 建议刷新）。超时判死后真实 restored 到来
 *  也算恢复（返回 true 供调用方收掉「请刷新」横幅——上下文其实活了）。 */
export type ContextPhase = 'ok' | 'lost' | 'restored' | 'dead'

export class ContextTracker {
  phase: ContextPhase = 'ok'
  private lostAt = 0

  lost(now = Date.now()): void {
    this.phase = 'lost'
    this.lostAt = now
  }

  restored(): boolean {
    if (this.phase !== 'lost' && this.phase !== 'dead') return false
    this.phase = 'restored'
    return true
  }

  /** lost 后未恢复超时（由调用方周期驱动）。 */
  expired(now = Date.now(), timeoutMs = CTX_RESTORE_TIMEOUT_MS): boolean {
    if (this.phase !== 'lost') return false
    if (now - this.lostAt >= timeoutMs) {
      this.phase = 'dead'
      return true
    }
    return false
  }
}

/** localStorage 读写薄抽象（测试注入内存实现）。 */
export interface GuardStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

/**
 * 风暴下的落盘/横幅刷新节流（评审 MAJOR：去重只限记录条数，不限写入频率——
 * 每帧异常 = 每帧 JSON 序列化 + localStorage 同步写 + DOM 重写）。
 * fresh（新条目）立即放行并重置窗口；重复计数仅在窗口外放行。
 */
export const PERSIST_THROTTLE_MS = 2000

export class PersistThrottle {
  private lastAt = 0
  constructor(private intervalMs = PERSIST_THROTTLE_MS) {}

  allow(fresh: boolean, now = Date.now()): boolean {
    if (fresh || now - this.lastAt >= this.intervalMs) {
      this.lastAt = now
      return true
    }
    return false
  }
}

/** DOM 外壳：全局监听 + 横幅 + 持久化。单例（install 一次）。 */
export class ErrorGuard {
  private static instance: ErrorGuard | null = null
  readonly log: ErrorLog
  readonly banner = new BannerState()
  readonly context = new ContextTracker()
  private bannerEl: HTMLElement | null = null
  private bannerText: HTMLElement | null = null
  private ctxTimer = 0
  private hbTimer = 0
  private persistGate = new PersistThrottle()

  static install(storage: GuardStorage = window.localStorage): ErrorGuard {
    if (ErrorGuard.instance) return ErrorGuard.instance
    const g = new ErrorGuard(storage)
    ErrorGuard.instance = g
    g.attach()
    return g
  }

  static get(): ErrorGuard | null {
    return ErrorGuard.instance
  }

  private constructor(private storage: GuardStorage) {
    this.log = new ErrorLog()
    // 恢复上次会话残留记录（本次会话新错误排在后面）
    for (const r of ErrorLog.load(safeGet(storage, STORAGE_KEY))) this.log.add(r, r.at)
  }

  private attach(): void {
    window.addEventListener('error', (e) => {
      this.report('error', e.message, (e.error as Error | undefined)?.stack ?? `${e.filename}:${e.lineno}`)
    })
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason
      this.report('rejection', String(r instanceof Error ? r.message : r), r instanceof Error ? r.stack : undefined)
    })
    // 卸载兜底：节流窗口内最后一次计数变化也保证落盘（崩溃前最后状态在盘上）
    window.addEventListener('pagehide', () => {
      safeSet(this.storage, STORAGE_KEY, this.log.toJSON())
    })
  }

  /** 上报一条。首条/新条目即时落盘；风暴计数更新节流落盘（PERSIST_THROTTLE_MS），
   *  横幅拉起仅一次、×N 计数刷新同节流，内容不变不重写 DOM。 */
  report(kind: string, message: string, stack?: string): void {
    const fresh = this.log.add({ at: Date.now(), kind, message, stack })
    const rec = this.log.list()[this.log.list().length - 1]
    if (!rec) return
    const gate = this.persistGate.allow(fresh)
    if (gate) safeSet(this.storage, STORAGE_KEY, this.log.toJSON())
    const key = `${kind}::${message}`
    const alreadyShown = this.banner.phase === 'shown' && this.banner.currentKey === key
    if (this.banner.report(kind, message, rec.count ?? 1) && !alreadyShown) {
      this.showBanner(kind === 'ctxlost' ? `⚠ ${message}` : `应用遇到问题：${message}${rec.count && rec.count > 1 ? `（×${rec.count}）` : ''}`, kind !== 'ctxlost')
    } else if (alreadyShown && gate) {
      // 风暴计数增长：按节流刷新现有横幅的 ×N
      this.showBanner(`应用遇到问题：${message}${rec.count && rec.count > 1 ? `（×${rec.count}）` : ''}`, true)
    }
  }

  /** context lost 流：lost → 信息横幅「正在恢复渲染…」；restored/超时分流。 */
  onContextLost(): void {
    this.context.lost()
    this.showBanner('正在恢复渲染…（GPU 上下文重建中）', false)
    window.clearTimeout(this.ctxTimer)
    this.ctxTimer = window.setTimeout(() => {
      if (this.context.expired()) {
        this.banner.hide()
        this.report('ctxlost', 'GPU 渲染上下文丢失且未自动恢复，请刷新页面')
      }
    }, CTX_RESTORE_TIMEOUT_MS)
  }

  onContextRestored(): void {
    if (this.context.restored()) this.hideBanner()
    window.clearTimeout(this.ctxTimer)
  }

  /** 会话心跳（崩溃取证）：立即写首条 + 周期驱动（半周期轮询防跳窗）。 */
  startHeartbeat(getProbe: () => { heapMB: number | null; tier: string }): void {
    window.clearInterval(this.hbTimer)
    const hb = new Heartbeat(getProbe, this.storage)
    hb.tick()
    this.hbTimer = window.setInterval(() => hb.tick(), HEARTBEAT_MS / 2)
  }

  /** 最近一次心跳（调试面板展示；无记录返回 null）。 */
  lastProbe(): SessionProbe | null {
    const list = loadProbes(safeGet(this.storage, SESSION_KEY))
    return list.length > 0 ? (list[list.length - 1] ?? null) : null
  }

  /** 供调试面板读取的上次/本次记录。 */
  records(): readonly GuardRecord[] {
    return this.log.list()
  }

  private showBanner(text: string, dismissible: boolean): void {
    if (!this.bannerEl) {
      const el = document.createElement('div')
      el.id = 'guard-banner'
      const txt = document.createElement('span')
      txt.className = 'msg'
      const x = document.createElement('button')
      x.className = 'x'
      x.textContent = '×'
      x.addEventListener('click', () => {
        this.banner.dismiss()
        this.hideBanner()
      })
      el.append(txt, x)
      document.getElementById('app')?.append(el)
      this.bannerEl = el
      this.bannerText = txt
    }
    if (this.bannerText && this.bannerText.textContent !== text) this.bannerText.textContent = text
    this.bannerEl?.querySelector('.x')?.classList.toggle('hidden', !dismissible)
    this.bannerEl?.classList.add('show')
  }

  private hideBanner(): void {
    this.bannerEl?.classList.remove('show')
  }
}

/** storage 访问兜底（隐私模式/禁用 cookie 下 setItem 会抛）。 */
function safeGet(s: GuardStorage, key: string): string | null {
  try {
    return s.getItem(key)
  } catch {
    return null
  }
}
function safeSet(s: GuardStorage, k: string, v: string): void {
  try {
    s.setItem(k, v)
  } catch {
    /* 持久化失败不影响当次横幅 */
  }
}
