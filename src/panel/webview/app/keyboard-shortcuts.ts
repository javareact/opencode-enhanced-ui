import type { AgentInfo } from "../../../core/sdk"

export type LeaderAction = "childFirst" | "newSession" | "redoSession" | "undoSession"
export type ComposerMode = "normal" | "shell"

type ComposerTabIntentOptions = {
  mode: ComposerMode
  hasAutocomplete: boolean
  hasCurrentItem: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  canCycleAgent: boolean
}

type ComposerShellToggleOptions = {
  mode: ComposerMode
  draft: string
  key: string
  start: number
  end: number
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

type ComposerEnterIntentOptions = {
  mode: ComposerMode
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  hasAutocomplete: boolean
  isImeComposing: boolean
}

export function cycleAgentName(agents: AgentInfo[], current?: string) {
  const visible = agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  if (visible.length === 0) {
    return undefined
  }

  const index = visible.findIndex((agent) => agent.name === current)
  if (index < 0) {
    return visible[0]?.name
  }

  return visible[(index + 1) % visible.length]?.name
}

export function leaderAction(key: string): LeaderAction | undefined {
  switch (normalizeKey(key)) {
    case "down":
      return "childFirst"
    case "n":
      return "newSession"
    case "r":
      return "redoSession"
    case "u":
      return "undoSession"
    default:
      return undefined
  }
}

export function composerTabIntent(options: ComposerTabIntentOptions) {
  if (options.mode === "shell") {
    return "ignore" as const
  }

  if (options.hasAutocomplete && options.hasCurrentItem) {
    return "autocomplete" as const
  }

  if (!options.metaKey && !options.ctrlKey && !options.altKey && options.canCycleAgent) {
    return "cycleAgent" as const
  }

  return undefined
}

export function shouldEnterShellMode(options: ComposerShellToggleOptions) {
  // Note: contentEditable can look visually empty while still containing a trailing <br>.
  // Our DOM parser turns that into a single "\n" in the draft. Treat whitespace-only drafts
  // as empty so shell-mode toggles match what the user sees.
  const empty = options.draft.trim().length === 0
  const atStart = options.start === 0 && options.end === 0
  const atEnd = options.start === options.draft.length && options.end === options.draft.length
  return options.mode === "normal"
    && options.key === "!"
    && !options.metaKey
    && !options.ctrlKey
    && !options.altKey
    && empty
    && (atStart || atEnd)
}

export function shouldExitShellModeOnBackspace(options: ComposerShellToggleOptions) {
  // Same contentEditable empty-state caveat as shouldEnterShellMode().
  const empty = options.draft.trim().length === 0
  const atStart = options.start === 0 && options.end === 0
  const atEnd = options.start === options.draft.length && options.end === options.draft.length
  return options.mode === "shell"
    && options.key === "Backspace"
    && !options.metaKey
    && !options.ctrlKey
    && !options.altKey
    && empty
    && (atStart || atEnd)
}

export function composerEnterIntent(options: ComposerEnterIntentOptions) {
  if (options.key !== "Enter") {
    return undefined
  }

  if (options.isImeComposing) {
    return "ignore" as const
  }

  if (options.hasAutocomplete) {
    return "acceptAutocomplete" as const
  }

  if (options.ctrlKey || options.metaKey) {
    return "newline" as const
  }

  return "submit" as const
}

export function isShortcutTarget(target: EventTarget | null, composer: HTMLElement | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (composer && (target === composer || composer.contains(target))) {
    return true
  }
  if (target.isContentEditable) {
    return false
  }

  const tag = target.tagName
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && tag !== "BUTTON" && tag !== "A"
}

function normalizeKey(key: string) {
  const value = key.trim().toLowerCase()
  if (value === "arrowdown") {
    return "down"
  }
  if (value === "arrowup") {
    return "up"
  }
  if (value === "arrowleft") {
    return "left"
  }
  if (value === "arrowright") {
    return "right"
  }
  return value
}
