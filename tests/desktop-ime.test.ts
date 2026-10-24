import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesktopControls } from '../src/controls/desktop'

/**
 * IME 吞键取证钩子（真机反馈 #5「按键不响应」）：headless 实测 IME 组合事件
 * （e.key='Process'/kc229）下移动输入恒为 0——这是输入层唯一已证实的吞键机制。
 * 钩子必须：229/组合事件触发恰好一次（去重），常规按键永不触发。
 */

const keydownHandlers: ((e: Partial<KeyboardEvent>) => void)[] = []
const keyupHandlers: ((e: Partial<KeyboardEvent>) => void)[] = []
const canvas = { addEventListener(): void {} } as unknown as HTMLCanvasElement

const makeControls = (): DesktopControls =>
  new DesktopControls(canvas, {
    onLook() {}, onInteract() {}, onToggleFly() {}, onToggleDayNight() {}, onMenu() {}, onActivity() {},
  })

beforeEach(() => {
  keydownHandlers.length = 0
  keyupHandlers.length = 0
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    addEventListener(type: string, cb: (e: unknown) => void) {
      if (type === 'keydown') keydownHandlers.push(cb)
      if (type === 'keyup') keyupHandlers.push(cb)
    },
  }
  g.document = { addEventListener(): void {}, removeEventListener(): void {} }
})

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.document
})

const press = (e: Partial<KeyboardEvent>): void => {
  for (const cb of keydownHandlers) cb({ key: '', preventDefault(): void {}, ...e })
}

const release = (e: Partial<KeyboardEvent>): void => {
  for (const cb of keyupHandlers) cb({ key: '', ...e })
}

describe('IME 组合键取证钩子（真机反馈 #5）', () => {
  it('kc229 / isComposing 事件 → onImeKey 恰好触发一次（重复组合不重复报）', () => {
    const dc = makeControls()
    let fired = 0
    dc.onImeKey = () => { fired++ }
    press({ key: 'Process', keyCode: 229 })
    expect(fired).toBe(1)
    press({ key: 'Process', keyCode: 229, isComposing: true }) // 后续组合键：去重
    press({ key: 'd', isComposing: true }) // 组合中的真实键值：同属组合，仍去重
    expect(fired).toBe(1)
  })

  it('常规按键（WASD/功能键）永不触发钩子', () => {
    const dc = makeControls()
    let fired = 0
    dc.onImeKey = () => { fired++ }
    for (const k of ['w', 'a', 's', 'd', 'shift', 'e', 'f', 'n', 'escape']) press({ key: k })
    expect(fired).toBe(0)
    // IME 事件之后常规键继续可用（keys 集合不受组合事件污染）
    press({ key: 'w' })
    expect(fired).toBe(0)
  })
})

describe('单击即产生移动输入（真机反馈 #5 契约：首次 keydown 必须立即驱动 input()）', () => {
  type Case = [key: string, field: 'forward' | 'strafe', sign: number]
  const cases: Case[] = [
    ['w', 'forward', 1], ['s', 'forward', -1], ['a', 'strafe', -1], ['d', 'strafe', 1],
  ]
  it.each(cases)('单次 keydown %s → input().%s 立即非零（无首击吞没）', (k, field, sign) => {
    const dc = makeControls()
    press({ key: k }) // 仅一次 keydown——「单击即动」
    expect(dc.input()[field]).toBe(sign)
    release({ key: k })
    expect(dc.input()[field]).toBe(0)
  })

  it('首次 keydown 即令控件 active（未激活状态不吞首击）', () => {
    const dc = makeControls()
    expect(dc.active).toBe(false)
    press({ key: 'd' })
    expect(dc.active).toBe(true)
    expect(dc.input().strafe).toBe(1)
  })
})
