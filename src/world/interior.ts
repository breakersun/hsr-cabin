/**
 * 客室内饰：开放式行李架+装饰行李、窗帘（下拉式）、阅读灯、大件行李存放区、
 * 开水机（点击出热水动画+蒸汽）、灭火器/垃圾桶等固定道具。
 */

import {
  AdditiveBlending,
  DynamicDrawUsage,
  BoxGeometry,
  CanvasTexture,
  Clock,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import { makeAabb, type AABB } from '../physics/collision'
import { BoilerMachine, CurtainMachine } from '../interaction/machines'
import { WINDOW_BAYS } from './cabin'
import type { MaterialLibrary } from './materials'
import { mergeBufferGeometries, mergedBoxMesh, type BoxSpec } from './geo'

export interface CurtainRef {
  index: number
  side: -1 | 1
  z: number
  machine: CurtainMachine
}

export interface LampRef {
  index: number
  side: -1 | 1
  z: number
  on: boolean
}

const DEG = Math.PI / 180

function steamTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas2D 不可用')
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new CanvasTexture(c)
  tex.magFilter = LinearFilter
  return tex
}

export class Interior {
  group = new Group()
  colliders: AABB[] = []
  curtains: CurtainRef[] = []
  lamps: LampRef[] = []
  boiler = new BoilerMachine()
  boilerPos = { x: -1.32, y: 1.0, z: -2.0 }

  private curtainMesh!: InstancedMesh
  private lampDiscMesh!: InstancedMesh
  private lampConeMesh!: InstancedMesh
  private boilerBody!: Mesh
  private cup!: Mesh
  private water!: Mesh
  private ledMat!: MeshStandardMaterial
  private buttonMat!: MeshStandardMaterial
  private steam: Sprite[] = []
  private steamClock = new Clock(false)
  private lampScale = new Map<number, number>() // 目标缩放插值
  private mTmp = new Matrix4()
  private posTmp = new Vector3()
  private quatTmp = new Quaternion()
  private scaleTmp = new Vector3()
  private lampOnColor = new Color(2.0, 1.65, 1.0)
  private lampOffColor = new Color(0.12, 0.12, 0.12)
  private dirtyCurtains = new Set<number>()
  private steamTex!: CanvasTexture

  constructor(mats: MaterialLibrary, public shadows: boolean) {
    this.buildLuggageRacks(mats)
    this.buildCurtains(mats)
    this.buildLamps(mats)
    this.buildBigLuggage(mats)
    this.buildBoiler(mats)
    this.buildProps(mats)
    this.steamTex = steamTexture()
    for (let i = 0; i < 3; i++) {
      const sm = new SpriteMaterial({
        map: this.steamTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      })
      const s = new Sprite(sm)
      s.scale.set(0.14, 0.14, 1)
      s.position.set(this.boilerPos.x + 0.24, this.boilerPos.y - 0.28, this.boilerPos.z)
      this.group.add(s)
      this.steam.push(s)
    }
  }

