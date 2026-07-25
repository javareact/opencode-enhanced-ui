# Background Command Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kill and Detach-to-background buttons for running AI bash tools, with a background command management bar above the composer.

**Architecture:** Webview detects running bash tools from session messages. Kill reuses existing `composerAction/interruptSession` (calls `session.abort`). Detach calls a new `detachBashTool` host action that aborts the session then creates a PTY with the same command. PTY sessions are tracked host-side and pushed to webview via `ptyUpdate` messages.

**Tech Stack:** TypeScript, React, VS Code Webview API, OpenCode SDK v2 (`@opencode-ai/sdk`)

## Global Constraints

- Package manager: `bun` (`bun@1.3.10`)
- Language: TypeScript with `strict: true`, `module: Node16`, `moduleResolution: Node16`
- Code style: double quotes, semicolons omitted, 2-space indentation
- Test runner: `bun test`
- Validation: `bun run check-types && bun run lint && bun run compile`
- No `@media (prefers-reduced-motion)` queries
- Keep command/view/setting ids in `opencode-ui.*` namespace
- Prefix unused params with `_` to satisfy ESLint

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/bridge/types.ts` | Modify | Add `PtySessionInfo` type, `detachBashTool`/`stopPty` WebviewMessages, `ptyUpdate` HostMessage |
| `src/panel/webview/app/background-commands.ts` | Create | Pure functions `scanRunningBashTools`, `isOvertime` + hook `useRunningBashTools` |
| `src/panel/webview/app/background-commands.test.ts` | Create | Tests for pure functions |
| `src/panel/webview/app/background-command-bar.tsx` | Create | `BackgroundCommandBar` React component |
| `src/panel/webview/app/background-command-bar.test.tsx` | Create | Tests for `BackgroundCommandBar` |
| `src/panel/webview/app/state.ts` | Modify | Add `ptySessions` to `AppState` |
| `src/panel/webview/hooks/useHostMessages.ts` | Modify | Handle `ptyUpdate` message |
| `src/panel/webview/hooks/useHostMessages.test.ts` | Modify | Test `ptyUpdate` handling |
| `src/panel/provider/actions.ts` | Modify | Add `detachBashTool` and `stopPty` actions |
| `src/panel/provider/actions.test.ts` | Modify | Tests for new actions |
| `src/panel/provider/controller.ts` | Modify | PTY event tracking, new message handlers, `postPtyUpdate` |
| `src/panel/webview/app/contexts.ts` | Modify | Add `BashToolActionsContext` |
| `src/panel/webview/app/webview-bindings.tsx` | Modify | Consume context in `ToolRow` and `ToolShellPanel` |
| `src/panel/webview/app/tool-rows.tsx` | Modify | Add `onKill`/`onDetach` props to `ToolRow`, render buttons |
| `src/panel/webview/renderers/CollapsibleShellBlock.tsx` | Modify | Add `onKill`/`onDetach` props, render buttons |
| `src/panel/webview/app/App.tsx` | Modify | Wire hook, callbacks, context provider, `BackgroundCommandBar` |
| `src/panel/webview/tool.css` | Modify | Styles for kill/detach buttons and management bar |

---

### Task 1: Bridge Types

**Files:**
- Modify: `src/bridge/types.ts`

**Interfaces:**
- Produces: `PtySessionInfo` type, `detachBashTool` and `stopPty` variants in `WebviewMessage`, `ptyUpdate` variant in `HostMessage`

- [ ] **Step 1: Add `PtySessionInfo` type**

In `src/bridge/types.ts`, after the `SessionPickerPayload` type (before `HostMessage`), add:

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

- [ ] **Step 2: Add `ptyUpdate` to `HostMessage`**

In the `HostMessage` union, after the `modelSelectionInit` variant, add:

```typescript
| {
    type: "ptyUpdate"
    sessions: PtySessionInfo[]
  }
```

- [ ] **Step 3: Add `detachBashTool` and `stopPty` to `WebviewMessage`**

In the `WebviewMessage` union, after the `modelSelectionChanged` variant, add:

```typescript
| {
      type: "detachBashTool"
      command: string
      messageID: string
    }
  | {
      type: "stopPty"
      ptyID: string
    }
```

- [ ] **Step 4: Run type-check to verify no errors**

Run: `bun run check-types`
Expected: PASS (types are additive, no consumers yet)

- [ ] **Step 5: Commit**

```bash
git add src/bridge/types.ts
git commit -m "feat: add bridge types for background command management"
```

---

### Task 2: Background Commands Detection — Pure Functions

**Files:**
- Create: `src/panel/webview/app/background-commands.ts`
- Create: `src/panel/webview/app/background-commands.test.ts`

**Interfaces:**
- Produces: `RunningBashTool` type, `scanRunningBashTools()`, `isOvertime()`

- [ ] **Step 1: Write the failing tests**

Create `src/panel/webview/app/background-commands.test.ts`:

```typescript
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { SessionMessage } from "../../../core/sdk"
import { isOvertime, scanRunningBashTools, type RunningBashTool } from "./background-commands"

function message(id: string, role: "user" | "assistant", parts: SessionMessage["parts"]): SessionMessage {
  return {
    info: { id, sessionID: "s1", role, time: { created: 0 } },
    parts,
  }
}

