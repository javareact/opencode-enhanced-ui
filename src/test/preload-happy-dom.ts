// happy-dom is an ESM package; use require to avoid module resolution issues in CJS context.
const { Window } = require("happy-dom") as { Window: new () => unknown }

const window = new Window() as Record<string, unknown>

globalThis.window = window as unknown as typeof globalThis.window
globalThis.document = (window as { document: unknown }).document as unknown as Document

for (const key of Object.keys(window)) {
  if (key === "window" || key === "document") {
    continue
  }
  if (!(key in globalThis)) {
    const value = window[key]
    if (typeof value !== "undefined") {
      ;(globalThis as Record<string, unknown>)[key] = value
    }
  }
}
