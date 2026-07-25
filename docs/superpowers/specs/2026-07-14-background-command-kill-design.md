# Background Command Management — Design Spec

## Problem

When the AI's `bash` tool runs a long-running command (e.g., `cd scrm-admin-vue && yarn dev`), the tool stays in `running` state indefinitely. This blocks the session — the user cannot send new messages and must press the global Stop button (double-Esc) to abort the entire session via `session.abort()`.

The current UX requires the user to use the double-Esc interrupt flow on the composer's primary action button, which is not contextual to the running command and interrupts the entire session without any per-command visibility.

## Goal

Add two UI actions for running bash commands, each available in two locations (timeline and management bar):

1. **Kill**: Stop the running bash command by aborting the session. The command is terminated and the conversation can resume.
2. **Detach to background**: Abort the session (stops the original process), then immediately restart the same command in an independent PTY session. The conversation can resume while the command continues running in background.

**UI locations** (both actions available in both places):

- **Timeline**: Kill and Detach buttons next to running bash tools in the transcript.
- **Background command management bar**: A bar above the composer showing running bash commands and background PTY sessions, with stop buttons, highlighting when a command exceeds a timeout threshold.

## Constraints

- The OpenCode SDK does not provide a per-tool abort API. `session.abort()` is the only session-level termination mechanism.
- "Detach to background" is implemented as **abort + PTY restart**: the original process is killed, then a new PTY session is created with the same command. The OpenCode SDK has no suspend/detach API for running tool processes.
- Only `tool === "bash"` parts are affected. Other running tools do not get kill/detach buttons.
- PTY sessions are workspace-scoped (created with `directory` parameter). They are shared across all session panels in the same workspace.

## Architecture

### Kill Flow (unchanged from original design)

```
Webview detects running bash tool
        ↓
vscode.postMessage({ type: "composerAction", action: "interruptSession" })
        ↓
SessionPanelController → runComposerAction()
        ↓
rt.sdk.session.abort() → session goes idle
        ↓
User can continue the conversation
```

### Detach Flow (new)

```
Webview detects running bash tool, user clicks "Detach"
        ↓
vscode.postMessage({ type: "detachBashTool", command, messageID })
        ↓
SessionPanelController → detachBashTool()
  1. rt.sdk.session.abort({ sessionID, directory })     ← stops AI + kills original process
  2. rt.sdk.pty.create({ command, cwd: rt.dir, title })  ← starts new independent PTY process
        ↓
PTY events (pty.created, pty.exited, pty.deleted) flow through EventHub
        ↓
SessionPanelController tracks PTY sessions, sends ptyUpdate to webview
        ↓
Webview BackgroundCommandBar shows PTY sessions with stop buttons
        ↓
User clicks stop → vscode.postMessage({ type: "stopPty", ptyID })
        ↓
SessionPanelController → stopPty() → rt.sdk.pty.remove({ ptyID })
```

### Full Architecture Diagram

```
SSE Events → EventHub → SessionPanelController.handle()
                                ↓
                    ┌───────────┴───────────┐
                    ↓                         ↓
        reducer → snapshot.messages     PTY event tracking
                    ↓                         ↓
        background-commands.ts          ptySessions Map
        scanRunningBashTools()               ↓
                    ↓                    ptyUpdate message
            ┌───────┴────────┐              ↓
            ↓                  ↓             ↓
      ToolRow             BackgroundCommandBar
      [Kill] [Detach]     [Kill] [Detach] [Stop PTY]
            ↓                  ↓             ↓
    composerAction       detachBashTool    stopPty
    interruptSession           ↓             ↓
            ↓            session.abort    pty.remove
            ↓            + pty.create      ↓
            └──────────────────┴──────────┘
                               ↓
                    session idle, user continues
```

## File-Level Design

### `src/bridge/types.ts` (modify)

**New WebviewMessage variants:**

```typescript
| { type: "detachBashTool"; command: string; messageID: string }
| { type: "stopPty"; ptyID: string }
```

**New HostMessage variant:**

```typescript
| { type: "ptyUpdate"; sessions: PtySessionInfo[] }
```

**New type:**

```typescript
export type PtySessionInfo = {
  id: string
  title: string
  command: string
  cwd: string
  status: "running" | "exited"
  pid: number
}
```

