import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorGuard } from '../src/ui/errorGuard'

/**
 * 评审第六轮 MAJOR：把「至多每 2s 落盘」锁进真实 report() 路径（fake storage 集成）。
 * 直接驱动 ErrorGuard.report()，统计 setItem 次数；fake timers 推进时间，不等真实 2s。
 * 变异自检（本地验证红→绿后还原）：
 *  - report() 中 gate 改恒 true（删节流）⇒ 「窗口内重复 0 写」用例红
 *  - gate 改恒 false（永不落盘）⇒ 「首条恰 1 写」用例红
 */

/** 最小 DOM 元素桩：只覆盖 showBanner 触碰的面。 */
const fakeEl = (): unknown => ({
  id: '',
  className: '',
  textContent: '',
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
  append() {},
  addEventListener() {},
  querySelector() {
    return null
  },
})

let writes: string[]
let pagehideHandler: (() => void) | undefined

const storage = {
  getItem: (): null => null,
  setItem: (_k: string, v: string): void => {
    writes.push(v)
  },
}

const installFresh = (): ErrorGuard => {
  Reflect.set(ErrorGuard, 'instance', null) // 单例重置（测试隔离）
  return ErrorGuard.install(storage)
}

beforeEach(() => {
  writes = []
  pagehideHandler = undefined
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    addEventListener(type: string, cb: () => void) {
      if (type === 'pagehide') pagehideHandler = cb
    },
  }
  g.document = { createElement: fakeEl, getElementById: () => null, addEventListener() {} }
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.document
})

describe('report() 真实路径落盘频率（评审 MAJOR）', () => {
  it('首条错误：恰好写 1 次（即时落盘，无重复写）', () => {
    const guard = installFresh()
    guard.report('frame', 'boom')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('boom')
  })

  it('2s 窗口内重复同一错误：0 次额外写（杀「gate 恒 true / 无节流」变异）', () => {
    const guard = installFresh()
    guard.report('frame', 'boom')
    vi.advanceTimersByTime(1000)
    guard.report('frame', 'boom')
    vi.advanceTimersByTime(500)
    guard.report('frame', 'boom') // t=1500 仍在窗口
    expect(writes).toHaveLength(1)
  })

  it('越窗后再次上报：放行恰 1 次写，且重复计数刷上盘（杀「gate 恒 false / 永不落盘」变异）', () => {
    const guard = installFresh()
    guard.report('frame', 'boom') // t=0 写
    vi.advanceTimersByTime(2100)
    guard.report('frame', 'boom') // 越节流窗（仍在 5s 去重窗 → count=2）
    expect(writes).toHaveLength(2)
    const recs = JSON.parse(writes[1] ?? '[]') as Array<{ count?: number }>
    expect(recs[recs.length - 1]?.count).toBe(2)
  })

  it('新错误条目（不同消息）不受节流窗口约束：立即写', () => {
    const guard = installFresh()
    guard.report('frame', 'boom')
    vi.advanceTimersByTime(100)
    guard.report('render', 'other') // fresh
    expect(writes).toHaveLength(2)
  })
})

describe('pagehide 兜底（评审 MINOR）', () => {
  it('卸载时把窗口内未落盘的重复计数补写上盘', () => {
    const guard = installFresh()
    guard.report('frame', 'boom') // t=0 写
    vi.advanceTimersByTime(500)
    guard.report('frame', 'boom') // 窗口内：0 写，count=2 只在内存
    expect(writes).toHaveLength(1)
    pagehideHandler?.()
    expect(writes).toHaveLength(2)
    const recs = JSON.parse(writes[1] ?? '[]') as Array<{ count?: number }>
    expect(recs[recs.length - 1]?.count).toBe(2)
  })
})
