/**
 * 调试面板（PRD §7 调试后门）：?debug=1 显示
 * FPS / 帧耗时 / 三角形数 / draw calls / 画质档 / dpr / 闲置降频状态，
 * 以及错误守卫的最近记录（localStorage hsr:lasterror，含上次会话残留）。
 */

import type { EngineStats } from '../engine'
import { ErrorGuard } from './errorGuard'

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
    const recs = ErrorGuard.get()?.records() ?? []
    for (let i = Math.max(0, recs.length - 3); i < recs.length; i++) {
      const r = recs[i]
      if (!r) continue
      this.el.textContent += `\nerr ${r.kind}: ${r.message.slice(0, 48)}${r.count && r.count > 1 ? ` ×${r.count}` : ''}`
    }
    // 崩溃取证心跳：最近一次 heap/档位落盘（标签页暴毙后崩前轨迹）
    const probe = ErrorGuard.get()?.lastProbe()
    if (probe) {
      const age = Math.max(0, Math.round((Date.now() - probe.at) / 1000))
      this.el.textContent += `\nhb ${probe.heapMB === null ? 'n/a' : `${probe.heapMB}MB`} @${probe.tier} ${age}s前`
    }
  }
}