### `src/panel/provider/actions.ts` (modify)

**New action: `detachBashTool`**

```typescript
export async function detachBashTool(ctx: ActionContext, command: string, messageID: string)
```

1. Get workspace runtime (`rt`).
2. Call `rt.sdk.session.abort({ sessionID, directory: rt.dir })` to stop the AI and kill the original bash process.
3. Wait for abort to settle (`wait(300)`).
4. Call `rt.sdk.pty.create({ command, cwd: rt.dir, title: command })` to restart the command in an independent PTY.
5. The PTY creation result triggers a `pty.created` SSE event, which flows through `EventHub` → `SessionPanelController`.
6. Handle errors: if `session.abort` fails, log and show error. If `pty.create` fails, log and show error (the session is already aborted, so the user can still continue the conversation).

**New action: `stopPty`**

```typescript
export async function stopPty(ctx: ActionContext, ptyID: string)
```

1. Get workspace runtime (`rt`).
2. Call `rt.sdk.pty.remove({ ptyID, directory: rt.dir })`.
3. The `pty.deleted` SSE event flows through `EventHub` → `SessionPanelController`.

### `src/panel/provider/controller.ts` (modify)

**PTY session tracking:**

- Add `private ptySessions: Map<string, PtySessionInfo>` to `SessionPanelController`.
- In `handle(event: SessionEvent)`, handle PTY events:
  - `pty.created` → add session to `ptySessions`, push `ptyUpdate` to webview.
  - `pty.updated` → update session in `ptySessions`, push `ptyUpdate` to webview.
  - `pty.exited` → update status to `"exited"` in `ptySessions`, push `ptyUpdate` to webview.
  - `pty.deleted` → remove session from `ptySessions`, push `ptyUpdate` to webview.
- On panel ready (`webview:ready`), call `rt.sdk.pty.list({ directory: rt.dir })` to sync existing PTY sessions, then push `ptyUpdate`.

**New webview message handlers:**

```typescript
if (message?.type === "detachBashTool") {
  void detachBashTool(this.actionContext(), message.command, message.messageID)
  return
}

if (message?.type === "stopPty") {
  void stopPty(this.actionContext(), message.ptyID)
  return
}
```

**New `postPtyUpdate` method:**

```typescript
private async postPtyUpdate() {
  const sessions = Array.from(this.ptySessions.values())
  await postToWebview(this.panel.webview, { type: "ptyUpdate", sessions })
}
```

### `src/panel/webview/app/background-commands.ts` (new, updated)

Pure functions and a React hook for detecting running bash tools. Same as original design, plus a helper to extract the command from a tool part.

```typescript
export type RunningBashTool = {
  partID: string
  messageID: string
  command: string
  firstSeenAt: number
}

export function scanRunningBashTools(messages: SessionMessage[]): RunningBashTool[]

export function isOvertime(tool: RunningBashTool, now: number, thresholdMs: number): boolean

export function useRunningBashTools(messages: SessionMessage[]): {
  tools: RunningBashTool[]
  hasOvertime: boolean
}
```

**`scanRunningBashTools`**:

1. Iterate all messages and their parts.
2. Filter for `type === "tool" && tool === "bash" && state.status === "running"`.
3. Extract `command` from `state.input.command` (string fallback to `state.title`).
4. Return `RunningBashTool[]` keyed by `part.id`.

**`isOvertime`**:

- Returns `true` when `now - firstSeenAt >= thresholdMs`.

**`useRunningBashTools`** hook:

- Maintains a `useRef<Map<string, number>>` storing the first-seen timestamp per part ID.
- On each render, calls `scanRunningBashTools(messages)`.
- Compares the result with the ref:
  - New part IDs → record `Date.now()` as first-seen timestamp.
  - Disappeared part IDs → delete from ref.
  - Existing part IDs → keep the original timestamp.
- Uses `setInterval(1000)` to trigger re-render for overtime checks.
- Returns `{ tools, hasOvertime }` where `hasOvertime` is `true` if any tool exceeds the threshold.
- Default threshold: `10_000` ms (10 seconds).
- Cleans up `setInterval` on unmount.

### `src/panel/webview/app/background-command-bar.tsx` (new, updated)

React component for the background command management bar. Shows both running bash tools and background PTY sessions.

