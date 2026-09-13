import { useState } from 'react'
import type { MissionCard, ScoreBlock, ScoreLine } from '@/missions/types'
import './Missions.css'

/** A change where `undefined` means "remove the field" (the schema has no nullable fields). */
type Loose<T> = { [K in keyof T]?: T[K] | undefined }

function merge<T extends object>(base: T, change: Loose<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) delete out[key]
    else out[key] = value
  }
  return out as T
}

/**
 * The in-app card editor (spec §6.1): fix a typo the page conversion made, or
 * write a house rule onto a card. Edits the card as it is stored — name, legend,
 * the WHEN DRAWN rule, intro paragraphs, objective actions, every scoring block
 * and line with its VP values, and the notes. The result replaces the card in
 * the deck; a re-import of the page replaces the edits.
 */
export function MissionCardEditor({
  card,
  onSave,
  onCancel,
}: {
  card: MissionCard
  onSave: (card: MissionCard) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<MissionCard>(() => structuredClone(card))
  const [introText, setIntroText] = useState(card.intro.join('\n\n'))
  const [notesText, setNotesText] = useState(card.notes.join('\n\n'))

  const paragraphs = (text: string): string[] =>
    text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)

  const patch = (change: Loose<MissionCard>) => setDraft((d) => merge(d, change))

  const patchBlock = (bi: number, change: Loose<ScoreBlock>) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b, i) => (i === bi ? merge(b, change) : b)) }))

  const patchLine = (bi: number, li: number, change: Loose<ScoreLine>) =>
    patchBlock(bi, { lines: draft.blocks[bi]!.lines.map((l, j) => (j === li ? merge(l, change) : l)) })

  const removeLine = (bi: number, li: number) =>
    patchBlock(bi, { lines: draft.blocks[bi]!.lines.filter((_l, j) => j !== li) })

  const addLine = (bi: number) => {
    const first = draft.blocks[bi]!.lines[0]
    const pair = first !== undefined && first.vp === undefined && first.fixedVp !== undefined
    patchBlock(bi, {
      lines: [
        ...draft.blocks[bi]!.lines,
        pair
          ? ({ text: '', fixedVp: 0, tacticalVp: 0, cumulative: false } as ScoreLine)
          : ({ text: '', vp: 0, cumulative: false } as ScoreLine),
      ],
    })
  }

  const addBlock = () =>
    patch({ blocks: [...draft.blocks, { header: 'ANY BATTLE ROUND', lines: [{ text: '', vp: 0, cumulative: false }] }] })

  const removeBlock = (bi: number) => patch({ blocks: draft.blocks.filter((_b, i) => i !== bi) })

  const number = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value))

  const save = () => {
    const name = draft.name.trim()
    if (!name) return
    onSave(
      merge(draft, {
        name,
        legend: draft.legend?.trim() || undefined,
        whenDrawn: draft.whenDrawn?.trim() || undefined,
        intro: paragraphs(introText),
        notes: paragraphs(notesText),
        blocks: draft.blocks.map((b) =>
          merge(b, {
            header: b.header.trim() || 'ANY BATTLE ROUND',
            when: b.when?.trim() || undefined,
            lines: b.lines.filter((l) => l.text.trim()).map((l) => ({ ...l, text: l.text.trim() })),
          }),
        ),
      }),
    )
  }

  return (
    <form
      className="mission cardEditor"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label>
        Name
        <input type="text" value={draft.name} required onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <label>
        Legend <span className="muted">(flavour line, optional)</span>
        <input type="text" value={draft.legend ?? ''} onChange={(e) => patch({ legend: e.target.value })} />
      </label>
      {(card.whenDrawn !== undefined || 'fixedEligible' in card) && (
        <label>
          When drawn
          <textarea rows={2} value={draft.whenDrawn ?? ''} onChange={(e) => patch({ whenDrawn: e.target.value })} />
        </label>
      )}
      <label>
        Rules text <span className="muted">(blank line between paragraphs)</span>
        <textarea rows={4} value={introText} onChange={(e) => setIntroText(e.target.value)} />
      </label>

      {draft.actions.map((a, ai) => (
        <fieldset key={ai} className="cardEditor__group">
          <legend>
            {a.name} <span className="muted">{a.type.toLowerCase()}</span>
          </legend>
          {a.rows.map((r, ri) => (
            <label key={ri}>
              {r.label.toLowerCase()}
              <textarea
                rows={2}
                value={r.text}
                onChange={(e) =>
                  patch({
                    actions: draft.actions.map((x, i) =>
                      i === ai ? { ...x, rows: x.rows.map((y, j) => (j === ri ? { ...y, text: e.target.value } : y)) } : x,
                    ),
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      ))}

      {draft.blocks.map((b, bi) => (
        <fieldset key={bi} className="cardEditor__group">
          <legend>Scoring block {bi + 1}</legend>
          <div className="cardEditor__pair">
            <label>
              Applies in
              <input
                type="text"
                value={b.header}
                placeholder="SECOND BATTLE ROUND ONWARDS"
                onChange={(e) => patchBlock(bi, { header: e.target.value })}
              />
            </label>
            <label>
              When
              <input
                type="text"
                value={b.when ?? ''}
                placeholder="End of your turn"
                onChange={(e) => patchBlock(bi, { when: e.target.value })}
              />
            </label>
          </div>
          {b.lines.map((l, li) => (
            <div key={li} className="cardEditor__line">
              <label className="cardEditor__lineText">
                Line {li + 1}
                <textarea rows={2} value={l.text} onChange={(e) => patchLine(bi, li, { text: e.target.value })} />
              </label>
              <div className="cardEditor__lineMeta">
                {l.vp === undefined && (l.fixedVp !== undefined || l.tacticalVp !== undefined) ? (
                  <>
                    <label>
                      Fixed VP
                      <input
                        type="number"
                        inputMode="numeric"
                        value={l.fixedVp ?? ''}
                        onChange={(e) => patchLine(bi, li, { fixedVp: number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Tactical VP
                      <input
                        type="number"
                        inputMode="numeric"
                        value={l.tacticalVp ?? ''}
                        onChange={(e) => patchLine(bi, li, { tacticalVp: number(e.target.value) })}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    VP
                    <input
                      type="number"
                      inputMode="numeric"
                      value={l.vp ?? ''}
                      onChange={(e) => patchLine(bi, li, { vp: number(e.target.value) })}
                    />
                  </label>
                )}
                <label>
                  Up to
                  <input
                    type="number"
                    inputMode="numeric"
                    value={l.cap ?? ''}
                    onChange={(e) => patchLine(bi, li, { cap: number(e.target.value) })}
                  />
                </label>
                <label>
                  Joins as
                  <select
                    value={l.join ?? ''}
                    onChange={(e) => patchLine(bi, li, { join: (e.target.value || undefined) as ScoreLine['join'] })}
                  >
                    <option value="">—</option>
                    <option value="plus">+ (in addition)</option>
                    <option value="or">or (instead)</option>
                  </select>
                </label>
                <label className="cardEditor__check">
                  <input
                    type="checkbox"
                    checked={l.cumulative}
                    onChange={(e) => patchLine(bi, li, { cumulative: e.target.checked })}
                  />
                  Cumulative
                </label>
                <button type="button" className="button button--quiet" onClick={() => removeLine(bi, li)}>
                  Remove line
                </button>
              </div>
            </div>
          ))}
          <div className="rosters__controls">
            <button type="button" className="button button--quiet" onClick={() => addLine(bi)}>
              Add line
            </button>
            <button type="button" className="button button--quiet" onClick={() => removeBlock(bi)}>
              Remove block
            </button>
          </div>
        </fieldset>
      ))}
      <div className="rosters__controls">
        <button type="button" className="button button--quiet" onClick={addBlock}>
          Add scoring block
        </button>
      </div>

      <label>
        Notes <span className="muted">(house rules go well here)</span>
        <textarea rows={3} value={notesText} onChange={(e) => setNotesText(e.target.value)} />
      </label>

      <div className="rosters__controls cardEditor__actions">
        <button type="submit" className="button">
          Save card
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
