# 全局模型选择持久化设计

## 问题描述

每次在VS Code扩展中创建新session时，模型选择被重置为默认模型（第一个可用模型），无法记住用户上次选择的模型。而直接使用opencode shell时能记住上次选择的模型。

## 需求

- 全局所有工作区共享同一个模型选择
- 使用VS Code的`globalState`进行持久化存储
- 新session创建时自动应用上次选择的模型
- 模型选择变化时自动更新持久化存储

## 当前实现分析

### 模型选择状态存储

当前模型选择状态存储在webview的`PersistedAppState`中，包含：
- `composerModelOverrides`: 每个agent的模型选择
- `composerRecentModels`: 最近使用的模型列表
- `composerModelVariants`: 模型变体选择

### 状态丢失原因

1. **Webview状态隔离**: 每个session的webview面板有独立的状态存储
2. **Session身份检查**: `createInitialState`中的`samePersistedSession`检查
   - 当新session创建时，`sessionId`不同，返回`false`
   - 导致`composerModelOverrides`和`composerRecentModels`被清空
3. **无跨session持久化**: 只有`composerFavoriteModels`被保留，但它不自动选择模型

### 模型选择优先级

```
composerSelection()优先级：
1. manualModel (用户手动选择)
2. agentModel (agent配置)
3. configuredModel (全局配置)
4. recentModel (最近使用)
5. fallbackModelRef (第一个可用模型)
```

## 设计方案

### 1. 创建ModelSelectionStore类

参考现有的`SessionTagStore`类，创建类似的模型选择存储类。

**文件**: `src/core/model-selection-store.ts`

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

  // 获取最后选择的模型
  getLastSelectedModel(): ComposerModelRef | undefined {
    const snapshot = this.snapshot()
    return snapshot.lastSelectedModel
  }

  // 获取最近使用的模型列表
  getRecentModels(): ComposerModelRef[] {
    const snapshot = this.snapshot()
    return snapshot.recentModels
  }

  // 获取收藏的模型列表
  getFavoriteModels(): ComposerModelRef[] {
    const snapshot = this.snapshot()
    return snapshot.favoriteModels
  }

  // 更新最后选择的模型
  async setLastSelectedModel(model: ComposerModelRef | undefined) {
    const snapshot = this.snapshot()
    snapshot.lastSelectedModel = model
    snapshot.lastUpdated = Date.now()
    await this.state.update(STORAGE_KEY, snapshot)
  }

  // 更新最近使用的模型列表
  async setRecentModels(models: ComposerModelRef[]) {
    const snapshot = this.snapshot()
    snapshot.recentModels = models
    snapshot.lastUpdated = Date.now()
    await this.state.update(STORAGE_KEY, snapshot)
  }

  // 更新收藏的模型列表
  async setFavoriteModels(models: ComposerModelRef[]) {
    const snapshot = this.snapshot()
    snapshot.favoriteModels = models
    snapshot.lastUpdated = Date.now()
    await this.state.update(STORAGE_KEY, snapshot)
  }

  // 批量更新所有模型选择
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

### 2. 集成到扩展激活流程

**文件**: `src/extension.ts`

```typescript
// 在activate函数中
const modelSelection = new ModelSelectionStore(ctx.globalState)

// 传递给需要的组件
commands(ctx, workspaceMgr, sessions, out, tabs, panels, capabilities, tags, tree, modelSelection)
```

### 3. 修改SessionPanelManager

在session创建和打开时，从ModelSelectionStore读取模型选择。

**文件**: `src/panel/provider/controller.ts`

```typescript
// 在SessionPanelManager构造函数中添加modelSelection参数
constructor(
  private extensionUri: vscode.Uri,
  private mgr: WorkspaceManager,
  private events: EventHub,
  private out: vscode.OutputChannel,
  private modelSelection?: ModelSelectionStore
) {
  // ...
}

// 在createPanel方法中
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

### 4. 修改Webview状态初始化

在`createInitialState`中添加从全局存储读取模型选择的逻辑。

**文件**: `src/panel/webview/app/state.ts`

```typescript
// 修改createInitialState函数签名
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
  // 注意：这里需要根据agent名称设置modelOverrides
  // 目前简化处理，将全局模型作为默认agent的选择
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

### 5. 监听模型选择变化

在webview中监听模型选择变化，并通知host更新全局存储。

**文件**: `src/panel/webview/app/App.tsx`

```typescript
// 监听模型选择变化
React.useEffect(() => {
  // 当模型选择变化时，通知host更新全局存储
  if (state.composerModelOverrides || state.composerRecentModels) {
    vscode.postMessage({
      type: "modelSelectionChanged",
      lastSelectedModel: Object.values(state.composerModelOverrides || {})[0],
      recentModels: state.composerRecentModels,
    })
  }
}, [state.composerModelOverrides, state.composerRecentModels])
```

### 6. 在Host侧处理消息

**文件**: `src/panel/provider/controller.ts`

```typescript
// 在消息处理中
if (message.type === "modelSelectionChanged") {
  await modelSelection.updateAll({
    lastSelectedModel: message.lastSelectedModel,
    recentModels: message.recentModels,
  })
}
```

## 数据流

```
1. 用户选择模型
   ↓
2. Webview更新local state (composerModelOverrides)
   ↓
3. Webview发送消息到Host (modelSelectionChanged)
   ↓
4. Host更新ModelSelectionStore (globalState)
   ↓
5. 新session创建
   ↓
6. Host从ModelSelectionStore读取模型选择
   ↓
7. 传递给新session的webview
   ↓
8. Webview在createInitialState中使用全局模型选择
```

## 边界情况处理

1. **首次使用**: 无全局存储时，使用默认fallback逻辑
2. **模型不可用**: 全局存储的模型在新provider中不存在时，回退到默认模型
3. **多个Agent**: 当前设计只存储最后一个选择的模型，适用于单agent场景
4. **并发session**: 多个session同时打开时，最后修改的模型选择会覆盖之前的

## 测试策略

1. **单元测试**: 测试ModelSelectionStore的get/set方法
2. **集成测试**: 测试session创建时模型选择的传递
3. **端到端测试**: 测试用户选择模型后新建session是否保持

## 实现优先级

1. **P0**: 创建ModelSelectionStore类
2. **P0**: 集成到扩展激活流程
3. **P1**: 修改session创建逻辑读取全局存储
4. **P1**: 修改webview状态初始化
5. **P2**: 监听模型选择变化并更新存储
6. **P2**: 处理边界情况