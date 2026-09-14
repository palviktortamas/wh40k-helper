import { useMemo, useState } from 'react'
import { bareSelection, instantiate, isSameOption } from '@/roster/defaults'
import { replaceSelection, type Validation } from '@/roster/store'
import type { CatalogueGraph, ResolvedEntry, ResolvedGroup } from '@/roster/resolve'
import type { Selection } from '@/roster/types'
import type { Datasheet, Detachment, ParsedCatalogue } from '@/data/model'
import { COST_TYPE } from '@/data/bsdata/schema'
import { modelGroups } from '@/play/snapshot'
import { weaponCounts } from '@/play/weapons'
import { ruleAppliesTo } from '@/roster/detachmentRules'
import { roleKey } from '@/roster/roles'
import { describeLoadout, enhancementsTaken } from './RosterEditor'
import { StatStrip } from './StatStrip'
import { WeaponTable } from './WeaponTable'
import { Marked } from './Marked'
import './Rosters.css'
import './Units.css'

/**
 * The per-model loadout editor (spec §5.2). A unit is shown as its option
 * groups; within each, every selectable entry gets a stepper. That is what makes
 * "16 with slugga and choppa, 2 with a rokkit launcha, 2 Nobz" expressible
 * rather than a single fixed loadout for the whole unit — the main complaint the
 * spec has about other apps.
 *
 * Limits: the constraint evaluator is the authority. It now reports how much
 * room each cap leaves (`headroom`), so a "+" that would break a `max` is
 * disabled, and before any increment the editor asks `tryChange` whether the
 * data would raise a new "at most" error — a second net for caps that live on
 * a scope the headroom cannot see. What *is* filtered is availability: the
 * data's own "you may only take X if Y" gates decide which options are offered.
 *
 * Next to the options sits the datasheet as it is being built: stats, the
 * weapons the chosen models carry, abilities, and the chosen detachments' rules
 * that name this unit — so a list is built from the unit's actual profile,
 * not from memory.
 */
