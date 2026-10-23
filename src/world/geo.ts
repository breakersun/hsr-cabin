/**
 * 几何合并工具：把多个 BoxGeometry（带变换）合成单个 BufferGeometry，
 * 控制静态车厢结构的 draw call（预算 < 60/帧）。
 */

import { BoxGeometry, BufferAttribute, BufferGeometry, Matrix4, Mesh } from 'three'
import type { Material } from 'three'

export interface BoxSpec {
  w: number
  h: number
  d: number
  x: number
  y: number
  z: number
  /** 可选绕 Y 旋转（弧度） */
  ry?: number
}

export function mergedBoxes(specs: readonly BoxSpec[]): BufferGeometry {
  const geometries: BufferGeometry[] = []
  const m = new Matrix4()
  for (const s of specs) {
    const g = new BoxGeometry(s.w, s.h, s.d)
    m.makeRotationY(s.ry ?? 0)
    m.setPosition(s.x, s.y, s.z)
    g.applyMatrix4(m)
    geometries.push(g)
  }
  return mergeBufferGeometries(geometries)
}

/** 合并同结构 BufferGeometry（position/normal/uv + index）。 */
export function mergeBufferGeometries(geometries: readonly BufferGeometry[]): BufferGeometry {
  const totalVerts = geometries.reduce(
    (n, g) => n + (g.attributes.position?.count ?? 0),
    0,
  )
  const pos = new Float32Array(totalVerts * 3)
  const nor = new Float32Array(totalVerts * 3)
  const uv = new Float32Array(totalVerts * 2)
  const indices: number[] = []
  let vOffset = 0
  for (const g of geometries) {
    if (!g.index) continue
    const gp = g.attributes.position as BufferAttribute
    const gn = g.attributes.normal as BufferAttribute
    const gu = g.attributes.uv as BufferAttribute
    pos.set(gp.array as Float32Array, vOffset * 3)
    nor.set(gn.array as Float32Array, vOffset * 3)
    uv.set(gu.array as Float32Array, vOffset * 2)
    const idx = g.index.array
    for (let i = 0; i < idx.length; i++) indices.push((idx[i] ?? 0) + vOffset)
    vOffset += gp.count
    g.dispose()
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(pos, 3))
  out.setAttribute('normal', new BufferAttribute(nor, 3))
  out.setAttribute('uv', new BufferAttribute(uv, 2))
  out.setIndex(indices)
  return out
}

/** 便捷：合并盒列表为 Mesh。 */
export function mergedBoxMesh(specs: readonly BoxSpec[], material: Material): Mesh {
  return new Mesh(mergedBoxes(specs), material)
}
