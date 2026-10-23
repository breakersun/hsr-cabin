/**
 * 通过台自动感应门（PRD §3.2）：双扇滑轨门 + 门顶指示灯。
 * 两扇门共用一组 InstancedMesh（门板/饰条/观察窗共享实例矩阵，随门板一起滑动），
 * 整组 draw call = 5（门板/饰条/观察窗/指示灯/滑轨罩）。
 * DoorMachine 驱动；关闭时向 CollisionWorld 注入碰撞体，通行判定后移除。
 * 主循环负责传感器（玩家距离）→ machine.sensor/blocked。
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { makeAabb, type AABB } from '../physics/collision'
import { DoorMachine } from '../interaction/machines'
import { CAR } from './cabin'
import type { MaterialLibrary } from './materials'
import { mergedBoxMesh, type BoxSpec } from './geo'

const EASE = (t: number): number => 1 - (1 - t) * (1 - t) // easeOut

export interface DoorRef {
  id: string
  z: number
  machine: DoorMachine
  /** instanceId → 该门（floor(i/2)），供射线拾取回调定位 */
  index: number
}

export class DoorSystem {
  group = new Group()
  doors: DoorRef[] = []
  private panelMesh: InstancedMesh
  private lampMesh: InstancedMesh
  private lampRed = new Color(0xff3030)
  private lampGreen = new Color(0x30ff60)
  private mTmp = new Matrix4()
  private posTmp = new Vector3()
  private quatTmp = new Quaternion()
  private scaleOne = new Vector3(1, 1, 1)

  constructor(ids: { id: string; z: number }[], mats: MaterialLibrary) {
    const n = ids.length
    const panelMat = new MeshStandardMaterial({ color: 0xd6d2c8, roughness: 0.5, metalness: 0.35 })
    const panelH = CAR.doorH - 0.06
    // 几何预平移：原点在门中缝，饰条/观察窗的偏移直接烘进各自几何
    const panelGeo = new BoxGeometry(0.54, panelH, 0.07)
    const trimGeo = new BoxGeometry(0.05, CAR.doorH - 0.2, 0.075)
    const winGeo = new BoxGeometry(0.22, 0.5, 0.08)
    winGeo.translate(0, 1.45 - panelH / 2 - 0.03, 0)
    this.panelMesh = new InstancedMesh(panelGeo, panelMat, n * 2)
    this.panelMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    const trims = new InstancedMesh(trimGeo, mats.livery, n * 2)
    trims.instanceMatrix.setUsage(DynamicDrawUsage)
    const wins = new InstancedMesh(winGeo, mats.glass, n * 2)
    wins.instanceMatrix.setUsage(DynamicDrawUsage)
    const lampGeo = new BoxGeometry(0.3, 0.05, 0.06)
    this.lampMesh = new InstancedMesh(lampGeo, new MeshBasicMaterial({ color: 0xff3030 }), n)
    this.lampMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    for (const m of [this.panelMesh, trims, wins, this.lampMesh]) m.frustumCulled = false

    // 滑轨罩（两门合并）+ 指示灯矩阵
    const railSpecs: BoxSpec[] = []
    ids.forEach((d, i) => {
      railSpecs.push({ w: CAR.doorHalfW * 2 + 0.2, h: 0.1, d: 0.24, x: 0, y: CAR.doorH + 0.05, z: d.z })
      this.doors.push({ id: d.id, z: d.z, machine: new DoorMachine(), index: i })
      this.mTmp.compose(this.posTmp.set(0, CAR.doorH + 0.12, d.z), this.quatTmp.identity(), this.scaleOne)
      this.lampMesh.setMatrixAt(i, this.mTmp)
      this.lampMesh.setColorAt(i, this.lampRed)
    })
    this.lampMesh.instanceMatrix.needsUpdate = true
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true
    this.group.add(this.panelMesh, trims, wins, this.lampMesh, mergedBoxMesh(railSpecs, mats.metal))
    this.trims = trims
    this.wins = wins
    this.update(0) // 初始化实例矩阵（InstancedMesh 缓冲默认全零）
  }

  private trims: InstancedMesh
  private wins: InstancedMesh
  private lastPassable = new Map<string, boolean>()

  /** instanceId（panelMesh 射线返回）→ DoorRef。 */
  doorByInstance(instanceId: number): DoorRef | undefined {
    return this.doors[Math.floor(instanceId / 2)]
  }

  get panelMeshRef(): InstancedMesh {
    return this.panelMesh
  }

  private onPassableChange?: (id: string, passable: boolean) => void

  /** 通行状态变化回调（主循环同步碰撞体用）。 */
  setOnPassableChange(cb: (id: string, passable: boolean) => void): void {
    this.onPassableChange = cb
  }

  /** 传感器更新：near = 感应区有人（保持开门），blocked = 门框有人（防夹）。 */
  sense(index: number, near: boolean, blocked: boolean): void {
    const d = this.doors[index]
    if (!d) return
    d.machine.sensor = near
    d.machine.blocked = blocked
    if (near) d.machine.requestOpen()
  }

  /** 关闭状态下注入碰撞的 AABB。 */
  collider(index: number): AABB {
    const d = this.doors[index]
    const z = d ? d.z : 0
    return makeAabb(0, CAR.doorH / 2, z, CAR.doorHalfW, CAR.doorH / 2, 0.08)
  }

  update(dt: number): boolean {
    let anyAnim = false
    this.doors.forEach((d, i) => {
      const before = d.machine.openness
      d.machine.update(dt)
      const openness = EASE(d.machine.openness)
      // 双扇向两侧滑入墙内（各滑 0.52m）；饰条/观察窗共享同一矩阵随之滑动
      for (const side of [0, 1]) {
        const s = side === 0 ? -1 : 1
        this.mTmp.compose(
          this.posTmp.set(s * (0.27 + openness * 0.52), (CAR.doorH - 0.06) / 2 + 0.03, d.z),
          this.quatTmp.identity(),
          this.scaleOne,
        )
        this.panelMesh.setMatrixAt(i * 2 + side, this.mTmp)
        this.trims.setMatrixAt(i * 2 + side, this.mTmp)
        this.wins.setMatrixAt(i * 2 + side, this.mTmp)
      }
      // 指示灯：红=关闭 绿=可通行
      const passable = d.machine.isPassable
      this.lampMesh.setColorAt(i, passable ? this.lampGreen : this.lampRed)
      const last = this.lastPassable.get(d.id)
      if (last !== passable) {
        this.lastPassable.set(d.id, passable)
        this.onPassableChange?.(d.id, passable)
      }
      if (d.machine.openness !== before || d.machine.state === 'opening' || d.machine.state === 'closing') {
        anyAnim = true
      }
    })
    this.panelMesh.instanceMatrix.needsUpdate = true
    this.trims.instanceMatrix.needsUpdate = true
    this.wins.instanceMatrix.needsUpdate = true
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true
    return anyAnim
  }
}