function toolPart(partID: string, messageID: string, tool: string, status: string, command?: string, title?: string): SessionMessage["parts"][number] {
  return {
    id: partID,
    sessionID: "s1",
    messageID,
    type: "tool",
    tool,
    state: {
      status: status as "pending" | "running" | "completed" | "error",
      ...(command !== undefined ? { input: { command } } : {}),
      ...(title !== undefined ? { title } : {}),
    },
  }
}

describe("scanRunningBashTools", () => {
  test("empty messages returns empty array", () => {
    assert.deepEqual(scanRunningBashTools([]), [])
  })

  test("running bash tool is included", () => {
    const msgs = [message("m1", "assistant", [toolPart("p1", "m1", "bash", "running", "yarn dev")])]
    const result = scanRunningBashTools(msgs)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.partID, "p1")
    assert.equal(result[0]!.messageID, "m1")
    assert.equal(result[0]!.command, "yarn dev")
  })

  test("completed bash tool is not included", () => {
    const msgs = [message("m1", "assistant", [toolPart("p1", "m1", "bash", "completed", "yarn dev")])]
    assert.deepEqual(scanRunningBashTools(msgs), [])
  })

  test("running non-bash tool is not included", () => {
    const msgs = [message("m1", "assistant", [toolPart("p1", "m1", "read", "running")])]
    assert.deepEqual(scanRunningBashTools(msgs), [])
  })

  test("error bash tool is not included", () => {
    const msgs = [message("m1", "assistant", [toolPart("p1", "m1", "bash", "error", "yarn dev")])]
    assert.deepEqual(scanRunningBashTools(msgs), [])
  })

  test("command falls back to title when input.command missing", () => {
    const msgs = [message("m1", "assistant", [toolPart("p1", "m1", "bash", "running", undefined, "yarn build")])]
    const result = scanRunningBashTools(msgs)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.command, "yarn build")
  })

  test("multiple running bash tools are all included", () => {
    const msgs = [
      message("m1", "assistant", [toolPart("p1", "m1", "bash", "running", "yarn dev")]),
      message("m2", "assistant", [toolPart("p2", "m2", "bash", "running", "yarn test")]),
    ]
    const result = scanRunningBashTools(msgs)
    assert.equal(result.length, 2)
  })
})

