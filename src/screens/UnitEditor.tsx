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
import { canResize, isAtMaxSize, modelCount, withUnitSize } from '@/roster/size'
import { canSplit, mergeSelection, splitSelection } from '@/roster/split'
import { roleKey } from '@/roster/roles'
import { describeLoadout, enhancementsTaken } from './RosterEditor'
import { StatStrip } from './StatStrip'
import { effectsFrom } from '@/play/effects'
import type { GrantingRule } from '@/play/grants'
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
  attached,
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
  /** Characters joined to this unit, with what they bring (see AttachedUnit). */
  attached: AttachedUnit[]
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
  // One tap to the largest legal size. A mob is not one group grown: stopping
  // partway already costs the full price and misses the weapon allowance the
  // data grants at full size (see roster/size.ts).
  // Every catalogue ability with text, by entry id: enhancements today, and
  // anything else the parser learns to carry tomorrow.
  const optionTexts = new Map(
    (catalogue.enhancements ?? []).filter((a) => a.text).map((a) => [a.id, a.text]),
  )
  const resizable = canResize(selection, graph)
  const reinforced = isAtMaxSize(selection, graph)
  const models = modelCount(selection)

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
      {resizable && (
        <label className="toggle editor__reinforce">
          <input
            type="checkbox"
            checked={reinforced}
            onChange={(e) => onChange(withUnitSize(selection, graph, e.target.checked ? 'max' : 'min'))}
          />
          <span className="toggle__name">Reinforced</span>
          <span className="muted editor__reinforceHint">
            {reinforced
              ? `at its largest: ${models} models`
              : `${models} models now — fill every group to the maximum`}
          </span>
        </label>
      )}
      {sheet && (
        <StatStrip
          stats={sheet.stats}
          size="large"
          mods={effectsFrom(rulesAboutUnit(sheet, selection, detachments, catalogue)).mods}
        />
      )}

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
            texts={optionTexts}
          />
        </div>
        {sheet && (
          <aside className="editor__sheet">
            <h3 className="editor__colHead">Datasheet</h3>
            <BuiltSheet
              selection={selection}
              sheet={sheet}
              attached={attached}
              detachments={detachments}
              catalogue={catalogue}
            />
          </aside>
        )}
      </div>
    </section>
  )
}

/** A character joined to this unit, and what it brings with it. */
export type AttachedUnit = {
  id: string
  /** The roster's own name for it, numbering and renaming included. */
  name: string
  /** "Leader", "Support", or whatever the data labels the association. */
  kindLabel: string
  points: number
  sheet: Datasheet | undefined
  /** Names of the enhancements it carries. */
  enhancements: string[]
}

/** The datasheet as the loadout stands: carried weapons with counts, abilities, detachment rules. */
/**
 * The rules that speak about this unit as it is being built: the detachments
 * the army took that name it, the enhancements it has taken, and its own
 * datasheet and faction abilities. Same list the table reads at the table.
 */
export function rulesAboutUnit(
  sheet: Datasheet,
  selection: Selection,
  detachments: Detachment[],
  catalogue: ParsedCatalogue,
): GrantingRule[] {
  const keywords = [...sheet.keywords, ...sheet.factionKeywords]
  const enhancementIds = new Set((catalogue.enhancements ?? []).map((e) => e.id))
  const byName = new Map((catalogue.enhancements ?? []).map((e) => [e.name, e.text]))
  return [
    ...detachments.flatMap((d) =>
      (d.rules ?? [])
        .filter((r) => ruleAppliesTo(r.text, keywords) !== false)
        .map((rule) => ({ name: rule.name, text: rule.text, source: d.name })),
    ),
    ...enhancementsTaken(selection, enhancementIds).map((name) => ({
      name,
      text: byName.get(name) ?? '',
      source: 'Enhancement',
    })),
    ...sheet.abilities.map((a) => ({
      name: a.name,
      text: a.text,
      source: a.kind === 'faction' ? 'Faction rule' : 'Datasheet',
    })),
  ]
}

