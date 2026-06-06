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
