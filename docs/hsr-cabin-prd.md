# 中国高铁车厢 3D 漫游 — 产品规格文档（PRD）

- **版本**: v0.2（2026-10-23），§12 四项已拍板，进入实现
- **产品代号**: HSR-Cabin
- **一句话定位**: 在浏览器里第一人称漫游一列「中国标准动车组」（复兴号 CR400 风格）的内部——司机室、商务座车、二等座车、餐车——可点击交互、昼夜切换，**移动端（安卓手机/平板）优先流畅运行**。

---

## 1. 产品概述

### 1.1 形态

- 单页应用（SPA）：**Three.js + Vite**，`npm run dev` 启动，`npm run build` 产出纯静态文件。
- 部署：免费静态托管（首选 Cloudflare Pages，备选 GitHub Pages），**无后端、无 VPS**。
- 渲染算力 100% 在访客终端本地（此前讨论的结论），服务器只是文件仓库 + CDN。

### 1.2 设计原则（四条，来自前期讨论的沉淀）

1. **移动优先**：安卓手机/平板是第一目标平台。交互、性能、视觉的所有决策先问「千元机上会怎样」，桌面向它对齐，而不是反过来。
2. **纯程序化**：零外部资产——所有几何程序化生成，所有贴图用 `CanvasTexture` 程序化绘制。包体小、加载快、无版权风险，天然适配移动网络。
3. **性能分级第一天就进架构**：启动探测设备 → 选画质档 → 渲染预算随之确定；不是事后补一个「低画质」开关。分档同时决定贴图生成分辨率与窗外景层数。
4. **高辨识度致敬风格（已拍板，私用）**：外观与内饰采用高辨识度的复兴号风格意象——车窗/司机室前视野可见 CR400BF 式「金红飘带」涂装意象、标志性内饰配色与灯带造型——但**不使用官方文字 LOGO 与注册商标**。用户已确认本项目为私用演示，接受该致敬风格。

### 1.3 非目标（明确不做）

- 多人联机、账号系统、存档、后端 API
- 真实线路/车站数据、GIS、时刻表
- 外部 glTF/图片资产导入管线（本项目全部程序化）
- iOS 深度优化（能跑即可）；音频文件资产（Phase 3 可选 WebAudio 合成音，默认静音）

---

## 2. 目标用户与设备矩阵

| 用户场景 | 设备 | 预期占比 | 画质档 | 帧率目标 |
|---|---|---|---|---|
| 随点随看 | 安卓中端手机（骁龙 7 系 / 天玑中端，4–6GB） | ~50% | 中档 | **稳定 30** |
| 旗舰用户 | 骁龙 8 系 / 天玑 9 系 | ~20% | 高档 | 60 |
| 大屏体验 | 安卓平板（中端 SoC，dpr 2–3 高分屏） | ~20% | 中档 | 30–60 |
| 桌面分享 | 笔记本 / 台式 Chrome / Edge / Safari | ~10% | 高档 | 60 |
| 内嵌浏览器 | 微信 / 抖音 WebView | 少量 | 低档起步 | ≥30（不承诺） |

> **平板特别标注**：高分屏是填充率杀手——即使判定为高档，dpr 也硬性 ≤ 2（呼应「移动 GPU 最怕填充率」）。

---

## 3. 场景内容规格

### 3.1 列车编组（司机室 + 3 节车厢）

`[司机室] — [商务座车] — [二等座车] — [餐车]`，车厢之间以**通过台（风挡/走廊）**连接，通过台设感应滑门。

| 分区 | 对应参考稿（飞机版）的 | 内容要点 |
|---|---|---|
| 司机室 | cockpit | 操纵台仪表、司机座椅、正前方铁轨/接触网/信号灯视野；经商务座车前端玻璃门可见、可进入 |
| 商务座车 | business | 1+2 布局真皮座椅、可点击展平、独立阅读灯、侧窗大窗 |
| 二等座车 | economy | **3+2 布局** ×约 10 排、大件行李存放处、开水间（热水机）、洗手台/卫生间；主场景 |
| 餐车 | galley | 吧台、高脚凳、展示柜、站立就餐区 |
| 卫生间 | lavatory | 坐便间 + 蹲便间各一（中国特色，与飞机差异点）、洗手台与镜 |

### 3.2 可交互物件

