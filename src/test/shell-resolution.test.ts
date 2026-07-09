import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, test } from "node:test"
import * as vscode from "vscode"
import { getShellPath, affectsShellPathSetting, SHELL_PATH_KEY } from "../core/settings"
import { resolveShell } from "../core/server"

const originalGetConfiguration = vscode.workspace.getConfiguration

afterEach(() => {
  ;(vscode.workspace as typeof vscode.workspace & {
    getConfiguration: typeof vscode.workspace.getConfiguration
  }).getConfiguration = originalGetConfiguration
})

function stubConfig(map: Record<string, unknown>) {
  ;(vscode.workspace as typeof vscode.workspace & {
    getConfiguration: typeof vscode.workspace.getConfiguration
  }).getConfiguration = ((section?: string) => ({
    get: <T,>(key: string, fallback: T) => {
      if (section === "opencode-ui" && key in map) {
        return map[key] as T
      }
      return fallback
    },
  })) as typeof vscode.workspace.getConfiguration
}

describe("shell path setting", () => {
  test("returns empty string when nothing is configured", () => {
    stubConfig({})
    assert.equal(getShellPath(), "")
  })

  test("returns the configured shell path", () => {
    stubConfig({ shellPath: "C:/Program Files/Git/bin/bash.exe" })
    assert.equal(getShellPath(), "C:/Program Files/Git/bin/bash.exe")
  })

  test("trims surrounding whitespace from the configured path", () => {
    stubConfig({ shellPath: "  /usr/bin/bash  " })
    assert.equal(getShellPath(), "/usr/bin/bash")
  })
})

describe("resolveShell", () => {
  test("returns the configured shell path when provided", () => {
    const result = resolveShell("linux", {}, "C:/custom/bash.exe", undefined)
    assert.equal(result, "C:/custom/bash.exe")
  })

  test("returns undefined when SHELL is already set in env and no setting configured", () => {
    const result = resolveShell("linux", { SHELL: "/bin/zsh" }, "", undefined)
    assert.equal(result, undefined)
  })

  test("returns the configured path even when SHELL is already set in env", () => {
    const result = resolveShell("linux", { SHELL: "/bin/zsh" }, "/usr/bin/bash", undefined)
    assert.equal(result, "/usr/bin/bash")
  })

  test("on Windows, returns Git Bash path when found and no setting configured", () => {
    const result = resolveShell("win32", {}, "", "C:\\Program Files\\Git\\bin\\bash.exe")
    assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe")
  })

  test("on Windows, returns undefined when Git Bash not found and no setting configured", () => {
    const result = resolveShell("win32", {}, "", undefined)
    assert.equal(result, undefined)
  })

  test("on Windows, prefers configured shell path over Git Bash auto-detection", () => {
    const result = resolveShell("win32", {}, "C:/custom/bash.exe", "C:\\Program Files\\Git\\bin\\bash.exe")
    assert.equal(result, "C:/custom/bash.exe")
  })

  test("on Windows, does not override when SHELL is already set and no setting configured", () => {
    const result = resolveShell("win32", { SHELL: "C:/existing/bash.exe" }, "", "C:\\Program Files\\Git\\bin\\bash.exe")
    assert.equal(result, undefined)
  })

  test("on non-Windows, returns undefined when no setting, SHELL not set, and no Git Bash", () => {
    const result = resolveShell("linux", {}, "", undefined)
    assert.equal(result, undefined)
  })

  test("on non-Windows, does not use Git Bash path even if provided", () => {
    const result = resolveShell("linux", {}, "", "/usr/bin/bash")
    assert.equal(result, undefined)
  })

  test("treats whitespace-only configured path as empty", () => {
    const result = resolveShell("win32", {}, "   ", "C:\\Program Files\\Git\\bin\\bash.exe")
    assert.equal(result, "C:\\Program Files\\Git\\bin\\bash.exe")
  })
})

describe("affectsShellPathSetting", () => {
  test("returns true when shellPath setting changes", () => {
    const event = {
      affectsConfiguration(key: string) {
        return key === "opencode-ui.shellPath"
      },
    } as vscode.ConfigurationChangeEvent
    assert.equal(affectsShellPathSetting(event), true)
  })

  test("returns false when an unrelated setting changes", () => {
    const event = {
      affectsConfiguration(key: string) {
        return key === "opencode-ui.panelTheme"
      },
    } as vscode.ConfigurationChangeEvent
    assert.equal(affectsShellPathSetting(event), false)
  })
})

describe("shellPath configuration declaration", () => {
  test("declares opencode-ui.shellPath in the extension configuration", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      contributes?: {
        configuration?: {
          properties?: Record<string, {
            type?: string
            default?: string
            scope?: string
          }>
        }
      }
    }

    const prop = pkg.contributes?.configuration?.properties?.["opencode-ui.shellPath"]
    assert.ok(prop, "opencode-ui.shellPath should be declared in package.json")
    assert.equal(prop?.type, "string")
    assert.equal(prop?.default, "")
    assert.equal(prop?.scope, "machine-overridable")
  })

  test("exports SHELL_PATH_KEY as opencode-ui.shellPath key name", () => {
    assert.equal(SHELL_PATH_KEY, "shellPath")
  })
})

describe("spawn sets SHELL env var", () => {
  test("server.ts spawn references resolveShell to set the SHELL env var", () => {
    const source = readFileSync(resolve(process.cwd(), "src/core/server.ts"), "utf8")
    assert.ok(source.includes("resolveShell"), "server.ts should call resolveShell in spawn")
    assert.ok(source.includes("env.SHELL"), "server.ts should set env.SHELL when a shell is resolved")
  })
})
