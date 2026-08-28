window.__ModuleLoader__.load({
	id: "@caizhiyuan/dsh-tool-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var _primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		var CHANNEL = "/tool-monitor";

		// ------------------------------------------------------------------
		// CSS (inline, guarded by data-plugin-css tag id).
		// ------------------------------------------------------------------
		var TAG_ID = "@deepseek-ai/dsh-tool-monitor/ui.css";
		var css = "\n"
			+ ".mn-root{position:relative}\n"
			+ ".mn-trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:3px;padding:3px 2px;font-size:12px;line-height:18px;display:inline-flex}\n"
			+ ".mn-trigger:hover,.mn-trigger:focus-visible{color:var(--dsw-alias-label-secondary)}\n"
			+ ".mn-trigger svg{transition:transform .12s}\n"
			+ ".mn-triggerDot{flex:none}\n"
			+ ".mn-triggerOpen{transform:rotate(180deg)}\n"
			+ ".mn-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-fill-l3,#c8ccd2)}\n"
			+ ".mn-dot--ongoing{background:#38bdf8}\n"
			+ ".mn-dot--done{background:var(--dsw-alias-status-success,#34c38f)}\n"
			+ ".mn-dot--warning{background:#f59e0b}\n"
			+ ".mn-dot--error{background:#ef4444}\n"
			+ ".mn-count{margin:0 5px}\n"
			+ ".mn-menu{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);width:400px;max-width:min(440px,100vw - 32px);max-height:min(480px,100vh - 140px);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;flex-direction:column;gap:1px;margin:0;padding:4px;list-style:none;display:flex;position:absolute;top:calc(100% + 5px);left:0;overflow:auto}\n"
			+ ".mn-row{box-sizing:border-box;width:100%;min-height:32px;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:8px;padding:6px 8px;font-size:13px;line-height:18px;display:flex;cursor:pointer}\n"
			+ ".mn-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}\n"
			+ ".mn-rowSettled{color:var(--dsw-alias-label-tertiary)}\n"
			+ ".mn-kind{background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);border-radius:5px;flex:none;padding:0 6px;font-size:11px;line-height:18px}\n"
			+ ".mn-label{min-width:0;font-family:var(--dsw-font-mono);white-space:nowrap;text-overflow:ellipsis;flex:1;overflow:hidden}\n"
			+ ".mn-status{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px;white-space:nowrap;text-overflow:ellipsis;max-width:38%;overflow:hidden}\n"
			+ ".mn-duration{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}\n"
			+ ".mn-stop{flex:none;border:0;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;padding:0 4px;border-radius:5px}\n"
			+ ".mn-stop:hover{color:#ef4444;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}\n"
			+ ".mn-output{border-top:1px solid var(--dsw-alias-border-l2);margin:2px 6px 6px;padding:8px;display:block}\n"
			+ ".mn-output__head{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);padding:0 2px 4px}\n"
			+ ".mn-output__pre{box-sizing:border-box;margin:0;padding:8px;background:var(--dsw-alias-fill-l2,rgba(0,0,0,.04));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;max-height:220px;overflow:auto;font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary)}\n"
			+ ".mn-error{color:#ef4444;padding:8px;font-size:12px;line-height:18px;text-align:center}\n";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
			var styleTag = document.createElement("style");
			styleTag.dataset.plugin = "@deepseek-ai/dsh-tool-monitor";
			styleTag.dataset.pluginCss = TAG_ID;
			styleTag.textContent = css;
			document.head.appendChild(styleTag);
		}

		// ------------------------------------------------------------------
		// Dictionaries (zh source of truth, en key-identical).
		// ------------------------------------------------------------------
		var zh = {
			"count.live.one": "{count} 个监听器运行中",
			"count.live.other": "{count} 个监听器运行中",
			"count.idle.one": "{count} 个监听器",
			"count.idle.other": "{count} 个监听器",
			"list.aria": "后台监听器",
			"status.running": "运行中",
			"status.stopped": "已停止",
			"status.completed": "已完成",
			"status.failed": "已失败",
			"action.stop": "停止",
			"output.title": "输出（保留最近内容）",
			"output.empty": "（暂无输出）",
			"output.truncated": "（输出超出保留上限，较早内容已丢弃）",
			"error.load": "加载失败：{message}",
			"duration.seconds": "{seconds}秒",
			"duration.minutes": "{minutes}分{seconds}秒",
			"duration.hours": "{hours}小时{minutes}分",
			"duration.title.live": "已运行 {duration}",
			"duration.title.done": "耗时 {duration}"
		};
		var en = {
			"count.live.one": "{count} monitor running",
			"count.live.other": "{count} monitors running",
			"count.idle.one": "{count} monitor",
			"count.idle.other": "{count} monitors",
			"list.aria": "Background monitors",
			"status.running": "running",
			"status.stopped": "stopped",
			"status.completed": "completed",
			"status.failed": "failed",
			"action.stop": "stop",
			"output.title": "Output (retained window)",
			"output.empty": "(no output yet)",
			"output.truncated": "(output exceeded the retention bound; older content dropped)",
			"error.load": "Failed to load: {message}",
			"duration.seconds": "{seconds}s",
			"duration.minutes": "{minutes}m {seconds}s",
			"duration.hours": "{hours}h {minutes}m",
			"duration.title.live": "Running for {duration}",
			"duration.title.done": "Took {duration}"
		};

		// ------------------------------------------------------------------
		// Helpers (module scope — survive even if apply throws).
		// ------------------------------------------------------------------
		/** Stable empty list so a session with no monitors keeps one array identity. */
		var NO_MONITORS = [];
		function isLive(m) { return m.status === "running"; }
		function dotState(status) {
			switch (status) {
				case "running": return "ongoing";
				case "stopped": return "warning";
				case "completed": return "done";
				case "failed": return "error";
				default: return "done";
			}
		}
		function statusLabel(status, t) {
			switch (status) {
				case "running": return t("status.running");
				case "stopped": return t("status.stopped");
				case "completed": return t("status.completed");
				case "failed": return t("status.failed");
				default: return status;
			}
		}
		function ordered(list) {
			return list.slice().sort(function(a, b) {
				var la = isLive(a);
				if (la !== isLive(b)) return la ? -1 : 1;
				if (la) return a.startedAt - b.startedAt;
				var fb = (b.finishedAt || b.startedAt) - (a.finishedAt || a.startedAt);
				return fb !== 0 ? fb : a.startedAt - b.startedAt;
			});
		}
		function formatDuration(elapsedMs, t) {
			var total = Math.max(0, Math.floor(elapsedMs / 1000));
			var seconds = total % 60;
			var minutes = Math.floor(total / 60) % 60;
			var hours = Math.floor(total / 3600);
			if (hours > 0) return t("duration.hours", { hours: hours, minutes: minutes });
			if (minutes > 0) return t("duration.minutes", { minutes: minutes, seconds: seconds });
			return t("duration.seconds", { seconds: seconds });
		}

		// ------------------------------------------------------------------
		// MonitorsAction — connects to the plugin's own /tool-monitor/ws (self
		// contained, separate from the harness connection), receives a full
		// `snapshot` on every change, reconnects on drop, and renders from it.
		// Output is fetched on demand via the /tool-monitor RPC when a row is
		// expanded. Renders nothing when the session has no monitors.
		// ------------------------------------------------------------------
		function MonitorsAction(props) {
			var sessionId = props.sessionId;
			var t = props.t;
			var ctx = props.__ctx;
			if (!ctx) return null;
			var connection = ctx.get("connection");

			var _open = React.useState(false);
			var open = _open[0], setOpen = _open[1];
			var _sel = React.useState(undefined);
			var selected = _sel[0], setSelected = _sel[1];
			var _out = React.useState({});
			var output = _out[0], setOutput = _out[1];
			var _mon = React.useState(NO_MONITORS);
			var monitors = _mon[0], setMonitors = _mon[1];
			var _now = React.useState(function() { return Date.now(); });
			var now = _now[0], setNow = _now[1];
			var rootRef = React.useRef(null);

			// Open the dedicated WS; the host pushes a snapshot on connect
			// (baseline) and on every monitor change. Reconnect with backoff.
			React.useEffect(function() {
				if (!sessionId) return;
				var ws;
				var closed = false;
				var timer;
				var base = (typeof location !== "undefined" && location.origin) ? location.origin : "";
				function connect() {
					ws = new WebSocket(base + "/tool-monitor/ws?sessionId=" + encodeURIComponent(sessionId));
					ws.onmessage = function(ev) {
						try {
							var msg = JSON.parse(ev.data);
							if (msg && msg.type === "snapshot") setMonitors(msg.monitors || NO_MONITORS);
						} catch (_) {}
					};
					ws.onclose = function() { if (!closed) timer = setTimeout(connect, 1000); };
					ws.onerror = function() { try { ws.close(); } catch (_) {} };
				}
				connect();
				return function() { closed = true; if (timer) clearTimeout(timer); try { if (ws) ws.close(); } catch (_) {} };
			}, [sessionId]);

			function refreshOutput(id) {
				if (!connection) return;
				connection.rpc.call(CHANNEL, "read", { sessionId: sessionId, monitorId: id }).then(function(r) {
					if (r.ok) setOutput(function(o) { var n = Object.assign({}, o); n[id] = { text: r.value.text, lossy: !!r.value.lossy }; return n; });
				}).catch(function() {});
			}
			function stopOne(id) {
				if (!connection) return;
				connection.rpc.call(CHANNEL, "stop", { sessionId: sessionId, monitorId: id }).then(function(r) {
					if (r.ok) setOutput(function(o) { var n = Object.assign({}, o); n[id] = { text: r.value.text, lossy: !!r.value.lossy }; return n; });
				}).catch(function() {});
			}

			var rows = React.useMemo(function() { return ordered(monitors); }, [monitors]);
			var liveCount = React.useMemo(function() {
				var n = 0;
				for (var i = 0; i < monitors.length; i++) if (isLive(monitors[i])) n++;
				return n;
			}, [monitors]);

			// Live durations tick once a second while the panel is open and a live monitor exists.
			React.useEffect(function() {
				if (!open) return;
				if (liveCount === 0) return;
				setNow(Date.now());
				var timer = setInterval(function() { setNow(Date.now()); }, 1000);
				return function() { clearInterval(timer); };
			}, [open, liveCount]);

			// Fetch retained output on demand when a row is expanded.
			React.useEffect(function() {
				if (!open || selected === undefined) return;
				refreshOutput(selected);
			}, [open, selected]);

			// Close when the last monitor disappears.
			React.useEffect(function() {
				if (monitors.length === 0 && open) setOpen(false);
			}, [monitors.length, open]);

			// Click outside to close.
			React.useEffect(function() {
				if (!open) return;
				var down = function(e) {
					if (rootRef.current !== null && !rootRef.current.contains(e.target)) setOpen(false);
				};
				document.addEventListener("mousedown", down);
				return function() { document.removeEventListener("mousedown", down); };
			}, [open]);

			// Escape to close.
			React.useEffect(function() {
				if (!open) return;
				var key = function(e) { if (e.key === "Escape") setOpen(false); };
				document.addEventListener("keydown", key);
				return function() { document.removeEventListener("keydown", key); };
			}, [open]);

			if (monitors.length === 0) return null;

			var countLabel = t(
				liveCount > 0 ? "count.live.one" : (monitors.length === 1 ? "count.idle.one" : "count.idle.other"),
				{ count: liveCount > 0 ? liveCount : monitors.length }
			);

			return React.createElement("div", { ref: rootRef, className: "mn-root" },
				React.createElement("button", {
					type: "button", className: "mn-trigger",
					"aria-expanded": open, "aria-label": countLabel,
					onClick: function() {
						setNow(Date.now());
						setOpen(function(c) { return !c; });
					}
				},
					liveCount > 0 ? React.createElement(_primitives.StateDot, { state: "ongoing", className: "mn-triggerDot" }) : null,
					React.createElement("span", { className: "mn-count" }, countLabel),
					React.createElement(_primitives.IconChevronDownOutline14, { className: open ? "mn-triggerOpen" : undefined })
				),
				open ? React.createElement("div", { className: "mn-menu", role: "list", "aria-label": t("list.aria") },
					rows.map(function(m) {
						var live = isLive(m);
						var duration = formatDuration(live ? now - m.startedAt : (m.finishedAt || m.startedAt) - m.startedAt, t);
						var status = statusLabel(m.status, t);
						var out = selected === m.monitor_id ? output[m.monitor_id] : undefined;
						return React.createElement(React.Fragment, { key: m.monitor_id },
							React.createElement("div", {
								className: "mn-row" + (live ? "" : " mn-rowSettled"),
								role: "listitem",
								onClick: function() { setSelected(function(cur) { return cur === m.monitor_id ? undefined : m.monitor_id; }); }
							},
								React.createElement("span", { className: "mn-dot mn-dot--" + dotState(m.status) }),
								React.createElement("span", { className: "mn-kind" }, m.kind),
								React.createElement("span", { className: "mn-label", title: m.label }, m.label),
								React.createElement("span", { className: "mn-status", title: m.detail || status }, m.detail || status),
								React.createElement("span", { className: "mn-duration", title: t(live ? "duration.title.live" : "duration.title.done", { duration: duration }) }, duration),
								live ? React.createElement("button", {
									type: "button", className: "mn-stop", title: t("action.stop"),
									onClick: function(e) { e.stopPropagation(); stopOne(m.monitor_id); }
								}, t("action.stop")) : null
							),
							out !== undefined ? React.createElement("div", { className: "mn-output" },
								React.createElement("div", { className: "mn-output__head" }, t("output.title")),
								React.createElement("pre", { className: "mn-output__pre" },
									(out.text.length > 0 ? out.text : t("output.empty")) + (out.lossy ? "\n" + t("output.truncated") : "")
								)
							) : null
						);
					})
				) : null
			);
		}

		// ------------------------------------------------------------------
		// Client plugin: register locale + header action.
		// Minimal apply — does NOT throw if services are missing.
		// ------------------------------------------------------------------
		var inject = ["slots", "locale"];

		function apply(ctx) {
			try { ctx.locale.register("monitor", { zh: zh, en: en }); } catch (_) {}
			try {
				var slots = ctx.get("slots");
				if (slots === undefined) return;
				slots.inject("conversation.session.header.actions", function() {
					return slots.register(
						{ name: "conversation.session.header.actions", id: "monitor-list", order: 30, locale: "monitor" },
						function MonitorsActionSlot(slotProps) {
							return React.createElement(MonitorsAction, Object.assign({}, slotProps, { __ctx: ctx }));
						}
					);
				});
			} catch (_) {}
		}

		exports.name = "tool-monitor";
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	},
});
