import { describe, expect, it } from 'vitest'
import { emptyContents } from '@/data/backup'
import { parseSyncFile, readSyncText, syncFileText } from './gist'

describe('the sync file in the gist', () => {
  it('round-trips the contents and the deletions', () => {
    const doc = {
      contents: { ...emptyContents(), settings: [{ key: 'theme', value: 'dark' }] },
      tombstones: [{ collection: 'rosters' as const, id: 'r1', deletedAt: 3 }],
    }
    expect(parseSyncFile(syncFileText(doc, 9))).toEqual(doc)
  })

  // The gist is created holding `{}` (GitHub refuses an empty file).
  it('reads a gist that was only just made as holding nothing yet', () => {
    expect(readSyncText('{}')).toBeUndefined()
    expect(readSyncText('  ')).toBeUndefined()
  })

  it('refuses a file that is not this app’s', () => {
    expect(() => parseSyncFile('{"app":"other"}')).toThrow(/something other/)
    expect(() => parseSyncFile('not json')).toThrow(/not readable/)
  })
})
