/**
 * 装配层：把 引擎/车厢/座椅/内饰/门/窗外景/控制/交互/光照/HUD 装成应用。
 * 分帧生成场景（每帧一步，带进度条），失败时降级到错误页。
 */

import { DirectionalLight, HemisphereLight, PointLight } from 'three'
import { Engine } from './engine'
import { AdaptiveGovernor } from './quality/adaptive'
import { collectSignals, detectTier, qualityForTier, type QualitySettings, type Tier } from './quality/detect'
import { CollisionWorld, makeAabb } from './physics/collision'
import { DayNightController } from './interaction/dayNight'
import { Picker } from './interaction/pick'
import { Player } from './controls/player'
import { TouchControls } from './controls/touch'
import { DesktopControls } from './controls/desktop'
import { buildMaterials } from './world/materials'
import { buildCabin, CAR } from './world/cabin'
import { SeatRows } from './world/seats'
import { Interior } from './world/interior'
import { DoorSystem } from './world/doors'
import { WindowWorld } from './world/windowWorld'
import { Hud, type JumpPoint } from './ui/hud'
import { DebugPanel } from './ui/debugPanel'

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
}

function updateBoot(pct: number, step: string): void {
  const fill = document.getElementById('boot-fill')
  const label = document.getElementById('boot-step')
  if (fill) fill.style.width = `${pct}%`
  if (label) label.textContent = step
}

