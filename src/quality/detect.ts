/**
 * 设备分级探测（PRD §6）。
 * detectTier / qualityForTier 为纯函数（单测覆盖）；collectSignals 依赖 DOM。
 * 档位规则（满足任一即降档）：
 *  - 低：cores<=4 或 deviceMemory<=4GB 或 WebView 或 2g/3g 网络
 *  - 高：桌面 UA 或 WebGPU 可用
 *  - 其余：中（默认，覆盖主流安卓手机/平板）
 */

export type Tier = 'low' | 'mid' | 'high'

export interface DeviceSignals {
  hardwareConcurrency: number | undefined
  deviceMemory: number | undefined // navigator.deviceMemory，GB
  devicePixelRatio: number
  effectiveType: string | undefined // 'slow-2g'|'2g'|'3g'|'4g'
  isWebView: boolean
  isDesktop: boolean
  hasWebGPU: boolean
}

export interface QualitySettings {
  tier: Tier
  dprCap: number // renderer 像素比上限（平板高分屏红线：硬性 <= 2）
  shadows: boolean
  shadowMapSize: number
  sceneryLayers: 1 | 2 | 3
  sway: number // 车体晃动幅度系数（0 = 关）
  /** MSAA 开关：仅在构造 WebGLRenderer（上下文创建）时生效；
   * 运行时切档不重建上下文，故 MSAA 由初始档位决定，切换档位不改变它。 */
  antialias: boolean
  toneMapping: boolean
  fpsCap: number // 0 = 不限制
  textureScale: number // CanvasTexture 生成分辨率系数
}

const SLOW_NETWORKS = new Set(['slow-2g', '2g', '3g'])

export function detectTier(s: DeviceSignals): Tier {
  // 低档触发条件（满足任一即降档）
  if ((s.hardwareConcurrency ?? 8) <= 4) return 'low'
  if ((s.deviceMemory ?? 8) <= 4) return 'low'
  if (s.isWebView) return 'low'
  if (s.effectiveType !== undefined && SLOW_NETWORKS.has(s.effectiveType)) return 'low'
  // 高档：桌面 / WebGPU
  if (s.isDesktop || s.hasWebGPU) return 'high'
  return 'mid'
}

/** 档位 → 渲染预算。低档 dpr<=1.5、无阴影无后处理；中档 dpr<=2 + 512 阴影；高档全开。 */
export function qualityForTier(tier: Tier): QualitySettings {
  switch (tier) {
    case 'low':
      return {
        tier,
        dprCap: 1.5,
        shadows: false,
        shadowMapSize: 0,
        sceneryLayers: 1,
        sway: 0,
        antialias: false,
        toneMapping: false,
        fpsCap: 30,
        textureScale: 0.5,
      }
    case 'mid':
      return {
        tier,
        dprCap: 2,
        shadows: true,
        shadowMapSize: 512,
        sceneryLayers: 2,
        sway: 0.45,
        antialias: false,
        toneMapping: false,
        fpsCap: 30,
        textureScale: 0.75,
      }
    case 'high':
      return {
        tier,
        dprCap: 2, // 移动高分屏红线：即使高档也硬性 <= 2；桌面 dpr 通常 <= 2
        shadows: true,
        shadowMapSize: 1024,
        sceneryLayers: 3,
        sway: 1,
        antialias: true,
        toneMapping: true,
        fpsCap: 0,
        textureScale: 1,
      }
  }
}

export function clampDpr(dpr: number, cap: number): number {
  return Math.min(dpr, cap)
}

/**
 * 整档切换后的 dpr 决策（纯函数，vitest 覆盖）。两条路径：
 * - 自适应降档（keepCurrent=true）：维持或收紧当前值，绝不回抬——
 *   自适应已把 dpr 降到位时，切到上限更高的档也不得把 dpr 升回去，
 *   否则整档切换会抵消之前的 dpr 自适应降幅；仅当新档上限更低时进一步收紧。
 * - 手动选档（keepCurrent=false）：按新档上限重置（用户预期「切档即重置」）。
 */
export function dprAfterTierChange(
  currentDpr: number,
  deviceDpr: number,
  newCap: number,
  keepCurrent: boolean,
): number {
  const reset = clampDpr(deviceDpr, newCap)
  return keepCurrent ? Math.min(currentDpr, reset) : reset
}

/** 从真实环境采集信号（测试中用假 signals 替代）。 */
export function collectSignals(): DeviceSignals {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; saveData?: boolean }
    standalone?: boolean
  }
  const ua = nav.userAgent ?? ''
  // WebView 特征：微信/钉钉/飞书 等；桌面判定：无 touch + 传统 UA
  const isWebView = /micromessenger|dingtalk|lark|feishu|bytedance|snssdk/i.test(ua)
  const isDesktop =
    !('ontouchstart' in window) && /windows|macintosh|linux x86|cros/i.test(ua) && !/android|iphone|ipad/i.test(ua)
  const hasWebGPU = typeof (nav as Navigator & { gpu?: object }).gpu !== 'undefined'
  return {
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    devicePixelRatio: window.devicePixelRatio || 1,
    effectiveType: nav.connection?.effectiveType,
    isWebView,
    isDesktop,
    hasWebGPU,
  }
}
