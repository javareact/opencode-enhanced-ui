import assert from "node:assert/strict"
import { describe, test } from "node:test"
import React from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"

import { WebviewBindingsProvider, useWebviewBindings } from "./webview-bindings"

type VsCodeApi = {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}

function createVsCodeApi(): VsCodeApi {
  return {
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  }
}

function ContextCapture({ onValue }: { onValue: (value: { fileRefStatus: Map<string, boolean>; vscode: VsCodeApi }) => void }) {
  const value = useWebviewBindings()
  onValue(value)
  return null
}

function TraceParent({
  fileRefStatus,
  vscode,
  renderTick,
  onValue,
}: {
  fileRefStatus: Map<string, boolean>
  vscode: VsCodeApi
  renderTick: number
  onValue: (value: { fileRefStatus: Map<string, boolean>; vscode: VsCodeApi }) => void
}) {
  return (
    <WebviewBindingsProvider fileRefStatus={fileRefStatus} vscode={vscode}>
      <ContextCapture onValue={onValue} />
      <span data-render-tick={renderTick} />
    </WebviewBindingsProvider>
  )
}

describe("WebviewBindingsProvider context value stability", () => {
  test("returns the same context value reference across parent re-renders when props are stable", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    const fileRefStatus = new Map<string, boolean>()
    const vscode = createVsCodeApi()
    const captured: Array<{ fileRefStatus: Map<string, boolean>; vscode: VsCodeApi }> = []

    flushSync(() => {
      root.render(<TraceParent fileRefStatus={fileRefStatus} vscode={vscode} renderTick={0} onValue={(v) => captured.push(v)} />)
    })

    // Re-render the parent with the same props but a different renderTick to force a parent re-render
    flushSync(() => {
      root.render(<TraceParent fileRefStatus={fileRefStatus} vscode={vscode} renderTick={1} onValue={(v) => captured.push(v)} />)
    })

    root.unmount()
    document.body.removeChild(container)

    assert.ok(captured.length >= 2, `expected at least two context value captures, got ${captured.length}`)
    assert.equal(captured[0], captured[1], "context value should be the same reference across re-renders")
  })
})
