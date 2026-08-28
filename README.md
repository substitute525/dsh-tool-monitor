# dsh-tool-monitor

> 一个 **dsh-plugin**：后台监听**文件**或**命令输出**，输出到达时唤醒所属会话，并在 Web 会话头部提供实时监听的列表与输出查看面板。MIT License。

## 功能

- **后台监听**：`monitor_start` 对 `file` 或 `command` 发起后台监听，返回 `monitor_id` 后立即继续。
- **触发唤醒**：默认在监听到**任意新输出**时唤醒；可用 `pattern`（JS 正则）限定只对匹配输出触发。
- **模型可见的四个工具**（宿主层注册，所有 preset 的所有会话可用）：
  - `monitor_start` — 启动监听。参数：`source`(file|command)、`path`/`command`、`duration_seconds`(0=持续到会话/插件停止)、`interval_ms`(默认3000)、`pattern`(正则，仅匹配触发)、`initial_snapshot`(file 现有内容作为首批)、`one_shot`(首次触发后自动停止)、`max_chars`(缓冲尾保留，默认4000)
  - `monitor_read(id)` — 增量读取（消费游标，同 `job_output`）
  - `monitor_stop(id)` — 停止（command 会杀后台进程）
  - `monitor_list()` — 本会话可见的监听器
- **Web 会话头部**：提供「N 个监听器」控件，点开列出每个监听（状态点 / 时长 / 详情 / 停止钮），点某行按需展示保留输出。

## 机制

- **宿主自注册表**：monitor 存于插件自己的 `Map`（id 形如 `monitor-N`），状态词 `running / stopped / completed / failed`，**不写入 `ctx.jobs`**，因此不会出现在框架的「后台任务」列表里。
- **自有 WebSocket 推送**：宿主用公开缝 `ctx.get('webServer').registerUpgrade({ path: '/tool-monitor/ws' })` 注册专属 WS 端点，再用 `ws` 包的 `WebSocketServer.handleUpgrade` 握手。每次注册表变化（启动 / 停止 / 结束 / 移除）就给该会话的连接推一份 `{ type:'snapshot', monitors:[...] }`；新连接建立先发一次 baseline；**loopback 校验**拒绝非本地来源；插件卸载时注销路由。
- **客户端**：`new WebSocket(location.origin + '/tool-monitor/ws?sessionId=…')`，收到 snapshot 更新列表，掉线 1s 自动重连（重连后宿主补发 baseline）；**不轮询**、不依赖 `useSessions`。头部按钮复用了框架的 `StateDot` + `IconChevronDownOutline14`，与「后台任务」等控件视觉一致。
- **输出按需读取**：模型端走 `monitor_read`（增量、消费游标）；Web 端点开行时经 `/tool-monitor` RPC `read`（保留窗口、非消费）。**输出不随推送下传**。
- **唤醒**：构造 `UserMessage`（source `{kind:'plugin', plugin:'tool-monitor', form:'notice', summary}`），owner idle 且预算内（默认连续 3 次，`agent/inbox/claimed` 收到用户消息即复位）→ `owner.followup(msg)`；否则 `owner.inject(msg)`。`agent/disposed` 或插件卸载会停止其所有监听。

## 安装

### 从源码 / 发行包放入 dsh profile

```powershell
# 1) 把包放进 profile 的 node_modules（按你发布的 scope 目录命名）
Copy-Item -Recurse -Force "<本包目录>" "C:\Users\HP\.dsh\profiles\web\node_modules\<你的 scope>\dsh-tool-monitor"

# 2) 在 profiles\web\cordis.patch.yml 注册：
#    - insert: [{ id: tool-monitor, name: '<你的 scope>/dsh-tool-monitor' }]

# 3) 重启 dsh web 应用，使宿主模块与新 client bundle 生效（刷新页面加载 client）
```

> 前提：dsh profile 需已组合 `webServer`（Web 版默认有）；headless 无 `webServer` 时插件仍可用（模型工具正常），只是没有 WS 推送。

### 通过包管理器安装（发布后）

按你发布到的 scope 安装，再按上面第 2、3 步注册并生效即可（包内 `dsh.client` 元数据会声明所需依赖）。

## 结构

- `lib/index.js` — Host 插件：`{name:'tool-monitor', inject:[...], Config(zod), apply}`；自注册表、每 tick 轮询、唤醒预算、`agent/disposed` 清理、`/tool-monitor/ws` 端点、`/tool-monitor` RPC（read/stop）。
- `lib/client.js` — Web 客户端半部（`window.__ModuleLoader__` 格式）：会话头部注册 `monitor-list`（order 30），连自有 WS 收 snapshot，点开查看/停止。
- 无构建步骤（`"type":"module"`，纯 ESM / 模块加载器格式）。

## 开源协议

[MIT](LICENSE)
