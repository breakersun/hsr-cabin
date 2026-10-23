/**
 * 窗外世界（PRD §3.3 实现红线）：贴窗循环滚动物体 + 多层视差，严禁真实大场景。
 * - 近层：路基地带 + 高架桥面挡墙 + 桥墩 + 接触网电杆（节奏闪过，350km/h = 97.2m/s）
 * - 中层：农田色块（层 2）
 * - 远层：远山剪影 + 夜间城镇灯光（层 3）
 * - 周期隧道：60–120s 随机进入，窗外变暗，出隧道恢复
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { DayNightChannels } from '../interaction/dayNight'
import { mergeBufferGeometries } from './geo'

export type TunnelPhase = 'idle' | 'entering' | 'inside' | 'exiting'

const SPEED = 97.2 // 350 km/h → m/s
const POLE_SPACING = 55
const POLE_PER_SIDE = 9
const POLE_SPAN = POLE_PER_SIDE * POLE_SPACING
const PIER_SPACING = 42
const PIER_PER_SIDE = 9
const PIER_SPAN = PIER_PER_SIDE * PIER_SPACING
const AXIS_Y = new Vector3(0, 1, 0)

function tex(canvas: HTMLCanvasElement, repeatX: number): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(repeatX, 1)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearMipmapLinearFilter
  t.magFilter = LinearFilter
  t.anisotropy = 2
  return t
}

function canvas2d(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas2D 不可用')
  return { c, ctx }
}

function skyTexture(): CanvasTexture {
  const { c, ctx } = canvas2d(8, 256)
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#4d86c6')
  g.addColorStop(0.55, '#a8c6e4')
  g.addColorStop(1, '#e8eef2')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 8, 256)
  return tex(c, 1)
}

function groundTexture(scale: number): CanvasTexture {
  const w = Math.round(512 * scale)
  const h = Math.round(64 * scale)
  const { c, ctx } = canvas2d(w, h)
  ctx.fillStyle = '#6f7a52'
  ctx.fillRect(0, 0, w, h)
  const tones = ['#7d8a5c', '#66714a', '#8d9464', '#5c6844']
  for (let i = 0; i < w * 1.2; i++) {
    ctx.fillStyle = tones[i % 4] ?? '#777'
    ctx.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 2 + Math.random() * 3)
  }
  // 路基碎石带
  ctx.fillStyle = 'rgba(120,118,110,0.8)'
  ctx.fillRect(0, h * 0.35, w, h * 0.3)
  return tex(c, 6)
}

function fieldsTexture(scale: number): CanvasTexture {
  const w = Math.round(1024 * scale)
  const h = Math.round(256 * scale)
  const { c, ctx } = canvas2d(w, h)
  const palette = ['#7fa055', '#a8b45c', '#c9c06a', '#8fae62', '#b7a35f', '#6e9450', '#d1c075', '#96ae6a']
  const cols = 14
  const rows = 6
  const cw = w / cols
  const ch = h / rows
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)] ?? '#7fa055'
      ctx.fillRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2)
      ctx.fillStyle = 'rgba(90,80,50,0.25)'
      ctx.fillRect(i * cw, j * ch, cw, 1.5)
    }
  }
  ctx.fillStyle = '#c8bfae'
  for (let i = 0; i < 10; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 8, 3 + Math.random() * 5)
  }
  return tex(c, 3)
}

function mountainsTexture(scale: number): CanvasTexture {
  const w = Math.round(1024 * scale)
  const h = Math.round(256 * scale)
  const { c, ctx } = canvas2d(w, h)
  const layers = [
    { color: '#8aa3b8', base: 0.72, amp: 0.3 },
    { color: '#7590a8', base: 0.82, amp: 0.24 },
    { color: '#5f7d99', base: 0.92, amp: 0.2 },
  ]
  for (const L of layers) {
    ctx.fillStyle = L.color
    ctx.beginPath()
    ctx.moveTo(0, h)
    ctx.lineTo(0, h * L.base)
    let x = 0
    while (x < w) {
      const step = w / (6 + Math.random() * 8)
      const midY = h * (L.base - L.amp * Math.random() * 1.2)
      const nY = h * (L.base - L.amp * Math.random())
      ctx.quadraticCurveTo(x + step / 2, midY, x + step, nY)
      x += step
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
  return tex(c, 2)
}

function townLightsTexture(scale: number): CanvasTexture {
  const w = Math.round(1024 * scale)
  const h = Math.round(128 * scale)
  const { c, ctx } = canvas2d(w, h)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  const colors = ['#ffd9a0', '#ffe9c8', '#cfe0ff', '#ffc37a']
  for (let i = 0; i < w / 4; i++) {
    const cx = Math.random() * w
    const cy = h * 0.55 + Math.random() * h * 0.4
    const n = 3 + Math.random() * 10
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)] ?? '#ffd9a0'
      ctx.fillRect(cx + (Math.random() - 0.5) * 30, cy + (Math.random() - 0.5) * 16, 1.5, 1.5)
    }
  }
  return tex(c, 2)
}

function tunnelTexture(scale: number): CanvasTexture {
  const w = Math.round(512 * scale)
  const h = Math.round(256 * scale)
  const { c, ctx } = canvas2d(w, h)
  ctx.fillStyle = '#3a3c40'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < w; i += 3) {
    const v = 20 + Math.random() * 30
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.35)`
    ctx.fillRect(i, 0, 2, h)
  }
  ctx.fillStyle = '#ffe2b0'
  for (let i = 0; i < 8; i++) {
    ctx.fillRect((i * w) / 8 + 12, h * 0.18, 14, 4)
    ctx.fillRect((i * w) / 8 + 12, h * 0.78, 14, 4)
  }
  return tex(c, 8)
}

export interface TunnelInfo {
  phase: TunnelPhase
  amount: number
  timer: number
}

function wrap(v: number, span: number): number {
  return ((v % span) + span) % span
}

export class WindowWorld {
  group = new Group()
  tunnel: TunnelInfo = { phase: 'idle', amount: 0, timer: 30 + Math.random() * 30 } // 首次进入隧道前的等待
  private scroll = 0
  private poleMesh: InstancedMesh
  private pierMesh: InstancedMesh
  private tubeMesh: Mesh
  private skyMat: MeshBasicMaterial
  private groundMat: MeshBasicMaterial
  private deckMat: MeshBasicMaterial
  private fieldMat: MeshBasicMaterial
  private fieldMesh: Mesh
  private mountainMat: MeshBasicMaterial
  private mountainMesh: Mesh
  private townMat: MeshBasicMaterial
  private townMesh: Mesh
  private tunnelMat: MeshStandardMaterial
  private mTmp = new Matrix4()
  private posTmp = new Vector3()
  private quatTmp = new Quaternion()
  private scaleOne = new Vector3(1, 1, 1)
  private disposables: CanvasTexture[] = []
  private tmpColor = new Color()

  constructor(textureScale: number, public layers: 1 | 2 | 3) {
    // ---- 天空穹顶 ----
    const skyTex = skyTexture()
    this.disposables.push(skyTex)
    this.skyMat = new MeshBasicMaterial({ map: skyTex, side: BackSide, fog: false })
    const dome = new Mesh(new CylinderGeometry(95, 95, 60, 24, 1, true), this.skyMat)
    dome.position.y = 16
    this.group.add(dome)

    // ---- 近层：路基地带 + 高架桥面挡墙（双侧合并为单 mesh）----
    const groundTex = groundTexture(textureScale)
    groundTex.repeat.set(3, 1)
    this.disposables.push(groundTex)
    this.groundMat = new MeshBasicMaterial({ map: groundTex, fog: false })
    const stripGeo = mergeBufferGeometries([
      new BoxGeometry(0.2, 4.5, 400).translate(-8.2, 0.4, 0),
      new BoxGeometry(0.2, 4.5, 400).translate(8.2, 0.4, 0),
    ])
    this.group.add(new Mesh(stripGeo, this.groundMat))
    this.deckMat = new MeshBasicMaterial({ color: 0x9d9a92, fog: false })
    const deckGeo = mergeBufferGeometries([
      new BoxGeometry(0.25, 0.8, 400).translate(-4.3, -1.1, 0),
      new BoxGeometry(0.25, 0.8, 400).translate(4.3, -1.1, 0),
    ])
    this.group.add(new Mesh(deckGeo, this.deckMat))

    // ---- 中层：农田色块（层 2+）----
    const fieldsTex = fieldsTexture(textureScale)
    fieldsTex.repeat.set(3, 1)
    this.disposables.push(fieldsTex)
    this.fieldMat = new MeshBasicMaterial({ map: fieldsTex, fog: false })
    const fieldGeo = mergeBufferGeometries([
      new BoxGeometry(0.4, 26, 520).translate(-52, 6, 0),
      new BoxGeometry(0.4, 26, 520).translate(52, 6, 0),
    ])
    this.fieldMesh = new Mesh(fieldGeo, this.fieldMat)
    this.fieldMesh.visible = this.layers >= 2
    this.group.add(this.fieldMesh)

    // ---- 远层：远山 + 夜间城镇灯光（层 3）----
    const mtnTex = mountainsTexture(textureScale)
    mtnTex.repeat.set(2, 1)
    this.disposables.push(mtnTex)
    this.mountainMat = new MeshBasicMaterial({ map: mtnTex, transparent: true, fog: false })
    const mtnGeo = mergeBufferGeometries([
      new BoxGeometry(0.6, 46, 900).translate(-150, 12, 0),
      new BoxGeometry(0.6, 46, 900).translate(150, 12, 0),
    ])
    this.mountainMesh = new Mesh(mtnGeo, this.mountainMat)
    this.mountainMesh.visible = this.layers >= 3
    this.group.add(this.mountainMesh)
    const townTex = townLightsTexture(textureScale)
    this.disposables.push(townTex)
    this.townMat = new MeshBasicMaterial({
      map: townTex,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    const townGeo = mergeBufferGeometries([
      new BoxGeometry(0.5, 18, 700).translate(-95, 7, 0),
      new BoxGeometry(0.5, 18, 700).translate(95, 7, 0),
    ])
    this.townMesh = new Mesh(townGeo, this.townMat)
    this.townMesh.visible = this.layers >= 3
    this.group.add(this.townMesh)

    // ---- 接触网电杆 + 悬臂（速度感核心视觉）----
    const mastGeo = new BoxGeometry(0.14, 8.5, 0.14)
    mastGeo.translate(0, 3.25, 0)
    const armGeo = new BoxGeometry(1.9, 0.09, 0.09)
    armGeo.translate(-0.95, 5.1, 0) // 悬臂与杆合并为单 InstancedMesh（同材质）
    this.poleMesh = new InstancedMesh(
      mergeBufferGeometries([mastGeo, armGeo]),
      new MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.7, metalness: 0.3 }),
      POLE_PER_SIDE * 2,
    )
    this.poleMesh.frustumCulled = false
    this.group.add(this.poleMesh)

    // ---- 高架桥墩 ----
    this.pierMesh = new InstancedMesh(
      new BoxGeometry(1.1, 16, 1.1),
      new MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.85 }),
      PIER_PER_SIDE * 2,
    )
    this.pierMesh.frustumCulled = false
    this.group.add(this.pierMesh)

    // ---- 隧道管 ----
    const tunTex = tunnelTexture(textureScale)
    this.disposables.push(tunTex)
    this.tunnelMat = new MeshStandardMaterial({
      map: tunTex,
      side: BackSide,
      transparent: true,
      opacity: 0,
      roughness: 0.9,
    })
    this.tubeMesh = new Mesh(new CylinderGeometry(7.2, 7.2, 190, 20, 1, true), this.tunnelMat)
    this.tubeMesh.rotation.x = Math.PI / 2
    this.tubeMesh.visible = false
    this.group.add(this.tubeMesh)
  }

  /** 画质档变化时调整可见层数。 */
  setLayers(n: 1 | 2 | 3): void {
    this.layers = n
    this.fieldMesh.visible = n >= 2
    this.mountainMesh.visible = n >= 3
    this.townMesh.visible = n >= 3
  }

  update(dt: number, ch: DayNightChannels): void {
    this.scroll += SPEED * dt

    // ---- 隧道状态机：等待 60–120s（首次提前）→ 进入 → 持续 6–12s → 退出 ----
    const T = this.tunnel
    switch (T.phase) {
      case 'idle':
        T.timer -= dt
        if (T.timer <= 0) T.phase = 'entering'
        break
      case 'entering':
        T.amount = Math.min(1, T.amount + dt / 1.4)
        if (T.amount >= 1) {
          T.phase = 'inside'
          T.timer = 6 + Math.random() * 6
        }
        break
      case 'inside':
        T.timer -= dt
        if (T.timer <= 0) T.phase = 'exiting'
        break
      case 'exiting':
        T.amount = Math.max(0, T.amount - dt / 1.4)
        if (T.amount <= 0) {
          T.phase = 'idle'
          T.timer = 60 + Math.random() * 60
        }
        break
    }

    // ---- 亮度合成：昼夜 × 隧道 ----
    const bright = Math.max(0.02, ch.windowWorld * (1 - T.amount * 0.96))
    this.tmpColor.setScalar(bright)
    this.skyMat.color.copy(this.tmpColor).multiplyScalar(1.15)
    this.groundMat.color.copy(this.tmpColor)
    this.deckMat.color.copy(this.tmpColor)
    this.fieldMat.color.copy(this.tmpColor)
    this.mountainMat.color.copy(this.tmpColor)
    this.townMat.opacity = ch.townLights * (1 - T.amount)
    this.townMesh.visible = this.layers >= 3 && this.townMat.opacity > 0.01
    this.poleMesh.visible = bright > 0.25

    // ---- 隧道管 ----
    this.tubeMesh.visible = T.amount > 0.01
    this.tunnelMat.opacity = T.amount

    // ---- 贴图滚动（各层视差系数 = 距离反比）----
    if (this.groundMat.map) this.groundMat.map.offset.x = -(this.scroll / 400) * 3
    if (this.fieldMat.map) this.fieldMat.map.offset.x = -(this.scroll / 520) * 3 * 0.55
    if (this.mountainMat.map) this.mountainMat.map.offset.x = -(this.scroll / 900) * 2 * 0.2
    if (this.townMat.map) this.townMat.map.offset.x = -(this.scroll / 700) * 0.6
    if (this.tunnelMat.map) this.tunnelMat.map.offset.x = -(this.scroll / 190) * 8

    // ---- 电杆/悬臂回收滚动 ----
    let i = 0
    for (const side of [-1, 1]) {
      this.quatTmp.setFromAxisAngle(AXIS_Y, side === 1 ? Math.PI : 0) // 右侧悬臂镜像朝内
      for (let k = 0; k < POLE_PER_SIDE; k++) {
        const z = wrap(k * POLE_SPACING - this.scroll, POLE_SPAN) - POLE_SPAN / 2
        this.mTmp.compose(this.posTmp.set(side * 6.2, -0.6, z), this.quatTmp, this.scaleOne)
        this.poleMesh.setMatrixAt(i, this.mTmp)
        i++
      }
    }
    this.poleMesh.instanceMatrix.needsUpdate = true

    // ---- 桥墩滚动 ----
    i = 0
    for (const side of [-1, 1]) {
      for (let k = 0; k < PIER_PER_SIDE; k++) {
        const z = wrap(k * PIER_SPACING - this.scroll, PIER_SPAN) - PIER_SPAN / 2
        this.mTmp.compose(this.posTmp.set(side * 4.0, -9.2, z), this.quatTmp, this.scaleOne)
        this.pierMesh.setMatrixAt(i, this.mTmp)
        i++
      }
    }
    this.pierMesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    for (const t of this.disposables) t.dispose()
  }
}
