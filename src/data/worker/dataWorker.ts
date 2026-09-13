/// <reference lib="webworker" />
/**
 * The data worker. Keeps the ~2 MB catalogue parse off the main thread so the
 * UI stays responsive during an install (spec §4.2, §7).
 *
 * It does not touch IndexedDB: it returns plain data and the main thread
 * persists it, which keeps Dexie in one place and the worker easy to test.
 */

import { installCatalogue, listAvailableCatalogues, type Progress } from '../install'
import type { CatalogueSummary } from '../model'
import type { InstallResult } from '../install'

export type WorkerRequest =
  | { id: number; type: 'list' }
  | { id: number; type: 'install'; summary: CatalogueSummary }

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: Progress }
  | { id: number; type: 'list-result'; catalogues: CatalogueSummary[] }
  | { id: number; type: 'install-result'; result: InstallResult }
  | { id: number; type: 'error'; message: string }

const post = (message: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(message)

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  void (async () => {
    try {
      if (request.type === 'list') {
        post({ id: request.id, type: 'list-result', catalogues: await listAvailableCatalogues() })
        return
      }
      const result = await installCatalogue(request.summary, (progress) =>
        post({ id: request.id, type: 'progress', progress }),
      )
      post({ id: request.id, type: 'install-result', result })
    } catch (error) {
      post({
        id: request.id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})
