/**
 * 程序化贴图与共享材质（PRD §1.2 纯程序化红线：零外部资产，全部 CanvasTexture）。
 * 贴图分辨率随画质档 textureScale 缩放。
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

export interface MaterialLibrary {
  floor: MeshStandardMaterial
  ceiling: MeshStandardMaterial
  wallLower: MeshStandardMaterial
  wallUpper: MeshStandardMaterial
  pillar: MeshStandardMaterial
  glass: MeshStandardMaterial
  curtain: MeshStandardMaterial
  seatFabric: MeshStandardMaterial
  seatFrame: MeshStandardMaterial
  headrest: MeshStandardMaterial
  armrest: MeshStandardMaterial
  tray: MeshStandardMaterial
  metal: MeshStandardMaterial
  darkPanel: MeshStandardMaterial
  luggageRack: MeshStandardMaterial
  stripOn: MeshStandardMaterial // 顶板灯带（emissive 动态调）
  stripDim: MeshStandardMaterial
  livery: MeshStandardMaterial // 外侧金红飘带（致敬意象）
  dispose(): void
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas2D 不可用')
  return { canvas, ctx }
}

function toTexture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): CanvasTexture {
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(repeatX, repeatY)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 2
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  return tex
}

/** 噪点底（织物/地毯通用） */
function noiseFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  speckles: string[],
  density: number,
): void {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < w * h * density; i++) {
    ctx.fillStyle = speckles[i % speckles.length] ?? '#000'
    const x = Math.random() * w
    const y = Math.random() * h
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random())
  }
}

/** 织物纹（座椅）：斜纹 + 噪点 */
function fabricTexture(scale: number): CanvasTexture {
  const s = Math.round(256 * scale)
  const { canvas, ctx } = makeCanvas(s, s)
  noiseFill(ctx, s, s, '#4a5b74', ['#40506a', '#55688a', '#3a4a62'], 0.18)
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'
  ctx.lineWidth = 1
  for (let i = -s; i < s * 2; i += 5) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + s, s)
    ctx.stroke()
  }
  return toTexture(canvas, 2, 2)
}

/** 地毯纹：青灰底 + 点阵 */
function carpetTexture(scale: number): CanvasTexture {
  const s = Math.round(256 * scale)
  const { canvas, ctx } = makeCanvas(s, s)
  noiseFill(ctx, s, s, '#3d4652', ['#343d48', '#48535f', '#2f3742'], 0.3)
  ctx.fillStyle = 'rgba(140,150,160,0.08)'
  for (let y = 4; y < s; y += 12) {
    for (let x = 4; x < s; x += 12) ctx.fillRect(x, y, 3, 3)
  }
  return toTexture(canvas, 5, 26)
}

/** 墙板：暖白细腻纹 */
function wallTexture(scale: number): CanvasTexture {
  const s = Math.round(128 * scale)
  const { canvas, ctx } = makeCanvas(s, s)
  noiseFill(ctx, s, s, '#e7e3da', ['#e0dbd1', '#eeeae2', '#dcd6ca'], 0.22)
  return toTexture(canvas, 3, 2)
}

/** 拉丝金属（开水机/门套） */
function brushedTexture(scale: number): CanvasTexture {
  const s = Math.round(128 * scale)
  const { canvas, ctx } = makeCanvas(s, s)
  ctx.fillStyle = '#b9bec4'
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < s * 3; i++) {
    const y = Math.random() * s
    ctx.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.06})`
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(s, y + (Math.random() - 0.5) * 2)
    ctx.stroke()
  }
  return toTexture(canvas, 1, 2)
}

/** 外侧金红飘带（中国标准动车组风格致敬意象，无官方标识） */
function liveryTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 128)
  const grad = ctx.createLinearGradient(0, 0, 64, 0)
  grad.addColorStop(0, '#c9a15a')
  grad.addColorStop(0.55, '#c9813a')
  grad.addColorStop(1, '#b01e24')
  ctx.fillStyle = grad
  ctx.fillRect(0, 40, 64, 30)
  ctx.fillStyle = '#b01e24'
  ctx.fillRect(0, 72, 64, 6)
  ctx.fillStyle = '#e8e6e0'
  ctx.fillRect(0, 0, 64, 40)
  ctx.fillRect(0, 78, 64, 50)
  return toTexture(canvas, 1, 1)
}

export function buildMaterials(textureScale: number): MaterialLibrary {
  const fabricTex = fabricTexture(textureScale)
  const carpetTex = carpetTexture(textureScale)
  const wallTex = wallTexture(textureScale)
  const wall2 = wallTex.clone()
  wall2.needsUpdate = true
  const metalTex = brushedTexture(textureScale)
  const liveryTex = liveryTexture()

  const mats = {
    floor: new MeshStandardMaterial({ map: carpetTex, roughness: 0.95, metalness: 0 }),
    ceiling: new MeshStandardMaterial({ map: wall2, color: 0xf4f1ea, roughness: 0.9, metalness: 0 }),
    wallLower: new MeshStandardMaterial({ map: wallTex, color: 0xd9d4c8, roughness: 0.85, metalness: 0 }),
    wallUpper: new MeshStandardMaterial({ map: wallTex, color: 0xe7e3da, roughness: 0.85, metalness: 0 }),
    pillar: new MeshStandardMaterial({ color: 0xded9cd, roughness: 0.7, metalness: 0.05 }),
    glass: new MeshStandardMaterial({
      color: 0x9fc4cc,
      transparent: true,
      opacity: 0.16,
      roughness: 0.08,
      metalness: 0.3,
      depthWrite: false,
    }),
    curtain: new MeshStandardMaterial({ color: 0xcfd4d9, roughness: 0.9, metalness: 0, side: 2 }),
    seatFabric: new MeshStandardMaterial({ map: fabricTex, roughness: 0.92, metalness: 0 }),
    seatFrame: new MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.4 }),
    headrest: new MeshStandardMaterial({ color: 0xe8e5de, roughness: 0.9, metalness: 0 }),
    armrest: new MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.35, metalness: 0.8 }),
    tray: new MeshStandardMaterial({ color: 0x3c4148, roughness: 0.5, metalness: 0.15 }),
    metal: new MeshStandardMaterial({ map: metalTex, color: 0xccced2, roughness: 0.3, metalness: 0.85 }),
    darkPanel: new MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8, metalness: 0.1 }),
    luggageRack: new MeshStandardMaterial({ color: 0xb6bbc2, roughness: 0.5, metalness: 0.55 }),
    stripOn: new MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffe9c4, emissiveIntensity: 1, roughness: 0.4 }),
    stripDim: new MeshStandardMaterial({ color: 0xd8d4c8, emissive: 0x554e40, emissiveIntensity: 0.4, roughness: 0.5 }),
    livery: new MeshStandardMaterial({ map: liveryTex, roughness: 0.35, metalness: 0.3 }),
  }

  return {
    ...mats,
    dispose(): void {
      for (const m of Object.values(mats)) {
        m.map?.dispose()
        m.dispose()
      }
    },
  } as MaterialLibrary
}
