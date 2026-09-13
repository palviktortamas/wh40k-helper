import { useMemo } from 'react'
import { bareSelection, instantiate, isSameOption } from '@/roster/defaults'
import { replaceSelection, type Validation } from '@/roster/store'
import type { CatalogueGraph, ResolvedEntry, ResolvedGroup } from '@/roster/resolve'
import type { Selection } from '@/roster/types'
import { COST_TYPE } from '@/data/bsdata/schema'
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
 * with our assumptions. What *is* filtered is availability: the data's own
 * "you may only take X if Y" gates decide which options are offered at all.
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
      <p className="muted">
        {describeLoadout(selection)} · {validation.unitPoints[selection.id] ?? 0} pts
      </p>

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
        root={selection}
        rootOnChange={onChange}
        validation={validation}
      />
    </section>
  )
}

const contains = (node: Selection, id: string): boolean =>
  node.id === id || node.selections.some((child) => contains(child, id))

type TreeProps = {
  parent: Selection
  root: Selection
  rootOnChange: (next: Selection) => void
  validation: Validation
}

/** The option groups and direct entries of one selection, availability-gated. */
export function OptionTree({
  parent,
  entry,
  root,
  rootOnChange,
  validation,
}: TreeProps & { entry: ResolvedEntry }) {
  const direct = entry.entries.filter((child) => offered(validation, parent, child, undefined))
  return (
    <>
      {entry.groups
        .filter((group) => groupOffered(validation, parent, group))
        .map((group) => (
          <GroupEditor
            key={group.linkId ?? group.id}
            group={group}
            parent={parent}
            root={root}
            rootOnChange={rootOnChange}
            validation={validation}
          />
        ))}
      {direct.length > 0 && (
        <div className="group">
          <div className="group__head">
            <h3>{direct.some((c) => c.type === 'model') ? 'Models' : 'Options'}</h3>
          </div>
          {direct.map((child) => (
            <OptionRow
              key={child.linkId ?? child.id}
              entry={child}
              parent={parent}
              root={root}
              rootOnChange={rootOnChange}
              validation={validation}
            />
          ))}
        </div>
      )}
    </>
  )
}

/** An option is shown when the data offers it here — or it is already taken, so it can be removed. */
const offered = (
  validation: Validation,
  parent: Selection,
  entry: ResolvedEntry,
  group: ResolvedGroup | undefined,
): boolean =>
  parent.selections.some((s) => isSameOption(s, entry, group?.id)) ||
  validation.isEntryAvailable(parent.id, entry, group)

const groupOffered = (validation: Validation, parent: Selection, group: ResolvedGroup): boolean =>
  parent.selections.some((s) => s.groupId === group.id) || validation.isGroupAvailable(parent.id, group)

function GroupEditor({
  group,
  parent,
  root,
  rootOnChange,
  validation,
}: TreeProps & { group: ResolvedGroup }) {
  const candidates = group.entries.filter((e) => offered(validation, parent, e, group))
  const nested = group.groups.filter((g) => groupOffered(validation, parent, g))
  const max = group.constraints.find((c) => c.type === 'max' && c.scope === 'parent')
  const min = group.constraints.find((c) => c.type === 'min' && c.scope === 'parent')

  const taken = candidates.reduce((sum, candidate) => sum + countOf(parent, candidate, group.id), 0)

  if (candidates.length === 0 && nested.length === 0) return null

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
          key={candidate.linkId ?? candidate.id}
          entry={candidate}
          groupId={group.id}
          parent={parent}
          root={root}
          rootOnChange={rootOnChange}
          validation={validation}
        />
      ))}

      {nested.map((child) => (
        <GroupEditor
          key={child.linkId ?? child.id}
          group={child}
          parent={parent}
          root={root}
          rootOnChange={rootOnChange}
          validation={validation}
        />
      ))}
    </div>
  )
}

const countOf = (parent: Selection, entry: ResolvedEntry, groupId: string | undefined): number =>
  parent.selections
    .filter((s) => isSameOption(s, entry, groupId))
    .reduce((sum, s) => sum + s.count, 0)

function OptionRow({
  entry,
  groupId,
  parent,
  root,
  rootOnChange,
  validation,
}: TreeProps & { entry: ResolvedEntry; groupId?: string }) {
  const existing = parent.selections.find((s) => isSameOption(s, entry, groupId))
  const count = existing?.count ?? 0
  const points = entry.costs[COST_TYPE.points]

  const setCount = (next: number) => {
    const value = Math.max(0, next)
    let updated: Selection

    if (value === 0) {
      updated = { ...parent, selections: parent.selections.filter((s) => s !== existing) }
    } else if (existing) {
      updated = {
        ...parent,
        selections: parent.selections.map((s) => (s === existing ? { ...s, count: value } : s)),
      }
    } else {
      // A new pick brings its own required sub-choices with it.
      const child = entry.entries.length + entry.groups.length > 0
        ? instantiate(entry, value)
        : bareSelection(entry, value)
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
      {existing && (entry.entries.length > 0 || entry.groups.length > 0) && (
        <details className="option__sub" open={existing.selections.length > 0}>
          <summary>Loadout</summary>
          <OptionTree
            parent={existing}
            entry={entry}
            root={root}
            rootOnChange={rootOnChange}
            validation={validation}
          />
        </details>
      )}
    </div>
  )
}
