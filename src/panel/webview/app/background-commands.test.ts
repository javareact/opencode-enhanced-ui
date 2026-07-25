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
