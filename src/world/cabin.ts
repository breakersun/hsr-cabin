/**
 * 车厢外壳搭建：地板/顶板/侧墙(含车窗)/端墙/通过台隔墙/灯带/LED 信息屏/外侧飘带。
 * 尺寸参考 CR400 近似值（PRD §3.4，可微调）：内长 23m × 内宽 3.3m × 高 2.3m。
 */

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import { makeAabb, type AABB } from '../physics/collision'
import type { MaterialLibrary } from './materials'
import { mergedBoxMesh, type BoxSpec } from './geo'

export const CAR = {
  halfW: 1.65, // 内壁半宽（内宽 3.3m）
  height: 2.3,
  halfL: 11.5, // 内长 23m
  windowY0: 0.85,
  windowY1: 1.75,
  vestibuleZ: 9.2, // 通过台隔墙 z
  doorHalfW: 0.5, // 门洞半宽（净宽 1.0m）
  doorH: 2.05,
  endZ: 11.4, // 端墙
}

/** 客室侧窗 bay 布局（窗帘/阅读灯/窗框共用） */
export const WINDOW_BAYS: { z: number; halfW: number }[] = (() => {
  const bays: { z: number; halfW: number }[] = []
  for (let i = 0; i < 7; i++) bays.push({ z: 8.0 - i * 2.6, halfW: 0.8 }) // 窗宽 1.6m
  return bays
})()

export interface CabinParts {
  group: Group
  colliders: AABB[]
  stripsMat: MeshStandardMaterial
  screenMat: MeshStandardMaterial
  glassMat: MeshStandardMaterial
}

