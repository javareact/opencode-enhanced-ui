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

const sampleTool: RunningBashTool = { partID: "p1", messageID: "m1", command: "yarn dev", firstSeenAt: 0 }
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
    let detachedCommand = ""
    const { container, unmount } = render(
      <BackgroundCommandBar tools={[sampleTool]} hasOvertime={false} ptySessions={[]} onKill={() => {}} onDetach={(t) => { detachedCommand = t.command }} onStopPty={() => {}} />
    )
    const detachBtn = container.querySelector(".oc-backgroundCommandDetach")
    assert.ok(detachBtn)
    act(() => { detachBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    assert.equal(detachedCommand, "yarn dev")
    unmount()
  })
})
