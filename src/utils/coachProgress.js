// Lernfortschritt des Lerncoachs: abgeleitete, getrennte Kennzahlen (keine einzelne Prozentzahl).
//
// Alles hier wird aus den gespeicherten Metadaten BERECHNET (coachStorage.js); es wird nichts
// zusaetzlich gespeichert. Vier Quellen bleiben strikt getrennt:
//   - automatisch geprueft:  Choice und Gap (richtig/falsch steht fest)
//   - Strukturcheck:         lokale Pruefung des Freitexts - KEINE Grammatikbewertung
//   - Selbsteinschaetzung:   eigene Wahl des Lernenden, rein informativ
//   - KI-Bewertung:          gibt es hier nicht (noch nicht angebunden)
//
// Es gibt bewusst KEINE allgemeine Einstufung "gefestigt". Aussagen sind auf das begrenzt, was geprueft wurde:
//   - "MC-/Lueckenaufgaben an mehreren Tagen erfolgreich": alle automatisch geprueften Aufgaben der Einheit
//     wurden an mindestens REPEAT_MIN_DAYS verschiedenen Kalendertagen richtig geloest, zuletzt richtig,
//     im aktuellen Inhaltsstand (revision). Freitext-Schritte spielen dabei keine Rolle.
//   - "Struktur mehrfach geuebt": der Strukturcheck war bei jeder Freitext-Aufgabe mit Check an mindestens
//     REPEAT_MIN_DAYS Tagen erfuellt. Das sagt nichts ueber grammatische Korrektheit und fliesst nicht in die
//     Aussage zu MC-/Lueckenaufgaben ein.
// Die Selbsteinschaetzung allein und unsichere Ergebnisse (unclear) sind nie ein objektiver Nachweis.
// Verglichen werden nur Ergebnisse gleicher Inhaltsversion (revision) und gleicher Herkunft (auto bzw. structure).
// Die Erfolgstage stammen aus den dauerhaften Metadaten (okDays); aeltere Staende ohne diese Felder zaehlen
// mit ihrem letzten Ergebnis als genau ein Tag.

import { isExerciseStep } from './coachLibrary.js'
import { getCoachUnitState, getUnitStepOverview, isReviewDue, isValidDayKey, localDayKey } from './coachStorage.js'

export const REPEAT_MIN_DAYS = 2

function localDay(iso) {
  return localDayKey(new Date(iso))
}

// 'auto' (Choice/Gap), 'structure' (Freitext mit Strukturcheck) oder 'self' (Freitext nur mit Selbsteinschaetzung).
export function objectiveKind(step) {
  if (step.type === 'choice' || step.type === 'gap') return 'auto'
  if (step.type === 'produce') return step.check ? 'structure' : 'self'
  return null
}

// Aeltere Staende ohne Verlauf haben genau einen Datenpunkt: ihr letztes Ergebnis.
function runsOf(saved) {
  if (saved.runs?.length) return saved.runs
  if (saved.status === 'correct' || saved.status === 'incorrect') return [{ at: saved.updatedAt, rev: saved.revision, src: 'auto', ok: saved.status === 'correct' }]
  return []
}

function successDays(saved, step, kind) {
  const days = new Set()
  if (saved.okDays?.rev === step.revision && saved.okDays.src === kind) for (const day of saved.okDays.days) if (isValidDayKey(day)) days.add(day) // nur echte Kalendertage zaehlen
  for (const run of runsOf(saved)) {
    if (run.rev === step.revision && run.src === kind && run.ok) days.add(localDay(run.at))
  }
  return days
}

function lastRun(saved, step, kind) {
  return runsOf(saved).filter((run) => run.rev === step.revision && run.src === kind).at(-1) ?? null
}

