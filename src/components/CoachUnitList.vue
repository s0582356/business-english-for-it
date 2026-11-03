<script setup>
import { computed } from 'vue'
import { getCoachUnitState } from '../utils/coachStorage.js'
import { REPEAT_MIN_DAYS, getUnitProgress } from '../utils/coachProgress.js'

const props = defineProps({
  coachEntry: { type: Object, default: null },
})
const emit = defineEmits(['back', 'start-unit'])

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('de-DE')
}

const units = computed(() => (props.coachEntry?.library.units ?? []).map((unit) => {
  const state = getCoachUnitState(unit.unitId)
  const progress = getUnitProgress(unit, state)
  const position = unit.steps.findIndex((step) => step.stepId === state.currentStepId)
  const inProgress = position >= 0 && !state.completedAt
  const completed = Boolean(state.completedAt)
  let status = 'Noch nicht begonnen'
  if (inProgress) status = `Begonnen – weiter bei Schritt ${position + 1} von ${unit.steps.length}`
  else if (progress.label === 'review-needed') status = 'Durchgearbeitet – Wiederholung nötig'
  else if (completed) status = 'Durchgearbeitet'
  else if (progress.label === 'in-progress') status = 'Begonnen'
  const { counts } = progress
  const lines = []
  const open = (total, answered) => (answered < total ? ` – ${total - answered} noch offen` : '')
  if (counts.auto.answered > 0) lines.push(`Automatisch geprüft: ${counts.auto.correct} von ${counts.auto.answered} richtig (letzter Stand)${open(counts.auto.total, counts.auto.answered)}`)
  if (counts.structure.answered > 0) lines.push(`Strukturcheck (eigene Sätze): bei ${counts.structure.met} von ${counts.structure.answered} Sätzen Struktur erfüllt – keine Grammatikbewertung${open(counts.structure.total, counts.structure.answered)}`)
  if (counts.self.ok + counts.self.almost + counts.self.again > 0) lines.push(`Deine Selbsteinschätzung: ${counts.self.ok}× passt, ${counts.self.almost}× fast, ${counts.self.again}× nochmal üben`)
  if (counts.improved > 0) lines.push(`Struktur im 2. Versuch verbessert (laut Strukturcheck): ${counts.improved}`)
  if (counts.gaveUp > 0) lines.push(`Lösung direkt angezeigt (nicht als gelöst gezählt): ${counts.gaveUp}`)
  if (progress.difficult > 0) lines.push(`Wiederholungsbedarf: ${progress.difficult} ${progress.difficult === 1 ? 'Aufgabe' : 'Aufgaben'}`)
  return {
    unit,
    status,
    inProgress,
    completed,
    due: progress.due,
    nextReview: state.review ? formatDate(state.review.dueAt) : null,
    staleCount: progress.stale,
    newCount: progress.newExercises,
    difficultCount: progress.difficult,
    auto: progress.auto,
    structure: progress.structure,
    lines,
  }
}))
</script>

<template>
  <section class="navigator-view coach-list" aria-label="Lerncoach">
    <button type="button" class="back-button" @click="emit('back')">← Business English W3</button>
    <div class="navigator-heading">
      <p class="eyebrow">Business English W3</p>
      <h2>Mein Lerncoach – Englisch Schritt für Schritt</h2>
      <p>Kurze Lerneinheiten: verstehen, hören, üben, eigenen Satz bilden und später wiederholen.</p>
    </div>

    <div class="navigator-list">
      <article v-for="entry in units" :key="entry.unit.unitId" class="navigator-list-card coach-unit-card">
        <span class="navigator-list-content">
          <strong>{{ entry.unit.unitTitle }}</strong>
          <small>{{ entry.unit.level }} · ca. {{ entry.unit.estimatedMinutes }} Minuten</small>
          <small>{{ entry.unit.goal }}</small>
          <small class="coach-unit-status">{{ entry.status }}</small>
          <small v-if="entry.newCount > 0" class="coach-unit-notice" role="status">Neu: {{ entry.newCount }} {{ entry.newCount === 1 ? 'Aufgabe' : 'Aufgaben' }} (z. B. eigene Sätze) – bitte üben. Dein bisheriger Lernstand bleibt erhalten.</small>
          <small v-if="entry.staleCount > 0" class="coach-unit-notice" role="status">Inhalt aktualisiert ({{ entry.staleCount }} {{ entry.staleCount === 1 ? 'Schritt' : 'Schritte' }}) – bitte wiederholen.</small>
          <small v-if="entry.due" class="coach-unit-notice" role="status">Wiederholung fällig seit {{ entry.nextReview }}.</small>
          <small v-else-if="entry.nextReview" class="coach-unit-next">Nächste Wiederholung: {{ entry.nextReview }}</small>
          <details v-if="entry.lines.length > 0 || entry.completed" class="coach-progress-details">
            <summary>Fortschritt im Detail</summary>
            <ul lang="de">
              <li v-for="line in entry.lines" :key="line">{{ line }}</li>
              <li v-if="entry.completed && entry.auto.total > 0 && entry.auto.repeated">MC-/Lückenaufgaben an mehreren Tagen erfolgreich (an mindestens {{ REPEAT_MIN_DAYS }} verschiedenen Tagen richtig gelöst).</li>
              <li v-else-if="entry.completed && entry.auto.total > 0">MC-/Lückenaufgaben: bisher an {{ entry.auto.days }} {{ entry.auto.days === 1 ? 'Tag' : 'Tagen' }} erfolgreich. „Mehrfach erfolgreich“ braucht mindestens {{ REPEAT_MIN_DAYS }} verschiedene Tage und ein richtiges letztes Ergebnis.</li>
              <li v-if="entry.completed && entry.structure.total > 0 && entry.structure.practiced">Struktur mehrfach geübt: Strukturcheck an mindestens {{ REPEAT_MIN_DAYS }} Tagen erfüllt – das ist keine Grammatikbewertung und zählt nicht für die MC-/Lückenaussage.</li>
              <li v-else-if="entry.completed && entry.structure.total > 0">Struktur geübt an {{ entry.structure.days }} {{ entry.structure.days === 1 ? 'Tag' : 'Tagen' }} (Strukturcheck erfüllt). Das ist keine Grammatikbewertung.</li>
              <li v-if="entry.completed">Selbsteinschätzung und „nicht zuverlässig prüfbare“ Sätze gelten nie als Nachweis.</li>
            </ul>
          </details>
        </span>
        <span class="coach-unit-actions">
          <button type="button" class="primary-button" @click="emit('start-unit', { unitId: entry.unit.unitId, mode: 'learn' })">
            {{ entry.inProgress ? 'Weiterlernen' : entry.completed ? 'Erneut durchgehen' : 'Starten' }}
          </button>
          <button v-if="entry.completed" type="button" :class="entry.due || entry.staleCount > 0 || entry.newCount > 0 ? 'primary-button' : 'secondary-button'" @click="emit('start-unit', { unitId: entry.unit.unitId, mode: 'review' })">
            {{ entry.newCount > 0 ? 'Neue Aufgaben üben' : 'Wiederholen' }}{{ entry.due ? ' (fällig)' : '' }}
          </button>
        </span>
      </article>
    </div>
  </section>
</template>
