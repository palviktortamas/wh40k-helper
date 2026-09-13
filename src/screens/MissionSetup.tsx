import { useEffect, useState } from 'react'
import type { Roster } from '@/roster/types'
import { emptyMission, type MissionState, type SecondaryMode, type Side } from '@/play/types'
import {
  FORCE_DISPOSITIONS,
  primaryFor,
  titleCase,
  type ForceDispositionName,
  type MissionDeck,
} from '@/missions/types'

const d6 = () => Math.floor(Math.random() * 6) + 1
const pick = <T,>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)]

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** The Force Disposition the roster's configuration selected, if any. */
export function rosterDisposition(roster: Roster): ForceDispositionName | undefined {
  for (const config of roster.configuration)
    for (const child of config.selections) {
      const hit = FORCE_DISPOSITIONS.find((d) => d.toLowerCase() === child.name.toLowerCase())
      if (hit) return hit
    }
  return undefined
}

/**
 * The Chapter Approved battle sequence (spec §6.1), as a form: dispositions →
 * derived primaries → deployment → twist → central objectives → attacker →
 * secondary mode. Every random step has a draw button and a manual override.
 */
export function MissionSetup({
  deck,
  roster,
  firstTurn,
  onChange,
}: {
  deck: MissionDeck
  roster: Roster | undefined
  firstTurn: Side
  onChange: (mission: MissionState | undefined) => void
}) {
  const [mine, setMine] = useState<ForceDispositionName | ''>('')
  const [theirs, setTheirs] = useState<ForceDispositionName | ''>('')
  const [deploymentId, setDeploymentId] = useState('')
  const [twistId, setTwistId] = useState('')
  const [central, setCentral] = useState<1 | 2 | 0>(0)
  const [attacker, setAttacker] = useState<Side | ''>('')
  const [mode, setMode] = useState<SecondaryMode>('tactical')
  const [fixed, setFixed] = useState<string[]>(['', ''])

  useEffect(() => {
    if (roster) setMine((current) => current || (rosterDisposition(roster) ?? ''))
  }, [roster])

  const myPrimary = mine && theirs ? primaryFor(deck, mine, theirs) : undefined
  const theirPrimary = mine && theirs ? primaryFor(deck, theirs, mine) : undefined
  const fixedEligible = deck.secondaries.filter((s) => s.fixedEligible)

  useEffect(() => {
    const mission: MissionState = {
      ...emptyMission(),
      ...(mine ? { myDisposition: mine } : {}),
      ...(theirs ? { opponentDisposition: theirs } : {}),
      ...(myPrimary ? { myPrimaryId: myPrimary.id } : {}),
      ...(theirPrimary ? { opponentPrimaryId: theirPrimary.id } : {}),
      ...(deploymentId ? { deploymentId } : {}),
      ...(twistId ? { twistId } : {}),
      ...(central ? { centralObjectives: central } : {}),
      ...(attacker ? { attacker } : {}),
      secondaryMode: mode,
      fixedIds: mode === 'fixed' ? fixed.filter(Boolean) : [],
      deck: mode === 'tactical' ? shuffle(deck.secondaries.map((s) => s.id)) : [],
    }
    onChange(mission)
    // The shuffled deck is fixed at the moment of the last change, which is fine:
    // it only matters once the game starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, theirs, deploymentId, twistId, central, attacker, mode, fixed, firstTurn])

  return (
    <fieldset className="settings__group missionSetup">
      <legend>Mission (Chapter Approved 2026-27)</legend>

      <div className="missionSetup__pair">
        <label>
          Your Force Disposition
          <select value={mine} onChange={(e) => setMine(e.target.value as ForceDispositionName)}>
            <option value="">— choose —</option>
            {FORCE_DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent's Force Disposition
          <select value={theirs} onChange={(e) => setTheirs(e.target.value as ForceDispositionName)}>
            <option value="">— choose —</option>
            {FORCE_DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      {roster && !rosterDisposition(roster) && (
        <p className="muted">The roster has no Force Disposition selected; pick one here.</p>
      )}
      {myPrimary && theirPrimary && (
        <p className="missionSetup__derived">
          Your primary: <strong>{titleCase(myPrimary.name)}</strong> · Opponent's:{' '}
          <strong>{titleCase(theirPrimary.name)}</strong>
        </p>
      )}

      <label>
        Deployment
        <span className="missionSetup__row">
          <select value={deploymentId} onChange={(e) => setDeploymentId(e.target.value)}>
            <option value="">— choose or draw —</option>
            {deck.deployments.map((d) => (
              <option key={d.id} value={d.id}>
                {titleCase(d.name)}
              </option>
            ))}
          </select>
          <button type="button" className="button button--quiet" onClick={() => setDeploymentId(pick(deck.deployments)?.id ?? '')}>
            Draw
          </button>
        </span>
      </label>

      <label>
        Twist (optional)
        <span className="missionSetup__row">
          <select value={twistId} onChange={(e) => setTwistId(e.target.value)}>
            <option value="">— none —</option>
            {deck.twists.map((t) => (
              <option key={t.id} value={t.id}>
                {titleCase(t.name)}
              </option>
            ))}
          </select>
          <button type="button" className="button button--quiet" onClick={() => setTwistId(pick(deck.twists)?.id ?? '')}>
            Draw
          </button>
        </span>
      </label>

      <label>
        Central objectives
        <span className="missionSetup__row">
          <select value={central} onChange={(e) => setCentral(Number(e.target.value) as 0 | 1 | 2)}>
            <option value={0}>— roll or choose —</option>
            <option value={1}>One</option>
            <option value={2}>Two</option>
          </select>
          <button type="button" className="button button--quiet" onClick={() => setCentral(d6() === 6 ? 2 : 1)}>
            Roll D6
          </button>
        </span>
      </label>

      <label>
        Attacker
        <span className="missionSetup__row">
          <select value={attacker} onChange={(e) => setAttacker(e.target.value as Side)}>
            <option value="">— roll off or choose —</option>
            <option value="me">Me</option>
            <option value="opponent">Opponent</option>
          </select>
          <button type="button" className="button button--quiet" onClick={() => setAttacker(Math.random() < 0.5 ? 'me' : 'opponent')}>
            Roll off
          </button>
        </span>
      </label>

      <label>
        Secondary missions
        <select value={mode} onChange={(e) => setMode(e.target.value as SecondaryMode)}>
          <option value="tactical">Tactical (draw two each Command phase)</option>
          <option value="fixed">Fixed (two cards for the whole battle)</option>
        </select>
      </label>
      {mode === 'fixed' &&
        [0, 1].map((i) => (
          <label key={i}>
            Fixed card {i + 1}
            <select
              value={fixed[i]}
              onChange={(e) => setFixed((f) => f.map((v, j) => (j === i ? e.target.value : v)))}
            >
              <option value="">— choose —</option>
              {fixedEligible
                .filter((s) => s.id !== fixed[1 - i])
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {titleCase(s.name)}
                  </option>
                ))}
            </select>
          </label>
        ))}
    </fieldset>
  )
}