function BuiltSheet({
  selection,
  sheet,
  attached,
  detachments,
  catalogue,
}: {
  selection: Selection
  sheet: Datasheet
  attached: AttachedUnit[]
  detachments: Detachment[]
  catalogue: ParsedCatalogue
}) {
  const { rows, unmatched } = weaponCounts({ models: modelGroups(selection, sheet) }, sheet)
  const { grants, mods } = effectsFrom(rulesAboutUnit(sheet, selection, detachments, catalogue))
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

  // What a joined character brings. Which of its abilities confer to the
  // bodyguard is a judgement the rules text makes in prose, so everything the
  // character has is listed and tagged with its name rather than guessed at.
  const fromAttached = attached.flatMap((joined) => [
    ...(joined.sheet?.abilities ?? [])
      .filter((a) => a.kind !== 'core' && a.kind !== 'faction')
      .map((ability) => ({ key: `${joined.id}:${ability.id}`, name: ability.name, text: ability.text, from: joined, tag: joined.kindLabel })),
    ...joined.enhancements.map((name) => ({
      key: `${joined.id}:enh:${name}`,
      name,
      text: enhancementText.get(name) ?? '',
      from: joined,
      tag: 'Enhancement',
    })),
  ])

  return (
    <div className="built">
      <WeaponTable
        title="Ranged weapons"
        rows={carried.filter((r) => r.profile.kind === 'ranged')}
        grants={grants}
        mods={mods}
      />
      <WeaponTable
        title="Melee weapons"
        rows={carried.filter((r) => r.profile.kind === 'melee')}
        grants={grants}
        mods={mods}
      />
      {carried.length === 0 && <p className="muted">No weapons chosen yet.</p>}
      {unmatched.length > 0 && (
        <p className="muted">
          Also carried: {unmatched.map(([name, n]) => `${n}× ${name}`).join(', ')}
        </p>
      )}

      {attached.length > 0 && (
        <>
          <h3>Joined by</h3>
          <ul className="attached">
            {attached.map((joined) => (
              <li key={joined.id} className="attached__item">
                <span className="attached__name">{joined.name}</span>
                <span className="rule-chip rule-chip--attached">{joined.kindLabel}</span>
                {joined.points > 0 && <span className="muted"> {joined.points} pts</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {(sheet.abilities.length > 0 ||
        detachmentRules.length > 0 ||
        taken.length > 0 ||
        fromAttached.length > 0) && <h3>Abilities</h3>}
      <ul className="abilities">
        {fromAttached.map((item) => (
          <li key={item.key} className="abilities__item">
            <div className="abilities__head">
              {item.name}
              <span className="rule-chip rule-chip--attached">
                {item.from.name} · {item.tag}
              </span>
            </div>
            {item.text && (
              <p className="abilities__text">
                <Marked text={item.text} />
              </p>
            )}
          </li>
        ))}
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
  /**
   * Rules text per catalogue entry id, so an option can be read *before* it is
   * taken — an enhancement is a paragraph of rules, and its name alone is not
   * enough to choose by.
   */
  texts?: Map<string, string> | undefined
}

/** The option groups and direct entries of one selection, availability-gated. */
export function OptionTree({
  parent,
  entry,
  root,
  rootOnChange,
  validation,
  tryChange,
  texts,
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
            texts={texts}
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
              texts={texts}
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
  texts,
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
  // A group with a minimum must not be emptied: the rules make the choice
  // compulsory, and emptying it used to hide the nested loadout of whatever was
  // removed, leaving no way back.
  const groupMin = min && min.value > 0 ? min.value : 0
  const atGroupMin = groupMin > 0 && shownTaken <= groupMin
  // "Choose exactly one": tapping another option swaps to it, because with the
  // floor in place there is otherwise no way to change your mind.
  const singleChoice = groupMin === 1 && limit === 1

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

      {candidates.flatMap((candidate) => {
        // Once a pick has been separated into individual models, each gets its
        // own row so its loadout can differ from its twin's.
        const instances = parent.selections.filter((s) => isSameOption(s, candidate, group.id))
        const rows = instances.length > 1 ? instances : [undefined]
        return rows.map((instance, index) => (
          <OptionRow
            key={instance?.id ?? candidate.linkId ?? candidate.id}
            entry={candidate}
            groupId={group.id}
            parent={parent}
            root={root}
            rootOnChange={rootOnChange}
            validation={validation}
            tryChange={tryChange}
            texts={texts}
            groupFull={groupFull}
            atGroupMin={atGroupMin}
            singleChoice={singleChoice}
            instance={instance}
            instanceLabel={instance ? `${index + 1} of ${instances.length}` : undefined}
          />
        ))
      })}

      {nested.map((child) => (
        <GroupEditor
          key={child.linkId ?? child.id}
          group={child}
          parent={parent}
          root={root}
          rootOnChange={rootOnChange}
          validation={validation}
          tryChange={tryChange}
          texts={texts}
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
  texts,
  groupFull,
  atGroupMin = false,
  singleChoice = false,
  instance,
  instanceLabel,
}: TreeProps & {
  entry: ResolvedEntry
  groupId?: string
  groupFull: boolean
  /** One separated copy of this pick, when the owner split them apart. */
  instance?: Selection | undefined
  /** "1 of 2" — which copy this row is. */
  instanceLabel?: string | undefined
  /** The group is at its compulsory minimum, so nothing here may be removed. */
  atGroupMin?: boolean
  /** Exactly one of this group is taken: picking another swaps to it. */
  singleChoice?: boolean
}) {
  const [hint, setHint] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // Enhancements are a paragraph of rules; choosing one by name alone is
  // guesswork, so anything the catalogue has text for can be read in place.
  const text = texts?.get(entry.id)
  const existing = instance ?? parent.selections.find((s) => isSameOption(s, entry, groupId))
  const count = existing?.count ?? 0
  const points = entry.costs[COST_TYPE.points]

  // Room left on this option itself: the evaluator's number once it is taken,
  // the data's plain `max` before that.
  const baseMax = entry.constraints.find((c) => c.type === 'max' && c.scope === 'parent' && c.value >= 0)?.value
  const room = existing ? validation.headroom[existing.id] : baseMax !== undefined ? baseMax - count : undefined
  const atCap = room !== undefined && room <= 0
  // In a one-of-N group the "+" swaps rather than adds, so a full group is no
  // reason to grey it out.
  const swaps = singleChoice && count === 0
  const plusDisabled = (groupFull && !swaps) || atCap
  const minusDisabled = count === 0 || (atGroupMin && count > 0)

  const setCount = (next: number) => {
    const value = Math.max(0, next)
    let updated: Selection

    if (value > 0 && swaps && groupId) {
      // Replace whatever else this group holds — the choice is exclusive.
      const kept = parent.selections.filter((s) => s.groupId !== groupId)
      const child = entry.entries.length + entry.groups.length > 0
        ? instantiate(entry, value)
        : bareSelection(entry, value)
      child.groupId = groupId
      updated = { ...parent, selections: [...kept, child] }
    } else if (value === 0) {
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

    const rootWith = (next: Selection): Selection =>
      parent.id === root.id
        ? next
        : { ...root, selections: replaceSelection(root.selections, parent.id, next) }
    const nextRoot = rootWith(updated)

    // A swap does not grow the unit, so the "would this break a cap?" guard
    // that refuses increments must not refuse it.
    if (value > count && tryChange && !swaps) {
      const refusal = tryChange(nextRoot)
      if (refusal) {
        // A special-weapon model *replaces* an ordinary one rather than
        // joining it — a Boy with a rokkit launcha is still one of the mob's
        // Boyz — so at full size there is no room to simply add one. Offer the
        // data a version that takes one from a sibling model instead, largest
        // group first, and use the first it accepts. Which sibling is the right
        // donor is not assumed: the evaluator decides.
        const donors = parent.selections
          .filter((s) => s.type === 'model' && s.count > 1 && s !== existing && s.entryId !== entry.id)
          .sort((a, b) => b.count - a.count)
        for (const donor of donors) {
          const swapped = rootWith({
            ...updated,
            selections: updated.selections.map((s) =>
              s.id === donor.id ? { ...s, count: s.count - 1 } : s,
            ),
          })
          if (!tryChange(swapped)) {
            setHint(`Replaced one ${donor.name}`)
            setTimeout(() => setHint(null), 2500)
            rootOnChange(swapped)
            return
          }
        }
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
        {instanceLabel && <span className="muted option__which"> {instanceLabel}</span>}
        {points ? <span className="muted"> {points} pts</span> : null}
        {/* Worth a word only when more than one could be taken; a fixed single pick just greys its "+". */}
        {room !== undefined && count > 0 && count + Math.max(room, 0) > 1 && (
          <span className={`option__room ${atCap ? 'option__room--cap' : ''}`}>
            {atCap ? 'max' : `${room} more`}
          </span>
        )}
        {text && (
          <button
            className="option__info tap"
            aria-expanded={reading}
            aria-label={`${reading ? 'Hide' : 'Show'} the rules for ${entry.name}`}
            onClick={() => setReading(!reading)}
          >
            {reading ? '−' : 'i'}
          </button>
        )}
        {hint && (
          <span className="option__hint" role="status">
            {hint}
          </span>
        )}
      </div>
      <div className="stepper">
        <button
          aria-label={`One fewer ${entry.name}`}
          disabled={minusDisabled}
          title={
            minusDisabled && count > 0 ? 'This choice is compulsory — pick another instead' : undefined
          }
          onClick={() => setCount(count - 1)}
        >
          −
        </button>
        <span className="stepper__value" aria-live="polite">
          {count}
        </span>
        <button
          aria-label={`One more ${entry.name}`}
          disabled={plusDisabled}
          title={
            plusDisabled
              ? 'At the limit the data allows'
              : swaps
                ? `Switch to ${entry.name}`
                : undefined
          }
          onClick={() => setCount(count + 1)}
        >
          +
        </button>
      </div>
      {text && reading && (
        <p className="option__text">
          <Marked text={text} />
        </p>
      )}
      {existing && (entry.entries.length > 0 || entry.groups.length > 0) && (
        <details className="option__sub" open={existing.selections.length > 0}>
          <summary>Loadout</summary>
          {canSplit(existing, entry.entries.length + entry.groups.length > 0) && (
            <button
              className="button button--quiet option__split"
              onClick={() => rootOnChange(splitSelection(root, existing.id))}
            >
              Give each of the {existing.count} its own loadout
            </button>
          )}
          {instance && (
            <button
              className="button button--quiet option__split"
              // Only identical copies merge, so this never throws a loadout away.
              disabled={mergeSelection(root, instance.id) === root}
              title={
                mergeSelection(root, instance.id) === root
                  ? 'These are equipped differently, so they cannot be combined'
                  : undefined
              }
              onClick={() => rootOnChange(mergeSelection(root, instance.id))}
            >
              Combine the identical ones
            </button>
          )}
          <OptionTree
            parent={existing}
            entry={entry}
            texts={texts}
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