export async function bootApp(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement
  const touch = isTouchDevice()

  // ---- 画质档探测 ----
  updateBoot(6, '设备探测')
  await nextFrame()
  const signals = collectSignals()
  const tier = detectTier(signals)
  let quality: QualitySettings = qualityForTier(tier)
  let qualityMode: 'auto' | Tier = 'auto'

  // ---- 引擎 ----
  let engine: Engine
  try {
    engine = new Engine(canvas, quality)
  } catch (err) {
    showGlError(err)
    return
  }
  const scene = engine.scene
  const camera = engine.camera

  // ---- 材质 ----
  updateBoot(16, '生成材质贴图')
  await nextFrame()
  const mats = buildMaterials(quality.textureScale)

  // ---- 车厢 ----
  updateBoot(32, '搭建车厢外壳')
  await nextFrame()
  const cabin = buildCabin(mats, quality.textureScale)
  scene.add(cabin.group)
  const world = new CollisionWorld()
  for (const c of cabin.colliders) world.addStatic(c)

  // ---- 座椅 ----
  updateBoot(50, '安装 3+2 座椅')
  await nextFrame()
  const seats = new SeatRows(mats, quality.shadows)
  scene.add(seats.group)
  for (const c of seats.colliders) world.addStatic(c)

  // ---- 内饰 ----
  updateBoot(66, '安装内饰与开水机')
  await nextFrame()
  const interior = new Interior(mats, quality.shadows)
  scene.add(interior.group)
  for (const c of interior.colliders) world.addStatic(c)

  // ---- 通过台感应门 ----
  updateBoot(76, '安装感应门')
  await nextFrame()
  const doors = new DoorSystem(
    [
      { id: 'doorF', z: CAR.vestibuleZ },
      { id: 'doorR', z: -CAR.vestibuleZ },
    ],
    mats,
  )
  scene.add(doors.group)
  doors.doors.forEach((d, i) => world.setDynamic(d.id, doors.collider(i)))
  doors.setOnPassableChange((id, passable) => {
    const i = doors.doors.findIndex((d) => d.id === id)
    if (i >= 0) world.setDynamic(id, passable ? null : doors.collider(i))
  })

  // ---- 窗外世界 ----
  updateBoot(86, '生成窗外景观')
  await nextFrame()
  const windowWorld = new WindowWorld(quality.textureScale, quality.sceneryLayers)
  scene.add(windowWorld.group)

  // ---- 光照 ----
  updateBoot(92, '点亮车厢')
  await nextFrame()
  const hemi = new HemisphereLight(0xfff4e0, 0x71747c, 0.8) // 地面色模拟地毯/座椅反弹光照亮顶面
  scene.add(hemi)
  const sun = new DirectionalLight(0xfff2dd, 1.0)
  sun.position.set(26, 32, 6)
  if (quality.shadows) {
    sun.castShadow = true
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    const sc = sun.shadow.camera
    sc.left = -14
    sc.right = 14
    sc.top = 14
    sc.bottom = -14
    sc.near = 4
    sc.far = 70
    sun.shadow.bias = -0.0006
  }
  scene.add(sun)
  scene.add(sun.target)
  const points = [
    new PointLight(0xffd9a8, 0.4, 10, 1.6),
    new PointLight(0xffd9a8, 0.4, 10, 1.6),
  ]
  points[0]?.position.set(0, 2.1, 4.8)
  points[1]?.position.set(0, 2.1, -3.6)
  for (const p of points) scene.add(p)

  // ---- 玩家与控制 ----
  updateBoot(96, '连接控制')
  await nextFrame()
  const shell = makeAabb(0, 1.15, 0, CAR.halfW - 0.05, CAR.height / 2 + 0.6, CAR.halfL - 0.05)
  const player = new Player(shell)
  const dayNight = new DayNightController(0.8)

  const hud = new Hud(touch, {
    onJump: (p: JumpPoint) => {
      player.teleport(p.x, p.z, p.yaw)
      engine.noteActivity()
      hud.toast(`已跳转：${p.name}`)
    },
    onToggleDayNight: () => {
      dayNight.toggle()
      engine.noteActivity()
      hud.toast(dayNight.mode === 'night' ? '切换到夜晚' : '切换到白天')
    },
    onQuality: (q) => {
      qualityMode = q
      const t = q === 'auto' ? detectTier(collectSignals()) : q
      applyTier(t, false)
      hud.toast(q === 'auto' ? `画质：自动（${t === 'low' ? '低' : t === 'mid' ? '中' : '高'}档）` : `画质：已锁定 ${q === 'low' ? '低' : q === 'mid' ? '中' : '高'}档`)
    },
    onToggleFly: () => {
      player.freeFly = !player.freeFly
      engine.noteActivity()
      hud.toast(player.freeFly ? '自由飞行：开（免碰撞，限车厢内）' : '自由飞行：关')
    },
    onToggleDemo: () => {
      engine.demoMode = !engine.demoMode
      hud.toast(engine.demoMode ? '演示模式：常显渲染' : '演示模式：关（闲置降频）')
    },
    onFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen?.().catch(() => hud.toast('当前浏览器不支持全屏'))
    },
  })
  hud.updateState({ night: false, fly: false, demo: false, quality: 'auto' })

  const picker = new Picker(camera, canvas)

  // ---- 交互注册 ----
  const seatBacks = seats.pickMeshes
  picker.register(seatBacks.back, {
    label: (i) => {
      const s = seats.seats[i ?? 0]
      return s ? `${s.label} 靠背（${Math.round(s.back.angleDeg)}°）` : '座椅靠背'
    },
    onInteract: (i) => {
      const s = seats.seats[i ?? 0]
      if (!s) return
      s.back.toggle()
      return `${s.label} 靠背 ${s.back.state === 'reclining' ? '后仰' : '立起'}`
    },
    setHighlight: (i, on) => seats.setHighlight(i ?? 0, 'back', on),
  })
  picker.register(seatBacks.tray, {
    label: (i) => {
      const s = seats.seats[i ?? 0]
      return s ? `${s.label} 小桌板` : '小桌板'
    },
    onInteract: (i) => {
      const s = seats.seats[i ?? 0]
      if (!s) return
      s.tray.toggle()
      return s.tray.state === 'deploying' ? `${s.label} 小桌板展开` : `${s.label} 小桌板收起`
    },
    setHighlight: (i, on) => seats.setHighlight(i ?? 0, 'tray', on),
  })
  picker.register(interior.curtainMeshRef, {
    label: (i) => {
      const c = interior.curtains[i ?? 0]
      return c ? `${c.side === -1 ? '左侧' : '右侧'}车窗窗帘` : '窗帘'
    },
    onInteract: (i) => {
      const c = interior.curtains[i ?? 0]
      if (!c) return
      interior.toggleCurtain(c.index)
      return c.machine.state === 'lowering' ? '窗帘拉下' : '窗帘升起'
    },
  })
  picker.register(interior.lampDiscMeshRef, {
    label: (i) => {
      const l = interior.lamps[i ?? 0]
      return l ? `阅读灯（${l.side === -1 ? '左' : '右'}侧）` : '阅读灯'
    },
    onInteract: (i) => {
      interior.toggleLamp(i ?? 0)
      const l = interior.lamps[i ?? 0]
      return l?.on ? '阅读灯开启' : '阅读灯关闭'
    },
  })
  picker.register(interior.boilerMeshRef, {
    label: () => '开水机（点击接热水）',
    onInteract: () => interior.boilerPress(),
  })
  picker.register(doors.panelMeshRef, {
    label: () => '通过台感应门',
    onInteract: (i) => {
      const d = doors.doorByInstance(i ?? 0)
      if (!d) return
      d.machine.toggle()
      return d.machine.state === 'opening' ? '感应门：手动开启' : '感应门：关闭'
    },
  })

  // ---- 输入 ----
  const lookSens = 0.0032
  let joyVec = { x: 0, y: 0 }
  let touchActive = false
  const touchControls = new TouchControls(canvas, hud.joyEl, hud.knobEl, {
    onMove: (x, y) => {
      joyVec = { x, y }
      touchActive = true
    },
    onLook: (dx, dy) => {
      player.look(-dx * lookSens, -dy * lookSens)
      engine.noteActivity()
    },
    onTap: (x, y) => {
      const r = picker.interactAt(x, y, true)
      engine.noteActivity()
      if (r) {
        hud.showTarget(r.label)
        if (r.toast) hud.toast(r.toast)
      }
    },
    onActivity: () => engine.noteActivity(),
  })
  void touchControls // 监听器在构造时注册；此引用仅为保留实例

  const toggleFly = (): void => {
    player.freeFly = !player.freeFly
    hud.toast(player.freeFly ? '自由飞行：开' : '自由飞行：关')
  }
  const desktopControls = new DesktopControls(canvas, {
    onLook: (dx, dy) => {
      player.look(-dx * lookSens, -dy * lookSens)
      engine.noteActivity()
    },
    onInteract: () => {
      const r = picker.interactCenter()
      if (r) {
        hud.showTarget(r.label)
        if (r.toast) hud.toast(r.toast)
      }
    },
    onToggleFly: toggleFly,
    onToggleDayNight: () => {
      dayNight.toggle()
      hud.toast(dayNight.mode === 'night' ? '切换到夜晚' : '切换到白天')
    },
    onMenu: () => hud.toggleMenu(),
    onActivity: () => engine.noteActivity(),
  })
  // 桌面准星
  const crosshair = document.createElement('div')
  crosshair.id = 'crosshair'
  crosshair.className = 'hud'
  document.getElementById('app')?.append(crosshair)
  if (!touch) crosshair.style.display = 'none'
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas
    crosshair.style.display = locked ? 'block' : 'none'
    picker.setHoverEnabled(locked)
  })

  // ---- 自适应降档 ----
  const TIER_ORDER: Tier[] = ['high', 'mid', 'low']
  const applyTier = (t: Tier, notify: boolean): void => {
    quality = qualityForTier(t)
    engine.applyQuality(quality)
    windowWorld.setLayers(quality.sceneryLayers)
    if (notify) hud.toast(`性能保护：已降至${t === 'low' ? '低' : '中'}档画质`)
  }
  const governor = new AdaptiveGovernor(
    {
      getSettings: () => engine.quality,
      stepDownDpr: () => {
        if (engine.currentDpr <= 1.01) return false
        engine.setDpr(Math.max(1, engine.currentDpr - 0.25))
        return true
      },
      stepDownTier: () => {
        const i = TIER_ORDER.indexOf(engine.quality.tier)
        if (i < 0 || i >= TIER_ORDER.length - 1) return false
        applyTier(TIER_ORDER[i + 1] ?? 'low', true)
        return true
      },
    },
    () => qualityMode === 'auto',
  )

  // ---- 调试面板 ----
  const debugEnabled = new URLSearchParams(location.search).get('debug') === '1'
  const debugPanel = new DebugPanel(() => engine.stats, debugEnabled)

  // ---- 主循环 ----
  updateBoot(100, '发车')
  await nextFrame()
  let swayT = 0
  let hoverTimer = 0

  const frame = (dt: number): boolean => {
    // 输入 → 移动
    let forward = joyVec.y
    let strafe = joyVec.x
    let run = false
    let lift = 0
    if (desktopControls.active) {
      const di = desktopControls.input()
      forward += di.forward
      strafe += di.strafe
      run = di.run
      lift = di.lift
    }
    if (touchActive && (joyVec.x !== 0 || joyVec.y !== 0)) run = joyVec.y > 0.92 // 摇杆推满 = 跑
    player.move({ forward, strafe, run, lift }, dt, world)

    // 门传感器（感应区 1.5m，门框防夹 0.75m）
    let doorAnim = false
    doors.doors.forEach((d, i) => {
      const dist = Math.hypot(player.x, player.z - d.z)
      const inFrame = Math.abs(player.z - d.z) < 0.75 && Math.abs(player.x) < 0.7
      doors.sense(i, dist < 1.5, inFrame)
    })
    if (doors.update(dt)) doorAnim = true

    const seatsAnim = seats.update(dt)
    const interiorAnim = interior.update(dt)
    dayNight.update(dt)
    const ch = dayNight.sample()
    windowWorld.update(dt, ch)

    // 光照/材质随昼夜 & 隧道（通道值→物理强度带应用侧倍率）
    const T = windowWorld.tunnel.amount
    const curtainFactor = 1 + (interior.curtainOpenRatio() - 1) * 0.08
    hemi.intensity = ch.ambient * 2.3 * curtainFactor * (1 - T * 0.35)
    sun.intensity = ch.sun * 1.45 * (1 - T)
    sun.castShadow = quality.shadows && sun.intensity > 0.05
    for (const p of points) p.intensity = ch.cabinPoint * 2.6 * (1 + T * 0.1)
    cabin.stripsMat.emissiveIntensity = ch.strips * 1.7
    cabin.screenMat.emissiveIntensity = ch.screen * 1.25
    cabin.glassMat.opacity = 0.16 + ch.glassReflect * 0.3
    // 信息屏滚动
    const scr = cabin.screenMat.map
    if (scr) scr.offset.x = (performance.now() * 0.000018) % 1

    // 相机 + 车体晃动（隧道中加强）
    player.applyToCamera(camera)
    const swayAmp = quality.sway * (1 + T * 2.4)
    if (swayAmp > 0) {
      swayT += dt
      camera.position.y += Math.sin(swayT * 2.2) * 0.006 * swayAmp
      camera.position.x += Math.sin(swayT * 1.31) * 0.004 * swayAmp
      camera.rotation.z = Math.sin(swayT * 1.7) * 0.0045 * swayAmp
    }

    // 桌面悬停提示（节流）
    hoverTimer += dt
    if (hoverTimer > 0.12) {
      hoverTimer = 0
      const label = picker.hover()
      if (label) hud.showTarget(label)
    }

    debugPanel.update()
    governor.onFrame(dt * 1000)
    hud.updateState({
      night: dayNight.isNight,
      fly: player.freeFly,
      demo: engine.demoMode,
      quality: qualityMode,
    })

    return (
      player.moved ||
      doorAnim ||
      seatsAnim ||
      interiorAnim ||
      dayNight.isAnimating ||
      windowWorld.tunnel.phase === 'entering' ||
      windowWorld.tunnel.phase === 'exiting'
    )
  }

  engine.start(frame, () => engine.noteActivity())
  document.getElementById('boot')?.classList.add('done')
  window.setTimeout(() => document.getElementById('boot')?.remove(), 600)
  hud.toast(touch ? '欢迎登车 · 左下摇杆开始探索' : '欢迎登车 · 点击画面锁定鼠标开始', 3000)
}

function showGlError(err: unknown): void {
  const boot = document.getElementById('boot')
  boot?.remove()
  const glError = document.getElementById('gl-error')
  if (glError) {
    glError.classList.add('show')
    const detail = glError.querySelector('.detail')
    if (detail) detail.textContent = String(err)
  }
}