function screenTexture(scale: number): { tex: CanvasTexture; mat: MeshStandardMaterial } {
  const w = Math.round(1024 * scale)
  const h = Math.round(72 * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas2D 不可用')
  const bg = new Color(0x0c1420)
  ctx.fillStyle = `#${bg.getHexString()}`
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffb02e'
  ctx.font = `bold ${Math.round(h * 0.42)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const msg = '当前车速 350 km/h        车厢温度 24.5℃        旅程愉快 · 请保持安静        请勿在车厢内吸烟'
  ctx.fillText(msg, 12, h * 0.38)
  ctx.fillStyle = 'rgba(255,176,46,0.55)'
  ctx.font = `${Math.round(h * 0.24)}px system-ui, sans-serif`
  ctx.fillText('本次列车为程序化致敬演示 · 非官方产品', 12, h * 0.78)
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.magFilter = LinearFilter
  tex.repeat.set(0.5, 1)
  const mat = new MeshStandardMaterial({
    map: tex,
    emissive: 0xffb02e,
    emissiveMap: tex,
    emissiveIntensity: 0.8,
    color: 0x111111,
  })
  return { tex, mat }
}

export function buildCabin(mats: MaterialLibrary, textureScale: number): CabinParts {
  const group = new Group()
  const colliders: AABB[] = []
  const H = CAR.height
  const W = CAR.halfW
  const L = CAR.halfL

  // 地板（地毯）与顶板
  const floor = new Mesh(new BoxGeometry(W * 2, 0.1, L * 2), mats.floor)
  floor.position.y = -0.05
  floor.receiveShadow = true
  group.add(floor)

  const ceiling = new Mesh(new BoxGeometry(W * 2, 0.12, L * 2), mats.ceiling)
  ceiling.position.y = H + 0.06
  group.add(ceiling)

  // 侧墙（每侧）：下带 / 上带 / 窗间立柱 / 窗框 / 玻璃
  const lowerSpecs: BoxSpec[] = []
  const upperSpecs: BoxSpec[] = []
  const pillarSpecs: BoxSpec[] = []
  const frameSpecs: BoxSpec[] = []
  const glassSpecs: BoxSpec[] = []
  const wallT = 0.1

  for (const side of [-1, 1]) {
    const x = side * (W + wallT / 2)
    lowerSpecs.push({ w: wallT, h: CAR.windowY0, d: L * 2, x, y: CAR.windowY0 / 2, z: 0 })
    upperSpecs.push({
      w: wallT,
      h: H - CAR.windowY1,
      d: L * 2,
      x,
      y: (CAR.windowY1 + H) / 2,
      z: 0,
    })
    // 窗间立柱：bay 覆盖区间之外填实 + bay 之间
    const winYMid = (CAR.windowY0 + CAR.windowY1) / 2
    const winH = CAR.windowY1 - CAR.windowY0
    const coverEnd = 8.8 // 客室窗带起点（前部）
    for (const bay of WINDOW_BAYS) {
      const z0 = bay.z + bay.halfW
      const z1 = bay.z - bay.halfW
      if (z0 < coverEnd) {
        pillarSpecs.push({ w: wallT, h: winH, d: coverEnd - z0, x, y: winYMid, z: (coverEnd + z0) / 2 })
      }
      const gapStart = z1
      const nextBay = WINDOW_BAYS[WINDOW_BAYS.indexOf(bay) + 1]
      const gapEnd = nextBay ? nextBay.z + nextBay.halfW : -8.4
      pillarSpecs.push({ w: wallT, h: winH, d: gapStart - gapEnd, x, y: winYMid, z: (gapStart + gapEnd) / 2 })
      // 窗框（四边细条，内外各一圈简化为内侧一圈）
      frameSpecs.push(
        { w: 0.06, h: 0.05, d: bay.halfW * 2 + 0.12, x: side * (W - 0.02), y: CAR.windowY1 - 0.025, z: bay.z },
        { w: 0.06, h: 0.05, d: bay.halfW * 2 + 0.12, x: side * (W - 0.02), y: CAR.windowY0 + 0.025, z: bay.z },
      )
      glassSpecs.push({
        w: 0.02,
        h: winH - 0.06,
        d: bay.halfW * 2 - 0.04,
        x: side * (W + 0.01),
        y: winYMid,
        z: bay.z,
      })
    }
    // 后部（bay 带之后到通过台隔墙）填实
    pillarSpecs.push({ w: wallT, h: winH, d: -8.4 - (-CAR.vestibuleZ), x, y: winYMid, z: (-8.4 + -CAR.vestibuleZ) / 2 })
    // 通过台侧小窗（观感）+ 其余填实
    const vz = 10.35
    pillarSpecs.push(
      { w: wallT, h: winH, d: vz - 0.35 - CAR.vestibuleZ, x, y: winYMid, z: (CAR.vestibuleZ + vz - 0.35) / 2 },
      { w: wallT, h: winH, d: CAR.endZ - (vz + 0.35), x, y: winYMid, z: (vz + 0.35 + CAR.endZ) / 2 },
      { w: wallT, h: winH - 0.5, d: 0.7, x, y: winYMid + 0.25, z: vz }, // 小窗上方填实
      { w: wallT, h: 0.25, d: 0.7, x, y: CAR.windowY0 + 0.125, z: vz },
    )
    glassSpecs.push({ w: 0.02, h: 0.5, d: 0.7, x: side * (W + 0.01), y: CAR.windowY0 + 0.5, z: vz })

    // 外侧金红飘带（致敬意象，透过车窗沿车体可见）
    const livery = new Mesh(new BoxGeometry(0.02, 0.62, L * 2 - 0.4), mats.livery)
    livery.position.set(side * (W + 0.08), 1.28, 0)
    group.add(livery)
    colliders.push(makeAabb(side * (W + wallT / 2), H / 2, 0, wallT / 2, H / 2, L))
  }

  const lower = mergedBoxMesh(lowerSpecs, mats.wallLower)
  const upper = mergedBoxMesh(upperSpecs, mats.wallUpper)
  const pillars = mergedBoxMesh(pillarSpecs, mats.pillar)
  const frames = mergedBoxMesh(frameSpecs, mats.darkPanel)
  const glass = mergedBoxMesh(glassSpecs, mats.glass)
  glass.renderOrder = 2
  for (const m of [lower, upper, pillars, frames]) m.receiveShadow = true
  group.add(lower, upper, pillars, frames, glass)

  // 端墙（前 + 后）+ 走廊门装饰（MVP 边界：不可开启）
  for (const end of [-1, 1]) {
    const z = end * CAR.endZ
    const wall = new Mesh(new BoxGeometry(W * 2, H, 0.12), mats.wallUpper)
    wall.position.set(0, H / 2, z)
    group.add(wall)
    colliders.push(makeAabb(0, H / 2, z, W, H / 2, 0.08))
    // 风挡走廊意象：深色内凹 + 门框
    const recess = new Mesh(new BoxGeometry(1.15, 2.1, 0.06), mats.darkPanel)
    recess.position.set(0, 1.05, z - end * 0.08)
    group.add(recess)
    const recessGlass = new Mesh(new BoxGeometry(0.55, 1.15, 0.02), mats.glass)
    recessGlass.position.set(0, 1.45, z - end * 0.12)
    group.add(recessGlass)
  }

  // 通过台隔墙（前/后）：留中部门洞
  for (const end of [-1, 1]) {
    const z = end * CAR.vestibuleZ
    const sidePieceW = W - CAR.doorHalfW
    const specs: BoxSpec[] = [
      { w: sidePieceW, h: H, d: 0.14, x: -(CAR.doorHalfW + sidePieceW / 2), y: H / 2, z },
      { w: sidePieceW, h: H, d: 0.14, x: CAR.doorHalfW + sidePieceW / 2, y: H / 2, z },
      { w: CAR.doorHalfW * 2, h: H - CAR.doorH, d: 0.14, x: 0, y: (CAR.doorH + H) / 2, z },
      // 门套（金属）
      { w: 0.08, h: CAR.doorH, d: 0.2, x: -CAR.doorHalfW - 0.04, y: CAR.doorH / 2, z },
      { w: 0.08, h: CAR.doorH, d: 0.2, x: CAR.doorHalfW + 0.04, y: CAR.doorH / 2, z },
      { w: CAR.doorHalfW * 2 + 0.16, h: 0.08, d: 0.2, x: 0, y: CAR.doorH + 0.04, z },
    ]
    const dividing = mergedBoxMesh(specs, mats.wallUpper)
    const doorTrim = mergedBoxMesh(specs.slice(3), mats.metal)
    dividing.receiveShadow = true
    group.add(dividing, doorTrim)
    colliders.push(
      makeAabb(-(CAR.doorHalfW + sidePieceW / 2), H / 2, z, sidePieceW / 2, H / 2, 0.09),
      makeAabb(CAR.doorHalfW + sidePieceW / 2, H / 2, z, sidePieceW / 2, H / 2, 0.09),
      makeAabb(0, (CAR.doorH + H) / 2, z, CAR.doorHalfW, (H - CAR.doorH) / 2, 0.09),
    )
  }

  // 顶板灯带（两条贯穿客室）+ 通过台小灯
  const stripsMat = mats.stripOn
  for (const sx of [-0.85, 0.85]) {
    const strip = new Mesh(new BoxGeometry(0.16, 0.03, 17.6), stripsMat)
    strip.position.set(sx, H - 0.02, -0.3)
    group.add(strip)
    // 灯带凹槽
    const trough = new Mesh(new BoxGeometry(0.22, 0.05, 17.7), mats.ceiling)
    trough.position.set(sx, H - 0.045, -0.3)
    group.add(trough)
  }
  for (const vz of [10.3, -10.3]) {
    const strip = new Mesh(new BoxGeometry(1.2, 0.03, 0.16), mats.stripDim)
    strip.position.set(0, H - 0.02, vz)
    group.add(strip)
  }

  // LED 信息屏（前隔墙上方，面向客室）
  const { mat: screenMat } = screenTexture(textureScale)
  const screen = new Mesh(new BoxGeometry(1.5, 0.26, 0.05), screenMat)
  screen.position.set(0, 1.98, -CAR.vestibuleZ - 0.1) // 后隔墙上方，面向 -Z 玩家来向
  group.add(screen)
  const screen2 = screen.clone()
  screen2.position.z = CAR.vestibuleZ + 0.1
  screen2.rotation.y = Math.PI
  group.add(screen2)

  // 通过台附属：扶手杆 + 折叠座椅意象（装饰）
  const handrailSpecs: BoxSpec[] = []
  for (const end of [-1, 1]) {
    handrailSpecs.push(
      { w: 0.05, h: 0.05, d: 0.9, x: -1.3, y: 1.0, z: end * 10.5 },
      { w: 0.05, h: 0.05, d: 0.9, x: 1.3, y: 1.0, z: end * 10.5 },
      { w: 0.36, h: 0.05, d: 0.38, x: -1.35, y: 0.55, z: end * 10.9 }, // 折叠座
      { w: 0.36, h: 0.05, d: 0.38, x: 1.35, y: 0.55, z: end * 10.9 },
    )
  }
  group.add(mergedBoxMesh(handrailSpecs, mats.metal))

  return { group, colliders, stripsMat, screenMat, glassMat: mats.glass }
}