```typescript
export function BackgroundCommandBar({
  tools,
  hasOvertime,
  ptySessions,
  onKill,
  onDetach,
  onStopPty,
}: {
  tools: RunningBashTool[]
  hasOvertime: boolean
  ptySessions: PtySessionInfo[]
  onKill: () => void
  onDetach: (tool: RunningBashTool) => void
  onStopPty: (ptyID: string) => void
}): React.JSX.Element | null
```

**Rendering rules**:

- `tools.length === 0 && ptySessions.length === 0` → return `null`.
- Otherwise, render a bar with two sections:
  - **Running bash tools section** (from `tools`): For each tool, truncated command text + Kill button + Detach button.
  - **Background PTY sessions section** (from `ptySessions`): For each session with `status === "running"`, truncated command text + Stop button (`onStopPty`).
- Left side: status dot + `"{n} command(s) running"` text (total of both sections).
- `is-overtime` class on the root element when `hasOvertime` is `true`.
- Kill buttons call `onKill()`.
- Detach buttons call `onDetach(tool)`.
- Stop PTY buttons call `onStopPty(ptyID)`.
- Command text is truncated with ellipsis; hover shows full text via `title` attribute.
- Exited PTY sessions (`status === "exited"`) are not shown.

### `src/panel/webview/app/state.ts` (modify)

Add `ptySessions` to `AppState`:

```typescript
export type AppState = {
  // ... existing fields ...
  ptySessions: PtySessionInfo[]
}
```

In `createInitialState`, initialize `ptySessions: []`.

In `normalizeSnapshotPayload` or a new normalizer, handle incoming `ptyUpdate` messages.

### `src/panel/webview/hooks/useHostMessages.ts` (modify)

Handle `ptyUpdate` message type:

```typescript
if (message?.type === "ptyUpdate") {
  handlers.setState((current) => ({
    ...current,
    ptySessions: message.sessions,
  }))
  return
}
```

### `src/panel/webview/app/tool-rows.tsx` (modify)

Add Kill and Detach buttons to `ToolRow` when `part.tool === "bash"` and `part.state?.status === "running"`.

The `ToolRow` component needs two new optional props:
- `onKill?: () => void` — sends `composerAction/interruptSession`.
- `onDetach?: () => void` — sends `detachBashTool` with the command and messageID.

When both are provided and the tool is a running bash tool, render both buttons in `oc-toolRowMeta`:

```
[bash] cd scrm-admin-vue && yarn dev  [⏳] [Kill] [Detach]
```

### `src/panel/webview/renderers/CollapsibleShellBlock.tsx` (modify)

Add optional `onKill?: () => void` and `onDetach?: () => void` props. When `running === true` and the callbacks are provided, render Kill and Detach buttons in the header meta area next to the spinner.

### `src/panel/webview/app/App.tsx` (modify)

1. Call `useRunningBashTools(state.snapshot.messages)` to get `{ tools, hasOvertime }`.
2. Define callbacks:
   - `onKill`: `() => vscode.postMessage({ type: "composerAction", action: "interruptSession" })`.
   - `onDetach`: `(tool: RunningBashTool) => vscode.postMessage({ type: "detachBashTool", command: tool.command, messageID: tool.messageID })`.
   - `onStopPty`: `(ptyID: string) => vscode.postMessage({ type: "stopPty", ptyID })`.
3. Pass `onKill` and `onDetach` to `Timeline` → `ToolRow` / `CollapsibleShellBlock`.
4. Insert `<BackgroundCommandBar tools={tools} hasOvertime={hasOvertime} ptySessions={state.ptySessions} onKill={onKill} onDetach={onDetach} onStopPty={onStopPty} />` in the footer, above the `<section className="oc-composer">` block, inside the `!blocked && !isChildSession` conditional.

### `src/panel/webview/app/contexts.ts` (modify) + React Context approach

Instead of threading `onKill`/`onDetach` through `Timeline` → `PartView` → `ToolPartView` → `ToolRow` (which would require modifying 4+ files with prop signature changes), use a React Context:

- Add `BashToolActionsContext` to `contexts.ts`:
  ```typescript
  export const BashToolActionsContext = React.createContext<{
    onKill: (() => void) | null
    onDetach: ((tool: { command: string; messageID: string }) => void) | null
  }>({ onKill: null, onDetach: null })
  ```
