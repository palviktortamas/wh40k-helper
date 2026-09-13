import { useMemo } from 'react'
import { instantiate } from '@/roster/defaults'
import { replaceSelection, type Validation } from '@/roster/store'
import type { CatalogueGraph, ResolvedEntry, ResolvedGroup } from '@/roster/resolve'
import type { Selection } from '@/roster/types'
import { describeLoadout } from './RosterEditor'
import './Rosters.css'

/**
 * The per-model loadout editor (spec §5.2). A unit is shown as its option
 * groups; within each, every selectable entry gets a stepper. That is what makes
 * "17 with slugga and choppa, 2 with a rokkit launcha, 1 Boss Nob" expressible
 * rather than a single fixed loadout for the whole unit — the main complaint the
 * spec has about other apps.
 *
 * Limits are not enforced by disabling controls: the constraint evaluator is the
 * authority, and it says *why* something is illegal. Steppers stay live and the
 * error list explains, which keeps the editor honest when the data disagrees
 * with our assumptions.
 */
export function UnitEditor({
  selection,
  graph,
  validation,
  onBack,
  onChange,
}: {
  selection: Selection
  graph: CatalogueGraph
  validation: Validation
  onBack: () => void
  onChange: (next: Selection) => void
}) {
  const entry = graph.resolve(selection.entryId)

  const issues = useMemo(
    () => validation.issues.filter((i) => i.selectionId && contains(selection, i.selectionId)),
    [validation, selection],
  )

  if (!entry) {
    return (
      <section className="rosters">
        <button className="sheet__back tap" onClick={onBack}>
          ‹ Back
        </button>
        <p>This unit is not in the installed data.</p>
      </section>
    )
  }

  return (
    <section className="rosters">
      <button className="sheet__back tap" onClick={onBack}>
        ‹ Back
      </button>
      <h2>{selection.name}</h2>
      <p className="muted">{describeLoadout(selection)}</p>

      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue, index) => (
            <li key={index} className={`issues__item issues__item--${issue.severity}`}>
              <span className="issues__mark">{issue.severity === 'error' ? '✕' : '⚠'}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      <OptionTree
        parent={selection}
        entry={entry}
        onChange={onChange}
        root={selection}
        rootOnChange={onChange}
      />
    </section>
  )
}

const contains = (node: Selection, id: string): boolean =>
  node.id === id || node.selections.some((child) => contains(child, id))

function OptionTree({
  parent,
  entry,
  root,
  rootOnChange,
}: {
  parent: Selection
  entry: ResolvedEntry
  onChange: (next: Selection) => void
  root: Selection
  rootOnChange: (next: Selection) => void
}) {
  return (
    <>
      {entry.groups
        .filter((group) => !group.hidden)
        .map((group) => (
          <GroupEditor
            key={group.id}
            group={group}
            parent={parent}
            root={root}
            rootOnChange={rootOnChange}
          />
        ))}
      {entry.entries.filter((child) => !child.hidden && child.type === 'model').length > 0 && (
        <ModelRows entry={entry} parent={parent} root={root} rootOnChange={rootOnChange} />
      )}
    </>
  )
}

function GroupEditor({
  group,
  parent,
  root,
  rootOnChange,
}: {
  group: ResolvedGroup
  parent: Selection
  root: Selection
  rootOnChange: (next: Selection) => void
}) {
  const candidates = group.entries.filter((e) => !e.hidden)
  const max = group.constraints.find((c) => c.type === 'max' && c.scope === 'parent')
  const min = group.constraints.find((c) => c.type === 'min' && c.scope === 'parent')

  const taken = candidates.reduce(
    (sum, candidate) => sum + countOf(parent, candidate.id),
    0,
  )

  if (candidates.length === 0 && group.groups.length === 0) return null

  return (
    <div className="group">
      <div className="group__head">
        <h3>{group.name}</h3>
        <span className="muted">
          {taken}
          {max && max.value >= 0 ? ` / ${max.value}` : ''}
          {min && min.value > 0 ? ` (min ${min.value})` : ''}
        </span>
      </div>

      {candidates.map((candidate) => (
        <OptionRow
          key={candidate.id}
          entry={candidate}
          groupId={group.id}
          parent={parent}
          root={root}
          rootOnChange={rootOnChange}
        />
      ))}

      {group.groups
        .filter((nested) => !nested.hidden)
        .map((nested) => (
          <GroupEditor
            key={nested.id}
            group={nested}
            parent={parent}
            root={root}
            rootOnChange={rootOnChange}
          />
        ))}
    </div>
  )
}

