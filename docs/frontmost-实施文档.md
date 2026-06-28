# frontmost — 实施文档

> 📌 这是中文**设计稿 / 背景说明**，记录架构取舍与思路。面向使用者的权威安装与使用文档以根目录 [`README.md`](../README.md) 为准。

> A live "now using" badge for your Mac.
>
> 一个**框架无关**的"在线状态广播"组件：实时展示你 Mac 前台正在使用的软件（图标），切换 app 即时更新；做成可嵌入任意网页（博客、主页、GitHub Profile、文档站…）的小徽章。开源、各自部署、零开发者账号成本。
>
> 命名说明：`frontmost` 取自 macOS"前台应用"官方术语（frontmost application），精准、内行、不绑具体平台——为将来跨平台留门。标题暂带 Mac，是因为当前只实现了 macOS 采集端（见 §2「平台相关性」）。

---

## 1. 这是什么 / 设计目标

把"我现在在用什么软件"做成一个能嵌进**任何网页**（博客 / 个人主页 / GitHub Profile README / Notion / 文档站，框架无关：Astro / Next / Hugo / VitePress / 手写 HTML）的小徽章。核心约束与决策：

| 维度 | 决策 | 理由 |
|---|---|---|
| 颗粒度 | 只到 **app 级别**（图标 + 名字），不读窗口标题/网页 | 够用；且**无需任何 macOS 权限**，开箱即用 |
| 展示 | 展示 app **真实系统图标** | 零手工维护图标库，使用者跑什么就显示什么 |
| 框架无关 | **Web Component** 自包含组件（+ 可选 SVG 徽章） | 浏览器原生标准，任何站点可嵌，不与宿主框架耦合 |
| 后端 | **Cloudflare Workers + Durable Object**（图标另存 KV/R2） | 免费、稳定、全球边缘、一个部署搞定所有端点；DO 强一致且不受 KV 写限额约束（见 §3.5）|
| 分发 | **开源 + 各自部署** | 不依赖作者跑中心服务、不替别人付费、鉴权极简 |
| 采集端 | **Hammerspoon 起步 → CLI+launchd+Homebrew 成品** | 永远不需要 $99 开发者账号 |

---

## 2. 整体架构

```
┌──────────────┐   POST /update (带密钥)   ┌─────────────────┐   GET /current (公开,CORS)   ┌──────────────┐
│  采集端       │  ───────────────────────▶ │ Cloudflare       │  ◀────────────────────────── │  展示端       │
│ (Mac 常驻)    │   POST /icon (按需上传)    │ Worker +         │   GET /badge/:user.svg       │ (博客组件)    │
│ Hammerspoon   │   心跳 / 状态事件          │ Durable Object   │   GET /icon/:bundleid        │ Web Component │
│ →后续 CLI     │   (typed messages)        │ (presence actor) │   widget.js                  │ 轮询(隐藏暂停) │
└──────────────┘                          │ +图标存 KV/R2    │   ↑ no-store + cache-buster  │ →可升级 SSE   │
                                          └─────────────────┘                              └──────────────┘
```

> 写路径（采集端→DO）走强一致、低频；读路径（组件→`/current`）显式 `no-store` 并带 cache-buster，避免用户自己的 Cloudflare Cache Rules 把实时状态误缓存。后续如果要把读请求与访客数解耦，优先升级 SSE，而不是依赖站点级缓存规则。

三段职责：
- **采集端**：监听前台切换 + 睡眠/锁屏事件，发状态与心跳；按需上传图标字节。
- **中转**：存一条状态记录/用户 + 按 bundle id 存图标；对外提供只读端点（开 CORS）。
- **展示端**：轮询读状态，渲染图标 + 活跃状态。

### 平台相关性（为什么标题带 Mac、架构却不绑 Mac）
三段里**只有采集端是平台相关的**——中转（Worker+DO）是纯云端、展示端（Web Component）跑在浏览器，二者与操作系统无关、跨平台零改动。因此架构上把采集端定义为**可插拔 adapter**：后端只认一套**平台无关的上报契约**（typed message + 心跳 + 一个稳定的 app 标识符），每个 OS 写一个 adapter 去满足它。

- 当前**只实现 macOS adapter**（Hammerspoon / `NSWorkspace` / launchd / Keychain 这些都是 macOS 专属）。所以标题诚实地写 Mac。
- **Windows / Linux adapter 留作后续或社区 PR**，实现要点见 §7。后端与前端届时一行不用改。

