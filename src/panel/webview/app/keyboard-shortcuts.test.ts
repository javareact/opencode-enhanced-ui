import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { composerEnterIntent, composerTabIntent, cycleAgentName, leaderAction, shouldEnterShellMode, shouldExitShellModeOnBackspace } from "./keyboard-shortcuts"

describe("keyboard shortcuts", () => {
  test("cycles visible primary agents and wraps", () => {
    const agents = [
      { name: "build", mode: "primary" as const },
      { name: "helper", mode: "subagent" as const },
      { name: "plan", mode: "all" as const },
      { name: "hidden", mode: "primary" as const, hidden: true },
    ]

    assert.equal(cycleAgentName(agents, "build"), "plan")
    assert.equal(cycleAgentName(agents, "plan"), "build")
    assert.equal(cycleAgentName(agents, "missing"), "build")
  })

  test("maps leader combos to upstream actions", () => {
    assert.equal(leaderAction("ArrowDown"), "childFirst")
    assert.equal(leaderAction("n"), "newSession")
    assert.equal(leaderAction("r"), "redoSession")
    assert.equal(leaderAction("u"), "undoSession")
    assert.equal(leaderAction("ArrowLeft"), undefined)
  })

  test("uses Tab for autocomplete before agent cycling only when a suggestion exists", () => {
    assert.equal(composerTabIntent({
      mode: "normal",
      hasAutocomplete: true,
      hasCurrentItem: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: true,
    }), "autocomplete")

    assert.equal(composerTabIntent({
      mode: "normal",
      hasAutocomplete: true,
      hasCurrentItem: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: true,
    }), "cycleAgent")

    assert.equal(composerTabIntent({
      mode: "shell",
      hasAutocomplete: false,
      hasCurrentItem: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: true,
    }), "ignore")

    assert.equal(composerTabIntent({
      mode: "normal",
      hasAutocomplete: true,
      hasCurrentItem: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: false,
    }), undefined)
  })

  test("enters shell mode only from an empty prompt at cursor zero", () => {
    assert.equal(shouldEnterShellMode({
      mode: "normal",
      draft: "",
      key: "!",
      start: 0,
      end: 0,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), true)

    assert.equal(shouldEnterShellMode({
      mode: "normal",
      draft: "\n",
      key: "!",
      start: 1,
      end: 1,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), true)

    assert.equal(shouldEnterShellMode({
      mode: "normal",
      draft: "hello",
      key: "!",
      start: 0,
      end: 0,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), false)

    assert.equal(shouldEnterShellMode({
      mode: "normal",
      draft: "\n\n",
      key: "!",
      start: 1,
      end: 1,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), false)

    assert.equal(shouldEnterShellMode({
      mode: "shell",
      draft: "",
      key: "!",
      start: 0,
      end: 0,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), false)
  })

  test("exits shell mode with backspace only when empty", () => {
    assert.equal(shouldExitShellModeOnBackspace({
      mode: "shell",
      draft: "",
      key: "Backspace",
      start: 0,
      end: 0,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), true)

    assert.equal(shouldExitShellModeOnBackspace({
      mode: "shell",
      draft: "\n",
      key: "Backspace",
      start: 1,
      end: 1,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), true)

    assert.equal(shouldExitShellModeOnBackspace({
      mode: "shell",
      draft: "echo hi",
      key: "Backspace",
      start: 7,
      end: 7,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), false)

    assert.equal(shouldExitShellModeOnBackspace({
      mode: "shell",
      draft: "\n\n",
      key: "Backspace",
      start: 1,
      end: 1,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }), false)
  })

  test("uses different Enter behavior: plain Enter submits, Ctrl+Enter inserts newline", () => {
    assert.equal(composerEnterIntent({
      mode: "normal",
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      hasAutocomplete: false,
      isImeComposing: false,
    }), "submit")

    assert.equal(composerEnterIntent({
      mode: "normal",
      key: "Enter",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      hasAutocomplete: false,
      isImeComposing: false,
    }), "newline")

    assert.equal(composerEnterIntent({
      mode: "shell",
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      hasAutocomplete: false,
      isImeComposing: false,
    }), "submit")

    assert.equal(composerEnterIntent({
      mode: "normal",
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      hasAutocomplete: false,
      isImeComposing: false,
    }), "submit")

    assert.equal(composerEnterIntent({
      mode: "normal",
      key: "Enter",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      hasAutocomplete: false,
      isImeComposing: false,
    }), "newline")

    assert.equal(composerEnterIntent({
      mode: "normal",
      key: "Enter",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      hasAutocomplete: false,
      isImeComposing: false,
    }), "newline")

    assert.equal(composerEnterIntent({
      mode: "shell",
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      hasAutocomplete: true,
      isImeComposing: false,
    }), "acceptAutocomplete")
  })
})
