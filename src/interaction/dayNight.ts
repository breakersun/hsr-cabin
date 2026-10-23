/**
 * 昼夜切换状态（PRD §5：切换 < 1s 生效）。
 * 纯数值插值（vitest 覆盖），场景层把各通道映射到灯光强度 / 材质颜色 / 窗外景亮度。
 */

export type TimeOfDay = 'day' | 'night'

/** 各光照/视觉通道在昼夜两端的取值。 */
export interface DayNightChannels {
  /** 环境半球光 */
  ambient: number
  /** 窗外太阳方向光 */
  sun: number
  /** 车顶灯带 emissive 强度 */
  strips: number
  /** 室内点光 */
  cabinPoint: number
  /** LED 信息屏 emissive */
  screen: number
  /** 窗外景（天空/田野/电杆）亮度倍率 */
  windowWorld: number
  /** 夜间城镇灯光/星星透明度 */
  townLights: number
  /** 窗玻璃内反射层透明度 */
  glassReflect: number
}

export const DAY_CHANNELS: DayNightChannels = {
  ambient: 0.85,
  sun: 1.1,
  strips: 0.55,
  cabinPoint: 0.35,
  screen: 0.8,
  windowWorld: 1,
  townLights: 0,
  glassReflect: 0.05,
}

export const NIGHT_CHANNELS: DayNightChannels = {
  ambient: 0.3,
  sun: 0,
  strips: 1.7,
  cabinPoint: 0.9,
  screen: 1.6,
  windowWorld: 0.12,
  townLights: 1,
  glassReflect: 0.45,
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class DayNightController {
  mode: TimeOfDay = 'day'
  /** 0 = 白天，1 = 夜晚（往返过渡中） */
  blend = 0
  transitioning = false

  constructor(public durationSec = 0.8) {}

  toggle(): void {
    this.mode = this.mode === 'day' ? 'night' : 'day'
    this.transitioning = true
  }

  set(mode: TimeOfDay): void {
    if (this.mode !== mode) this.toggle()
  }

  update(dtSec: number): void {
    if (!this.transitioning) return
    const target = this.mode === 'night' ? 1 : 0
    const step = dtSec / this.durationSec
    if (this.blend < target) this.blend = Math.min(target, this.blend + step)
    else this.blend = Math.max(target, this.blend - step)
    if (this.blend === target) this.transitioning = false
  }

  get isNight(): boolean {
    return this.blend >= 0.5
  }

  /** 过渡是否已完成（供闲置检测：过渡中不算静止）。 */
  get isAnimating(): boolean {
    return this.transitioning
  }

  /** 当前各通道插值。 */
  sample(): DayNightChannels {
    const t = this.blend
    return {
      ambient: lerp(DAY_CHANNELS.ambient, NIGHT_CHANNELS.ambient, t),
      sun: lerp(DAY_CHANNELS.sun, NIGHT_CHANNELS.sun, t),
      strips: lerp(DAY_CHANNELS.strips, NIGHT_CHANNELS.strips, t),
      cabinPoint: lerp(DAY_CHANNELS.cabinPoint, NIGHT_CHANNELS.cabinPoint, t),
      screen: lerp(DAY_CHANNELS.screen, NIGHT_CHANNELS.screen, t),
      windowWorld: lerp(DAY_CHANNELS.windowWorld, NIGHT_CHANNELS.windowWorld, t),
      townLights: lerp(DAY_CHANNELS.townLights, NIGHT_CHANNELS.townLights, t),
      glassReflect: lerp(DAY_CHANNELS.glassReflect, NIGHT_CHANNELS.glassReflect, t),
    }
  }
}