export function getUnitProgress(unit, state = getCoachUnitState(unit.unitId), now = new Date()) {
  const overview = getUnitStepOverview(unit, state)
  const exercises = unit.steps.filter(isExerciseStep)
  const counts = {
    auto: { total: 0, answered: 0, correct: 0 },
    structure: { total: 0, answered: 0, met: 0 },
    self: { total: 0, ok: 0, almost: 0, again: 0 },
    improved: 0,
    gaveUp: 0,
  }
  const required = []
  for (const step of exercises) {
    const kind = objectiveKind(step)
    const saved = state.steps[step.stepId]
    const current = Boolean(saved) && saved.revision === step.revision
    if (kind === 'auto') {
      counts.auto.total++
      if (current) {
        counts.auto.answered++
        if (saved.status === 'correct') counts.auto.correct++
      }
    } else if (kind === 'structure') {
      counts.structure.total++
      if (current && saved.produce?.checked && !saved.produce.gaveUp) {
        counts.structure.answered++
        if (saved.produce.final === 'met' && !saved.produce.copied) counts.structure.met++
      }
    }
    if (kind === 'self' || kind === 'structure') {
      counts.self.total++
      const self = current ? (saved.produce?.self ?? (saved.status.startsWith('self-') ? saved.status : null)) : null
      if (self === 'self-ok') counts.self.ok++
      else if (self === 'self-almost') counts.self.almost++
      else if (self === 'self-again') counts.self.again++
    }
    if (current && saved.produce?.improved) counts.improved++
    if (current && (saved.status === 'gave-up' || saved.produce?.gaveUp)) counts.gaveUp++
    if (kind === 'auto' || kind === 'structure') required.push({ step, kind, saved })
  }

  const openExercises = overview.open.filter((stepId) => exercises.some((step) => step.stepId === stepId))
  const completed = Boolean(state.completedAt)
  const started = Boolean(state.startedAt) || Object.keys(state.steps).length > 0 || unit.steps.some((step) => step.stepId === state.currentStepId)
  const inProgress = !completed && unit.steps.some((step) => step.stepId === state.currentStepId)

  const dayCount = (entries) => entries.map(({ step, kind, saved }) => (saved && saved.revision === step.revision ? successDays(saved, step, kind).size : 0))
  const autoSteps = required.filter((entry) => entry.kind === 'auto')
  const structureSteps = required.filter((entry) => entry.kind === 'structure')
  const autoDays = autoSteps.length > 0 ? Math.min(...dayCount(autoSteps)) : 0
  const structureDays = structureSteps.length > 0 ? Math.min(...dayCount(structureSteps)) : 0
  const clean = overview.stale.length === 0 && openExercises.length === 0 && overview.difficult.length === 0
  // Nur Choice/Gap: zuletzt richtig und an mindestens REPEAT_MIN_DAYS Tagen richtig geloest.
  // Die Aussage gilt nur fuer diese Aufgaben und haengt nicht von Freitext-Schritten ab.
  const autoRepeated = autoSteps.length > 0 && autoSteps.every(({ step, kind, saved }) => Boolean(saved)
    && saved.revision === step.revision
    && successDays(saved, step, kind).size >= REPEAT_MIN_DAYS
    && lastRun(saved, step, kind)?.ok === true)
  const structurePracticed = structureSteps.length > 0 && structureDays >= REPEAT_MIN_DAYS

  let label = 'not-started'
  if (inProgress) label = 'in-progress'
  else if (completed && !clean) label = 'review-needed'
  else if (completed) label = 'worked-through'
  else if (started) label = 'in-progress'

  return {
    label,
    counts,
    stale: overview.stale.length,
    newExercises: completed ? openExercises.length : 0,
    difficult: overview.difficult.length,
    due: isReviewDue(state, now),
    auto: { total: autoSteps.length, days: autoDays, repeated: autoRepeated, missingDays: autoSteps.length > 0 ? Math.max(0, REPEAT_MIN_DAYS - autoDays) : 0 },
    structure: { total: structureSteps.length, days: structureDays, practiced: structurePracticed },
  }
}
