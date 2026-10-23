/**
 * 入口：启动应用，未捕获异常落到降级页（WebGL 不可用等）。
 */

import './style.css'
import { bootApp } from './app'

void bootApp().catch((err: unknown) => {
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