| 物件 | 触发 | 反馈 |
|---|---|---|
| 通过台感应门（×3 处） | 靠近自动开 / 点击开 | 滑门动画 + 门顶指示灯 |
| 车窗窗帘（下拉式） | 点击 | 开合动画；开时室内略亮、窗外景清晰 |
| 二等座靠背 / 小桌板 | 点击 | 靠背两档倾角插值；桌板展开/收起 |
| 商务座座椅 | 点击 | 坐姿 ⇄ 全平（两预设位插值） |
| 热水机（开水机） | 点击（Phase 2） | 接水动画 + 蒸汽粒子 + 杯内水位 |
| 车内 LED 信息屏 | 不可交互 | 滚动显示：车速 350 km/h、下一站、车厢温度 |
| 行李架（开放式货架） | Phase 2 | 放置/取下行李箱动画 |

**固定细节道具**（不可交互，撑真实感）：灭火器、安全锤、垃圾桶、座椅背袋、USB 充电口、扶手、烟感、衣帽钩。

> 与飞机的关键差异：高铁行李架是**开放货架**，不是封闭舱门——没有「开合行李舱」交互，换成窗帘、桌板、座椅、门、热水机。

### 3.3 窗外世界（程序化，循环滚动）

- **白天**：程序化天空 + 循环掠过的元素：农田色块、远山剪影、高架桥墩、城镇楼群、风力发电机；**接触网电杆以正确节奏规律闪过**——这是「高铁速度感」的核心视觉来源。
- **隧道**：每 60–120 秒随机进隧道一次：窗外变暗、轻微震动加强、出隧道恢复。
- **夜晚**：窗外近黑 + 偶尔掠过的城镇灯光；车窗玻璃出现车内反射（近似做法：窗面叠加半透明高光层）。
- **实现红线**：窗外景必须用「贴着车窗的循环滚动物体 + 2–3 层视差」实现，**严禁**真实构建 350 km/h 的大范围场景（性能红线）。
- **车体动态**：恒定轻微正弦晃动（幅度按画质档，低档可关闭），隧道中加强。

### 3.4 尺寸参考（真实 CR400 近似值，实现可微调）

| 项 | 参考值 |
|---|---|
| 车厢内部 | 长 ~24 m × 宽 ~3.1 m × 高 ~2.3 m |
| 二等座排距 / 座宽 | ~1.0 m / ~0.45 m；过道 ~0.6 m |
| 一等座（若做） | 2+2，排距 ~1.16 m |
| 商务座 | 1+2 |
| 门高 / 走路速度 | ~2.0 m；走 1.4 m/s、跑 3.0 m/s、视高 1.55 m |

---

## 4. 交互规格（触摸优先）

### 4.1 移动端（主要输入）

- **移动**：屏幕左下虚拟摇杆（拇指）。
- **视角**：屏幕右侧任意位置拖动。
- **交互**：单击物件（射线拾取，命中判定比桌面放宽）；选中物件描边高亮 + 底部提示条说明可做什么。
- **无 hover**：一切悬停提示逻辑改为点击态/选中态。
- **UI 布局**：
  - 顶部左：车型与速度徽标（装饰性）
  - 顶部右：菜单按钮 → 地点跳转（司机室/商务座/二等座/餐车/卫生间）+ 昼夜切换 + 画质选择（自动/低/中/高）+ 自由飞行开关
  - 底部：操作提示条（首次进入显示，可关闭）
  - 右下：全屏按钮
- **手势规范**：canvas `touch-action: none`（防浏览器手势抢戏）；全部热区 ≥ 48dp；300ms 内双击视为一次点击。
- **方向**：竖屏可完整游玩；首次进入提示「横屏体验更佳」，不强制锁定；`resize`/`orientationchange` 正确更新相机与渲染尺寸。
- **视口**：高度用 `100dvh`（防地址栏伸缩）；`env(safe-area-inset-*)` 全面屏安全区适配。

### 4.2 桌面端（完整但次要）

- WASD 移动，鼠标视角（Pointer Lock），Shift 跑
- E / 鼠标点击：交互
- **F**：切换自由飞行相机；**N**：昼夜切换；Esc：菜单
- 与移动端共用同一套菜单与提示条

### 4.3 碰撞

- 胶囊体（玩家）vs AABB/凸包（墙、座椅、吧台、门框）
- 门关闭时是实体，开启后可通行
- 相机高度钳制：不可钻座椅底、不可顶穿行李架
- 自由飞行免碰撞，但仍限制在车厢外壳之内

### 4.4 HUD

小 overlay 常显当前模式的的关键操作：桌面一行键位；移动端首次气泡 + 可展开。原则：随时可查、不遮挡画面中心。

---

## 5. 视觉与光照

