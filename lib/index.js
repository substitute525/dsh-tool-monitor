/**
 * `tool-monitor` — background monitors for files and command output.
 *
 * Model-facing `monitor_start`, `monitor_read`, `monitor_stop`, and
 * `monitor_list` tools over a process-local monitor registry, plus a
 * dedicated `/tool-monitor/ws` WebSocket live-push surface for the Web
 * session-header list. Monitors live in this plugin's own registry (NOT
 * `ctx.jobs`), so they never surface in the generic background-job list; the
 * browser connects to the plugin's own WS endpoint (registered on the public
 * `webServer.registerUpgrade` seam) and receives a full `snapshot` frame on
 * every monitor change, while the output stays a back-and-forth
 * `monitor_read` / web `read`.
 *
 * Each monitor polls a file (or a background `ShellProcess`) on a timer,
 * retains a bounded tail of output, and wakes its owning agent with a plugin
 * `notice` whenever triggering output arrives — `followup` (opens a turn)
 * while the owner is idle within a wake budget, `inject` (queued for the
 * next step, no wake) when the budget is spent or the owner is busy.
 * Monitors stop on duration expiry, `one_shot` first trigger, explicit
 * `monitor_stop`, owner disposal, or plugin unload; a terminated background
 * process is killed on the way out.
 *
 * @module @deepseek-ai/dsh-tool-monitor
 */
import z from '@deepseek-ai/schemastery';
import WebSocket, { WebSocketServer } from 'ws';
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'tool-monitor';
export const inject = ['tools', 'systemPrompt', 'fs', 'shell', 'timer', 'connection'];

