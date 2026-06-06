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

describe("ModelSelectionStore", () => {
  test("returns empty state by default", () => {
    const store = new ModelSelectionStore(memoryState() as any)

    assert.equal(store.getLastSelectedModel(), undefined)
    assert.deepEqual(store.getRecentModels(), [])
    assert.deepEqual(store.getFavoriteModels(), [])
  })

  test("stores and retrieves last selected model", async () => {
    const store = new ModelSelectionStore(memoryState() as any)

    const model = { providerID: "openai", modelID: "gpt-4" }
    await store.setLastSelectedModel(model)

    assert.deepEqual(store.getLastSelectedModel(), model)
  })

  test("stores and retrieves recent models", async () => {
    const store = new ModelSelectionStore(memoryState() as any)

    const models = [
      { providerID: "openai", modelID: "gpt-4" },
      { providerID: "anthropic", modelID: "claude-3" },
    ]
    await store.setRecentModels(models)

    assert.deepEqual(store.getRecentModels(), models)
  })

  test("stores and retrieves favorite models", async () => {
    const store = new ModelSelectionStore(memoryState() as any)

    const models = [{ providerID: "openai", modelID: "gpt-4" }]
    await store.setFavoriteModels(models)

    assert.deepEqual(store.getFavoriteModels(), models)
  })

  test("updates multiple fields at once via updateAll", async () => {
    const store = new ModelSelectionStore(memoryState() as any)

    const model = { providerID: "openai", modelID: "gpt-4" }
    const recentModels = [model]

    await store.updateAll({ lastSelectedModel: model, recentModels })

    assert.deepEqual(store.getLastSelectedModel(), model)
    assert.deepEqual(store.getRecentModels(), recentModels)
  })

  test("clears last selected model when set to undefined", async () => {
    const store = new ModelSelectionStore(memoryState() as any)

    await store.setLastSelectedModel({ providerID: "openai", modelID: "gpt-4" })
    await store.setLastSelectedModel(undefined)

    assert.equal(store.getLastSelectedModel(), undefined)
  })
})
