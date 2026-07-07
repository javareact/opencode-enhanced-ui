import assert from "node:assert/strict"
import { describe, test } from "node:test"
import * as vscode from "vscode"

import type { SessionInfo } from "../core/sdk"
import { SessionViewProvider } from "./session-view-provider"

function session(id: string): SessionInfo {
  return {
    id,
    directory: "/workspace",
    title: "New session",
    time: { created: 1, updated: 1 },
  }
}

type SdkMock = {
  session: {
    list: (input: unknown) => Promise<{ data?: SessionInfo[] }>
    create: (input: unknown) => Promise<{ data?: SessionInfo }>
  }
}

function createProvider(opts: {
  sdk: SdkMock
  readyRuntimes?: number
}) {
  const rt = {
    workspaceId: "file:///workspace",
    dir: "/workspace",
    name: "workspace",
    state: "ready" as const,
    sdk: opts.sdk,
  }

  const mgr = {
    list: () => [rt],
    get: () => rt,
    onDidChange: () => ({ dispose() {} }),
  }

  const events = {
    onDidEvent: () => ({ dispose() {} }),
  }

  const focused = {
    onDidChange: () => ({ dispose() {} }),
    snapshot: () => ({ ref: undefined }),
  }

  const out = {
    appendLine() {},
  }

  const provider = new SessionViewProvider(
    vscode.Uri.parse("/extension"),
    mgr as any,
    events as any,
    focused as any,
    out as any,
  )

  return { provider, rt }
}

describe("SessionViewProvider autoResolve", () => {
  test("does not create duplicate sessions when called concurrently", async () => {
    let createCount = 0
    let listCount = 0
    const sdk: SdkMock = {
      session: {
        list: async () => {
          listCount += 1
          return { data: [] }
        },
        create: async () => {
          createCount += 1
          return { data: session(`s-${createCount}`) }
        },
      },
    }

    const { provider } = createProvider({ sdk })

    // Simulate concurrent calls from mgr.onDidChange and resolveWebviewView
    await Promise.all([
      (provider as any).autoResolve(),
      (provider as any).autoResolve(),
    ])

    assert.equal(listCount, 1, "session.list should only be called once")
    assert.equal(createCount, 1, "session.create should only be called once")
    assert.ok((provider as any).currentRef, "currentRef should be set")
  })

  test("reuses existing session when sessions already exist", async () => {
    let createCount = 0
    const existing = session("existing-1")
    const sdk: SdkMock = {
      session: {
        list: async () => ({ data: [existing] }),
        create: async () => {
          createCount += 1
          return { data: session("new") }
        },
      },
    }

    const { provider } = createProvider({ sdk })

    await (provider as any).autoResolve()

    assert.equal(createCount, 0, "should not create a new session")
    assert.equal((provider as any).currentRef?.sessionId, "existing-1")
  })
})