  /** 开放式行李架（无门，PRD 与飞机差异点）+ 少量装饰行李 */
  private buildLuggageRacks(mats: MaterialLibrary): void {
    const specs: BoxSpec[] = []
    const zMid = (8.7 + -1.3) / 2
    const len = 8.7 - -1.3
    for (const side of [-1, 1]) {
      const x = side * 1.3
      specs.push(
        { w: 0.44, h: 0.05, d: len, x, y: 1.9, z: zMid }, // 架板
        { w: 0.03, h: 0.1, d: len, x: side * 1.09, y: 1.87, z: zMid }, // 前沿挡条
      )
      for (const bz of [8.4, 4.2, 0.4, -1.0]) {
        specs.push({ w: 0.05, h: 0.42, d: 0.05, x: side * 1.5, y: 1.68, z: bz }) // 壁挂支架
      }
    }
    const rack = mergedBoxMesh(specs, mats.luggageRack)
    this.group.add(rack) // 高位薄板：不开阴影（省 shadow pass）

    // 装饰行李（InstancedMesh + 每实例颜色）
    const sizes: [number, number, number][] = [
      [0.55, 0.34, 0.26],
      [0.4, 0.28, 0.22],
      [0.6, 0.4, 0.3],
      [0.34, 0.24, 0.2],
      [0.5, 0.32, 0.24],
      [0.44, 0.3, 0.22],
      [0.58, 0.36, 0.28],
      [0.36, 0.26, 0.2],
    ]
    const colors = [0x5a6a7a, 0x7a4a3a, 0x3f5a44, 0x6a5a7a, 0x8a8a72, 0x44546a]
    const geo = new BoxGeometry(1, 1, 1)
    const bags = new InstancedMesh(geo, new MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }), sizes.length)
    const q = new Quaternion()
    const c = new Color()
    sizes.forEach((s, i) => {
      const side = i % 2 === 0 ? -1 : 1
      const z = 7.6 - Math.floor(i / 2) * 1.9
      q.setFromAxisAngle(new Vector3(0, 1, 0), (Math.random() - 0.5) * 0.5)
      this.mTmp.compose(this.posTmp.set(side * 1.32, 1.925 + s[1] / 2, z), q, this.scaleTmp.set(s[0], s[1], s[2]))
      bags.setMatrixAt(i, this.mTmp)
      bags.setColorAt(i, c.setHex(colors[i % colors.length] ?? 0x555555))
    })
    this.group.add(bags) // 行李架上方：不开阴影
  }

  /** 每窗一副下拉窗帘（InstancedMesh，从顶部展开） */
  private buildCurtains(mats: MaterialLibrary): void {
    const cassetteSpecs: BoxSpec[] = []
    let idx = 0
    for (const side of [-1, 1]) {
      for (const bay of WINDOW_BAYS) {
        cassetteSpecs.push({ w: 0.06, h: 0.07, d: 1.64, x: side * 1.6, y: 1.78, z: bay.z })
        this.curtains.push({ index: idx++, side: side as -1 | 1, z: bay.z, machine: new CurtainMachine() })
        this.dirtyCurtains.add(idx - 1)
      }
    }
    this.group.add(mergedBoxMesh(cassetteSpecs, mats.luggageRack))
    const geo = new BoxGeometry(0.024, 1, 1.58)
    geo.translate(0.012, -0.5, 0) // 顶部铰点
    this.curtainMesh = new InstancedMesh(geo, mats.curtain, this.curtains.length)
    this.curtainMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.group.add(this.curtainMesh)
  }

  /** 每个 window bay 一盏阅读灯（行李架下沿）：点击开关，灯盘发光 + 体积光锥 */
  private buildLamps(mats: MaterialLibrary): void {
    const fixtureSpecs: BoxSpec[] = []
    let idx = 0
    for (const side of [-1, 1]) {
      for (const bay of WINDOW_BAYS) {
        fixtureSpecs.push({ w: 0.3, h: 0.05, d: 0.1, x: side * 1.34, y: 1.855, z: bay.z })
        this.lamps.push({ index: idx++, side: side as -1 | 1, z: bay.z, on: false })
        this.lampScale.set(idx - 1, 0)
      }
    }
    this.group.add(mergedBoxMesh(fixtureSpecs, mats.darkPanel))

    const discGeo = new BoxGeometry(0.22, 0.02, 0.07)
    this.lampDiscMesh = new InstancedMesh(
      discGeo,
      new MeshBasicMaterial({ color: 0xffffff }),
      this.lamps.length,
    )
    const coneGeo = new ConeGeometry(0.17, 0.62, 12, 1, true)
    coneGeo.translate(0, -0.31, 0) // 顶点在原点
    this.lampConeMesh = new InstancedMesh(
      coneGeo,
      new MeshBasicMaterial({
        color: 0xffd890,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      this.lamps.length,
    )
    for (const m of [this.lampDiscMesh, this.lampConeMesh]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage)
      this.group.add(m)
    }
    this.refreshLampMatrices()
  }

  private refreshLampMatrices(): void {
    for (const lamp of this.lamps) {
      const s = this.lampScale.get(lamp.index) ?? 0
      // 灯盘
      this.quatTmp.identity()
      this.mTmp.compose(
        this.posTmp.set(lamp.side * 1.34, 1.83, lamp.z),
        this.quatTmp,
        this.scaleTmp.set(1, 1, 1),
      )
      this.lampDiscMesh.setMatrixAt(lamp.index, this.mTmp)
      this.lampDiscMesh.setColorAt(
        lamp.index,
        lamp.on ? this.lampOnColor : this.lampOffColor,
      )
      // 光锥（向车内下倾 22°）
      this.quatTmp.setFromAxisAngle(new Vector3(0, 0, 1), lamp.side * 22 * DEG)
      this.mTmp.compose(
        this.posTmp.set(lamp.side * 1.34, 1.825, lamp.z),
        this.quatTmp,
        this.scaleTmp.set(s, s, s),
      )
      this.lampConeMesh.setMatrixAt(lamp.index, this.mTmp)
    }
    this.lampDiscMesh.instanceMatrix.needsUpdate = true
    if (this.lampDiscMesh.instanceColor) this.lampDiscMesh.instanceColor.needsUpdate = true
    this.lampConeMesh.instanceMatrix.needsUpdate = true
  }

  toggleLamp(index: number): void {
    const lamp = this.lamps[index]
    if (!lamp) return
    lamp.on = !lamp.on
    this.refreshLampMatrices()
  }

  /** 大件行李存放区（后部右侧） */
  private buildBigLuggage(mats: MaterialLibrary): void {
    const specs: BoxSpec[] = []
    const zMid = -5.0
    const len = 3.2
    specs.push(
      { w: 0.06, h: 0.06, d: len, x: 1.58, y: 0.85, z: zMid }, // 挡杆
      { w: 0.06, h: 0.85, d: 0.06, x: 1.58, y: 0.42, z: zMid - len / 2 },
      { w: 0.06, h: 0.85, d: 0.06, x: 1.58, y: 0.42, z: zMid + len / 2 },
    )
    this.group.add(mergedBoxMesh(specs, mats.metal))
    // 大件行李箱（装饰）
    const suitGeo = new BoxGeometry(1, 1, 1)
    const suit = new InstancedMesh(
      suitGeo,
      new MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }),
      5,
    )
    const sizes: [number, number, number][] = [
      [0.42, 0.62, 0.26],
      [0.36, 0.54, 0.24],
      [0.46, 0.68, 0.28],
      [0.3, 0.44, 0.22],
      [0.4, 0.3, 0.26],
    ]
    const c = new Color()
    const q = new Quaternion()
    sizes.forEach((s, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), (i % 2 === 0 ? 1 : -1) * 0.12)
      this.mTmp.compose(
        this.posTmp.set(1.35 - (i % 2) * 0.1, s[1] / 2 + (i === 4 ? 0.62 : 0), -6.2 + i * 0.62),
        q,
        this.scaleTmp.set(s[0], s[1], s[2]),
      )
      suit.setMatrixAt(i, this.mTmp)
      suit.setColorAt(i, c.setHex([0x39516b, 0x6b3939, 0x39543b, 0x514061, 0x2f2f34][i] ?? 0x444444))
    })
    this.group.add(suit) // 贴墙大件：不开阴影
    this.colliders.push(makeAabb(1.05, 0.6, zMid, 0.62, 0.6, len / 2 + 0.15))
  }

  /** 开水机：点击 → 出热水动画（水位上升 + 蒸汽 + LED 变化） */
  private buildBoiler(mats: MaterialLibrary): void {
    const { x, y, z } = this.boilerPos
    const body = new Mesh(new BoxGeometry(0.5, 1.1, 0.66), mats.metal)
    body.position.set(x, y, z)
    body.castShadow = this.shadows
    this.boilerBody = body
    this.group.add(body)
    const face = new Mesh(new BoxGeometry(0.03, 0.96, 0.5), mats.darkPanel)
    face.position.set(x + 0.25, y + 0.05, z)
    this.group.add(face)
    // 出水管 + 接水槽（同材质合并为单 mesh）
    const spoutGeo = new CylinderGeometry(0.022, 0.022, 0.14, 10).translate(x + 0.28, y - 0.22, z)
    const gridGeo = new BoxGeometry(0.16, 0.03, 0.36).translate(x + 0.28, y - 0.34, z)
    this.group.add(new Mesh(mergeBufferGeometries([spoutGeo, gridGeo]), mats.seatFrame))
    // 出水按钮 + LED
    this.buttonMat = new MeshStandardMaterial({
      color: 0xc0392b,
      emissive: 0x8a1a12,
      emissiveIntensity: 0.7,
      roughness: 0.4,
    })
    const button = new Mesh(new CylinderGeometry(0.045, 0.045, 0.03, 14), this.buttonMat)
    button.rotation.z = Math.PI / 2
    button.position.set(x + 0.28, y + 0.28, z - 0.2)
    this.group.add(button)
    this.ledMat = new MeshStandardMaterial({
      color: 0x30ff60,
      emissive: 0x30ff60,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    })
    const led = new Mesh(new BoxGeometry(0.02, 0.05, 0.3), this.ledMat)
    led.position.set(x + 0.27, y + 0.28, z + 0.12)
    this.group.add(led)
    // 水杯 + 水位
    this.cup = new Mesh(
      new CylinderGeometry(0.034, 0.028, 0.09, 12),
      new MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 }),
    )
    this.cup.position.set(x + 0.28, y - 0.3, z)
    this.cup.scale.setScalar(0.001)
    this.group.add(this.cup)
    this.water = new Mesh(
      new CylinderGeometry(0.03, 0.026, 0.08, 10),
      new MeshStandardMaterial({ color: 0x67b7c4, transparent: true, opacity: 0.75, roughness: 0.15 }),
    )
    this.water.position.set(x + 0.28, y - 0.3, z)
    this.water.scale.set(1, 0.001, 1)
    this.group.add(this.water)
    this.colliders.push(makeAabb(x + 0.05, y, z, 0.3, 0.6, 0.36))
  }

  /** 灭火器 / 垃圾桶 等固定道具 */
  private buildProps(mats: MaterialLibrary): void {
    const ext = new Group()
    const bottle = new Mesh(
      new CylinderGeometry(0.06, 0.06, 0.44, 12),
      new MeshStandardMaterial({ color: 0xb01e24, roughness: 0.35, metalness: 0.3 }),
    )
    bottle.position.set(-1.52, 0.86, -8.9)
    ext.add(bottle)
    const handle = new Mesh(new BoxGeometry(0.1, 0.03, 0.05), mats.seatFrame)
    handle.position.set(-1.52, 1.1, -8.9)
    ext.add(handle)
    this.group.add(ext)

    const bin = new Mesh(
      new CylinderGeometry(0.17, 0.14, 0.72, 14, 1, true),
      new MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6, metalness: 0.4, side: 2 }),
    )
    bin.position.set(-1.4, 0.36, -2.9)
    this.group.add(bin)
    this.colliders.push(
      makeAabb(-1.52, 0.9, -8.9, 0.1, 0.6, 0.1),
      makeAabb(-1.4, 0.36, -2.9, 0.18, 0.36, 0.18),
    )
  }

  toggleCurtain(index: number): void {
    this.curtains[index]?.machine.toggle()
  }

  curtainOpenRatio(): number {
    // “开”= amount 低。全开 → 1
    if (this.curtains.length === 0) return 1
    let sum = 0
    for (const c of this.curtains) sum += 1 - c.machine.amount
    return sum / this.curtains.length
  }

  /** 开水机交互入口，返回给 toast 的文案。 */
  boilerPress(): string {
    const prev = this.boiler.state
    const ok = this.boiler.press()
    if (!ok) return '正在出水，请稍候'
    if (prev === 'idle') {
      this.steamClock.start()
      return '正在接热水，小心烫'
    }
    return '已取走水杯'
  }

  update(dt: number): boolean {
    let animating = false
    // 窗帘
    for (const c of this.curtains) {
      const before = c.machine.amount
      c.machine.update(dt)
      if (c.machine.state === 'lowering' || c.machine.state === 'rising') {
        animating = true
        this.dirtyCurtains.add(c.index)
      } else if (c.machine.amount !== before) {
        this.dirtyCurtains.add(c.index)
      }
    }
    if (this.dirtyCurtains.size > 0) {
      for (const idx of this.dirtyCurtains) {
        const c = this.curtains[idx]
        if (!c) continue
        const amt = Math.max(0.02, c.machine.amount)
        this.quatTmp.identity()
        this.mTmp.compose(
          this.posTmp.set(c.side * 1.6, 1.76, c.z),
          this.quatTmp,
          this.scaleTmp.set(1, amt, 1),
        )
        this.curtainMesh.setMatrixAt(idx, this.mTmp)
      }
      this.dirtyCurtains.clear()
      this.curtainMesh.instanceMatrix.needsUpdate = true
    }
    // 开水机
    const boilerBefore = this.boiler.state
    this.boiler.update(dt)
    if (this.boiler.state !== boilerBefore) animating = true
    const dispensing = this.boiler.state === 'dispensing'
    if (dispensing) animating = true
    const cupTarget = this.boiler.state === 'idle' ? 0.001 : 1
    this.cup.scale.x += (cupTarget - this.cup.scale.x) * Math.min(1, dt * 8)
    this.cup.scale.y = this.cup.scale.x
    this.cup.scale.z = this.cup.scale.x
    const wp = Math.max(0.001, this.boiler.progress)
    this.water.scale.set(this.cup.scale.x, wp, this.cup.scale.x)
    this.water.position.y = this.boilerPos.y - 0.3 - 0.045 + (0.08 * wp) / 2
    // LED：绿=就绪/满，橙闪烁=出水中
    if (dispensing) {
      const blink = 0.6 + 0.4 * Math.sin(performance.now() * 0.012)
      this.ledMat.color.setRGB(1 * blink, 0.55 * blink, 0.1 * blink)
      this.ledMat.emissive.copy(this.ledMat.color)
    } else {
      this.ledMat.color.setRGB(0.19, 1, 0.38)
      this.ledMat.emissive.copy(this.ledMat.color)
    }
    // 蒸汽
    const steamOn = this.boiler.isSteamVisible
    const t = this.steamClock.getElapsedTime()
    for (let i = 0; i < this.steam.length; i++) {
      const sp = this.steam[i]
      if (!sp) continue
      if (!steamOn) {
        sp.visible = false // 隐藏时不产生 draw call
        continue
      }
      sp.visible = true
      const life = (t * 0.8 + i * 0.33) % 1
      sp.position.set(
        this.boilerPos.x + 0.28 + Math.sin(life * 6.28 + i) * 0.03,
        this.boilerPos.y - 0.24 + life * 0.42,
        this.boilerPos.z,
      )
      const sc = 0.1 + life * 0.16
      sp.scale.set(sc, sc, 1)
      ;(sp.material as SpriteMaterial).opacity = 0.5 * (1 - life)
    }
    // 阅读灯光锥插值
    let lampAnim = false
    for (const lamp of this.lamps) {
      const target = lamp.on ? 1 : 0
      const cur = this.lampScale.get(lamp.index) ?? 0
      if (Math.abs(cur - target) > 0.01) {
        lampAnim = true
        this.lampScale.set(lamp.index, cur + (target - cur) * Math.min(1, dt * 10))
      } else if (cur !== target) {
        this.lampScale.set(lamp.index, target)
        lampAnim = true
      }
    }
    if (lampAnim) this.refreshLampMatrices()
    return animating || lampAnim
  }

  get curtainMeshRef(): InstancedMesh {
    return this.curtainMesh
  }

  get lampDiscMeshRef(): InstancedMesh {
    return this.lampDiscMesh
  }

  get boilerMeshRef(): Mesh {
    return this.boilerBody
  }

  dispose(): void {
    this.steamTex.dispose()
  }
}
