/**
 * 入口：启动应用，未捕获异常落到降级页（WebGL 不可用等）。
 * 崩溃诊断加固：进入应用前先装全局错误守卫（onerror/unhandledrejection →
 * 可关闭横幅 + localStorage 留痕），boot 阶段的异常也不会无声消失。
 */

import './style.css'
import { bootApp } from './app'
import { ErrorGuard } from './ui/errorGuard'

ErrorGuard.install()

void bootApp().catch((err: unknown) => {
  const guard = ErrorGuard.get()
  guard?.report('boot', err instanceof Error ? err.message : String(err), err instanceof Error ? err.stack : undefined)
  const boot = document.getElementById('boot')
  if (boot) {
    const step = document.getElementById('boot-step')
    if (step) step.textContent = '初始化失败'
    const errEl = document.createElement('div')
    errEl.style.cssText = 'margin-top:12px;font-size:12px;color:#c0392b;word-break:break-all'
    errEl.textContent = String(err)
    const card = boot.querySelector('.boot-card')
    card?.append(errEl)
  }
})
