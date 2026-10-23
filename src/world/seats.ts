/**
 * 二等座 3+2 座椅（PRD §3.1）：10 排 × 5 座，全 InstancedMesh（三角形预算 < 80k）。
 * 每座独立状态：靠背两档倾角（BackrestMachine）+ 椅背小桌板（TrayMachine）。
 * 交互通过 raycast instanceId 定位到具体座位。
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import { makeAabb, type AABB } from '../physics/collision'
import { BackrestMachine, TrayMachine } from '../interaction/machines'
import type { MaterialLibrary } from './materials'

export const SEAT = {
  rows: 10,
  zFirst: 8.2, // 第一排（最前）z
  pitch: 1.0,
  xTriple: [-1.44, -1.0, -0.56], // A B C（C 靠过道）
  xDouble: [0.56, 1.0], // D F（D 靠过道）
  letters: ['A', 'B', 'C', 'D', 'F'],
  pivotY: 0.42, // 靠背铰点高度
  backDz: -0.24, // 铰点相对排中心 z
}

export interface SeatRef {
  index: number
  row: number // 0 起
  col: number
  label: string // 如 "5排C座"
  x: number
  z: number
  back: BackrestMachine
  tray: TrayMachine
}

const DEG = Math.PI / 180
const AXIS_X = new Vector3(1, 0, 0)

export class SeatRows {
  group = new Group()
  colliders: AABB[] = []
  seats: SeatRef[] = []
  private backMesh: InstancedMesh
  private headMesh: InstancedMesh
  private pocketMesh: InstancedMesh
  private trayMesh: InstancedMesh
  private dirty = new Set<number>()
  private mStatic = new Matrix4()
  private mBack = new Matrix4()
  private mTray = new Matrix4()
  private pos = new Vector3()
  private quat = new Quaternion()
  private scaleOne = new Vector3(1, 1, 1)
  private highlightColor = new Color(1.7, 1.4, 0.8)
  private normalColor = new Color(1, 1, 1)

  constructor(mats: MaterialLibrary, public shadows: boolean) {
    const n = SEAT.rows * 5
    // 各部件几何（铰点/局部偏移直接烘焙进几何，实例矩阵只含世界定位）
    const legGeo = new BoxGeometry(0.4, 0.3, 0.44)
    const cushionGeo = new BoxGeometry(0.42, 0.11, 0.46)
    const backGeo = new BoxGeometry(0.4, 0.66, 0.09)
    backGeo.translate(0, 0.33, 0)
    const headGeo = new BoxGeometry(0.3, 0.14, 0.11)
    headGeo.translate(0, 0.72, 0.03)
    const pocketGeo = new BoxGeometry(0.3, 0.22, 0.035)
    pocketGeo.translate(0, 0.3, -0.062)
    const trayGeo = new BoxGeometry(0.32, 0.24, 0.02)
    trayGeo.translate(0, -0.13, 0)
    const armGeo = new BoxGeometry(0.05, 0.055, 0.36)
    const armCount = SEAT.rows * 7

    const legs = new InstancedMesh(legGeo, mats.seatFrame, n)
    const cushions = new InstancedMesh(cushionGeo, mats.seatFabric, n)
    this.backMesh = new InstancedMesh(backGeo, mats.seatFabric, n)
    this.headMesh = new InstancedMesh(headGeo, mats.headrest, n)
    this.pocketMesh = new InstancedMesh(pocketGeo, mats.darkPanel, n)
    this.trayMesh = new InstancedMesh(trayGeo, mats.tray, n)
    const arms = new InstancedMesh(armGeo, mats.armrest, armCount)

    for (const m of [legs, cushions, this.backMesh, this.headMesh, this.pocketMesh, this.trayMesh, arms]) {
      m.castShadow = shadows
      m.receiveShadow = shadows
      m.instanceMatrix.setUsage(DynamicDrawUsage)
      this.group.add(m)
    }

    // 静态部件矩阵 + 每座状态
    this.quat.identity()
    let armIdx = 0
    for (let row = 0; row < SEAT.rows; row++) {
      const z = SEAT.zFirst - row * SEAT.pitch
      for (let col = 0; col < 5; col++) {
        const x = col < 3 ? (SEAT.xTriple[col] ?? 0) : (SEAT.xDouble[col - 3] ?? 0)
        const idx = row * 5 + col
        this.mStatic.compose(this.pos.set(x, 0.15, z), this.quat, this.scaleOne)
        legs.setMatrixAt(idx, this.mStatic)
        this.mStatic.compose(this.pos.set(x, 0.365, z + 0.03), this.quat, this.scaleOne)
        cushions.setMatrixAt(idx, this.mStatic)
        this.seats.push({
          index: idx,
          row,
          col,
          label: `${row + 1}排${SEAT.letters[col]}座`,
          x,
          z,
          back: new BackrestMachine(),
          tray: new TrayMachine(),
        })
        this.dirty.add(idx)
      }
      // 扶手：三连座边界 4 根 + 双连座边界 3 根
      const armXs = [-1.66, -1.22, -0.78, -0.34, 0.34, 0.78, 1.22]
      for (const ax of armXs) {
        this.mStatic.compose(this.pos.set(ax, 0.585, z + 0.02), this.quat, this.scaleOne)
        arms.setMatrixAt(armIdx, this.mStatic)
        armIdx++
      }
      // 碰撞：三连座/双连座各一个 AABB（含靠背后仰空间）
      const zc = z - 0.12
      this.colliders.push(
        makeAabb(-1.0, 0.45, zc, 0.68, 0.45, 0.42), // 三连座 x∈[-1.68,-0.32]
        makeAabb(0.78, 0.45, zc, 0.46, 0.45, 0.42), // 双连座 x∈[0.32,1.24]
      )
    }
    legs.instanceMatrix.needsUpdate = true
    cushions.instanceMatrix.needsUpdate = true
    arms.instanceMatrix.needsUpdate = true

    // 高亮支持：instanceColor 初始化为白色
    for (const mesh of [this.backMesh, this.trayMesh]) {
      for (let i = 0; i < n; i++) mesh.setColorAt(i, this.normalColor)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** 供射线拾取暴露的动态部件。 */
  get pickMeshes(): { back: InstancedMesh; tray: InstancedMesh } {
    return { back: this.backMesh, tray: this.trayMesh }
  }

  setHighlight(index: number, part: 'back' | 'tray', on: boolean): void {
    const mesh = part === 'back' ? this.backMesh : this.trayMesh
    mesh.setColorAt(index, on ? this.highlightColor : this.normalColor)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  update(dt: number): boolean {
    let anyAnimating = false
    for (const seat of this.seats) {
      const wasStill = seat.back.state === 'upright' || seat.back.state === 'reclined'
      seat.back.update(dt)
      seat.tray.update(dt)
      const backMoving = seat.back.state === 'reclining' || seat.back.state === 'rising'
      const trayMoving = seat.tray.state === 'deploying' || seat.tray.state === 'retracting'
      if (backMoving || trayMoving || !wasStill) {
        anyAnimating = true
        this.dirty.add(seat.index)
      }
    }
    if (this.dirty.size === 0) return anyAnimating
    for (const idx of this.dirty) {
      const seat = this.seats[idx]
      if (!seat) continue
      // 靠背（头枕/背袋随动）：绕 X 轴负角 = 上端向车尾（-Z）倾
      this.quat.setFromAxisAngle(AXIS_X, -seat.back.angleDeg * DEG)
      this.mBack.compose(this.pos.set(seat.x, SEAT.pivotY, seat.z + SEAT.backDz), this.quat, this.scaleOne)
      this.backMesh.setMatrixAt(idx, this.mBack)
      this.headMesh.setMatrixAt(idx, this.mBack)
      this.pocketMesh.setMatrixAt(idx, this.mBack)
      // 小桌板：挂在靠背局部 (0, 0.50, -0.075)，展开 0→+90°（几何初始沿靠背下垂）
      this.quat.setFromAxisAngle(AXIS_X, seat.tray.openness * 90 * DEG)
      this.mTray.compose(this.pos.set(0, 0.5, -0.075), this.quat, this.scaleOne)
      this.mTray.premultiply(this.mBack)
      this.trayMesh.setMatrixAt(idx, this.mTray)
    }
    this.dirty.clear()
    this.backMesh.instanceMatrix.needsUpdate = true
    this.headMesh.instanceMatrix.needsUpdate = true
    this.pocketMesh.instanceMatrix.needsUpdate = true
    this.trayMesh.instanceMatrix.needsUpdate = true
    return anyAnimating
  }
}