describe("isOvertime", () => {
  const tool: RunningBashTool = { partID: "p1", messageID: "m1", command: "yarn dev", firstSeenAt: 1000 }

  test("below threshold returns false", () => {
    assert.equal(isOvertime(tool, 2000, 10_000), false)
  })

  test("at threshold returns true", () => {
    assert.equal(isOvertime(tool, 11_000, 10_000), true)
  })

  test("above threshold returns true", () => {
    assert.equal(isOvertime(tool, 50_000, 10_000), true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/panel/webview/app/background-commands.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the implementation**

Create `src/panel/webview/app/background-commands.ts`:

```typescript
import type { SessionMessage } from "../../../core/sdk"

export type RunningBashTool = {
  partID: string
  messageID: string
  command: string
}

export function scanRunningBashTools(messages: SessionMessage[]): RunningBashTool[] {
  const tools: RunningBashTool[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== "bash") {
        continue
      }
      if (part.state?.status !== "running") {
        continue
      }
      const input = part.state?.input as Record<string, unknown> | undefined
      const command = typeof input?.command === "string"
        ? input.command
        : typeof part.state?.title === "string"
          ? part.state.title
          : ""
      tools.push({
        partID: part.id,
        messageID: part.messageID,
        command,
      })
    }
  }
  return tools
}

export function isOvertime(tool: RunningBashTool & { firstSeenAt: number }, now: number, thresholdMs: number): boolean {
  return now - tool.firstSeenAt >= thresholdMs
}
```

Note: The `firstSeenAt` field is not part of `RunningBashTool` — it is added by the hook at runtime. The `isOvertime` function accepts a tool extended with `firstSeenAt` to keep the pure function testable without React.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/panel/webview/app/background-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/webview/app/background-commands.ts src/panel/webview/app/background-commands.test.ts
git commit -m "feat: add scanRunningBashTools and isOvertime pure functions"
```

---

### Task 3: Background Commands Hook

**Files:**
- Modify: `src/panel/webview/app/background-commands.ts`
- Modify: `src/panel/webview/app/background-commands.test.ts`

**Interfaces:**
- Consumes: `scanRunningBashTools`, `isOvertime` from Task 2
- Produces: `useRunningBashTools()` hook returning `{ tools, hasOvertime }`

- [ ] **Step 1: Add hook to implementation**

Append to `src/panel/webview/app/background-commands.ts`:

```typescript
import React from "react"

const OVERTIME_THRESHOLD_MS = 10_000

type RunningBashToolWithTime = RunningBashTool & { firstSeenAt: number }

export function useRunningBashTools(messages: SessionMessage[]): {
  tools: RunningBashTool[]
  hasOvertime: boolean
} {
  const firstSeenRef = React.useRef<Map<string, number>>(new Map())
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0)

  const scanned = scanRunningBashTools(messages)
  const scannedIds = new Set(scanned.map((t) => t.partID))
  const seen = firstSeenRef.current

  for (const id of [...seen.keys()]) {
    if (!scannedIds.has(id)) {
      seen.delete(id)
    }
  }
  for (const tool of scanned) {
    if (!seen.has(tool.partID)) {
      seen.set(tool.partID, Date.now())
    }
  }

  const toolsWithTime: RunningBashToolWithTime[] = scanned.map((t) => ({
    ...t,
    firstSeenAt: seen.get(t.partID) ?? Date.now(),
  }))

  const hasOvertime = toolsWithTime.some((t) => isOvertime(t, Date.now(), OVERTIME_THRESHOLD_MS))

  React.useEffect(() => {
    if (toolsWithTime.length === 0) {
      return
    }
    const interval = setInterval(forceRender, 1000)
    return () => clearInterval(interval)
  }, [toolsWithTime.length])

  return {
    tools: scanned,
    hasOvertime,
  }
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `bun test src/panel/webview/app/background-commands.test.ts`
Expected: PASS

- [ ] **Step 3: Run type-check**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/panel/webview/app/background-commands.ts
git commit -m "feat: add useRunningBashTools hook with overtime detection"
```

---

### Task 4: Webview State and Host Message Handling

**Files:**
- Modify: `src/panel/webview/app/state.ts`
- Modify: `src/panel/webview/hooks/useHostMessages.ts`
- Modify: `src/panel/webview/hooks/useHostMessages.test.ts`

**Interfaces:**
- Consumes: `PtySessionInfo` from `src/bridge/types.ts` (Task 1)
- Produces: `ptySessions` field on `AppState`, `ptyUpdate` message handling

- [ ] **Step 1: Write the failing test for ptyUpdate handling**

In `src/panel/webview/hooks/useHostMessages.test.ts`, add a new test inside the `describe("dispatchHostMessage")` block:

```typescript
test("dispatches ptyUpdate to state.ptySessions", () => {
  const fileRefStatus = new Map<string, boolean>()
  let resultState: AppState | undefined
  const initialState = createInitialState(null)

  dispatchHostMessage({
    type: "ptyUpdate",
    sessions: [{
      id: "pty-1",
      title: "yarn dev",
      command: "yarn dev",
      cwd: "/workspace",
      status: "running",
      pid: 12345,
    }],
  } satisfies HostMessage, {
    fileRefStatus,
    onFileSearchResults: () => {},
    onFocusComposer: () => {},
    onRestoreComposer: () => {},
    onShellCommandSucceeded: () => {},
    setPendingMcpActions: (() => {}) as Dispatch<SetStateAction<Record<string, boolean>>>,
    setState: ((update: SetStateAction<AppState>) => {
      resultState = typeof update === "function" ? (update as (c: AppState) => AppState)(initialState) : update
    }) as Dispatch<SetStateAction<AppState>>,
  })

  assert.equal(resultState?.ptySessions.length, 1)
  assert.equal(resultState?.ptySessions[0]?.id, "pty-1")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/panel/webview/hooks/useHostMessages.test.ts`
Expected: FAIL — `ptySessions` does not exist on `AppState`

- [ ] **Step 3: Add `ptySessions` to `AppState` and `createInitialState`**

In `src/panel/webview/app/state.ts`:

1. Add import at top:
```typescript
import type { ComposerFileSelection, ComposerPathKind, PtySessionInfo, SessionBootstrap, SessionMessageHistory, SessionPickerPayload, SessionSnapshot, SkillCatalogEntry } from "../../../bridge/types"
```

2. Add field to `AppState` type (after `form: FormState`):
```typescript
  ptySessions: PtySessionInfo[]
```

3. Add to `createInitialState` return object (after `form: { ... }`):
```typescript
    ptySessions: [],
```

- [ ] **Step 4: Handle `ptyUpdate` in `useHostMessages`**

In `src/panel/webview/hooks/useHostMessages.ts`, after the existing message handlers (before the end of the function), add:

```typescript
if (message?.type === "ptyUpdate") {
  handlers.setState((current) => ({
    ...current,
    ptySessions: message.sessions,
  }))
  return
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/panel/webview/hooks/useHostMessages.test.ts`
Expected: PASS

- [ ] **Step 6: Run type-check and lint**

Run: `bun run check-types && bun run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/panel/webview/app/state.ts src/panel/webview/hooks/useHostMessages.ts src/panel/webview/hooks/useHostMessages.test.ts
git commit -m "feat: add ptySessions to AppState and handle ptyUpdate message"
```

---

### Task 5: Host-Side Actions — detachBashTool and stopPty

**Files:**
- Modify: `src/panel/provider/actions.ts`
- Modify: `src/panel/provider/actions.test.ts`

**Interfaces:**
- Consumes: `ActionContext` from existing `actions.ts`, SDK `session.abort` and `pty.create`/`pty.remove`
- Produces: `detachBashTool(ctx, command, messageID)`, `stopPty(ctx, ptyID)`

- [ ] **Step 1: Write the failing tests**

In `src/panel/provider/actions.test.ts`, add new tests. First, understand the existing `createContext` helper pattern used in the file — it provides mock SDK methods. Add `pty` mock methods to the context.

Add these tests inside the existing `describe` block:

```typescript
test("detachBashTool calls session.abort then pty.create with correct command", async () => {
  let abortCalled = false
  let ptyPayload: unknown
  const { ctx } = createContext({
    abort: async () => { abortCalled = true; return { data: true } },
    ptyCreate: async (input) => { ptyPayload = input; return { data: { id: "pty-1", title: "yarn dev", command: "yarn dev", args: [], cwd: "/workspace", status: "running", pid: 123 } } },
  })

  await withImmediateTimeout(async () => {
    await detachBashTool(ctx, "yarn dev", "msg-1")
  })

  assert.equal(abortCalled, true)
  assert.deepEqual(ptyPayload, {
    command: "yarn dev",
    cwd: "/workspace",
    title: "yarn dev",
  })
})

test("detachBashTool handles session.abort failure gracefully", async () => {
  let ptyCalled = false
  const { ctx } = createContext({
    abort: async () => { throw new Error("abort failed") },
    ptyCreate: async () => { ptyCalled = true; return { data: { id: "pty-1", title: "", command: "", args: [], cwd: "", status: "running", pid: 0 } } },
  })

  await withImmediateTimeout(async () => {
    await detachBashTool(ctx, "yarn dev", "msg-1")
  })

  assert.equal(ptyCalled, true)
})

test("detachBashTool handles pty.create failure gracefully", async () => {
  const { ctx } = createContext({
    abort: async () => { return { data: true } },
    ptyCreate: async () => { throw new Error("pty create failed") },
  })

  await withImmediateTimeout(async () => {
    await detachBashTool(ctx, "yarn dev", "msg-1")
  })
})

test("stopPty calls pty.remove with correct ptyID", async () => {
  let removePayload: unknown
  const { ctx } = createContext({
    ptyRemove: async (input) => { removePayload = input; return { data: true } },
  })

  await withImmediateTimeout(async () => {
    await stopPty(ctx, "pty-123")
  })

  assert.deepEqual(removePayload, {
    ptyID: "pty-123",
    directory: "/workspace",
  })
})
```

Note: The `createContext` helper and `withImmediateTimeout` already exist in the test file. The mock SDK needs to include `session.abort`, `pty.create`, and `pty.remove`. If the existing mock pattern doesn't have these, add them to the mock creation helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/panel/provider/actions.test.ts`
Expected: FAIL — `detachBashTool` and `stopPty` not defined

- [ ] **Step 3: Implement `detachBashTool` and `stopPty`**

In `src/panel/provider/actions.ts`, add these functions (after the existing `runShellCommand` function):

```typescript
export async function detachBashTool(ctx: ActionContext, command: string, _messageID: string) {
  if (!command.trim() || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)
  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  try {
    await rt.sdk.session.abort({
      sessionID: ctx.ref.sessionId,
      directory: rt.dir,
    })
  } catch (err) {
    ctx.log(`detachBashTool: session.abort failed: ${textError(err)}`)
  }

  await wait(300)

  try {
    await rt.sdk.pty.create({
      command,
      cwd: rt.dir,
      title: command,
    } as Parameters<typeof rt.sdk.pty.create>[0])
  } catch (err) {
    ctx.log(`detachBashTool: pty.create failed: ${textError(err)}`)
    void vscode.window.showErrorMessage(`Failed to start background command: ${textError(err)}`)
  }

  await ctx.push(true)
}

export async function stopPty(ctx: ActionContext, ptyID: string) {
  if (!ptyID || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)
  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  try {
    await rt.sdk.pty.remove({
      ptyID,
      directory: rt.dir,
    })
  } catch (err) {
    ctx.log(`stopPty: pty.remove failed: ${textError(err)}`)
    void vscode.window.showErrorMessage(`Failed to stop background command: ${textError(err)}`)
  }
}
```

Note: The exact SDK method signatures for `pty.create` and `pty.remove` should match the `@opencode-ai/sdk` v2 types. The `pty.create` takes `{ command?, args?, cwd?, title?, env? }` in the body and `{ directory?, workspace? }` in query. The adapted `Client` type in `src/core/sdk.ts` may need the `pty` property exposed. Check if the SDK client already exposes `pty` — if not, add it to the `Client` type in `src/core/sdk.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/panel/provider/actions.test.ts`
Expected: PASS

- [ ] **Step 5: Run type-check and lint**

Run: `bun run check-types && bun run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/panel/provider/actions.ts src/panel/provider/actions.test.ts
git commit -m "feat: add detachBashTool and stopPty host actions"
```

---

### Task 6: Host-Side Controller — PTY Event Tracking and Message Handlers

**Files:**
- Modify: `src/panel/provider/controller.ts`

**Interfaces:**
- Consumes: `detachBashTool`, `stopPty` from Task 5, `PtySessionInfo` from Task 1
- Produces: PTY session tracking in controller, `ptyUpdate` push to webview, new webview message handlers

- [ ] **Step 1: Add PTY session tracking field and imports**

In `src/panel/provider/controller.ts`:

1. Update the import from `./actions` to include `detachBashTool` and `stopPty`:
```typescript
import { providerAuthAction, rejectQuestion, replyPermission, replyQuestion, runComposerAction, runMcpAction, runShellCommand, runSlashCommand, submit, detachBashTool, stopPty, type PanelActionState } from "./actions"
```

2. Add import for `PtySessionInfo`:
```typescript
import type { ComposerPromptPart, HostMessage, PtySessionInfo, SessionPanelRef, SessionSnapshot, WebviewMessage } from "../../bridge/types"
```

3. Add private field to `SessionPanelController` class (after `private deferredDirty`):
```typescript
private ptySessions: Map<string, PtySessionInfo> = new Map()
```

- [ ] **Step 2: Add PTY event handling in `handle()` method**

In the `handle()` method, after the existing `markDeferredDirty(event)` call and before the `needsRefresh` check, add:

```typescript
if (this.handlePtyEvent(event)) {
  return
}
```

Add the `handlePtyEvent` private method:

```typescript
private handlePtyEvent(event: SessionEvent): boolean {
  if (event.type === "pty.created") {
    const props = event.properties as { info?: PtySessionInfo }
    if (props.info) {
      this.ptySessions.set(props.info.id, props.info)
      void this.postPtyUpdate()
    }
    return true
  }

  if (event.type === "pty.updated") {
    const props = event.properties as { info?: PtySessionInfo }
    if (props.info) {
      this.ptySessions.set(props.info.id, props.info)
      void this.postPtyUpdate()
    }
    return true
  }

  if (event.type === "pty.exited") {
    const props = event.properties as { id?: string; exitCode?: number }
    if (props.id) {
      const existing = this.ptySessions.get(props.id)
      if (existing) {
        this.ptySessions.set(props.id, { ...existing, status: "exited" })
        void this.postPtyUpdate()
      }
    }
    return true
  }

  if (event.type === "pty.deleted") {
    const props = event.properties as { id?: string }
    if (props.id) {
      this.ptySessions.delete(props.id)
      void this.postPtyUpdate()
    }
    return true
  }

  return false
}
```

- [ ] **Step 3: Add `postPtyUpdate` method**

Add this private method to `SessionPanelController`:

```typescript
private async postPtyUpdate() {
  if (this.state.disposed || !this.ready) {
    return
  }
  const sessions = Array.from(this.ptySessions.values())
  await postToWebview(this.panel.webview, {
    type: "ptyUpdate",
    sessions,
  })
}
```

- [ ] **Step 4: Sync PTY sessions on panel ready**

In the `webview:ready` handler (the `if (message?.type === "ready")` block), after `await this.flushModelSelectionInit()`, add:

```typescript
await this.syncPtySessions()
```

Add the `syncPtySessions` private method:

```typescript
private async syncPtySessions() {
  const rt = this.mgr.get(this.ref.workspaceId)
  if (!rt || rt.state !== "ready" || !rt.sdk) {
    return
  }
  try {
    const result = await rt.sdk.pty.list({ directory: rt.dir })
    const sessions = result.data
    if (Array.isArray(sessions)) {
      this.ptySessions.clear()
      for (const session of sessions) {
        if (session && typeof session === "object" && "id" in session) {
          this.ptySessions.set(session.id, session as PtySessionInfo)
        }
      }
      await this.postPtyUpdate()
    }
  } catch {
    // PTY list not available — silently skip
  }
}
```

- [ ] **Step 5: Add webview message handlers for `detachBashTool` and `stopPty`**

In the `onDidReceiveMessage` callback, after the existing `runShellCommand` handler, add:

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

- [ ] **Step 6: Clear PTY sessions on retarget**

In the `retarget()` method, add after `this.deferredDirty = { ... }`:

```typescript
this.ptySessions.clear()
```

- [ ] **Step 7: Run type-check and lint**

Run: `bun run check-types && bun run lint`
Expected: PASS

- [ ] **Step 8: Run existing controller tests to verify no regressions**

Run: `bun test src/panel/provider/`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/panel/provider/controller.ts
git commit -m "feat: add PTY event tracking and detachBashTool/stopPty handlers to controller"
```

---

### Task 7: BackgroundCommandBar Component

**Files:**
- Create: `src/panel/webview/app/background-command-bar.tsx`
- Create: `src/panel/webview/app/background-command-bar.test.tsx`

**Interfaces:**
- Consumes: `RunningBashTool` from Task 2, `PtySessionInfo` from Task 1
- Produces: `BackgroundCommandBar` React component

- [ ] **Step 1: Write the failing tests**

Create `src/panel/webview/app/background-command-bar.test.tsx`:

```typescript
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { BackgroundCommandBar } from "./background-command-bar"
import type { RunningBashTool } from "./background-commands"
import type { PtySessionInfo } from "../../../bridge/types"

function render(node: React.JSX.Element): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return { container, unmount: () => act(() => root.unmount()) }
}

const sampleTool: RunningBashTool = { partID: "p1", messageID: "m1", command: "yarn dev" }
const samplePty: PtySessionInfo = { id: "pty-1", title: "yarn dev", command: "yarn dev", cwd: "/ws", status: "running", pid: 123 }

describe("BackgroundCommandBar", () => {
  test("returns null when no tools and no PTY sessions", () => {
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[]} hasOvertime={false} ptySessions={[]} onKill={() => {}} onDetach={() => {}} onStopPty={() => {}} />
    )
    assert.equal(container.children.length, 0)
    unmount()
  })

  test("shows 1 command running for single bash tool", () => {
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[sampleTool]} hasOvertime={false} ptySessions={[]} onKill={() => {}} onDetach={() => {}} onStopPty={() => {}} />
    )
    assert.ok(container.textContent?.includes("1 command running"))
    unmount()
  })

  test("shows 2 commands running for two bash tools", () => {
    const tool2 = { ...sampleTool, partID: "p2" }
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[sampleTool, tool2]} hasOvertime={false} ptySessions={[]} onKill={() => {}} onDetach={() => {}} onStopPty={() => {}} />
    )
    assert.ok(container.textContent?.includes("2 commands running"))
    unmount()
  })

  test("shows PTY session with stop button", () => {
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[]} hasOvertime={false} ptySessions={[samplePty]} onKill={() => {}} onDetach={() => {}} onStopPty={() => {}} />
    )
    assert.ok(container.textContent?.includes("yarn dev"))
    const stopBtn = container.querySelector(".oc-backgroundCommandStop")
    assert.ok(stopBtn)
    unmount()
  })

  test("does not show exited PTY sessions", () => {
    const exitedPty = { ...samplePty, status: "exited" as const }
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[]} hasOvertime={false} ptySessions={[exitedPty]} onKill={() => {}} onDetach={() => {}} onStopPty={() => {}} />
    )
    assert.equal(container.children.length, 0)
    unmount()
  })

  test("has is-overtime class when hasOvertime is true", () => {
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[sampleTool]} hasOvertime={true} ptySessions={[]} onKill={() => {}} onDetach={() => {}} onStopPty={() => {}} />
    )
    const bar = container.querySelector(".oc-backgroundCommandBar")
    assert.ok(bar?.classList.contains("is-overtime"))
    unmount()
  })

  test("click kill calls onKill", () => {
    let called = false
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[sampleTool]} hasOvertime={false} ptySessions={[]} onKill={() => { called = true }} onDetach={() => {}} onStopPty={() => {}} />
    )
    const killBtn = container.querySelector(".oc-backgroundCommandStop")
    assert.ok(killBtn)
    act(() => { killBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    assert.equal(called, true)
    unmount()
  })

  test("click detach calls onDetach with tool", () => {
    let detachedTool: RunningBashTool | null = null
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[sampleTool]} hasOvertime={false} ptySessions={[]} onKill={() => {}} onDetach={(t) => { detachedTool = t }} onStopPty={() => {}} />
    )
    const detachBtn = container.querySelector(".oc-backgroundCommandDetach")
    assert.ok(detachBtn)
    act(() => { detachBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    assert.ok(detachedTool)
    assert.equal(detachedTool!.command, "yarn dev")
    unmount()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/panel/webview/app/background-command-bar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create the component**

Create `src/panel/webview/app/background-command-bar.tsx`:

```typescript
import React from "react"
import type { PtySessionInfo } from "../../../bridge/types"
import type { RunningBashTool } from "./background-commands"

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
}): React.JSX.Element | null {
  const runningPtySessions = ptySessions.filter((s) => s.status === "running")
  const total = tools.length + runningPtySessions.length

  if (total === 0) {
    return null
  }

  const label = total === 1 ? "1 command running" : `${total} commands running`

  return (
    <div className={`oc-backgroundCommandBar${hasOvertime ? " is-overtime" : ""}`}>
      <div className="oc-backgroundCommandBarInner">
        <div className="oc-backgroundCommandBadge">
          <span className="oc-backgroundCommandBadgeDot" />
          <span>{label}</span>
        </div>
        <div className="oc-backgroundCommandSection">
          {tools.map((tool) => (
            <div key={tool.partID} className="oc-backgroundCommandItem">
              <span className="oc-backgroundCommandText" title={tool.command}>{tool.command}</span>
              <button type="button" className="oc-backgroundCommandStop" onClick={onKill} aria-label="Kill command" title="Kill (interrupts session)">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" className="oc-backgroundCommandStopPath" /></svg>
              </button>
              <button type="button" className="oc-backgroundCommandDetach" onClick={() => onDetach(tool)} aria-label="Detach to background" title="Detach to background (restarts in PTY)">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h5a3 3 0 0 1 3 3v5M4 4l3-3M4 4l3 3" className="oc-backgroundCommandDetachPath" /></svg>
              </button>
            </div>
          ))}
        </div>
        {runningPtySessions.length > 0 ? (
          <div className="oc-backgroundCommandSection oc-backgroundCommandSectionPty">
            {runningPtySessions.map((session) => (
              <div key={session.id} className="oc-backgroundCommandItem">
                <span className="oc-backgroundCommandText" title={session.command}>{session.command}</span>
                <button type="button" className="oc-backgroundCommandStop" onClick={() => onStopPty(session.id)} aria-label="Stop background command" title="Stop background command">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" className="oc-backgroundCommandStopPath" /></svg>
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/panel/webview/app/background-command-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panel/webview/app/background-command-bar.tsx src/panel/webview/app/background-command-bar.test.tsx
git commit -m "feat: add BackgroundCommandBar component"
```

---

### Task 8: Timeline Kill/Detach Buttons — Context and Base Components

**Files:**
- Modify: `src/panel/webview/app/contexts.ts`
- Modify: `src/panel/webview/app/tool-rows.tsx`
- Modify: `src/panel/webview/renderers/CollapsibleShellBlock.tsx`
- Modify: `src/panel/webview/app/webview-bindings.tsx`

**Interfaces:**
- Produces: `BashToolActionsContext`, `onKill`/`onDetach` props on `ToolRow` and `CollapsibleShellBlock`

- [ ] **Step 1: Add `BashToolActionsContext` to `contexts.ts`**

In `src/panel/webview/app/contexts.ts`, add:

```typescript
import React from "react"

export const BashToolActionsContext = React.createContext<{
  onKill: (() => void) | null
  onDetach: ((tool: { command: string; messageID: string }) => void) | null
}>({ onKill: null, onDetach: null })

export function useBashToolActions() {
  return React.useContext(BashToolActionsContext)
}
```

- [ ] **Step 2: Add `onKill`/`onDetach` props to `ToolRow` in `tool-rows.tsx`**

In `src/panel/webview/app/tool-rows.tsx`, add optional props to `ToolRow`:

```typescript
export function ToolRow({
  ToolStatus,
  active = false,
  isMcpTool,
  part,
  renderToolRowExtra,
  renderToolRowTitle,
  extras,
  toolLabel,
  onKill,
  onDetach,
}: {
  ToolStatus: ({ state }: { state?: string }) => React.JSX.Element | null
  active?: boolean
  isMcpTool: (tool: string) => boolean
  part: Extract<MessagePart, { type: "tool" }>
  renderToolRowExtra: (part: Extract<MessagePart, { type: "tool" }>, item: string) => React.ReactNode
  renderToolRowTitle: (part: Extract<MessagePart, { type: "tool" }>) => React.ReactNode
  extras: string[]
  toolLabel: (tool: string) => string
  onKill?: () => void
  onDetach?: () => void
}) {
```

In the JSX, within `oc-toolRowMeta`, after the `ToolStatus`, add:

```typescript
{part.tool === "bash" && part.state?.status === "running" && onKill ? (
  <button type="button" className="oc-toolRowKill" onClick={onKill} aria-label="Kill command" title="Kill (interrupts session)">
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" className="oc-toolRowKillPath" /></svg>
  </button>
) : null}
{part.tool === "bash" && part.state?.status === "running" && onDetach ? (
  <button type="button" className="oc-toolRowDetach" onClick={onDetach} aria-label="Detach to background" title="Detach to background (restarts in PTY)">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h5a3 3 0 0 1 3 3v5M4 4l3-3M4 4l3 3" className="oc-toolRowDetachPath" /></svg>
  </button>
) : null}
```

- [ ] **Step 3: Add `onKill`/`onDetach` props to `CollapsibleShellBlock`**

In `src/panel/webview/renderers/CollapsibleShellBlock.tsx`, add optional props:

```typescript
interface CollapsibleShellBlockProps {
  ToolStatus: ({ state }: { state?: string }) => React.JSX.Element | null
  action: string
  title: React.ReactNode
  running?: boolean
  body: string
  className?: string
  onKill?: () => void
  onDetach?: () => void
}

export function CollapsibleShellBlock({
  ToolStatus,
  action,
  title,
  running = false,
  body,
  className = "",
  onKill,
  onDetach,
}: CollapsibleShellBlockProps) {
```

In the header meta area, after the spinner, add:

```typescript
{running && onKill ? (
  <button type="button" className="oc-toolRowKill" onClick={onKill} aria-label="Kill command" title="Kill (interrupts session)">
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" className="oc-toolRowKillPath" /></svg>
  </button>
) : null}
{running && onDetach ? (
  <button type="button" className="oc-toolRowDetach" onClick={onDetach} aria-label="Detach to background" title="Detach to background (restarts in PTY)">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h5a3 3 0 0 1 3 3v5M4 4l3-3M4 4l3 3" className="oc-toolRowDetachPath" /></svg>
  </button>
) : null}
```

- [ ] **Step 4: Consume context in `webview-bindings.tsx`**

In `src/panel/webview/app/webview-bindings.tsx`:

1. Add import:
```typescript
import { useBashToolActions } from "./contexts"
```

2. In `ToolRow` function, consume context and pass to `BaseToolRow`:

```typescript
export function ToolRow({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  if (part.tool === "task") {
    return <TaskToolRow part={part} active={active} />
  }

  const workspaceDir = useWorkspaceDir()
  const { onKill, onDetach } = useBashToolActions()
  const extras = toolRowExtras(part)
  const command = typeof part.state?.input === "object" && part.state?.input !== null
    ? String((part.state.input as Record<string, unknown>).command ?? "")
    : ""
  return <BaseToolRow ToolStatus={ToolStatus} active={active} isMcpTool={isMcpTool} part={part} renderToolRowExtra={(current, item) => renderToolRowExtra(current, item, FileRefText)} renderToolRowTitle={(current) => renderToolRowTitle(current, toolDetails(current), { FileRefText, renderLspToolTitle: renderInlineLspToolTitle, workspaceDir })} extras={extras} toolLabel={toolLabel} onKill={onKill ?? undefined} onDetach={onDetach && command ? () => onDetach({ command, messageID: part.messageID }) : undefined} />
}
```

3. In `ToolShellPanel` function, consume context and pass to `BaseCollapsibleShellBlock`:

```typescript
export function ToolShellPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const body = toolTextBody(part)
  const status = part.state?.status || "pending"
  const { onKill, onDetach } = useBashToolActions()
  const command = typeof part.state?.input === "object" && part.state?.input !== null
    ? String((part.state.input as Record<string, unknown>).command ?? "")
    : ""
  return (
    <BaseCollapsibleShellBlock
      ToolStatus={ToolStatus}
      action={toolLabel(part.tool)}
      title={details.title}
      running={status === "running"}
      body={body}
      className={active ? "is-active" : ""}
      onKill={onKill ?? undefined}
      onDetach={onDetach && command ? () => onDetach({ command, messageID: part.messageID }) : undefined}
    />
  )
}
```

- [ ] **Step 5: Run type-check and lint**

Run: `bun run check-types && bun run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/panel/webview/app/contexts.ts src/panel/webview/app/tool-rows.tsx src/panel/webview/renderers/CollapsibleShellBlock.tsx src/panel/webview/app/webview-bindings.tsx
git commit -m "feat: add kill/detach buttons to ToolRow and CollapsibleShellBlock via context"
```

---

### Task 9: App.tsx Integration

**Files:**
- Modify: `src/panel/webview/app/App.tsx`

**Interfaces:**
- Consumes: `useRunningBashTools` from Task 3, `BackgroundCommandBar` from Task 7, `BashToolActionsContext` from Task 8

- [ ] **Step 1: Add imports**

At the top of `src/panel/webview/app/App.tsx`, add:

```typescript
import { useRunningBashTools } from "./background-commands"
import { BackgroundCommandBar } from "./background-command-bar"
import { BashToolActionsContext } from "./contexts"
```

- [ ] **Step 2: Call hook and define callbacks**

Inside the `App()` function, after the existing `useModifierState()` call, add:

```typescript
const { tools: runningBashTools, hasOvertime } = useRunningBashTools(state.snapshot.messages)

const onKill = React.useCallback(() => {
  vscode.postMessage({ type: "composerAction", action: "interruptSession" })
}, [])

const onDetach = React.useCallback((tool: { command: string; messageID: string }) => {
  vscode.postMessage({ type: "detachBashTool", command: tool.command, messageID: tool.messageID })
}, [])

const onStopPty = React.useCallback((ptyID: string) => {
  vscode.postMessage({ type: "stopPty", ptyID })
}, [])

const bashToolActions = React.useMemo(() => ({ onKill, onDetach }), [onDetach, onKill])
```

- [ ] **Step 3: Wrap timeline with context provider**

Find the `<main ref={timelineRef} className="oc-transcript">` section and wrap it:

```typescript
<BashToolActionsContext.Provider value={bashToolActions}>
  <main ref={timelineRef} className="oc-transcript">
    <div className="oc-transcriptInner">
      <Timeline ... />
    </div>
  </main>
</BashToolActionsContext.Provider>
```

- [ ] **Step 4: Insert BackgroundCommandBar in the footer**

In the `!blocked && !isChildSession` conditional block, before the `<section className="oc-composer ...">` element, insert:

```typescript
<BackgroundCommandBar
  tools={runningBashTools}
  hasOvertime={hasOvertime}
  ptySessions={state.ptySessions}
  onKill={onKill}
  onDetach={onDetach}
  onStopPty={onStopPty}
/>
```

- [ ] **Step 5: Run type-check and lint**

Run: `bun run check-types && bun run lint`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `bun test src/panel ./src/test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/panel/webview/app/App.tsx
git commit -m "feat: wire BackgroundCommandBar and BashToolActionsContext into App"
```

---

### Task 10: CSS Styling

**Files:**
- Modify: `src/panel/webview/tool.css`

- [ ] **Step 1: Add styles for kill/detach buttons and management bar**

Append to `src/panel/webview/tool.css`:

```css
/* Timeline kill/detach buttons */
.oc-toolRowKill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--oc-color-text-secondary, #f85149);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
}
.oc-toolRowKill:hover {
  opacity: 1;
  background: rgba(248, 81, 73, 0.15);
}
.oc-toolRowKill:disabled {
  opacity: 0.3;
  cursor: default;
}
.oc-toolRowKillPath {
  fill: currentColor;
  stroke: none;
}
.oc-toolRowDetach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--oc-color-text-secondary, #58a6ff);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
}
.oc-toolRowDetach:hover {
  opacity: 1;
  background: rgba(88, 166, 255, 0.15);
}
.oc-toolRowDetach:disabled {
  opacity: 0.3;
  cursor: default;
}
.oc-toolRowDetachPath {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Background command management bar */
.oc-backgroundCommandBar {
  margin-bottom: 4px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--oc-color-bg-secondary, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--oc-color-border, rgba(255, 255, 255, 0.06));
  transition: background 0.2s, border-color 0.2s;
}
.oc-backgroundCommandBar.is-overtime {
  background: rgba(248, 81, 73, 0.08);
  border-color: rgba(248, 81, 73, 0.3);
}
.oc-backgroundCommandBarInner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.oc-backgroundCommandBadge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
  color: var(--oc-color-text-secondary, #8b949e);
}
.oc-backgroundCommandBar.is-overtime .oc-backgroundCommandBadge {
  color: #f85149;
}
.oc-backgroundCommandBadgeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: oc-pulse 1.5s ease-in-out infinite;
}
@keyframes oc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.oc-backgroundCommandSection {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}
.oc-backgroundCommandSectionPty {
  padding-left: 8px;
  border-left: 1px solid var(--oc-color-border, rgba(255, 255, 255, 0.06));
}
.oc-backgroundCommandItem {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.oc-backgroundCommandText {
  font-size: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--oc-color-text, #c9d1d9);
}
.oc-backgroundCommandStop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #f85149;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
}
.oc-backgroundCommandStop:hover {
  opacity: 1;
  background: rgba(248, 81, 73, 0.15);
}
.oc-backgroundCommandStopPath {
  fill: currentColor;
  stroke: none;
}
.oc-backgroundCommandDetach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #58a6ff;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
}
.oc-backgroundCommandDetach:hover {
  opacity: 1;
  background: rgba(88, 166, 255, 0.15);
}
.oc-backgroundCommandDetachPath {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

- [ ] **Step 2: Run type-check and lint**

Run: `bun run check-types && bun run lint`
Expected: PASS

- [ ] **Step 3: Run compile to verify CSS is bundled**

Run: `bun run compile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/panel/webview/tool.css
git commit -m "feat: add CSS styles for kill/detach buttons and background command bar"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Run all tests**

Run: `bun test src/panel ./src/test`
Expected: All PASS

- [ ] **Step 2: Run full validation**

Run: `bun run check-types && bun run lint && bun run compile`
Expected: PASS

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: final verification adjustments"
```
