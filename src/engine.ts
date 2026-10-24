/**
 * 渲染引擎封装：rAF 主循环 + 画质应用 + 移动端性能三红线（PRD §6）：
 * - fps 上限（中低档 30）
 * - document.hidden 完全暂停
 * - 静止无交互 5s 后降频渲染（演示模式可关）
 */

import {
  ACESFilmicToneMapping,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import type { QualitySettings } from './quality/detect'
import { clampDpr, dprAfterTierChange } from './quality/detect'

export interface EngineStats {
  fps: number
  frameMs: number
  triangles: number
  calls: number
  dpr: number
  tier: string
  throttled: boolean
  /** 调试面板附加行：相机姿态读数（出生颠倒类问题的机上诊断用），未启用时缺省 */
  cam?: string
}

const IDLE_AFTER_MS = 5000
const IDLE_FRAME_MS = 150 // 闲置时 ~6.7fps 降频渲染
const HIDDEN_SKIP = true

export class Engine {
  renderer: WebGLRenderer
  scene = new Scene()
  camera: PerspectiveCamera
  quality: QualitySettings
  currentDpr: number
  deviceDpr: number
  stats: EngineStats = { fps: 0, frameMs: 0, triangles: 0, calls: 0, dpr: 1, tier: 'mid', throttled: false }
  /** 演示模式：禁用闲置降频（常显滚动窗外景） */
  demoMode = false
  private rafId = 0
  private running = false
  private lastT = 0
  private lastRenderT = 0
  private lastActivity = performance.now()
  private frameTimes: number[] = []
  private onFrame: (dt: number) => boolean = () => false
  private onVisibility: (visible: boolean) => void = () => {}
  private resizeHandler: () => void = () => {}
  /** 主循环/渲染异常上报（永不无声死亡：循环不断，异常上报后继续下一帧） */
  onError: ((err: unknown, where: 'frame' | 'render') => void) | null = null
  /** WebGL 上下文事件（app 层负责横幅与持久化记录） */
  onContextEvent: ((lost: boolean) => void) | null = null
  contextLost = false

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality
    this.deviceDpr = window.devicePixelRatio || 1
    this.currentDpr = clampDpr(this.deviceDpr, quality.dprCap)
    this.renderer = new WebGLRenderer({
      canvas,
      // MSAA 只能在上下文创建时决定；运行时切档不重建上下文（如实反映：
      // MSAA 由初始档位决定，后续切档不改变；见 detect.ts QualitySettings.antialias）
      antialias: quality.antialias,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(this.currentDpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400)
    // 姿态约定：与 Player.applyToCamera 的欧拉一致（YXZ），并显式钉住 up，
    // 保证出生与运行全程「抬头=天花板、低头=地板」。
    this.camera.rotation.order = 'YXZ'
    this.camera.up.set(0, 1, 0)
    this.applyQuality(quality)

    document.addEventListener('visibilitychange', this.handleVisibility)
    // WebGL 上下文丢失/恢复：lost 必须 preventDefault 才有机会恢复（否则
    // three 直接假死）；恢复由 three 内部重建纹理/程序，这里只上报与放行
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.contextLost = true
      this.onContextEvent?.(true)
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false
      this.onContextEvent?.(false)
    })
    this.resizeHandler = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    }
    window.addEventListener('resize', this.resizeHandler)
    window.addEventListener('orientationchange', this.resizeHandler)
  }

  private handleVisibility = (): void => {
    if (document.hidden) {
      if (HIDDEN_SKIP && this.running) this.pauseLoop()
    } else {
      if (this.running && this.rafId === 0) this.resumeLoop()
      this.onVisibility(!document.hidden)
    }
  }

  /** 应用画质档（dpr/阴影/色调映射）。
   *  keepCurrentDpr=true（自适应降档路径）：dpr 只降不升（见 dprAfterTierChange），
   *  避免整档切换把自适应已下调的 dpr 回抬；默认（手动选档）按新档上限重置。 */
  applyQuality(q: QualitySettings, opts?: { keepCurrentDpr?: boolean }): void {
    this.quality = q
    this.currentDpr = dprAfterTierChange(this.currentDpr, this.deviceDpr, q.dprCap, opts?.keepCurrentDpr === true)
    this.renderer.setPixelRatio(this.currentDpr)
    this.renderer.shadowMap.enabled = q.shadows
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.toneMapping = q.toneMapping ? ACESFilmicToneMapping : NoToneMapping
    this.renderer.toneMappingExposure = 1.18 // ACES 中间调偏暗，略提曝光
    this.stats.tier = q.tier
    this.stats.dpr = this.currentDpr
  }

  /** 自适应降 dpr（不重建场景）。 */
  setDpr(dpr: number): void {
    this.currentDpr = clampDpr(dpr, this.quality.dprCap)
    this.renderer.setPixelRatio(this.currentDpr)
    this.stats.dpr = this.currentDpr
  }

  noteActivity(): void {
    this.lastActivity = performance.now()
  }

  start(onFrame: (dt: number) => boolean, onVisibility: (visible: boolean) => void): void {
    this.onFrame = onFrame
    this.onVisibility = onVisibility
    this.running = true
    this.lastT = performance.now()
    this.lastRenderT = 0
    this.resumeLoop()
  }

  stop(): void {
    this.running = false
    this.pauseLoop()
  }

  private pauseLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  private resumeLoop(): void {
    if (this.rafId === 0) {
      this.lastT = performance.now()
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  private tick = (now: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.tick)
    const capMs = this.quality.fpsCap > 0 ? 1000 / this.quality.fpsCap : 0
    const sinceRender = now - this.lastRenderT
    // fps 上限
    if (capMs > 0 && sinceRender < capMs - 1.5) return
    // 闲置降频（演示模式关闭该行为）
    const idleMs = now - this.lastActivity
    const throttled = !this.demoMode && idleMs > IDLE_AFTER_MS
    if (throttled && sinceRender < IDLE_FRAME_MS) return

    const dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now
    this.lastRenderT = now

    // 单帧异常不得杀死主循环（此前 onFrame 一抛 → render 也被跳过 → 画面
    // 永久冻结，用户感知即「自动退出」）；捕获上报后继续下一帧
    let busy = false
    try {
      busy = this.onFrame(dt)
    } catch (err) {
      this.onError?.(err, 'frame')
    }
    if (busy) this.lastActivity = now
    if (!this.contextLost) {
      try {
        this.renderer.render(this.scene, this.camera)
      } catch (err) {
        this.onError?.(err, 'render')
      }
    }

    // 统计
    const info = this.renderer.info.render
    this.stats.triangles = info.triangles
    this.stats.calls = info.calls
    this.stats.throttled = throttled
    const ms = performance.now() - now
    this.frameTimes.push(ms)
    if (this.frameTimes.length > 40) this.frameTimes.shift()
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    this.stats.frameMs = Math.round(avg * 100) / 100
    this.stats.fps = Math.round(1000 / Math.max(1, sinceRender))
  }

  dispose(): void {
    this.stop()
    document.removeEventListener('visibilitychange', this.handleVisibility)
    window.removeEventListener('resize', this.resizeHandler)
    window.removeEventListener('orientationchange', this.resizeHandler)
    this.renderer.dispose()
  }
}
