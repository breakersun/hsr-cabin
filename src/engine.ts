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
import { clampDpr } from './quality/detect'

export interface EngineStats {
  fps: number
  frameMs: number
  triangles: number
  calls: number
  dpr: number
  tier: string
  throttled: boolean
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

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality
    this.deviceDpr = window.devicePixelRatio || 1
    this.currentDpr = clampDpr(this.deviceDpr, quality.dprCap)
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(this.currentDpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400)
    this.applyQuality(quality)

    document.addEventListener('visibilitychange', this.handleVisibility)
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

  /** 应用画质档（dpr/阴影/色调映射）。 */
  applyQuality(q: QualitySettings): void {
    this.quality = q
    this.currentDpr = clampDpr(this.deviceDpr, q.dprCap)
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

    const busy = this.onFrame(dt)
    if (busy) this.lastActivity = now
    this.renderer.render(this.scene, this.camera)

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