- **配色**（CR400 风格，高辨识度致敬）：车体白灰 + 暖白灯带；商务座暗棕/香槟、二等座蓝灰织物、餐车木纹+白；车窗与前视野可见 CR400BF 式金红飘带涂装意象（无需完整车体建模）。
- **光照**：低强度 `HemisphereLight` 打底；顶灯带用 emissive 材质模拟；中高档允许 2–3 个 `RectAreaLight`/`PointLight`；白天加 1 个窗外 `DirectionalLight`。
- **阴影**：仅高档开 1 张 1024 shadow map（窗光）；中低档无实时阴影，用预置顶面变暗/暗角近似 AO。
- **昼夜切换（N）**：夜晚窗光熄灭、灯带降功率、信息屏与指示灯成为主光源、窗外近黑。
- **emissive + （高档）bloom** 用于 LED 信息屏、指示灯、夜间灯带。
- 材质统一 `MeshStandardMaterial`，roughness/metalness 由程序化贴图驱动；贴图分辨率随档位（低 512 / 高 1024）。

---

## 6. 性能规格与设备分级（核心约束）

**启动探测信号**（全部免费）：`navigator.hardwareConcurrency`、`navigator.deviceMemory`、`navigator.gpu`、`gl.getParameter(MAX_TEXTURE_SIZE)`、`Math.min(devicePixelRatio, 3)`、`navigator.connection.effectiveType`、UA（WebView 检测）。

| 档位 | 触发条件（满足任一即降档） | dpr 上限 | 实时阴影 | 后处理 | 窗外景层数 | 车体晃动 | 帧率目标 |
|---|---|---|---|---|---|---|---|
| **低** | cores≤4 或 mem≤4GB 或 WebView 或 2g/3g | 1.0 | ✕ | ✕ | 1 | 关 | 30 稳定 |
| **中**（默认） | 其余安卓手机/平板 | 1.5 | ✕ | ✕ | 2 | 弱 | 30 稳定（尽力 60） |
| **高** | 桌面 / WebGPU 可用 / GPU 探测佳 | 2.0 | ✓ 1024 | bloom | 3 | 正常 | 60 稳定 |

- **自适应降档**：自动模式下，连续 4 s 平均帧耗时超预算 1.3× → 先以 0.25 步进降 dpr，再降整档；用户手动选档则不自动降（暂停逻辑仍生效）。
- **发热/续航**：`visibilitychange` 隐藏即停渲染循环；无输入且无动画播放 5 s 后暂停渲染至下一次输入（提供「演示模式」开关禁用此行为）。移动端中低档默认 30 fps 上限。
- **硬预算**（实现期用 `renderer.info` 持续盯）：

| 指标 | 预算 |
|---|---|
| 单视角可见三角形 | < 80,000（座椅全部 `InstancedMesh`） |
| draw calls / 帧 | < 60 |
| 纹理总内存 | < 80 MB |
| bundle（gzip，含 three） | < 300 KB |

---

## 7. 移动端专项

- **PWA**：manifest（横竖屏均支持）+ Service Worker 预缓存 app shell → 二次访问秒开、可添加到主屏幕全屏启动。
- **加载体验**：程序化场景生成分帧执行（每帧生成预算 < 8 ms）+ 百分比进度条；首屏目标 < 3 s（中端机、3G 模拟）。
- **降级路径**：WebGL 不可用 / 老内核 WebView → 优雅错误页；Phase 2 补一张静态全景图 fallback。
- **微信 WebView 已知坑**：fullscreen API 受限、手势冲突——降级路径明确并写入测试清单。
- **调试后门**：`?debug=1` 显示 FPS / 帧耗时 / draw calls / 三角形数面板（桌面与真机 `chrome://inspect` 均可用）。

---

## 8. 技术架构

- Vite 5+ / Three.js（npm 当前稳定版），ES modules，按需 import。
- 模块划分建议：`main`（装配）/ `scene-builder`（车厢搭建）/ `controls`（桌面+触摸统一）/ `interaction`（raycast + 物件状态机）/ `quality`（探测+档位+自适应）/ `window-world`（窗外景）/ `ui`（HUD）。
- 几何全部程序化；贴图 `CanvasTexture` 程序化生成（织物纹、地毯纹、木纹、金属拉丝、窗外景色层）。
- 状态用简单模块级状态机，**不引入 UI 框架**（无 React）。
- `npm run build` → `dist/` 纯静态。

## 9. 部署

- **首选 Cloudflare Pages**：连 Git 仓库，构建命令 `npm run build`，输出目录 `dist`；免费 HTTPS + 全球 CDN + 不限带宽；每次 push 自动上线。
- 备选 GitHub Pages（注意 Vite `base: '/repo-name/'` 配置）。
- 未来若需轻后端（访问统计等）：Cloudflare Workers + KV，不改变本架构。