- `App.tsx` wraps the timeline area with `<BashToolActionsContext.Provider value={{ onKill, onDetach }}>`.
- `ToolShellPanel` and `ToolRow` in `webview-bindings.tsx` consume the context via `useContext(BashToolActionsContext)` and pass callbacks to the base components.
- No changes needed to `Timeline`, `PartView`, or `part-views.tsx` signatures.

### CSS (existing stylesheet)

New class names following the `oc-` prefix convention:

```
/* Timeline kill/detach buttons */
.oc-toolRowKill
.oc-toolRowKill:disabled
.oc-toolRowKillPath
.oc-toolRowDetach
.oc-toolRowDetach:disabled
.oc-toolRowDetachPath

/* Background command management bar */
.oc-backgroundCommandBar
.oc-backgroundCommandBar.is-overtime
.oc-backgroundCommandBarInner
.oc-backgroundCommandBadge
.oc-backgroundCommandBadgeDot
.oc-backgroundCommandText
.oc-backgroundCommandStop
.oc-backgroundCommandDetach
.oc-backgroundCommandSection
.oc-backgroundCommandSectionPty
```

Style principles:

- Follow existing theme system (`data-oc-theme` and `data-oc-color` attributes).
- Kill button uses warning/red color, consistent with `oc-composerPrimaryAction.is-armed`.
- Detach button uses accent/blue color to distinguish from kill.
- Management bar uses semi-transparent background blending with `oc-footerInner`.
- `is-overtime` class switches to a warning background and border.
- Horizontal scroll for overflow when multiple commands are running.
- No `@media (prefers-reduced-motion)` queries (per AGENTS.md rules).
- CSS transitions for bar appear/disappear fade.

## Testing

### `src/panel/webview/app/background-commands.test.ts` (new)

Pure function tests for `scanRunningBashTools` and `isOvertime`:

- Empty message list → `[]`
- Running bash tool → correct `RunningBashTool` entry
- Completed bash tool → not included
- Running non-bash tool → not included
- Error-status bash tool → not included
- Command field missing → fallback to title
- `isOvertime` boundary: below threshold → `false`, at threshold → `true`, above threshold → `true`

### `src/panel/webview/app/background-command-bar.test.tsx` (new)

React component tests:

- No running commands and no PTY sessions → `null`
- 1 running bash tool, no PTY → "1 command running" text + Kill + Detach buttons
- 2 running bash tools → "2 commands running" text
- 1 PTY session running → shows in PTY section with Stop button
- PTY session exited → not shown
- Overtime → `is-overtime` class present
- Click Kill → `onKill` called
- Click Detach → `onDetach` called with correct tool
- Click Stop PTY → `onStopPty` called with correct ptyID

### `src/panel/provider/actions.test.ts` (extend)

- `detachBashTool` calls `session.abort` then `pty.create` with correct command and cwd
- `detachBashTool` handles `session.abort` failure gracefully
- `detachBashTool` handles `pty.create` failure gracefully (session already aborted)
- `stopPty` calls `pty.remove` with correct ptyID

### Tool row kill/detach button tests (extend existing test files or add new)

- Bash tool running → Kill and Detach buttons rendered
- Bash tool completed → neither button rendered
- Non-bash tool running → neither button rendered
- Click Kill → sends `composerAction/interruptSession`
- Click Detach → sends `detachBashTool` with correct command and messageID

### `src/panel/webview/hooks/useHostMessages.test.ts` (extend)

- `ptyUpdate` message → updates `state.ptySessions`

### Verification Commands

```bash
bun test src/panel/webview/app/background-commands.test.ts
bun test src/panel/webview/app/background-command-bar.test.tsx
bun test src/panel/provider/actions.test.ts
bun test src/panel/webview/hooks/useHostMessages.test.ts
bun run check-types && bun run lint && bun run compile
```

## Out of Scope

- User-initiated shell mode (`!` prefix) background execution.
- Killing or detaching individual tools other than `bash`.
- Auto-detecting and auto-detaching without user interaction (auto-detect highlights the bar, but detach is manual).
- Connecting to PTY sessions via WebSocket to view real-time output (future enhancement).
- Changes to the OpenCode server or SDK.
