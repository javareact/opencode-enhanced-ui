import React from "react"
import type { SessionMessage } from "../../../core/sdk"

export type RunningBashTool = {
  partID: string
  messageID: string
  command: string
  firstSeenAt: number
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
        firstSeenAt: 0,
      })
    }
  }
  return tools
}

export function isOvertime(tool: RunningBashTool & { firstSeenAt: number }, now: number, thresholdMs: number): boolean {
  return now - tool.firstSeenAt >= thresholdMs
}

const OVERTIME_THRESHOLD_MS = 10_000

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

  const toolsWithTime: RunningBashTool[] = scanned.map((t) => ({
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
    tools: toolsWithTime,
    hasOvertime,
  }
}