## 10. 验收标准

**功能**
1. `npm run dev` 一键起；`npm run build` 产物纯静态、本地 preview 可玩。
2. 5 个跳转点（司机室/商务座/二等座/餐车/卫生间）全部可达，全程无穿模。
3. 交互物件全部有效：感应门 ×3、窗帘 ×N、二等座靠背/桌板、商务座展平、热水机（P2）。
4. 昼夜切换 < 1 s 生效；隧道循环正常；窗外景持续滚动无跳变。
5. 桌面键位全工作；移动端摇杆 + 视角 + 点击全工作，热区 ≥ 48dp，无浏览器手势冲突。
6. `?debug=1` 面板数据可见。

**性能（真机验收）**
7. 中端安卓（骁龙 7 系 / 6GB）Chrome：中档漫游 95 分位帧耗时 < 33 ms。
8. 桌面 60 fps；平板（dpr 硬 cap 2）中档 ≥ 30 fps。
9. Lighthouse mobile：FCP < 3 s；bundle gzip < 300 KB；PWA 可安装（P2 验收）。
10. 标签页切后台后 CPU 归零（任务管理器验证）。

## 11. 分期范围

| 阶段 | 内容 |
|---|---|
| **Phase 1（MVP）** | 二等座车全功能 + 触摸/桌面双控制 + 碰撞 + 跳转（车内 2 点）+ 白天窗外 2 层视差 + 昼夜切换 + 三档画质 + 自适应降档 + debug 面板 |
| **Phase 2** | 商务座车 + 餐车 + 司机室 + 5 点跳转 + 隧道循环 + 热水机交互 + PWA + WebGL 不可用降级页 |
| **Phase 3** | WebAudio 合成报站/门提示音（**已确认要做**；默认静音、界面开关）、行李放置动画、座椅旋转、旅程循环（出站-巡航-到站）、WebGPURenderer 可选路径 |

## 12. 决策记录（2026-10-23 已拍板）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 一等座（2+2）是否纳入 | **砍**，任何阶段都不做（商务+二等+餐车已覆盖全部意象） |
| 2 | 声音 | **要做**，放 Phase 3（WebAudio 合成报站/门音，默认静音带开关） |
| 3 | 竖屏策略 | 按建议：竖屏可完整游玩 + 首次进入提示「横屏体验更佳」，不强制 |
| 4 | 品牌外观 | 高辨识度致敬复兴号风格（金红飘带意象、内饰配色），不用官方 LOGO；私用风险用户已确认接受 |

**分发约束**：用户指定所有任务不派发给 `pi`；实现与评审在 `claude_code` / `codex` / `agy` 之间交叉进行。

## 13. 附录：可直接派发的实现提示词（压缩版）

```text
Build a mobile-first 3D Chinese high-speed-rail (CR400-style EMU) interior
I can explore in the browser.

- One-page app with Three.js and Vite. Run it with: npm run dev.
  ALL geometry and textures procedural (CanvasTexture), zero external assets,
  gzip bundle < 300KB.
- Model a 3-car consist linked by gangways with auto-sensing doors:
  driver cab (visible through glass door, instrument panel), business class
  (1+2 seats that recline flat), second class (3+2 rows, luggage racks, hot-water
  station, washroom with squat + seated toilets), café bar car. Real-ish
  dimensions (~24m long, ~3.1m wide interior). High-recognition Fuxing-style
  look (e.g. CR400BF gold-red stripe livery visible through windows), but no
  official logos or wordmarks.
- Touch-first controls: left virtual joystick to walk, right-side drag to look,
  tap to interact (doors, window shades, seat recline, tray tables); hotspots
  >= 48dp, touch-action: none, 100dvh, safe-area insets. Desktop: WASD, mouse
  look (pointer lock), Shift run, E interact, F free-fly camera, N day/night.
- Collisions so I can't walk through walls or seats. Menu to jump to
  Cab / Business / Second Class / Café / Lavatory.
- Procedural window world: parallax scrolling fields, mountains, viaduct piers
  and rhythmically passing catenary poles by day; periodic tunnel passages;
  night mode with cabin reflections. Slight car sway.
- Device tiering on boot (cores / deviceMemory / dpr / WebView / effectiveType):
  low-mid-high presets for pixel ratio (cap 2), shadows, post-processing and
  scenery layers; auto-degrade on sustained frame overrun; pause rendering when
  the tab is hidden or input idle. Target a stable 30fps on a mid-tier Android
  phone and 60fps on a laptop; show controls in a small overlay.
```
