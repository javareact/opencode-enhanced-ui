import React from "react"
import type { ComposerPathResult, HostMessage, SessionSnapshot } from "../../../bridge/types"
import { reduceSessionSnapshot } from "../../shared/session-reducer"
import { summarizeSessionSnapshot } from "../../shared/session-summary"
import { bootstrapFromSnapshot, normalizeSessionPickerPayload, normalizeSnapshotPayload, type AppState, type VsCodeApi } from "../app/state"

export function dispatchHostMessage(message: HostMessage, handlers: {
  fileRefStatus: Map<string, boolean>
  onErrorMessage?: (message: string) => void
  onFileSearchResults: (payload: { requestID: string; query: string; results: ComposerPathResult[] }) => void
  onFocusComposer: () => void
  onRestoreComposer: (payload: { parts: import("../../../bridge/types").ComposerPromptPart[] }) => void
  onShellCommandSucceeded: () => void
  setPendingMcpActions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setState: React.Dispatch<React.SetStateAction<AppState>>
}) {
  if (message?.type === "bootstrap") {
    handlers.setState((current) => ({ ...current, bootstrap: message.payload, error: "" }))
    return
  }

  if (message?.type === "snapshot") {
    handlers.setState((current) => {
      const nextSnapshot = normalizeSnapshotPayload(message.payload, current.snapshot)
      return {
        ...current,
        bootstrap: bootstrapFromSnapshot(message.payload),
        snapshot: nextSnapshot,
        error: "",
      }
    })
    return
  }

  if (message?.type === "sessionEvent") {
    handlers.setState((current) => {
      const nextSnapshotState = reduceSessionSnapshot(asSessionSnapshot(current), message.event)
      if (!nextSnapshotState) {
        return current
      }

      const nextSnapshot = normalizeSnapshotPayload(nextSnapshotState)
      return {
        ...current,
        bootstrap: {
          ...bootstrapFromSnapshot(nextSnapshotState),
          message: summarizeSessionSnapshot(nextSnapshotState),
        },
        snapshot: nextSnapshot,
        error: "",
      }
    })
    return
  }

  if (message?.type === "deferredUpdate") {
    handlers.setState((current) => {
      const nextSnapshot = {
        ...current.snapshot,
        ...message.payload,
      }
      return {
        ...current,
        bootstrap: {
          ...current.bootstrap,
          message: summarizeSessionSnapshot({
            ...nextSnapshot,
            status: current.bootstrap.status,
            workspaceName: current.bootstrap.workspaceName,
            sessionRef: current.bootstrap.sessionRef,
          }),
        },
        snapshot: {
          ...nextSnapshot,
        },
        error: "",
      }
    })
    return
  }

  if (message?.type === "submitting") {
    handlers.setState((current) => ({
      ...current,
      bootstrap: {
        ...current.bootstrap,
        message: summarizeSessionSnapshot({
          ...current.snapshot,
          submitting: message.value,
          status: current.bootstrap.status,
          workspaceName: current.bootstrap.workspaceName,
          sessionRef: current.bootstrap.sessionRef,
        }),
      },
      snapshot: {
        ...current.snapshot,
        submitting: message.value,
      },
    }))
    return
  }

  if (message?.type === "error") {
    handlers.onErrorMessage?.(message.message || "Unknown error")
    handlers.setState((current) => ({ ...current, error: message.message || "Unknown error" }))
    return
  }

  if (message?.type === "fileRefsResolved") {
    for (const item of message.refs) {
      handlers.fileRefStatus.set(item.key, item.exists)
    }
    window.dispatchEvent(new CustomEvent("oc-file-refs-updated"))
    return
  }

  if (message?.type === "fileSearchResults") {
    handlers.onFileSearchResults(message)
    return
  }

  if (message?.type === "restoreComposer") {
    handlers.onRestoreComposer(message)
    return
  }

  if (message?.type === "focusComposer") {
    handlers.onFocusComposer()
    return
  }

  if (message?.type === "shellCommandSucceeded") {
    handlers.onShellCommandSucceeded()
    return
  }

  if (message?.type === "sessionPicker") {
    handlers.setState((current) => ({
      ...current,
      sessionPicker: normalizeSessionPickerPayload(message.payload),
    }))
    return
  }

  if (message?.type === "modelSelectionInit") {
    handlers.setState((current) => {
      const nextOverrides = { ...current.composerModelOverrides }
      if (message.lastModel) {
        nextOverrides["build"] = message.lastModel
      }
      return {
        ...current,
        composerModelOverrides: nextOverrides,
        composerRecentModels: Array.isArray(message.recentModels) ? message.recentModels : current.composerRecentModels,
      }
    })
    return
  }

  if (message?.type === "mcpActionFinished") {
    handlers.setPendingMcpActions((current) => {
      if (!current[message.name]) {
        return current
      }
      const next = { ...current }
      delete next[message.name]
      return next
    })
  }
}

function asSessionSnapshot(state: AppState): SessionSnapshot {
  return {
    ...state.snapshot,
    status: state.bootstrap.status,
    workspaceName: state.bootstrap.workspaceName,
    sessionRef: state.bootstrap.sessionRef,
    session: state.snapshot.session,
    message: state.bootstrap.message || "",
  }
}

export function useHostMessages({
  fileRefStatus,
  onErrorMessage,
  onFileSearchResults,
  onFocusComposer,
  onRestoreComposer,
  onShellCommandSucceeded,
  setPendingMcpActions,
  setState,
  vscode,
}: {
  fileRefStatus: Map<string, boolean>
  onErrorMessage?: (message: string) => void
  onFileSearchResults: (payload: { requestID: string; query: string; results: ComposerPathResult[] }) => void
  onFocusComposer: () => void
  onRestoreComposer: (payload: { parts: import("../../../bridge/types").ComposerPromptPart[] }) => void
  onShellCommandSucceeded: () => void
  setPendingMcpActions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setState: React.Dispatch<React.SetStateAction<AppState>>
  vscode: VsCodeApi
}) {
  const fileSearchHandlerRef = React.useRef(onFileSearchResults)
  const focusComposerHandlerRef = React.useRef(onFocusComposer)
  const restoreComposerHandlerRef = React.useRef(onRestoreComposer)
  const shellSucceededHandlerRef = React.useRef(onShellCommandSucceeded)

  React.useEffect(() => {
    fileSearchHandlerRef.current = onFileSearchResults
  }, [onFileSearchResults])

  React.useEffect(() => {
    restoreComposerHandlerRef.current = onRestoreComposer
  }, [onRestoreComposer])

  React.useEffect(() => {
    focusComposerHandlerRef.current = onFocusComposer
  }, [onFocusComposer])

  React.useEffect(() => {
    shellSucceededHandlerRef.current = onShellCommandSucceeded
  }, [onShellCommandSucceeded])

  React.useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>) => {
      dispatchHostMessage(event.data, {
        fileRefStatus,
        onErrorMessage,
        onFileSearchResults: (payload) => fileSearchHandlerRef.current(payload),
        onFocusComposer: () => focusComposerHandlerRef.current(),
        onRestoreComposer: (payload) => restoreComposerHandlerRef.current(payload),
        onShellCommandSucceeded: () => shellSucceededHandlerRef.current(),
        setPendingMcpActions,
        setState,
      })
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "ready" })
    return () => window.removeEventListener("message", handler)
  }, [fileRefStatus, onErrorMessage, setPendingMcpActions, setState, vscode])
}
