import React from "react"

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
  const [expanded, setExpanded] = React.useState(false)

  return (
    <section className={["oc-shellBlock", expanded ? "is-expanded" : "is-collapsed", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="oc-shellBlockHeader"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse shell output" : "Expand shell output"}
      >
        <div className="oc-shellBlockHeaderMain">
          <span className="oc-shellBlockAction">{action}</span>
          <span className="oc-shellBlockTitle">{title}</span>
        </div>
        <div className="oc-shellBlockHeaderMeta">
          {running ? <span className="oc-shellBlockSpinner"><ToolStatus state="running" /></span> : null}
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
          <svg className="oc-shellBlockToggleIcon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </button>
      <div className="oc-shellBlockBody" aria-hidden={!expanded}>
        <div className="oc-shellBlockBodyClip">
          <pre className="oc-shellBlockContent">{body || " "}</pre>
        </div>
      </div>
    </section>
  )
}
