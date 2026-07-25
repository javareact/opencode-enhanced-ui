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
