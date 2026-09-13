/**
 * Typed client for the data worker, plus the persistence the worker
 * deliberately does not do.
 */

import { db, type CatalogueRecord, type HealthRecord } from '../db'
import type { CatalogueSummary } from '../model'
import type { InstallResult, Progress } from '../install'
import { PARSER_VERSION } from '../bsdata/parse'
import type { WorkerRequest, WorkerResponse } from './dataWorker'

/** Omit over a union must distribute, or the union collapses to its shared keys. */
type RequestBody = WorkerRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

let worker: Worker | undefined
let nextId = 1

function getWorker(): Worker {
  worker ??= new Worker(new URL('./dataWorker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** Sends one request and resolves with its result, forwarding progress on the way. */
function request<T>(
  message: RequestBody,
  onProgress?: (progress: Progress) => void,
  pick?: (response: WorkerResponse) => T | undefined,
): Promise<T> {
  const id = nextId++
  const active = getWorker()

  return new Promise<T>((resolve, reject) => {
    const handle = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      if (response.id !== id) return
      if (response.type === 'progress') {
        onProgress?.(response.progress)
        return
      }
      active.removeEventListener('message', handle)
      if (response.type === 'error') {
        reject(new Error(response.message))
        return
      }
      const value = pick?.(response)
      if (value === undefined) reject(new Error(`Unexpected worker reply: ${response.type}`))
      else resolve(value)
    }
    active.addEventListener('message', handle)
    active.postMessage({ ...message, id } as WorkerRequest)
  })
}

export function listCatalogues(): Promise<CatalogueSummary[]> {
  return request<CatalogueSummary[]>({ type: 'list' }, undefined, (r) =>
    r.type === 'list-result' ? r.catalogues : undefined,
  )
}

/** Downloads and parses a faction in the worker, then persists it here. */
export async function installCatalogue(
  summary: CatalogueSummary,
  onProgress?: (progress: Progress) => void,
): Promise<CatalogueRecord> {
  const { record, health } = await request<InstallResult>(
    { type: 'install', summary },
    onProgress,
    (r) => (r.type === 'install-result' ? r.result : undefined),
  )
  await db.transaction('rw', db.catalogues, db.health, async () => {
    await db.catalogues.put(record)
    await db.health.put(health)
  })
  return record
}

/**
 * Re-parses every installed catalogue whose parsed model predates the current
 * parser, from the raw text it kept — no network. Called once at app start;
 * returns how many were refreshed. Failures leave the old record in place.
 */
export async function reparseStaleCatalogues(): Promise<number> {
  const stale = (await db.catalogues.toArray()).filter((r) => r.parserVersion !== PARSER_VERSION)
  let refreshed = 0
  for (const record of stale) {
    try {
      const { record: next, health } = await request<InstallResult>(
        { type: 'reparse', record },
        undefined,
        (r) => (r.type === 'install-result' ? r.result : undefined),
      )
      await db.transaction('rw', db.catalogues, db.health, async () => {
        await db.catalogues.put(next)
        await db.health.put(health)
      })
      refreshed++
    } catch (error) {
      console.warn(`Could not re-parse ${record.name}:`, error)
    }
  }
  return refreshed
}

export function getInstalledCatalogues(): Promise<CatalogueRecord[]> {
  return db.catalogues.orderBy('name').toArray()
}

export function getCatalogue(id: string): Promise<CatalogueRecord | undefined> {
  return db.catalogues.get(id)
}

export function getHealth(catalogueId: string): Promise<HealthRecord | undefined> {
  return db.health.get(catalogueId)
}

export async function removeCatalogue(id: string): Promise<void> {
  await db.transaction('rw', db.catalogues, db.health, async () => {
    await db.catalogues.delete(id)
    await db.health.delete(id)
  })
}
