import React from "react"
import type { MessagePart, SessionInfo, SessionMessage } from "../../../core/sdk"

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
  const isMcp = isMcpTool(part.tool)
  const failed = part.state?.status === "error"
  return (
    <section className={`oc-toolRowWrap oc-toolRowWrap-${part.tool}${isMcp ? " oc-toolRowWrap-mcp" : ""}${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}>
      <div className={`oc-toolRow${isMcp ? " oc-toolRow-mcp" : ""}`}>
        <div className={`oc-toolRowMain${isMcp ? " oc-toolRowMain-mcp" : ""}${failed ? " is-error" : ""}`}>
          <span className="oc-kicker">{toolLabel(part.tool)}</span>
          <span className={`oc-toolRowTitle${isMcp ? " oc-toolRowTitle-mcp" : ""}`}>{renderToolRowTitle(part)}</span>
        </div>
        <div className={`oc-toolRowMeta${isMcp ? " oc-toolRowMeta-mcp" : ""}`}>
          <ToolStatus state={part.state?.status} />
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
        </div>
      </div>
      {extras.length > 0 ? (
        <div className="oc-toolRowExtras">
          {extras.map((item) => <div key={item} className="oc-toolRowExtra">↳ {renderToolRowExtra(part, item)}</div>)}
        </div>
      ) : null}
    </section>
  )
}

export function TaskToolRow({
  AgentBadge,
  ToolStatus,
  active = false,
  part,
  child,
  sessions,
  childSessionID,
  agentName,
  title,
  body,
  onNavigate,
}: {
  AgentBadge: ({ name }: { name: string }) => React.JSX.Element
  ToolStatus: ({ state }: { state?: string }) => React.JSX.Element | null
  active?: boolean
  part: Extract<MessagePart, { type: "tool" }>
  child: Record<string, SessionMessage[]>
  sessions: Record<string, SessionInfo>
  childSessionID: string
  agentName: string
  title: string
  body: string
  onNavigate: (sessionID: string) => void
}) {
  void child
  void sessions
  const clickable = !!childSessionID
  const failed = part.state?.status === "error"

  const content = (
    <>
      <div className="oc-taskRow">
        <div className="oc-taskLine oc-taskLinePrimary">
          <AgentBadge name={agentName} />
          <span className="oc-taskColon">:</span>
          <span className={`oc-taskSessionTitle${failed ? " is-error" : ""}`}>{title}</span>
          <ToolStatus state={part.state?.status} />
        </div>
        {body ? <div className={`oc-taskLine oc-taskLineSecondary${failed ? " is-error" : ""}`}><span className="oc-taskBranch">└</span><span className={`oc-taskBody${failed ? " is-error" : ""}`}>{body}</span></div> : null}
      </div>
    </>
  )

  if (clickable) {
    return (
      <button
        type="button"
        className={`oc-toolRowWrap oc-toolRowBtn oc-toolRowBtn-task${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}
        onClick={() => onNavigate(childSessionID)}
      >
        {content}
      </button>
    )
  }

  return <section className={`oc-toolRowWrap oc-toolRowWrap-task${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}>{content}</section>
}

export function ToolStatus({ state }: { state?: string }) {
  if (state !== "running" && state !== "pending") {
    return null
  }
  return (
    <span className="oc-toolSpinner" aria-label={state}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" className="oc-toolSpinnerTrack" />
        <path d="M 8 2 A 6 6 0 0 1 14 8" className="oc-toolSpinnerHead" />
      </svg>
    </span>
  )
}