function ModelRows({
  entry,
  parent,
  root,
  rootOnChange,
}: {
  entry: ResolvedEntry
  parent: Selection
  root: Selection
  rootOnChange: (next: Selection) => void
}) {
  return (
    <div className="group">
      <div className="group__head">
        <h3>Models</h3>
      </div>
      {entry.entries
        .filter((child) => !child.hidden && child.type === 'model')
        .map((child) => (
          <OptionRow
            key={child.id}
            entry={child}
            parent={parent}
            root={root}
            rootOnChange={rootOnChange}
          />
        ))}
    </div>
  )
}

const countOf = (parent: Selection, entryId: string): number =>
  parent.selections.filter((s) => s.entryId === entryId).reduce((sum, s) => sum + s.count, 0)

function OptionRow({
  entry,
  groupId,
  parent,
  root,
  rootOnChange,
}: {
  entry: ResolvedEntry
  groupId?: string
  parent: Selection
  root: Selection
  rootOnChange: (next: Selection) => void
}) {
  const existing = parent.selections.find((s) => s.entryId === entry.id)
  const count = existing?.count ?? 0
  const points = entry.costs['51b2-306e-1021-d207']

  const setCount = (next: number) => {
    const value = Math.max(0, next)
    let updated: Selection

    if (value === 0) {
      updated = {
        ...parent,
        selections: parent.selections.filter((s) => s.entryId !== entry.id),
      }
    } else if (existing) {
      updated = {
        ...parent,
        selections: parent.selections.map((s) =>
          s.entryId === entry.id ? { ...s, count: value } : s,
        ),
      }
    } else {
      // A new pick brings its own required sub-choices with it.
      const child = instantiate(entry, value)
      if (groupId) child.groupId = groupId
      updated = { ...parent, selections: [...parent.selections, child] }
    }

    rootOnChange(
      parent.id === root.id
        ? updated
        : { ...root, selections: replaceSelection(root.selections, parent.id, updated) },
    )
  }

  return (
    <div className="option">
      <div className="option__label">
        <span>{entry.name}</span>
        {points ? <span className="muted"> {points} pts</span> : null}
      </div>
      <div className="stepper">
        <button aria-label={`One fewer ${entry.name}`} onClick={() => setCount(count - 1)}>
          −
        </button>
        <span className="stepper__value" aria-live="polite">
          {count}
        </span>
        <button aria-label={`One more ${entry.name}`} onClick={() => setCount(count + 1)}>
          +
        </button>
      </div>
      {existing && existing.selections.length > 0 && (
        <details className="option__sub">
          <summary>Loadout</summary>
          <NestedOptions
            selection={existing}
            entry={entry}
            root={root}
            rootOnChange={rootOnChange}
          />
        </details>
      )}
    </div>
  )
}

function NestedOptions({
  selection,
  entry,
  root,
  rootOnChange,
}: {
  selection: Selection
  entry: ResolvedEntry
  root: Selection
  rootOnChange: (next: Selection) => void
}) {
  return (
    <>
      {entry.groups
        .filter((group) => !group.hidden)
        .map((group) => (
          <GroupEditor
            key={group.id}
            group={group}
            parent={selection}
            root={root}
            rootOnChange={rootOnChange}
          />
        ))}
      {entry.entries
        .filter((child) => !child.hidden)
        .map((child) => (
          <OptionRow
            key={child.id}
            entry={child}
            parent={selection}
            root={root}
            rootOnChange={rootOnChange}
          />
        ))}
    </>
  )
}
