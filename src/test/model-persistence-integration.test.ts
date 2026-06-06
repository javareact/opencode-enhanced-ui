import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { ModelSelectionStore } from "../core/model-selection-store"

function memoryState() {
  const state = new Map<string, unknown>()

  return {
    get<T>(key: string, fallback?: T) {
      return (state.has(key) ? state.get(key) : fallback) as T
    },
    async update(key: string, value: unknown) {
      state.set(key, value)
    },
  }
}

describe("Model Persistence Integration", () => {
  test("should persist model selection across sessions", async () => {
    const state = memoryState()
    const store1 = new ModelSelectionStore(state as any)
    const store2 = new ModelSelectionStore(state as any)

    const model = { providerID: "openai", modelID: "gpt-4" }
    await store1.setLastSelectedModel(model)
    await store1.setRecentModels([model])

    assert.deepEqual(store2.getLastSelectedModel(), model)
    assert.deepEqual(store2.getRecentModels(), [model])
  })

  test("should handle concurrent updates correctly", async () => {
    const state = memoryState()
    const store = new ModelSelectionStore(state as any)

    await Promise.all([
      store.setLastSelectedModel({ providerID: "openai", modelID: "gpt-4" }),
      store.setRecentModels([{ providerID: "anthropic", modelID: "claude-3" }]),
    ])

    assert.deepEqual(store.getLastSelectedModel(), { providerID: "openai", modelID: "gpt-4" })
    assert.deepEqual(store.getRecentModels(), [{ providerID: "anthropic", modelID: "claude-3" }])
  })
})
