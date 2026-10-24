import { afterEach, describe, expect, it, vi } from 'vitest'
import { TouchControls } from '../src/controls/touch'

/** 真机反馈 #6 回归（安卓浏览器：点击物体报红横幅 / 交互后整体无响应）：
 * Android Chrome 在浏览器接管/回收指针（滚动意图、pointercancel 后失活）时，
 * canvas.setPointerCapture(pointerId) 抛 InvalidStateError。契约：
 * - 路由（TouchRouter 纯逻辑，不可能抛）先行；捕获是 best-effort 增强；
 * - 捕获异常不得冒泡（症状A：异常冒到全局 → 错误横幅）；
 * - 捕获异常不得中断路由（症状B：触点进不了路由 → 输入整体 wedge 而渲染照常）；
 * - pointercancel/up 后路由槽自愈，后续触点照常可用。
 * 变异检查：恢复旧顺序（capture 在 route 前且不捕获）→ 本文件必须红。 */

/** 390×844 竖屏、无安全区 inset（与 touch-router.test.ts 基准一致）。 */
const W = 390
const H = 844

interface FakePointerEvent {
  pointerType: string
  pointerId: number
  clientX: number
  clientY: number
}

const touch = (pointerId: number, clientX: number, clientY: number): FakePointerEvent => ({
  pointerType: 'touch',
  pointerId,
  clientX,
  clientY,
})

/** Android Chrome 失活指针下 setPointerCapture 的真实行为（复现日志 touch.ts:66）。 */
const captureRejects = (id: number): void => {
  throw new Error(
    `Failed to execute 'setPointerCapture' on 'Element': InvalidStateError (pointer ${id})`,
  )
}

function makeHarness(captureImpl?: (id: number) => void) {
  const handlers: Record<string, (e: PointerEvent) => void> = {}
  const setPointerCapture = vi.fn(captureImpl)
  const canvas = {
    clientWidth: W,
    clientHeight: H,
    addEventListener: (type: string, fn: (e: PointerEvent) => void) => {
      handlers[type] = fn
    },
    setPointerCapture,
  }
  const joyEl = {
    classList: { add: vi.fn(), remove: vi.fn() },
    style: {} as Record<string, string>,
    offsetWidth: 108,
  }
  const knobEl = { style: {} as Record<string, string> }
  const cb = { onMove: vi.fn(), onLook: vi.fn(), onTap: vi.fn(), onActivity: vi.fn() }
  new TouchControls(
    canvas as unknown as HTMLCanvasElement,
    joyEl as unknown as HTMLElement,
    knobEl as unknown as HTMLElement,
    cb,
  )
  // 走真实注册的监听器派发（与浏览器事件路径一致），非直呼私有方法
  const fire = (type: string, e: FakePointerEvent) =>
    handlers[type]!(e as unknown as PointerEvent)
  return { joyEl, cb, setPointerCapture, fire }
}

/** geometry() 依赖的两个 DOM 全局（vitest node 环境桩）。 */
function stubDom(): void {
  vi.stubGlobal('document', { documentElement: {} })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '0' }))
}

describe('真机反馈 #6：setPointerCapture 抛 InvalidStateError 不得 wedge 输入', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('症状A：捕获抛错不冒泡——onDown 完整执行不向全局抛异常', () => {
    stubDom()
    const h = makeHarness(captureRejects)
    expect(() => h.fire('pointerdown', touch(1, 80, 780))).not.toThrow()
  })

  it('症状B：捕获抛错后该触点仍完成路由——摇杆照常驱动并可复位', () => {
    stubDom()
    const h = makeHarness(captureRejects)
    h.fire('pointerdown', touch(1, 80, 780)) // 左下激活区 → move 槽
    expect(h.cb.onActivity).toHaveBeenCalled()
    expect(h.joyEl.classList.add).toHaveBeenCalledWith('dynamic') // 路由副作用已发生
    h.fire('pointermove', touch(1, 80, 730)) // 指尖前推 50px
    expect(h.cb.onMove).toHaveBeenCalledWith(0, 50 / 54)
    h.fire('pointerup', touch(1, 80, 780))
    expect(h.cb.onMove).toHaveBeenLastCalledWith(0, 0)
  })

  it('症状B：捕获抛错后后续触点仍可用——点击交互 onTap 照常触发', () => {
    stubDom()
    const h = makeHarness(captureRejects)
    // 确定时钟：避免 worker 冷启动 performance.now() < 300ms 时首击被
    // 误判为双击连击（防抖基准 lastTapTime 初始为 0）
    let t = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    h.fire('pointerdown', touch(1, 80, 780)) // 第一指：move（捕获即抛）
    h.fire('pointerup', touch(1, 80, 780))
    h.fire('pointerdown', touch(2, 300, 400)) // 第二指：look 槽，右侧
    t += 50
    h.fire('pointerup', touch(2, 300, 400)) // 原地快速抬指 → 单击
    expect(h.cb.onTap).toHaveBeenCalledWith(300, 400)
  })

  it('槽位自愈：pointercancel/up 归还后新触点可重新占用 move/look 槽', () => {
    stubDom()
    const h = makeHarness(captureRejects)
    h.fire('pointerdown', touch(1, 80, 780)) // move 槽
    h.fire('pointerdown', touch(2, 300, 400)) // look 槽
    // 浏览器接管（pointercancel）+ 正常抬指 → 两槽必须归还
    h.fire('pointercancel', touch(1, 80, 780))
    h.fire('pointerup', touch(2, 300, 400))
    // 若槽泄漏：新触点两槽皆满被忽略，onMove/onLook 永不触发（wedge 形态）
    h.fire('pointerdown', touch(3, 100, 700))
    h.fire('pointermove', touch(3, 100, 650))
    expect(h.cb.onMove).toHaveBeenCalledWith(0, 50 / 54)
    h.fire('pointerdown', touch(4, 320, 300))
    h.fire('pointermove', touch(4, 330, 300))
    expect(h.cb.onLook).toHaveBeenCalledWith(10, 0)
  })

  it('增强保留：捕获可用时仍对每个触点尝试 setPointerCapture', () => {
    stubDom()
    const h = makeHarness() // 不抛错的桩：捕获成功路径
    h.fire('pointerdown', touch(1, 80, 780))
    h.fire('pointerdown', touch(2, 300, 400))
    expect(h.setPointerCapture).toHaveBeenCalledWith(1)
    expect(h.setPointerCapture).toHaveBeenCalledWith(2)
  })
})
