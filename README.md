# @substitute525/dsh-tool-monitor

Host 组合插件 + Web 客户端半部（`dsh-plugin`）：后台监听**文件**或**命令输出**，输出到达时唤醒所属会话（`followup`/`inject` 通知），并在 Web 会话头部提供监听器列表与输出查看面板。数据经插件自有的 `/tool-monitor/ws` WebSocket 推送（非 `ctx.jobs`，不污染后台任务列表）；输出在点开行时经 `/tool-monitor` RPC 按需读取。MIT License。

## 工具（模型可见，宿主层注册 ⇒ 所有 preset 的所有会话可用）

- `monitor_start` — 启动监听。参数：`source`(file|command)、`path`/`command`、`duration_seconds`(0=一直运行到会话/插件停止)、`interval_ms`(默认3000)、`pattern`(正则，仅匹配触发)、`initial_snapshot`(file 现有内容作为首批)、`one_shot`(首次触发后自动停止)、`max_chars`(缓冲尾保留，默认4000)
- `monitor_read(id)` — 增量读取（消费游标，同 job_output）
- `monitor_stop(id)` — 停止（command 会杀后台进程）
- `monitor_list()` — 本会话可见的监听器

## 唤醒机制

触发时构造 `UserMessage`（source: `{kind:'plugin', plugin:'tool-monitor', form:'notice', summary}`），owner idle 且预算内（默认连续3次，`agent/inbox/claimed` 中用户消息复位）→ `agent.followup(msg)`（`send(msg,'next-turn',true)`：入 inbox + 拉 driver，立即开新 turn；running 时 turn 边界接管）；否则 `agent.inject(msg)`（入队不唤醒，下次 pre-step 消费）。

## 安装

发布后：

```bash
# 若提供方把插件装进 profile
npm install @substitute525/dsh-tool-monitor
# 在 profiles\web\cordis.patch.yml 注册：
#   - insert: [{ id: tool-monitor, name: '@substitute525/dsh-tool-monitor' }]
```

本地开发（在本机 dsh profile 直接放置）：

```powershell
# 镜像 dsh-client-ui-usernav 先例：直接放 profile node_modules
Copy-Item -Recurse -Force "D:\self\dsh-tool-monitor" "C:\Users\HP\.dsh\profiles\web\node_modules\@substitute525\dsh-tool-monitor"
# 注册行已存在于 profiles\web\cordis.patch.yml；重启 dsh 使宿主模块与新 client bundle 生效
```

> 注意：profile 是 pnpm workspace（hoisted linker），未来执行 `pnpm install` 可能清理手工放置的包；重新执行上一步即可。源码规范位置即本目录。

## 结构

- `lib/index.js` — Host 插件：`{name:'tool-monitor', inject:['tools','systemPrompt','fs','shell','timer'], Config(zod), apply}`；内部监控注册表、每 tick 轮询（fs.readText 增量 / ShellProcess.readOutput）、唤醒预算、`agent/disposed` 清理；Web 连接存在时注册 `/tool-monitor` RPC 通道（list/read/stop，`authority:'loopback'`）
- `lib/client.js` — Web 客户端半部（`window.__ModuleLoader__` 格式）：会话头部 `conversation.session.header.actions` 注册 `monitor-list`（order 30），弹层列出监听器（状态点/时长/详情/停止钮），点击行经 RPC read 展示保留输出
- 无构建步骤（`"type":"module"`，纯 ESM/模块加载器格式），无打包器依赖

## License

[MIT](LICENSE)