export const Config = z.object({
    /** Poll/read interval applied when the caller omits `interval_ms`. */
    defaultIntervalMs: z.number().min(500).default(3000),
    /** Upper clamp for a caller-supplied `interval_ms`. */
    maxIntervalMs: z.number().min(500).default(600000),
    /** Tail retention bound for the buffered output, in characters. */
    defaultMaxChars: z.number().min(100).default(4000),
    /** Maximum simultaneously running monitors owned by one agent. */
    maxConcurrentPerOwner: z.number().min(1).max(64).default(8),
    /** Consecutive automatic wakes allowed before falling back to inject. */
    wakeBudget: z.number().min(1).max(20).default(3),
    /** Excerpt length carried in one wake notice, in characters. */
    noticeExcerptChars: z.number().min(100).default(2000)
});
/** Shared subset of a monitor record exposed to the model and the wire. */
const PUBLIC_MONITOR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        monitor_id: {
            type: 'string',
            required: true
        },
        kind: {
            type: 'string',
            enum: ['file', 'command'],
            required: true
        },
        label: {
            type: 'string',
            required: true
        },
        status: {
            type: 'string',
            enum: ['running', 'stopped', 'completed', 'failed'],
            required: true
        },
        startedAt: {
            type: 'integer',
            required: true
        },
        finishedAt: { type: 'integer' },
        stopReason: { type: 'string' },
        detail: { type: 'string' }
    }
};
/** A settled terminal status. */
function isTerminal(status) {
    return status !== 'running';
}
/** True for localhost, IPv6 loopback, or any IPv4 in 127/8 (mirrors the harness fence). */
function isLoopbackHostname(hostname) {
    if (hostname === 'localhost' || hostname === '[::1]') return true;
    const parts = String(hostname).split('.');
    return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Present one monitor call in the conversation. */
function presentCall(title, kind, rawInput) {
    return {
        card: 'generic',
        title,
        kind,
        ...rawInput !== undefined ? { rawInput } : {}
    };
}
/** Clamp the poll interval into the configured bounds. */
function clampInterval(value, config) {
    return Math.min(Math.max(Math.trunc(value), 500), config.maxIntervalMs);
}
/** Bound an excerpt to the notice budget, keeping the tail. */
function excerptTail(text, maxChars) {
    if (text.length <= maxChars) return text;
    return `…${text.slice(-maxChars)}`;
}

export function apply(ctx, config) {
    const monitors = new Map();
    const spentWakes = new WeakMap();
    const noticeLimit = Math.max(100, Math.trunc(config.noticeExcerptChars));
    let seq = 0;
    /** Per-session connected WS sockets for the dedicated live-push surface. */
    const clientsBySession = new Map();
    /** Disposer returned by `webServer.registerUpgrade` (released on teardown). */
    let disposeWsRoute;
    /** Public projection; never leaks the owner handle or live internals. */
    function publicView(mon) {
        return {
            monitor_id: mon.id,
            kind: mon.kind,
            label: mon.label,
            status: mon.status,
            startedAt: mon.startedAt,
            ...mon.finishedAt !== undefined ? { finishedAt: mon.finishedAt } : {},
            ...mon.stopReason !== undefined ? { stopReason: mon.stopReason } : {},
            ...mon.detail !== undefined ? { detail: mon.detail } : {}
        };
    }
    /** One session's monitor views, newest-first. */
    function listFor(sessionId) {
        return [...monitors.values()]
            .filter((m) => m.ownerId === sessionId)
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, 25)
            .map(publicView);
    }
    /** Send a fresh snapshot to every socket subscribed to one session. */
    function broadcast(sessionId) {
        const clients = clientsBySession.get(sessionId);
        if (clients === undefined || clients.size === 0) return;
        const payload = JSON.stringify({ type: 'snapshot', sessionId, monitors: listFor(sessionId) });
        for (const ws of clients) {
            try {
                ws.send(payload);
            }
            catch { /* socket closing */ }
        }
    }
    /** Announce that one owner's monitor set changed (pushes the snapshot). */
    function notifyChanged(sessionId) {
        broadcast(sessionId);
    }
    /** Append output to the bounded tail buffer, tracking read-cursor loss. */
    function pushText(mon, delta) {
        if (delta.length === 0) return;
        mon.buffer += delta;
        if (mon.buffer.length > mon.maxChars) {
            const over = mon.buffer.length - mon.maxChars;
            mon.buffer = mon.buffer.slice(over);
            if (mon.readCursor < over) mon.unreadLoss = true;
            mon.readCursor = Math.max(0, mon.readCursor - over);
            mon.historicLoss = true;
        }
    }
    /** Consume buffer delta since the last read (job_output-like semantics). */
    function readDelta(mon) {
        const text = mon.buffer.slice(mon.readCursor);
        mon.readCursor = mon.buffer.length;
        const lossy = mon.unreadLoss;
        mon.unreadLoss = false;
        return { text, lossy };
    }
    /** Release the timer and background process of one monitor. */
    function teardown(mon) {
        if (mon.timerDispose !== undefined) {
            try {
                mon.timerDispose();
            }
            catch { /* disposer best-effort */ }
            mon.timerDispose = undefined;
        }
        if (mon.deadlineDispose !== undefined) {
            try {
                mon.deadlineDispose();
            }
            catch { /* disposer best-effort */ }
            mon.deadlineDispose = undefined;
        }
        if (mon.proc !== undefined) {
            try {
                mon.proc.kill();
            }
            catch { /* process may already be gone */ }
            mon.proc = undefined;
        }
    }
    /** Keep the retained closed monitors bounded. */
    function pruneClosed() {
        const closed = [...monitors.values()]
            .filter((m) => isTerminal(m.status))
            .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
        const drop = Math.max(0, closed.length - 20);
        for (const m of closed.slice(0, drop)) monitors.delete(m.id);
    }
    /** Transition a running monitor to a manual/deliberate stop. */
    function stopMonitor(mon, reason) {
        if (!isTerminal(mon.status)) {
            mon.status = 'stopped';
            mon.stopReason = reason;
            mon.finishedAt = Date.now();
            teardown(mon);
            pruneClosed();
            notifyChanged(mon.ownerId);
        }
    }
    /** Transition a running monitor to a natural terminal state. */
    function markDone(mon, status, detail) {
        if (!isTerminal(mon.status)) {
            mon.status = status;
            mon.detail = detail;
            mon.finishedAt = Date.now();
            teardown(mon);
            pruneClosed();
            notifyChanged(mon.ownerId);
        }
    }
    /**
     * Deliver one notice to the owner: `followup` (opens/queues a turn) when
     * idle and inside the wake budget, `inject` (queued, no wake) otherwise.
     */
    function wakeOwner(mon, text, head) {
        const owner = mon.owner;
        if (owner === undefined) return;
        const message = createUserMessage({
            content: [{ type: 'text', text }],
            source: {
                kind: 'plugin',
                plugin: 'tool-monitor',
                form: 'notice',
                summary: boundContextSummary(head)
            }
        });
        try {
            const spent = spentWakes.get(owner) ?? 0;
            if (owner.status === 'idle' && spent < config.wakeBudget) {
                spentWakes.set(owner, spent + 1);
                owner.followup(message);
            }
            else {
                owner.inject(message);
            }
        }
        catch {
            // Owner disposed concurrently: drop the notice rather than crash the tick.
        }
    }
    /** Handle newly observed output: buffer it, test the trigger, wake on a trigger. */
    function emit(mon, delta) {
        pushText(mon, delta);
        if (mon.patternRe !== null && !mon.patternRe.test(delta)) return;
        const excerpt = excerptTail(delta, noticeLimit);
        if (excerpt.length === 0) return;
        if (mon.oneShot) {
            stopMonitor(mon, 'one-shot');
            wakeOwner(mon, `monitor ${mon.id} (${mon.kind}: ${mon.label}) stopped on first trigger (one-shot):\n`
                + `${excerpt}\n\nFull retained output: monitor_read.`, `monitor ${mon.id} (${mon.kind}: ${mon.label}) stopped (one-shot)`);
            return;
        }
        wakeOwner(mon, `monitor ${mon.id} (${mon.kind}: ${mon.label}) produced output:\n${excerpt}`
            + `${delta.length > excerpt.length ? '\n[notice truncated]' : ''}\n\nRead the remains with monitor_read; stop it with monitor_stop.`,
        `monitor ${mon.id} (${mon.kind}: ${mon.label}) produced output`);
    }
    /** Status-bearing tail line for terminal notices. */
    function statusLine(mon) {
        let line = `[status: ${mon.status}`;
        if (mon.detail !== undefined) line += `, ${mon.detail}`;
        if (mon.stopReason !== undefined) line += `, stop: ${mon.stopReason}`;
        return `${line}]`;
    }
    /** One final wake for an expired/stopped/completed monitor. */
    function finalWake(mon, head) {
        const { text } = readDelta(mon);
        const body = text.length > 0 ? `${excerptTail(text, noticeLimit)}\n\n` : '';
        wakeOwner(mon, `monitor ${mon.id} (${mon.kind}: ${mon.label}) ${statusLine(mon)}\n${body}Full retained output: monitor_read.`, head);
    }
    /** One poll tick behind a file-typed monitor. */
    async function fileTick(mon) {
        try {
            if (mon.target === undefined) {
                try {
                    mon.target = await ctx.fs.resolve(mon.path, { cwd: mon.cwd });
                }
                catch {
                    mon.detail = 'missing';
                    return;
                }
            }
            const info = await ctx.fs.stat(mon.target);
            if (info === undefined) {
                mon.detail = 'missing';
                return;
            }
            if (info.type !== 'file') {
                mon.detail = 'not a regular file';
                return;
            }
            if (mon.lastSize !== undefined && info.size !== undefined && info.size === mon.lastSize) return;
            const text = await ctx.fs.readText(mon.target);
            const length = text.length;
            const firstSeen = mon.lastTextLen === undefined;
            if (mon.lastTextLen !== undefined && length < mon.lastTextLen) {
                mon.lastTextLen = 0;
                emit(mon, `[monitor] ${mon.path} truncated or rotated; watching restarted\n`);
                if (isTerminal(mon.status)) return;
            }
            const delta = firstSeen ? '' : text.slice(mon.lastTextLen);
            mon.lastTextLen = length;
            mon.lastSize = info.size ?? length;
            mon.detail = undefined;
            if (firstSeen) {
                // The file appeared (or recovered) during the watch: its current
                // content is new output, not a baseline.
                if (text.length > 0) emit(mon, text);
            }
            else if (delta.length > 0) emit(mon, delta);
        }
        catch (error) {
            mon.detail = `read failed: ${String(error)}`;
        }
    }
    /** One poll tick behind a command-typed monitor. */
    function commandTick(mon) {
        const proc = mon.proc;
        if (proc === undefined) return;
        try {
            const read = proc.readOutput();
            if (read.delta.length > 0) {
                if (read.lossy) mon.detail = 'output truncated';
                emit(mon, read.delta);
            }
            if (isTerminal(mon.status)) return;
            if (proc.status !== 'running') {
                const detail = proc.exitCode === null
                    ? (proc.signal ?? 'terminated')
                    : `exit code ${proc.exitCode}`;
                markDone(mon, 'completed', detail);
                finalWake(mon, `monitor ${mon.id} (${mon.kind}: ${mon.label}) finished`);
            }
        }
        catch (error) {
            ctx.logger.warn(`tool-monitor: command tick failed for ${mon.id}: ${String(error)}`);
        }
    }
    /** Resolve one monitor for the calling agent, ownership-fenced. */
    function findMonitor(id, agent) {
        const mon = monitors.get(id);
        if (mon === undefined || agent === undefined || mon.ownerId !== agent.id) {
            throw new Error(`monitor ${JSON.stringify(id)} not found in this session`);
        }
        return mon;
    }
    /** Arm the poll loop and optional deadline for one monitor. */
    function arm(mon) {
        mon.timerDispose = ctx.interval(() => {
            try {
                if (mon.kind === 'file') void fileTick(mon);
                else commandTick(mon);
            }
            catch (error) {
                ctx.logger.warn(`tool-monitor: tick failed for ${mon.id}: ${String(error)}`);
            }
        }, mon.intervalMs);
        if (mon.durationMs !== 0) {
            mon.deadlineDispose = ctx.timeout(() => {
                if (!isTerminal(mon.status)) {
                    stopMonitor(mon, 'expired');
                    finalWake(mon, `monitor ${mon.id} (${mon.kind}: ${mon.label}) finished after duration`);
                }
            }, mon.durationMs);
        }
    }
    /** Seed a file monitor whose initial snapshot is requested. */
    function seedFile(mon) {
        return (async () => {
            try {
                mon.target = await ctx.fs.resolve(mon.path, { cwd: mon.cwd });
                const info = await ctx.fs.stat(mon.target);
                if (info === undefined || info.type !== 'file') return;
                const text = await ctx.fs.readText(mon.target);
                mon.lastTextLen = text.length;
                mon.lastSize = info.size ?? text.length;
                if (mon.initialSnapshot && text.length > 0) emit(mon, text);
            }
            catch {
                mon.detail = 'missing';
            }
        })();
    }
    /** Start a background command process for a command monitor. */
    function startCommand(mon) {
        try {
            const spec = ctx.shell.resolve({
                command: mon.command,
                ...mon.cwd !== undefined ? { workdir: mon.cwd } : {}
            });
            const proc = ctx.shell.start(spec);
            mon.proc = proc;
        }
        catch (error) {
            markDone(mon, 'failed', `spawn failed: ${String(error)}`);
        }
    }
    // -- registry events -------------------------------------------------
    /** A genuine human message claim resets the per-owner auto-wake budget. */
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        if (message?.source?.kind === 'user') spentWakes.delete(agent);
    });
    /** Owner disposal stops every monitor it owns. */
    ctx.on('agent/disposed', ({ agent }) => {
        for (const mon of [...monitors.values()]) {
            if (mon.ownerId === agent.id && !isTerminal(mon.status)) stopMonitor(mon, 'owner-disposed');
        }
    });
    /** Plugin unload stops everything this fiber started. */
    ctx.effect(() => () => {
        for (const mon of [...monitors.values()]) {
            if (!isTerminal(mon.status)) stopMonitor(mon, 'plugin-stop');
        }
        monitors.clear();
        for (const clients of clientsBySession.values()) for (const ws of clients) {
            try { ws.terminate(); } catch { /* socket gone */ }
        }
        clientsBySession.clear();
        if (disposeWsRoute !== undefined) {
            try {
                disposeWsRoute();
            }
            catch { /* registerUpgrade disposer best-effort */ }
            disposeWsRoute = undefined;
        }
    }, 'tool-monitor teardown');
    // -- dedicated WebSocket live-push surface --------------------------
    // The browser opens a separate WS to /tool-monitor/ws (this plugin's own
    // endpoint registered on the public `webServer.registerUpgrade` seam).
    // The host pushes a full `snapshot` frame on every monitor change; the
    // client renders it. This keeps monitors out of `ctx.jobs`, so they never
    // appear in the generic background-job list. A new connection receives a
    // baseline snapshot immediately; a non-loopback requester is refused.
    const webServer = ctx.get('webServer');
    if (webServer !== undefined && typeof webServer.registerUpgrade === 'function') {
        const wss = new WebSocketServer({ noServer: true });
        disposeWsRoute = webServer.registerUpgrade({
            path: '/tool-monitor/ws',
            handler: (req, socket, head) => {
                let sessionId = null;
                try {
                    sessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('sessionId');
                }
                catch { /* malformed url */ }
                const hostname = ((req.headers ?? {}).host ?? '').split(':')[0];
                if (sessionId === null || sessionId.length === 0 || !isLoopbackHostname(hostname)) {
                    socket.destroy();
                    return;
                }
                wss.handleUpgrade(req, socket, head, (ws) => {
                    let clients = clientsBySession.get(sessionId);
                    if (clients === undefined) {
                        clients = new Set();
                        clientsBySession.set(sessionId, clients);
                    }
                    clients.add(ws);
                    try {
                        ws.send(JSON.stringify({ type: 'snapshot', sessionId, monitors: listFor(sessionId) }));
                    }
                    catch { /* baseline best-effort */ }
                    ws.on('close', () => {
                        const current = clientsBySession.get(sessionId);
                        if (current !== undefined) {
                            current.delete(ws);
                            if (current.size === 0) clientsBySession.delete(sessionId);
                        }
                    });
                    ws.on('error', () => {});
                });
            }
        });
    }
    // -- prompts ---------------------------------------------------------
    ctx.systemPrompt.section({
        name: 'tool:monitor',
        order: 107,
        text: 'Use monitor_start to watch a file or a command output in the background; you are woken in-session by a notice when triggering output arrives. Read the delta with monitor_read (it consumes, like job_output), stop with monitor_stop, list with monitor_list. Do not busy-poll a running monitor. A monitor with one_shot: true stops itself after the first trigger; with pattern set, only matching output triggers it. duration_seconds: 0 keeps it running until monitor_stop or session end.'
    });
    // -- tools -----------------------------------------------------------
    ctx.tools.register(defineTool({
        name: 'monitor_start',
        description: 'Start a background monitor over a file or a command output. Returns immediately with a monitor_id; you are woken by an in-session notice when triggering output arrives. duration_seconds: 0 means run until monitor_stop or session end. one_shot: true stops the monitor automatically after the first trigger. pattern (JS regular expression) restricts triggers to matching output (non-matching output stays readable).',
        parameters: {
            source: {
                type: 'string',
                enum: ['file', 'command'],
                required: true,
                description: 'What to monitor.'
            },
            path: {
                type: 'string',
                description: 'File path (required for source=file); relative paths resolve against the session cwd.'
            },
            command: {
                type: 'string',
                description: 'Command to run in the background (required for source=command); runs in the session cwd.'
            },
            duration_seconds: {
                type: 'number',
                description: 'Stop automatically after this many seconds; 0 (default) means until monitor_stop or session end.'
            },
            interval_ms: {
                type: 'number',
                description: 'Poll/read interval in milliseconds (default 3000, clamped to 500-600000).'
            },
            pattern: {
                type: 'string',
                description: 'Optional JS regular expression; only output matching it triggers a wake.'
            },
            initial_snapshot: {
                type: 'boolean',
                description: 'File monitors: treat existing content as the first trigger and wake once (default false).'
            },
            one_shot: {
                type: 'boolean',
                description: 'Stop automatically after the first trigger and deliver one final notice (default false).'
            },
            max_chars: {
                type: 'number',
                description: 'Tail retention bound for buffered output in characters (default 4000).'
            }
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    monitor: {
                        ...PUBLIC_MONITOR_SCHEMA,
                        required: true
                    }
                }
            },
            render: (_args, value) => [{
                type: 'text',
                text: `started ${value.monitor.kind} monitor ${value.monitor.monitor_id} (${value.monitor.label}) [status: ${value.monitor.status}]\n`
                    + 'You will be woken by a notice when triggering output arrives; read it with monitor_read.'
            }]
        },
        async execute(args, exec) {
            const agent = exec.agent;
            if (agent === undefined) throw new Error('monitor_start requires an active agent context');
            const kind = args.source;
            const path = typeof args.path === 'string' ? args.path : undefined;
            const command = typeof args.command === 'string' ? args.command : undefined;
            if (kind === 'file' && (path === undefined || path.length === 0)) {
                throw new Error('monitor_start: source=file requires a non-empty path');
            }
            if (kind === 'command' && (command === undefined || command.length === 0)) {
                throw new Error('monitor_start: source=command requires a non-empty command');
            }
            const duration = args.duration_seconds;
            if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) {
                throw new Error('monitor_start: duration_seconds must be a non-negative number');
            }
            let patternRe = null;
            if (args.pattern !== undefined && args.pattern.length > 0) {
                try {
                    patternRe = new RegExp(args.pattern);
                }
                catch (error) {
                    throw new Error(`monitor_start: invalid pattern: ${String(error)}`);
                }
            }
            const running = [...monitors.values()].filter((m) => m.ownerId === agent.id && m.status === 'running').length;
            if (running >= config.maxConcurrentPerOwner) {
                throw new Error(`monitor_start: monitor limit reached for this session (${config.maxConcurrentPerOwner}); use monitor_stop to release one`);
            }
            const intervalMs = args.interval_ms === undefined
                ? config.defaultIntervalMs
                : clampInterval(args.interval_ms, config);
            const maxChars = Math.max(100, Math.min(Math.trunc(args.max_chars ?? config.defaultMaxChars), 1000000));
            const cwd = agent.session?.header?.cwd;
            const label = kind === 'file' ? (path ?? '') : (command.length > 120 ? `${command.slice(0, 119)}…` : command);
            const id = `monitor-${++seq}`;
            const mon = {
                id,
                owner: agent,
                ownerId: agent.id,
                kind,
                label,
                path,
                command,
                cwd,
                intervalMs,
                maxChars,
                patternRe,
                oneShot: args.one_shot === true,
                initialSnapshot: args.initial_snapshot === true,
                durationMs: duration === undefined || duration === 0 ? 0 : Math.trunc(duration * 1000),
                status: 'running',
                stopReason: undefined,
                startedAt: Date.now(),
                finishedAt: undefined,
                detail: undefined,
                buffer: '',
                readCursor: 0,
                unreadLoss: false,
                historicLoss: false,
                target: undefined,
                proc: undefined,
                timerDispose: undefined,
                deadlineDispose: undefined,
                lastTextLen: undefined,
                lastSize: undefined
            };
            monitors.set(id, mon);
            if (kind === 'file') {
                await seedFile(mon);
                if (!isTerminal(mon.status)) arm(mon);
            }
            else {
                startCommand(mon);
                if (!isTerminal(mon.status)) arm(mon);
            }
            notifyChanged(agent.id);
            return { monitor: publicView(mon) };
        },
        presentCall: (args) => presentCall(`Start ${args.source} monitor`, 'execute', args.source)
    }));
    ctx.tools.register(defineTool({
        name: 'monitor_read',
        description: 'Read a background monitor. Returns output produced since the previous read (consuming, like job_output) plus the monitor status.',
        parameters: {
            monitor_id: {
                type: 'string',
                required: true,
                description: 'Monitor id returned by monitor_start.'
            }
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    text: {
                        type: 'string',
                        required: true
                    },
                    lossy: { type: 'boolean' },
                    monitor: {
                        ...PUBLIC_MONITOR_SCHEMA,
                        required: true
                    }
                }
            },
            render: (_args, value) => [{
                type: 'text',
                text: `${value.text.length > 0 ? value.text : '(no new output)'}${value.text.endsWith('\n') || value.text.length === 0 ? '' : '\n'}[status: ${value.monitor.status}${value.monitor.detail !== undefined ? `, ${value.monitor.detail}` : ''}]`
            }]
        },
        execute(args, exec) {
            const mon = findMonitor(args.monitor_id, exec.agent);
            const { text, lossy } = readDelta(mon);
            return Promise.resolve({
                text,
                ...lossy ? { lossy } : {},
                monitor: publicView(mon)
            });
        },
        presentCall: (args) => presentCall(`Read output from monitor ${args.monitor_id}`, 'read', args.monitor_id)
    }));
    ctx.tools.register(defineTool({
        name: 'monitor_stop',
        description: 'Stop a background monitor: stops polling (file) or kills the background process (command). Returns the final status and remaining output.',
        parameters: {
            monitor_id: {
                type: 'string',
                required: true,
                description: 'Monitor id returned by monitor_start.'
            }
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    text: {
                        type: 'string',
                        required: true
                    },
                    monitor: {
                        ...PUBLIC_MONITOR_SCHEMA,
                        required: true
                    }
                }
            },
            render: (_args, value) => [{
                type: 'text',
                text: `monitor ${value.monitor.monitor_id} ${value.monitor.status === 'stopped' ? 'stopped' : 'already finished'} [status: ${value.monitor.status}${value.monitor.stopReason !== undefined ? `, stop: ${value.monitor.stopReason}` : ''}]\n${value.text.length > 0 ? value.text : '(no new output)'}`
            }]
        },
        execute(args, exec) {
            const mon = findMonitor(args.monitor_id, exec.agent);
            if (!isTerminal(mon.status)) {
                const { text } = readDelta(mon);
                stopMonitor(mon, 'manual');
                return Promise.resolve({ text, monitor: publicView(mon) });
            }
            const { text } = readDelta(mon);
            return Promise.resolve({ text, monitor: publicView(mon) });
        },
        presentCall: (args) => presentCall(`Stop monitor ${args.monitor_id}`, 'execute', args.monitor_id)
    }));
    ctx.tools.register(defineTool({
        name: 'monitor_list',
        description: 'List the monitors owned by this session (running and recently finished) with their ids, kinds, and statuses.',
        parameters: {},
        output: {
            schema: {
                type: 'array',
                items: PUBLIC_MONITOR_SCHEMA
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.length === 0
                    ? '(no monitors)'
                    : value.map((m) => `${m.monitor_id} [${m.kind}] ${m.status} — ${m.label}${m.detail !== undefined ? ` (${m.detail})` : ''}`).join('\n')
            }]
        },
        execute(_args, exec) {
            const agent = exec.agent;
            const list = [...monitors.values()]
                .filter((m) => agent !== undefined && m.ownerId === agent.id)
                .sort((a, b) => b.startedAt - a.startedAt)
                .slice(0, 25)
                .map(publicView);
            return Promise.resolve(list);
        },
        presentCall: () => presentCall('List monitors', 'read')
    }));
    // -- web client RPC --------------------------------------------------
    // The live list rides the /tool-monitor/ws push; this channel serves the
    // on-demand output read and stop (not a polling list).
    const connection = ctx.get('connection');
    if (connection !== undefined) {
        connection.rpc.handle('/tool-monitor', async (endpoint, payload) => {
            try {
                const p = payload ?? {};
                const sessionId = typeof p.sessionId === 'string' ? p.sessionId : undefined;
                if (sessionId === undefined) {
                    return { ok: false, error: { code: 'internal', message: 'missing sessionId', details: {} } };
                }
                if (endpoint === 'list') {
                    return { ok: true, value: listFor(sessionId) };
                }
                const id = typeof p.monitorId === 'string' ? p.monitorId : undefined;
                const mon = id === undefined ? undefined : monitors.get(id);
                if (mon === undefined || mon.ownerId !== sessionId) {
                    return {
                        ok: false,
                        error: { code: 'internal', message: `monitor ${JSON.stringify(id)} not found in this session`, details: {} }
                    };
                }
                if (endpoint === 'read') {
                    return { ok: true, value: { monitor: publicView(mon), text: mon.buffer, lossy: mon.historicLoss === true } };
                }
                if (endpoint === 'stop') {
                    if (!isTerminal(mon.status)) stopMonitor(mon, 'manual');
                    return { ok: true, value: { monitor: publicView(mon), text: mon.buffer, lossy: mon.historicLoss === true } };
                }
                return {
                    ok: false,
                    error: { code: 'internal', message: `unknown endpoint ${JSON.stringify(endpoint)}`, details: {} }
                };
            }
            catch (error) {
                return { ok: false, error: { code: 'internal', message: String(error), details: {} } };
            }
        }, { authority: 'loopback' });
    }
}
//#endregion
