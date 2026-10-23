import { describe, expect, it } from 'vitest'
import { tapSpreadNdc } from '../src/interaction/pick'

/** MAJOR 3 回归：移动端拾取热区必须两轴 ≥48 物理像素。
 *  旧实现固定 0.03 NDC，在 390×844 竖屏上仅约 12×25px。 */
describe('tapSpreadNdc 拾取热区换算', () => {
  const pxOf = (ndc: number, len: number): number => (ndc * len) / 2

  it('390×844 竖屏：两轴热区均 ≥48px', () => {
    const sp = tapSpreadNdc(390, 844)
    expect(sp.x).toBeCloseTo((48 * 2) / 390, 6)
    expect(sp.y).toBeCloseTo((48 * 2) / 844, 6)
    expect(pxOf(sp.x, 390)).toBeGreaterThanOrEqual(48)
    expect(pxOf(sp.y, 844)).toBeGreaterThanOrEqual(48)
  })

  it('1280×800 桌面：两轴热区均 ≥48px', () => {
    const sp = tapSpreadNdc(1280, 800)
    expect(pxOf(sp.x, 1280)).toBeGreaterThanOrEqual(48)
    expect(pxOf(sp.y, 800)).toBeGreaterThanOrEqual(48)
  })

  it('旧实现反例：固定 0.03 NDC 在竖屏窄轴上不足 48px（本修复的动机）', () => {
    expect(pxOf(0.03, 390)).toBeLessThan(48)
  })

  it('退化输入（0 尺寸）不产生 NaN/Infinity', () => {
    const sp = tapSpreadNdc(0, 0)
    expect(Number.isFinite(sp.x)).toBe(true)
    expect(Number.isFinite(sp.y)).toBe(true)
  })
})
