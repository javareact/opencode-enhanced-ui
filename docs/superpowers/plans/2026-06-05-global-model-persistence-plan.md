# 全局模型选择持久化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现全局模型选择持久化，使新session创建时能记住用户上次选择的模型

**Architecture:** 创建ModelSelectionStore类使用VS Code的globalState存储模型选择，在session创建和模型选择变化时同步状态

**Tech Stack:** TypeScript, React, VS Code Extension API

---

## 文件结构

### 新建文件
- `src/core/model-selection-store.ts` - 模型选择持久化存储类

### 修改文件
- `src/extension.ts:33` - 初始化ModelSelectionStore
- `src/extension.ts:95` - 传递modelSelection到commands函数
- `src/panel/provider/controller.ts:1-50` - 添加modelSelection参数
- `src/panel/provider/controller.ts:100-150` - 在createPanel中读取全局模型选择
- `src/panel/webview/app/state.ts:145-212` - 修改createInitialState函数签名
- `src/panel/webview/app/App.tsx:50-100` - 添加全局模型选择初始化逻辑
- `src/panel/webview/app/App.tsx:200-250` - 监听模型选择变化并通知host

---

## Task 1: 创建ModelSelectionStore类

**Files:**
- Create: `src/core/model-selection-store.ts`
- Test: `src/test/model-selection-store.test.ts`

- [ ] **Step 1: 创建ModelSelectionStore类的基本结构**

```typescript
import * as vscode from "vscode"
import type { ComposerModelRef } from "../panel/webview/app/state"

type ModelSelectionSnapshot = {
  lastSelectedModel?: ComposerModelRef
  recentModels: ComposerModelRef[]
  favoriteModels: ComposerModelRef[]
  lastUpdated: number
}

const STORAGE_KEY = "global-model-selection"

export class ModelSelectionStore {
  constructor(private state: vscode.Memento) {}

  getLastSelectedModel(): ComposerModelRef | undefined {
    const snapshot = this.snapshot()
    return snapshot.lastSelectedModel
  }

  getRecentModels(): ComposerModelRef[] {
    const snapshot = this.snapshot()
    return snapshot.recentModels
  }

  getFavoriteModels(): ComposerModelRef[] {
    const snapshot = this.snapshot()
    return snapshot.favoriteModels
  }

  async setLastSelectedModel(model: ComposerModelRef | undefined) {
    const snapshot = this.snapshot()
    snapshot.lastSelectedModel = model
    snapshot.lastUpdated = Date.now()
    await this.state.update(STORAGE_KEY, snapshot)
  }

  async setRecentModels(models: ComposerModelRef[]) {
    const snapshot = this.snapshot()
    snapshot.recentModels = models
    snapshot.lastUpdated = Date.now()
    await this.state.update(STORAGE_KEY, snapshot)
  }

  async setFavoriteModels(models: ComposerModelRef[]) {
    const snapshot = this.snapshot()
    snapshot.favoriteModels = models
    snapshot.lastUpdated = Date.now()
    await this.state.update(STORAGE_KEY, snapshot)
  }

  async updateAll(update: Partial<ModelSelectionSnapshot>) {
    const snapshot = this.snapshot()
    Object.assign(snapshot, update, { lastUpdated: Date.now() })
    await this.state.update(STORAGE_KEY, snapshot)
  }

  private snapshot(): ModelSelectionSnapshot {
    return {
      recentModels: [],
      favoriteModels: [],
      lastUpdated: 0,
      ...this.state.get<ModelSelectionSnapshot>(STORAGE_KEY),
    }
  }
}
```

- [ ] **Step 2: 创建ModelSelectionStore的单元测试**