> 一句话：**架构开放、实现聚焦**——门留着，但先把 Mac 一条路走通。

---

## 3. 关键设计（实现前必读）

### 3.1 图标：让采集端自带，别在博客里维护
- 采集端读系统真实图标（Hammerspoon: `hs.image.imageFromAppBundle`），降采样到 64/128px，**仅在"这个 bundle id 没传过"时**上传一次。
- 后端按 bundle id 存图标，走独立 `/icon/:bundleid` 端点，**缓存设很长**（图标几乎不变）。
- **轮询接口保持极小**：只回 `{ bundleId, name, status, lastHeartbeatAt }`（status 已在服务端推导好），不含图标字节。这样几秒一次的轮询负载几乎为零。

### 3.2 隐私即权限优势
只读 app 名字 / bundle id / 图标用的是 `NSWorkspace`，**不需要任何授权**；只有读窗口标题/网页内容才要 Accessibility / 屏幕录制权限。坚持 app 粒度 = 完美避开吓人的权限弹窗 = 开箱即用。

### 3.3 存活判断（本项目最有系统设计含量的部分）
服务器视角下，"合盖 / 锁屏 / 断网 / 崩溃 / 关机"**长得一模一样——都只是不再更新**。所以分两层。

**先拆状态模型（关键）。** 三类信息各写各的字段，**心跳永不覆盖 app / 锁屏状态**：

| 字段 | 谁更新 | 频率 | 说明 |
|---|---|---|---|
| `app` (bundleId, name) | 切换事件 | 低（几百/天）| 只在真的切 app 时写 |
| `presence` (active / locked / sleeping) | 锁屏/睡眠事件 | 极低 | 进程还活着时宣告 |
| `lastHeartbeatAt` | 心跳 | 60s 一次 | 只改这个；持久化在 DO storage，避免 DO 休眠/迁移后误判 |

采集端发**带类型的消息**，DO 按字段 merge，绝不整条覆盖：
```
{type:"switch", bundleId, name}      → 只动 app
{type:"lock"/"unlock"/"sleep"/"wake"} → 只动 presence
{type:"heartbeat"}                    → 只动 lastHeartbeatAt
```

**第一层：能宣告的主动宣告。** 采集端在安静下去前先发状态（这些事件触发时进程还活着，可靠）：
- 睡眠/唤醒：`NSWorkspace.willSleep / didWake`（Hammerspoon: `hs.caffeinate.watcher`）
- 锁屏/解锁：`screensDidLock / screensDidUnlock`（同上 watcher）
- 进程退出：**只能尽力同步发一次** beacon（`hs.shutdownCallback` 必须同步、不能跑异步任务），**绝不作为机制依赖**

→ 徽章能显示 `💤 睡眠中` / `🔒 锁屏中`，而非瞎猜。

**第二层：宣告不了的靠心跳超时兜底。** 硬杀 / 崩溃 / 拔电 / 断网来不及说话，**这才是离线的真正判定来源**：
- 采集端每 **60s** 发一次轻量心跳，只更新 `lastHeartbeatAt`。
- `offline` **永不落库**，读时推导。

**读时推导 status（服务器在 `/current` 计算，前端只渲染）：**
```
status = (now - lastHeartbeatAt > 150s) ? "offline"   // 兜住崩溃/断网/关机，盖过一切
       : presence !== "active"          ? presence    // 锁屏/睡眠（宣告值）
       : "active"                                      // 显示 app + "X 秒前活跃"
```

> 为什么心跳不能写 KV、为什么用 DO —— 见 §3.5。

### 3.4 鉴权
- 每个部署一个密钥，写接口校验 `Authorization: Bearer <secret>`。
- 密钥**存 macOS Keychain**，不要明文写进 config（这是"安全又优雅"的关键）。
- 因为各自部署，鉴权天然极简——一个你自己掌握的 secret，无需多用户体系。

### 3.5 存储选型：为什么是 Durable Object 而不是 KV
KV 看着像最省事的选择，但它**两个硬伤直接撞上本项目**（均经官方文档确认）：

- **免费版每天只能写 1,000 次。** 60s 心跳光自己就 1,440 写/天，第一天就触顶报错，还没算切换。
- **最终一致。** 官方明说：更新频率超过每分钟一次、或多数据中心并发时，KV 可能返回非最新数据；这类场景应改用 Durable Object。与"实时展示"直接冲突。

