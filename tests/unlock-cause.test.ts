import { describe, expect, it } from 'vitest'
import { classifyUnlock } from '../src/controls/desktop'

/**
 * 解锁归因判别（真机反馈 #4）：良性失焦（切窗/截图热键）不该按错误报警，
 * 页面可见且聚焦下自发释放才是真异常（疑似「标签页消失」前驱事件）。
 */

describe('classifyUnlock 解锁归因', () => {
  it('本来就没锁定 → null（无事件可归因）', () => {
    expect(classifyUnlock(false, 9999, true, true)).toBeNull()
    expect(classifyUnlock(false, 0, false, false)).toBeNull()
  })

  it('ESC 窗口内（≤150ms）→ escape（用户主动，优先于一切旁证）', () => {
    expect(classifyUnlock(true, 0, true, true)).toBe('escape')
    expect(classifyUnlock(true, 150, true, true)).toBe('escape') // 边界含端
    // ESC 后瞬间切窗：仍归 escape（两种都良性，无需细分）
    expect(classifyUnlock(true, 100, false, false)).toBe('escape')
  })

  it('超出 ESC 窗口 + 页面已隐藏或失焦 → blur（良性，不报警不落盘）', () => {
    expect(classifyUnlock(true, 151, false, true)).toBe('blur') // 切标签页（hidden）
    expect(classifyUnlock(true, 9999, true, false)).toBe('blur') // 窗口失焦（截图热键/点别的窗）
    expect(classifyUnlock(true, 9999, false, false)).toBe('blur') // 两者皆失
    expect(classifyUnlock(true, 150.5, false, false)).toBe('blur') // 刚过窗口即失焦
  })

  it('超出 ESC 窗口 + 页面可见且聚焦 → unexpected（真异常：报警+落盘）', () => {
    expect(classifyUnlock(true, 151, true, true)).toBe('unexpected')
    expect(classifyUnlock(true, 60_000, true, true)).toBe('unexpected') // 长时间浏览后自发释放
  })
})
