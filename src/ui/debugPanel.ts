/**
 * 调试面板（PRD §7 调试后门）：?debug=1 显示
 * FPS / 帧耗时 / 三角形数 / draw calls / 画质档 / dpr / 闲置降频状态。
 */

import type { EngineStats } from '../engine'

export class DebugPanel {
  private el: HTMLElement
  private timer = 0

  constructor(private getStats: () => EngineStats, enabled: boolean) {
    this.el = document.createElement('div')
    this.el.id = 'debug'
    document.getElementById('app')?.append(this.el)
    if (enabled) this.el.style.display = 'block'
  }

  update(): void {
    if (this.el.style.display === 'none' || this.el.style.display === '') return
    const now = performance.now()
    if (now - this.timer < 400) return
    this.timer = now
    const s = this.getStats()
    this.el.textContent =
      `fps ${s.fps} · ${s.frameMs.toFixed(1)}ms\n` +
      `tris ${s.triangles.toLocaleString()} · calls ${s.calls}\n` +
      `tier ${s.tier} · dpr ${s.dpr.toFixed(2)}\n` +
      `idle-throttled ${s.throttled ? 'yes' : 'no'}` +
      (s.cam ? `\n${s.cam}` : '')
  }
}