**Durable Object 正好对症**（2025-04 起免费版可用，仅 SQLite 后端，每天 10 万请求 / 13,000 GB-s 时长）：
- **强一致**：单线程 actor，读到的就是最新，无 KV 那种漂移。
- **不受 KV 写限额约束**：心跳只写 DO storage，不写 KV；app/锁屏也在同一个 actor 内合并更新。
- **是 presence 的标准解**：Cloudflare 自己就拿它做实时/在线状态。
- **天然长出 SSE/WebSocket**：升级实时推送时无需换架构（见 §6 升级路径）。

> 成本注意：DO 按"活跃时长"计费，但 **hibernation** 让它两次心跳间休眠、空闲不计时长；60s 心跳每次只唤醒几毫秒，离 13,000 GB-s/天差着量级。真想再省，心跳放宽到 90~120s、阈值相应放大。
>
> 图标字节不放 DO，单独存 **KV 或 R2**（写极低频、读走长缓存），各取所长。

---

## 4. 数据模型与 API

**DO presence actor（每用户一个实例，`idFromName(user)`）。** 实例内部状态按字段分开存，心跳只碰 `lastHeartbeatAt`：
```js
// DO 内部状态（持久化到 DO storage）
{
  app: { bundleId: "com.anthropic.claude", name: "Claude" },
  presence: "active",          // active | locked | sleeping （宣告值，不含 offline）
  lastHeartbeatAt: 1718400000  // 仅心跳更新；offline 由它读时推导，不存储
}
// GET /current 返回时才计算出对外的 status（见 §3.3 推导式）
```
**图标**：不放 DO，单独存 **KV/R2**（key 如 `icon:com.anthropic.claude`，PNG 字节）。

**端点：**
| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/update` | ✅ Bearer | 上报 typed message（switch / lock / sleep / heartbeat…）→ 转发给该用户的 DO |
| POST | `/icon/:bundleId` | ✅ Bearer | 上传图标字节（按需，去重）→ KV/R2 |
| GET | `/current?user=` | ❌ 公开(CORS) | 读 DO，**读时推导 status** 后返回；`no-store` |
| GET | `/icon/:bundleId` | ❌ 公开 | 返回图标，长缓存 |
| GET | `/badge/:user.svg` | ❌ 公开 | 服务端渲染 SVG 徽章（彩蛋形态）|
| GET | `/widget.js` | ❌ 公开 | Web Component 脚本 |

> - 所有 GET 必须开放 **CORS**（`Access-Control-Allow-Origin: *`），否则别人的博客域名 fetch 不动——框架无关的关键一环。
> - `/current` 必须显式 `Cache-Control: no-store`，组件请求也带 cache-buster。这个项目是实时状态，用户域名上的 Cache Everything / Cache Rules 很容易造成旧 app 卡住。

---

## 5. 分阶段实施路线

> 原则：**先用 Hammerspoon 打通完整链路验证产品价值，确认值得后再产品化**。每个 Phase 结束都应是一个可独立验证的里程碑。

### Phase 0 — 前置准备
1. 注册 Cloudflare 账号，安装 `wrangler` CLI。
2. `brew install hammerspoon`，打开一次确认能跑。
3. 确定你的 user id（如 `bazinga`）和一个写密钥（先随便定，后续进 Keychain）。
- ✅ 里程碑：工具链就绪。

### Phase 1 — 后端最小闭环（Durable Object）
1. `wrangler init`，在 `wrangler.toml` 声明一个 Durable Object 绑定（SQLite 后端）+ 一个 KV namespace（仅给图标用）。
2. 写 DO 类 `PresenceActor`：持有 `app / presence / lastHeartbeatAt`，按 typed message 分字段 merge（心跳只动 `lastHeartbeatAt`）。
3. Worker 路由：`POST /update`（校验 Bearer → `idFromName(user)` 拿 stub → 转发给 DO）。
4. `GET /current`：读 DO → **读时推导 status**（§3.3 式）→ 开 CORS + `Cache-Control: no-store`。
5. 用 `curl` 分别发 `switch` / `heartbeat` / 等超时，验证 status 推导正确。
- ✅ 里程碑：心跳不写 KV；切换/锁屏/超时三种输入都能读出正确 status。

### Phase 2 — 采集端 MVP（Hammerspoon）
1. 写 `init.lua`：用 `hs.application.watcher` 监听 `activated` 事件，取 `app:bundleID()` 和名字。
2. 切换时 `hs.http.asyncPost` 打到 `/update`（密钥先写在脚本里，Phase 7 再迁 Keychain）。
3. 加 `hs.timer.doEvery(60, ...)` 发心跳。
4. **亲自验证重启自启**：Hammerspoon 偏好里勾上 *Launch at login* → 重启 → 确认徽章自己复活。
- ✅ 里程碑：切 app，`/current` 实时变化；重启后无人值守自动恢复。

```lua
-- init.lua 核心骨架（示意）
local ENDPOINT = "https://<你的worker>/update"
local SECRET = "Bearer <你的密钥>"  -- Phase 7 迁移到 Keychain
local function report(payload)
  hs.http.asyncPost(ENDPOINT, hs.json.encode(payload),
    { ["Authorization"]=SECRET, ["Content-Type"]="application/json" },
    function(code) end)