```typescript
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

describe("ModelSelectionStore", () => {
  it("should return empty state by default", () => {
    const store = new ModelSelectionStore(memoryState() as any)
    
    expect(store.getLastSelectedModel()).toBeUndefined()
    expect(store.getRecentModels()).toEqual([])
    expect(store.getFavoriteModels()).toEqual([])
  })

  it("should store and retrieve last selected model", async () => {
    const store = new ModelSelectionStore(memoryState() as any)
    
    const model = { providerID: "openai", modelID: "gpt-4" }
    await store.setLastSelectedModel(model)
    
    expect(store.getLastSelectedModel()).toEqual(model)
  })

  it("should store and retrieve recent models", async () => {
    const store = new ModelSelectionStore(memoryState() as any)
    
    const models = [
      { providerID: "openai", modelID: "gpt-4" },
      { providerID: "anthropic", modelID: "claude-3" }
    ]
    await store.setRecentModels(models)
    
    expect(store.getRecentModels()).toEqual(models)
  })

  it("should store and retrieve favorite models", async () => {
    const store = new ModelSelectionStore(memoryState() as any)
    
    const models = [
      { providerID: "openai", modelID: "gpt-4" }
    ]
    await store.setFavoriteModels(models)
    
    expect(store.getFavoriteModels()).toEqual(models)
  })

  it("should update multiple fields at once", async () => {
    const store = new ModelSelectionStore(memoryState() as any)
    
    const model = { providerID: "openai", modelID: "gpt-4" }
    const recentModels = [model]
    
    await store.updateAll({ lastSelectedModel: model, recentModels })
    
    expect(store.getLastSelectedModel()).toEqual(model)
    expect(store.getRecentModels()).toEqual(recentModels)
  })
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `bun test src/test/model-selection-store.test.ts`
Expected: FAIL with "Module not found" or similar

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test src/test/model-selection-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/model-selection-store.ts src/test/model-selection-store.test.ts
git commit -m "feat: add ModelSelectionStore for global model persistence"
```

---

## Task 2: 集成ModelSelectionStore到扩展激活流程

**Files:**
- Modify: `src/extension.ts:33`
- Modify: `src/extension.ts:95`

- [ ] **Step 1: 在extension.ts中导入ModelSelectionStore**

```typescript
import { ModelSelectionStore } from "./core/model-selection-store"
```

- [ ] **Step 2: 在activate函数中初始化ModelSelectionStore**

```typescript
// 在第33行附近
const modelSelection = new ModelSelectionStore(ctx.globalState)
```

- [ ] **Step 3: 传递modelSelection到commands函数**

```typescript
// 修改第95行
commands(ctx, workspaceMgr, sessions, out, tabs, panels, capabilities, tags, tree, modelSelection)
```

