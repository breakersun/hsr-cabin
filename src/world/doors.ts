/**
 * 通过台自动感应门（PRD §3.2）：双扇滑轨门 + 门顶指示灯。
 * DoorMachine 驱动；关闭时向 CollisionWorld 注入碰撞体，通行判定后移除。
 * 主循环负责传感器（玩家距离）→ machine.sensor/blocked。
 */

import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three'
import { makeAabb, type AABB } from '../physics/collision'
import { DoorMachine } from '../interaction/machines'
import { CAR } from './cabin'
import type { MaterialLibrary } from './materials'
import { mergedBoxMesh, type BoxSpec } from './geo'

const EASE = (t: number): number => 1 - (1 - t) * (1 - t) // easeOut

export class AutoDoor {
  group = new Group()
  machine = new DoorMachine()
  readonly z: number
  private panels: Mesh[] = []
  private lamp: MeshStandardMaterial
  private lampRed: Color
  private lampGreen: Color

  constructor(
    public id: string,
    z: number,
    mats: MaterialLibrary,
    public onPassableChange?: (passable: boolean) => void,
  ) {
    this.z = z
    const panelMat = new MeshStandardMaterial({ color: 0xd6d2c8, roughness: 0.5, metalness: 0.35 })
    const stripeMat = mats.livery
    this.lampRed = new Color(0xff3030)
    this.lampGreen = new Color(0x30ff60)
    for (const side of [-1, 1]) {
      const panel = new Mesh(new BoxGeometry(0.54, CAR.doorH - 0.06, 0.07), panelMat)
      panel.position.set(side * 0.27, (CAR.doorH - 0.06) / 2 + 0.03, z)
      panel.castShadow = false
      this.group.add(panel)
      this.panels.push(panel)
      // 门面装饰：金色细条 + 观察窗
      const trim = new Mesh(new BoxGeometry(0.05, CAR.doorH - 0.2, 0.075), stripeMat)
      trim.position.set(side * 0.27, (CAR.doorH - 0.06) / 2 + 0.03, z)
      this.group.add(trim)
      const win = new Mesh(new BoxGeometry(0.22, 0.5, 0.08), mats.glass)
      win.position.set(side * 0.27, 1.45, z)
      this.group.add(win)
    }
    // 门顶指示灯（红=关闭 绿=开启）
    this.lamp = new MeshStandardMaterial({
      color: 0xff3030,
      emissive: 0xff3030,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    })
    const lamp = new Mesh(new BoxGeometry(0.3, 0.05, 0.06), this.lamp)
    lamp.position.set(0, CAR.doorH + 0.12, z)
    this.group.add(lamp)
    // 门套装饰合并（滑轨罩）
    const trimSpecs: BoxSpec[] = [
      { w: CAR.doorHalfW * 2 + 0.2, h: 0.1, d: 0.24, x: 0, y: CAR.doorH + 0.05, z },
    ]
    const trimMesh = mergedBoxMesh(trimSpecs, mats.metal)
    this.group.add(trimMesh)
  }

  private lastPassable = false

  update(dt: number): boolean {
    const before = this.machine.openness
    this.machine.update(dt)
    const openness = EASE(this.machine.openness)
    // 双扇向两侧滑入墙内（各滑 0.52m）
    const left = this.panels[0]
    const right = this.panels[1]
    if (left) left.position.x = -0.27 - openness * 0.52
    if (right) right.position.x = 0.27 + openness * 0.52
    // 指示灯
    const c = this.machine.isPassable ? this.lampGreen : this.lampRed
    this.lamp.color.copy(c)
    this.lamp.emissive.copy(c)
    const passable = this.machine.isPassable
    if (passable !== this.lastPassable) {
      this.lastPassable = passable
      this.onPassableChange?.(passable)
    }
    return this.machine.openness !== before || this.machine.state === 'opening' || this.machine.state === 'closing'
  }

  /** 关闭状态下注入碰撞的 AABB。 */
  collider(): AABB {
    return makeAabb(0, CAR.doorH / 2, this.z, CAR.doorHalfW, CAR.doorH / 2, 0.08)
  }

  /** 传感器更新：near = 感应区有人（保持开门），blocked = 门框有人（防夹）。 */
  sense(near: boolean, blocked: boolean): void {
    this.machine.sensor = near
    this.machine.blocked = blocked
    if (near) this.machine.requestOpen()
  }

  /** 可点击的门面板。 */
  get panelMeshes(): Mesh[] {
    return this.panels
  }
}