end
appWatcher = hs.application.watcher.new(function(name, event, app)
  if event == hs.application.watcher.activated then
    report({ type = "switch", bundleId = app:bundleID(), name = name })
  end
end):start()
hs.timer.doEvery(60, function() report({ type = "heartbeat" }) end)
```

### Phase 3 — 展示端（Web Component）
1. 写 `widget.js`：定义自定义元素 `<frontmost-badge>`，用 Shadow DOM 隔离样式。
2. 属性读 `user`、可选 `endpoint`；`connectedCallback` 里启动 3~5s 轮询 `/current`。
3. **必做：用 Page Visibility API 在标签页隐藏/移除时暂停轮询**（`document.hidden` / `visibilitychange` / `disconnectedCallback`）——否则一个常开页面一天就 1.7 万次请求。配合 §4 的边缘缓存，读路径成本与访客数解耦。
4. 渲染：图标 `<img src=".../icon/:bundleId">` + 名字 + "X 秒前活跃"。
5. 在一个测试 HTML 里引入验证，再贴到博客实测（验证 CORS）。
- ✅ 里程碑：博客上出现徽章，切 app 几秒内跟着变；切到别的标签页时轮询停止。

```html
<!-- 使用方只需两行 -->
<script src="https://<你的worker>/widget.js"></script>
<frontmost-badge user="bazinga"></frontmost-badge>
```

### Phase 4 — 图标管线
1. 采集端读图标（`hs.image.imageFromAppBundle(bundleId)`），降采样、编码。
2. **去重**：本地记一份"已上传 bundle id 集合"，没传过才 `POST /icon/:bundleId`。
3. 后端存图标 + `GET /icon/:bundleId` 长缓存返回。
4. 前端图标加载失败时显示兜底占位。
- ✅ 里程碑：真实 app 图标显示出来，且重复切换不再重复上传。

### Phase 5 — 存活判断完善
1. 采集端接入 `hs.caffeinate.watcher`：睡眠/唤醒、锁屏/解锁分别上报 `type: sleep/wake/lock/unlock`（进程活着时宣告，可靠）。
2. 退出 beacon **只在 `shutdownCallback` 里同步尽力发一次**，不跑异步、不作为依赖；真正的离线判定永远靠心跳超时。
3. 后端落实 §3.3 读时推导（心跳过期 > 宣告 presence > active），`offline` 不存储。
4. 前端为 `locked / sleeping / offline` 设计不同视觉（图标变灰 + 文案）。
- ✅ 里程碑：合盖、锁屏、断网三种情况徽章都显示正确，不再停在旧 app。

### Phase 6 —（可选）SVG 徽章彩蛋
1. 实现 `GET /badge/:user.svg`，服务端把当前图标 + 状态拼成 SVG 返回。
2. 用 `<img src=".../badge/bazinga.svg">` 即可，零 JS，可放 Markdown / GitHub README。
- 注意：`<img>` 仅页面加载时取一次，不自动刷新，适合"够用就好"的场景。
- ✅ 里程碑：README 里也能挂一个静态当前状态。

### Phase 7 — 产品化与开源分发
1. 把采集端从 Hammerspoon 重写为 **CLI 后台程序**（Go / Rust 单文件，或 Node 脚本）。
2. 用 `launchd` 注册开机自启；密钥迁入 **Keychain**（`security` 命令读取）。
3. 做 **Homebrew tap**：`brew install <you>/tap/frontmost` 一行完成"安装 + 注册自启"。
4. 后端提供 **Deploy to Cloudflare** 按钮，使用者部署自己的 Worker、设自己的 secret。
5. 写 README：嵌入两行用法 + 部署引导。
- ✅ 里程碑：陌生技术博主能 `brew install` + 点 Deploy 在十分钟内用上。

---

## 6. 升级路径与未来可选

**正式升级路径：轮询 → SSE 推送（DO 已为此铺好）。** MVP 用"轮询 + 隐藏暂停 + 边缘缓存"足够；当你想要真·实时（切换零延迟、且彻底消灭逐访客轮询成本）时，把 `/current` 换成从 DO 建立 **SSE 连接**：DO 在 `app/presence` 变化时主动推送，并用 **alarm** 在心跳超时那一刻推一条 `offline`。DO 原生支持 WebSocket/SSE 且带 hibernation（空闲不计时长），所以这步**不换架构、不加新依赖**，是这版选 DO 最大的红利。SSE 比 WebSocket 简单、单向正好够用，优先它。

**未来可选（不进主链路）：**
- **Swift 菜单栏 app**：托盘图标 + "隐身/退出"开关，体验最像成品。代价是回到 Gatekeeper / $99 公证那条路，留到"真想做精致产品"时再说。
- **MCP resource**：把同一份状态额外暴露成 MCP 资源，让某个 agent 能读"Bazinga 现在在干嘛"。是个 flex，不是架构；练 agent 时可加。
- **临时隐身开关**：CLI `frontmost pause` / 菜单栏开关，一键停止广播。

---

## 7. 分发现实税（避坑备忘）

**macOS（当前实现）：**
- **代码签名 / 公证都要 $99/年账号**；没有它 .app 能跑，但用户要"右键打开"，且系统大版本更新后越来越别扭。
- 本项目刻意选的路线**永远不需要 $99**：Hammerspoon（其自身已公证）→ CLI（源码/Homebrew 装的可执行文件不强制走公证）。
- **Homebrew Cask 会自动清除 quarantine 标记**，所以经 brew 装的东西即使没签名也能直接打开——这是"没签名却体验干净"的秘密。

**Windows / Linux adapter（后续或社区 PR，三个必踩的坑）：**
后端与前端完全复用、一行不用改；要写的只是一个满足上报契约的新 adapter。但别低估，至少三处与 macOS 不同：
1. **前台进程读取**：Windows 用 `GetForegroundWindow → GetWindowThreadProcessId` 拿进程/可执行文件名（AutoHotkey、PowerShell、.NET/Rust 均可）；睡眠/锁屏对应 `WM_POWERBROADCAST` 与会话锁定通知。Linux 因 X11/Wayland 差异更碎，X11 有 `_NET_ACTIVE_WINDOW`，Wayland 各合成器不一。
2. **app 标识符**：macOS 有干净稳定的 bundle id（`com.anthropic.claude`）；Windows 没有统一等价物，得用可执行文件名（`Claude.exe`）或 AUMID，**去重 key 与图标对应关系要重新设计**——这点要在上报契约里预留好"标识符可能不是 bundle id"。
3. **图标提取 + 分发**：图标格式不同（exe 内嵌 ICO vs icns），提取另写一套；分发面对的是 SmartScreen 拦未签名 exe、winget/scoop/MSIX 各自打包，等于这一节要为每个平台各写一份。

---

## 8. 一页速查
- 名字：**frontmost**（取自 macOS 前台应用术语，不绑平台），标签 `<frontmost-badge>`；副标题 *A live "now using" badge for your Mac.*
- 栈：Hammerspoon（起步）/ CLI+launchd+Homebrew（成品） + Cloudflare Workers + **Durable Object**（图标存 KV/R2） + Web Component。
- 四铁律：① app 粒度免权限；② 图标采集端自带、轮询接口极小；③ **状态拆三份**（app/presence/lastHeartbeatAt），心跳只动后者，offline 读时推导不存储；④ **写走 DO 强一致、读走边缘缓存 + 隐藏暂停**。
- 为什么 DO 不 KV：KV 免费版写 1,000/天（心跳就超）+ 最终一致；DO 强一致、心跳只改内存、还能无缝长出 SSE。
- 跨平台：**只有采集端绑 OS**，设计为可插拔 adapter；当前只做 macOS，Win/Linux 留作后续（坑见 §7）。
- 路线：先 Hammerspoon 打通验证 → 值得再产品化为 brew 安装的 CLI；实时需求出现再把轮询换 SSE。