export function UnitEditor({
  selection,
  graph,
  validation,
  sheet,
  displayName,
  detachments,
  catalogue,
  role,
  onBack,
  onChange,
  tryChange,
}: {
  selection: Selection
  graph: CatalogueGraph
  validation: Validation
  sheet: Datasheet | undefined
  /** What the roster calls this unit — its own name, or the numbered one. */
  displayName: string
  detachments: Detachment[]
  catalogue: ParsedCatalogue
  role: string | undefined
  onBack: () => void
  onChange: (next: Selection) => void
  tryChange: (next: Selection) => string | undefined
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

  const key = roleKey(role)

  return (
    <section className={`rosters editor role--${key}`}>
      <button className="sheet__back tap" onClick={onBack}>
        ‹ Back to the list
      </button>
      <div className="editor__head">
        <h2>{displayName}</h2>
        <span className="role-tag">{role ?? 'Unit'}</span>
      </div>
      <label className="editor__name">
        Name
        <input
          value={selection.customName ?? ''}
          placeholder={displayName}
          aria-label="Name this unit"
          onChange={(e) => {
            const next = { ...selection }
            // An empty field means "call it whatever the datasheet is called",
            // so the automatic numbering takes over again.
            if (e.target.value.trim()) next.customName = e.target.value
            else delete next.customName
            onChange(next)
          }}
        />
      </label>
      <p className="muted editor__summary">
        {describeLoadout(selection)} · <strong>{validation.unitPoints[selection.id] ?? 0} pts</strong>
      </p>
      {sheet && <StatStrip stats={sheet.stats} size="large" />}

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

      <div className="editor__cols">
        <div className="editor__options">
          <h3 className="editor__colHead">Loadout</h3>
          <OptionTree
            parent={selection}
            entry={entry}
            root={selection}
            rootOnChange={onChange}
            validation={validation}
            tryChange={tryChange}
          />
        </div>
        {sheet && (
          <aside className="editor__sheet">
            <h3 className="editor__colHead">Datasheet</h3>
            <BuiltSheet selection={selection} sheet={sheet} detachments={detachments} catalogue={catalogue} />
          </aside>
        )}
      </div>
    </section>
  )
}

/** The datasheet as the loadout stands: carried weapons with counts, abilities, detachment rules. */
function BuiltSheet({
  selection,
  sheet,
  detachments,
  catalogue,
}: {
  selection: Selection
  sheet: Datasheet
  detachments: Detachment[]
  catalogue: ParsedCatalogue
}) {
  const { rows, unmatched } = weaponCounts({ models: modelGroups(selection, sheet) }, sheet)
  const keywords = [...sheet.keywords, ...sheet.factionKeywords]
  // Every detachment the army took can speak about this unit, so each is asked.
  const detachmentRules = detachments.flatMap((d) =>
    (d.rules ?? [])
      .filter((r) => ruleAppliesTo(r.text, keywords) !== false)
      .map((rule) => ({ rule, detachmentName: d.name })),
  )
  const enhancementIds = new Set((catalogue.enhancements ?? []).map((e) => e.id))
  const taken = enhancementsTaken(selection, enhancementIds)
  const enhancementText = new Map((catalogue.enhancements ?? []).map((e) => [e.name, e.text]))
  const carried = rows.filter((r) => r.count > 0)

  return (
    <div className="built">
      <WeaponTable title="Ranged weapons" rows={carried.filter((r) => r.profile.kind === 'ranged')} />
      <WeaponTable title="Melee weapons" rows={carried.filter((r) => r.profile.kind === 'melee')} />
      {carried.length === 0 && <p className="muted">No weapons chosen yet.</p>}
      {unmatched.length > 0 && (
        <p className="muted">
          Also carried: {unmatched.map(([name, n]) => `${n}× ${name}`).join(', ')}
        </p>
      )}

      {(sheet.abilities.length > 0 || detachmentRules.length > 0 || taken.length > 0) && <h3>Abilities</h3>}
      <ul className="abilities">
        {detachmentRules.map(({ rule, detachmentName }) => (
          <li key={rule.id} className="abilities__item">
            <div className="abilities__head">
              {rule.name}
              <span className="rule-chip rule-chip--detachment">{detachmentName}</span>
            </div>
            <p className="abilities__text">
              <Marked text={rule.text} />
            </p>
          </li>
        ))}
        {taken.map((name) => (
          <li key={name} className="abilities__item">
            <div className="abilities__head">
              {name}
              <span className="rule-chip rule-chip--enhancement">Enhancement</span>
            </div>
            {enhancementText.get(name) && (
              <p className="abilities__text">
                <Marked text={enhancementText.get(name)!} />
              </p>
            )}
          </li>
        ))}
        {sheet.abilities.map((ability) => (
          <li key={ability.id} className="abilities__item">
            <div className="abilities__head">
              {ability.name}
              {ability.kind === 'faction' && <span className="rule-chip rule-chip--core">Core / faction</span>}
            </div>
            <p className="abilities__text">
              <Marked text={ability.text || '—'} />
            </p>
          </li>
        ))}
      </ul>
      <p className="muted built__keywords">{keywords.join(', ')}</p>
    </div>
  )
}

const contains = (node: Selection, id: string): boolean =>
  node.id === id || node.selections.some((child) => contains(child, id))

type TreeProps = {
  parent: Selection
  root: Selection
  rootOnChange: (next: Selection) => void
  validation: Validation
  /** Asked before an increment; a message refuses it. Absent for roster configuration. */
  tryChange?: ((nextRoot: Selection) => string | undefined) | undefined
}

/** The option groups and direct entries of one selection, availability-gated. */
export function OptionTree({
  parent,
  entry,
  root,
  rootOnChange,
  validation,
  tryChange,
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
            tryChange={tryChange}
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
              tryChange={tryChange}
              groupFull={false}
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
  tryChange,
}: TreeProps & { group: ResolvedGroup }) {
  const candidates = group.entries.filter((e) => offered(validation, parent, e, group))
  const nested = group.groups.filter((g) => groupOffered(validation, parent, g))
  const max = group.constraints.find((c) => c.type === 'max' && c.scope === 'parent')
  const min = group.constraints.find((c) => c.type === 'min' && c.scope === 'parent')

  const taken = candidates.reduce((sum, candidate) => sum + countOf(parent, candidate, group.id), 0)
  // The evaluator's own reading of the cap after modifiers ("3, or 6 above 10
  // models"). It also counts members the editor lists in another group (a
  // special-weapon model still counts towards "9-18 models"), so the shown
  // count is derived from the room left, not from the rows here.
  const evaluated = validation.groupHeadroom[`${parent.id}:${group.id}`]
  const baseMax = max && max.value >= 0 ? max.value : undefined
  const limit = evaluated !== undefined ? Math.max(taken + evaluated, baseMax ?? 0) : baseMax
  const shownTaken = evaluated !== undefined && limit !== undefined ? limit - evaluated : taken
  const groupFull = limit !== undefined && shownTaken >= limit

  if (candidates.length === 0 && nested.length === 0) return null

  return (
    <div className={`group ${groupFull ? 'group--full' : ''}`}>
      <div className="group__head">
        <h3>{group.name}</h3>
        <span className={`group__count ${groupFull ? 'group__count--full' : ''}`}>
          {shownTaken}
          {limit !== undefined ? ` / ${limit}` : ''}
          {min && min.value > 0 ? ` · min ${min.value}` : ''}
          {groupFull ? ' · full' : ''}
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
          tryChange={tryChange}
          groupFull={groupFull}
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
          tryChange={tryChange}
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
  tryChange,
  groupFull,
}: TreeProps & { entry: ResolvedEntry; groupId?: string; groupFull: boolean }) {
  const [hint, setHint] = useState<string | null>(null)
  const existing = parent.selections.find((s) => isSameOption(s, entry, groupId))
  const count = existing?.count ?? 0
  const points = entry.costs[COST_TYPE.points]

  // Room left on this option itself: the evaluator's number once it is taken,
  // the data's plain `max` before that.
  const baseMax = entry.constraints.find((c) => c.type === 'max' && c.scope === 'parent' && c.value >= 0)?.value
  const room = existing ? validation.headroom[existing.id] : baseMax !== undefined ? baseMax - count : undefined
  const atCap = room !== undefined && room <= 0
  const plusDisabled = groupFull || atCap

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

    const nextRoot =
      parent.id === root.id
        ? updated
        : { ...root, selections: replaceSelection(root.selections, parent.id, updated) }

    if (value > count && tryChange) {
      const refusal = tryChange(nextRoot)
      if (refusal) {
        setHint(refusal)
        setTimeout(() => setHint(null), 2500)
        return
      }
    }
    setHint(null)
    rootOnChange(nextRoot)
  }

  return (
    <div className={`option ${count > 0 ? 'option--taken' : ''}`}>
      <div className="option__label">
        <span>{entry.name}</span>
        {points ? <span className="muted"> {points} pts</span> : null}
        {/* Worth a word only when more than one could be taken; a fixed single pick just greys its "+". */}
        {room !== undefined && count > 0 && count + Math.max(room, 0) > 1 && (
          <span className={`option__room ${atCap ? 'option__room--cap' : ''}`}>
            {atCap ? 'max' : `${room} more`}
          </span>
        )}
        {hint && (
          <span className="option__hint" role="status">
            {hint}
          </span>
        )}
      </div>
      <div className="stepper">
        <button aria-label={`One fewer ${entry.name}`} disabled={count === 0} onClick={() => setCount(count - 1)}>
          −
        </button>
        <span className="stepper__value" aria-live="polite">
          {count}
        </span>
        <button
          aria-label={`One more ${entry.name}`}
          disabled={plusDisabled}
          title={plusDisabled ? 'At the limit the data allows' : undefined}
          onClick={() => setCount(count + 1)}
        >
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
            tryChange={tryChange}
          />
        </details>
      )}
    </div>
  )
}
