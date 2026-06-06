import { describe, it, expect, vi } from "vitest"
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
  it("should persist model selection across sessions", async () => {
    const state = memoryState()
    const store1 = new ModelSelectionStore(state as any)
    const store2 = new ModelSelectionStore(state as any)

    // 第一个session选择模型
    const model = { providerID: "openai", modelID: "gpt-4" }
    await store1.setLastSelectedModel(model)
    await store1.setRecentModels([model])

    // 第二个session应该能读取到相同的模型选择
    expect(store2.getLastSelectedModel()).toEqual(model)
    expect(store2.getRecentModels()).toEqual([model])
  })

  it("should handle concurrent updates correctly", async () => {
    const state = memoryState()
    const store = new ModelSelectionStore(state as any)

    // 并发更新
    await Promise.all([
      store.setLastSelectedModel({ providerID: "openai", modelID: "gpt-4" }),
      store.setRecentModels([{ providerID: "anthropic", modelID: "claude-3" }]),
    ])

    // 应该都能读取到
    expect(store.getLastSelectedModel()).toEqual({ providerID: "openai", modelID: "gpt-4" })
    expect(store.getRecentModels()).toEqual([{ providerID: "anthropic", modelID: "claude-3" }])
  })
})
