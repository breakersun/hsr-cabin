/**
 * 射线拾取交互：注册 mesh（含 InstancedMesh 的 instanceId）→ 处理器。
 * 移动端点击做 5 射线扩样（命中判定放宽）；交互距离 ≤ 3.2m。
 */

import { Object3D, Raycaster, Vector2 } from 'three'
import type { PerspectiveCamera } from 'three'

export interface PickHandler {
  /** 该物件的可读名称（提示条用） */
  label(instanceId?: number): string
  /** 交互动作；返回 toast 文案（可选） */
  onInteract(instanceId?: number): string | void
  /** 高亮开关（instanceId 用于 InstancedMesh） */
  setHighlight?(instanceId: number | undefined, on: boolean): void
}

const MAX_DIST = 3.2
const SPREAD = 0.03 // 移动端扩样偏移（NDC）

export class Picker {
  private raycaster = new Raycaster()
  private ndc = new Vector2()
  private meshes: Object3D[] = []
  private handlers = new Map<Object3D, PickHandler>()
  private lastHover: { mesh: Object3D; instanceId: number | undefined } | null = null
  private hoverEnabled = false

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement) {
    this.raycaster.far = MAX_DIST + 0.6
  }

  /** 桌面鼠标悬停提示开关（移动端无 hover）。 */
  setHoverEnabled(on: boolean): void {
    this.hoverEnabled = on
    if (!on) this.clearHover()
  }

  register(mesh: Object3D, handler: PickHandler): void {
    this.meshes.push(mesh)
    this.handlers.set(mesh, handler)
  }

  private toNdc(clientX: number, clientY: number): Vector2 {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    return this.ndc
  }

  /** 单次射线检测。 */
  private cast(x: number, y: number): { mesh: Object3D; instanceId: number | undefined } | null {
    this.ndc.set(x, y)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.meshes, false)
    for (const h of hits) {
      if (h.distance > MAX_DIST) break
      const handler = this.handlers.get(h.object)
      if (!handler) continue
      return { mesh: h.object, instanceId: h.instanceId }
    }
    return null
  }

  /** 交互（点击/E/准星）：命中返回 handler 结果。 */
  interactAt(clientX: number, clientY: number, spread: boolean): { label: string; toast: string } | null {
    const base = this.toNdc(clientX, clientY)
    const targets: Vector2[] = [base.clone()]
    if (spread) {
      for (const [ox, oy] of [
        [SPREAD, 0],
        [-SPREAD, 0],
        [0, SPREAD],
        [0, -SPREAD],
      ]) {
        targets.push(base.clone().add(new Vector2(ox, oy)))
      }
    }
    for (const t of targets) {
      const hit = this.cast(t.x, t.y)
      if (hit) {
        const handler = this.handlers.get(hit.mesh)
        if (!handler) continue
        const toast = handler.onInteract(hit.instanceId) ?? ''
        return { label: handler.label(hit.instanceId), toast }
      }
    }
    return null
  }

  /** 准星中心交互（桌面 pointer lock 点击 / E 键）。 */
  interactCenter(): { label: string; toast: string } | null {
    const rect = this.canvas.getBoundingClientRect()
    return this.interactAt(rect.left + this.canvas.clientWidth / 2, rect.top + this.canvas.clientHeight / 2, false)
  }

  /** 悬停检测（桌面 pointer lock，节流调用）：准星中心射线。 */
  hover(): string | null {
    if (!this.hoverEnabled) return null
    const hit = this.cast(0, 0)
    if (!hit) {
      this.clearHover()
      return null
    }
    if (
      !this.lastHover ||
      this.lastHover.mesh !== hit.mesh ||
      this.lastHover.instanceId !== hit.instanceId
    ) {
      this.clearHover()
      const handler = this.handlers.get(hit.mesh)
      handler?.setHighlight?.(hit.instanceId, true)
      this.lastHover = hit
    }
    return this.handlers.get(hit.mesh)?.label(hit.instanceId) ?? null
  }

  private clearHover(): void {
    if (this.lastHover) {
      const handler = this.handlers.get(this.lastHover.mesh)
      handler?.setHighlight?.(this.lastHover.instanceId, false)
      this.lastHover = null
    }
  }
}