- [ ] **Step 4: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/extension.ts
git commit -m "feat: integrate ModelSelectionStore into extension activation"
```

---

## Task 3: 修改commands函数签名

**Files:**
- Modify: `src/core/commands.ts:1-50`

- [ ] **Step 1: 在commands函数中添加modelSelection参数**

```typescript
// 找到commands函数签名，添加modelSelection参数
export function commands(
  ctx: vscode.ExtensionContext,
  mgr: WorkspaceManager,
  sessions: SessionStore,
  out: vscode.OutputChannel,
  tabs: TabManager,
  panels: SessionPanelManager,
  capabilities: CapabilityStore,
  tags: SessionTagStore,
  tree: SidebarProvider,
  modelSelection: ModelSelectionStore
) {
  // ... 现有逻辑 ...
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/core/commands.ts
git commit -m "feat: add modelSelection parameter to commands function"
```

---

## Task 4: 修改SessionPanelManager构造函数

**Files:**
- Modify: `src/panel/provider/controller.ts:1-50`

- [ ] **Step 1: 在SessionPanelManager构造函数中添加modelSelection参数**

```typescript
import { ModelSelectionStore } from "../../core/model-selection-store"

export class SessionPanelManager {
  constructor(
    private extensionUri: vscode.Uri,
    private mgr: WorkspaceManager,
    private events: EventHub,
    private out: vscode.OutputChannel,
    private modelSelection?: ModelSelectionStore
  ) {
    // ... 现有逻辑 ...
  }
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/panel/provider/controller.ts
git commit -m "feat: add modelSelection parameter to SessionPanelManager"
```

---

## Task 5: 修改SessionPanelManager初始化

**Files:**
- Modify: `src/extension.ts:30`

- [ ] **Step 1: 传递modelSelection到SessionPanelManager**

```typescript
// 修改第30行
const panels = new SessionPanelManager(ctx.extensionUri, workspaceMgr, events, out, modelSelection)
```

- [ ] **Step 2: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/extension.ts
git commit -m "feat: pass modelSelection to SessionPanelManager"
```

---

## Task 6: 在createPanel中读取全局模型选择

**Files:**
- Modify: `src/panel/provider/controller.ts:100-150`

- [ ] **Step 1: 在createPanel方法中添加全局模型选择读取逻辑**

```typescript
async createPanel(ref: SessionRef) {
  // ... 现有逻辑 ...
  
  // 从全局存储读取模型选择（如果可用）
  if (this.modelSelection) {
    const lastModel = this.modelSelection.getLastSelectedModel()
    const recentModels = this.modelSelection.getRecentModels()
    
    // 传递给webview作为初始状态
    panel.webview.postMessage({
      type: "init",
      lastModel,
      recentModels,
    })
  }
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/panel/provider/controller.ts
git commit -m "feat: read global model selection in createPanel"
```

---

## Task 7: 修改createInitialState函数签名

**Files:**
- Modify: `src/panel/webview/app/state.ts:145-212`

- [ ] **Step 1: 修改createInitialState函数签名**

```typescript
export function createInitialState(
  initialRef: SessionBootstrap["sessionRef"] | null, 
  persisted?: PersistedAppState, 
  initialDisplay?: DisplaySettings,
  globalModelSelection?: {
    lastSelectedModel?: ComposerModelRef
    recentModels?: ComposerModelRef[]
  }
): AppState {
  const sameSession = samePersistedSession(initialRef, persisted)
  
  // 优先使用会话内持久化，其次使用全局存储
  let modelOverrides: Record<string, ComposerModelRef> = {}
  if (sameSession) {
    modelOverrides = normalizeModelMap(persisted?.composerModelOverrides)
  } else if (globalModelSelection?.lastSelectedModel) {
    // 将全局模型设置为默认agent的选择
    // 默认agent名称在snapshot到达时由defaultAgentName函数确定
    // 这里使用"build"作为默认值，实际实现时应该从snapshot中获取
    modelOverrides = { "build": globalModelSelection.lastSelectedModel }
  }
  
  const recentModels = sameSession 
    ? normalizeModelList(persisted?.composerRecentModels) 
    : normalizeModelList(globalModelSelection?.recentModels)
  
  // ... 其余逻辑不变 ...
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/panel/webview/app/state.ts
git commit -m "feat: add globalModelSelection parameter to createInitialState"
```

---

## Task 8: 在App.tsx中处理全局模型选择

**Files:**
- Modify: `src/panel/webview/app/App.tsx:50-100`

- [ ] **Step 1: 在App组件中添加全局模型选择初始化逻辑**

```typescript
// 在组件顶部添加状态类型
type GlobalModelSelection = {
  lastSelectedModel?: ComposerModelRef
  recentModels?: ComposerModelRef[]
}

// 在App组件中添加状态
const [globalModelSelection, setGlobalModelSelection] = React.useState<GlobalModelSelection>({})

// 监听host消息
React.useEffect(() => {
  const handler = (event: MessageEvent) => {
    const message = event.data
    if (message.type === "init") {
      setGlobalModelSelection({
        lastSelectedModel: message.lastModel,
        recentModels: message.recentModels,
      })
    }
  }
  
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}, [])

// 在createInitialState调用中传递globalModelSelection
const initialState = createInitialState(
  bootstrap.sessionRef,
  persistedState,
  initialDisplay,
  globalModelSelection
)
```

- [ ] **Step 2: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/panel/webview/app/App.tsx
git commit -m "feat: handle global model selection in App component"
```

---

## Task 9: 监听模型选择变化并通知host

**Files:**
- Modify: `src/panel/webview/app/App.tsx:200-250`

- [ ] **Step 1: 添加模型选择变化监听器**

```typescript
// 监听模型选择变化
React.useEffect(() => {
  // 当模型选择变化时，通知host更新全局存储
  if (state.composerModelOverrides && Object.keys(state.composerModelOverrides).length > 0) {
    const lastSelectedModel = Object.values(state.composerModelOverrides)[0]
    vscode.postMessage({
      type: "modelSelectionChanged",
      lastSelectedModel,
      recentModels: state.composerRecentModels,
    })
  }
}, [state.composerModelOverrides, state.composerRecentModels])
```

- [ ] **Step 2: 在host侧处理消息**

```typescript
// 在SessionPanelManager的消息处理中
if (message.type === "modelSelectionChanged") {
  await this.modelSelection?.updateAll({
    lastSelectedModel: message.lastSelectedModel,
    recentModels: message.recentModels,
  })
}
```

- [ ] **Step 3: 验证类型检查通过**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/panel/webview/app/App.tsx src/panel/provider/controller.ts
git commit -m "feat: sync model selection changes to global storage"
```

---

## Task 10: 集成测试

**Files:**
- Test: `src/test/model-persistence-integration.test.ts`

- [ ] **Step 1: 创建集成测试**

```typescript
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
```

- [ ] **Step 2: 运行集成测试**

Run: `bun test src/test/model-persistence-integration.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/test/model-persistence-integration.test.ts
git commit -m "test: add model persistence integration tests"
```

---

## Task 11: 运行完整测试套件

**Files:**
- None

- [ ] **Step 1: 运行所有测试**

Run: `bun run test`
Expected: PASS

- [ ] **Step 2: 运行类型检查**

Run: `bun run check-types`
Expected: PASS

- [ ] **Step 3: 运行lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: complete global model persistence implementation"
```

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-06-05-global-model-persistence-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**