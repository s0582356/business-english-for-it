<script setup>
import { computed } from 'vue'
import { getCoachUnitState, getUnitStepOverview, isReviewDue } from '../utils/coachStorage.js'

const props = defineProps({
  coachEntry: { type: Object, default: null },
})
const emit = defineEmits(['back', 'start-unit'])

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('de-DE')
}

const units = computed(() => (props.coachEntry?.library.units ?? []).map((unit) => {
  const state = getCoachUnitState(unit.unitId)
  const overview = getUnitStepOverview(unit, state)
  const position = unit.steps.findIndex((step) => step.stepId === state.currentStepId)
  const inProgress = position >= 0 && !state.completedAt
  const started = inProgress || Boolean(state.startedAt) || Object.keys(state.steps).length > 0
  const completed = Boolean(state.completedAt)
  const due = isReviewDue(state)
  let status = 'Noch nicht begonnen'
  if (inProgress) status = `Begonnen – weiter bei Schritt ${position + 1} von ${unit.steps.length}`
  else if (completed) status = 'Abgeschlossen'
  else if (started) status = 'Begonnen'
  return {
    unit,
    status,
    inProgress,
    completed,
    due,
    nextReview: state.review ? formatDate(state.review.dueAt) : null,
    staleCount: overview.stale.length,
    difficultCount: overview.difficult.length,
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
          <small v-if="entry.staleCount > 0" class="coach-unit-notice" role="status">Inhalt aktualisiert ({{ entry.staleCount }} {{ entry.staleCount === 1 ? 'Schritt' : 'Schritte' }}) – bitte wiederholen.</small>
          <small v-if="entry.due" class="coach-unit-notice" role="status">Wiederholung fällig seit {{ entry.nextReview }}.</small>
          <small v-else-if="entry.nextReview" class="coach-unit-next">Nächste Wiederholung: {{ entry.nextReview }}</small>
        </span>
        <span class="coach-unit-actions">
          <button type="button" class="primary-button" @click="emit('start-unit', { unitId: entry.unit.unitId, mode: 'learn' })">
            {{ entry.inProgress ? 'Weiterlernen' : entry.completed ? 'Erneut durchgehen' : 'Starten' }}
          </button>
          <button v-if="entry.completed" type="button" :class="entry.due || entry.staleCount > 0 ? 'primary-button' : 'secondary-button'" @click="emit('start-unit', { unitId: entry.unit.unitId, mode: 'review' })">
            Wiederholen{{ entry.due ? ' (fällig)' : '' }}
          </button>
        </span>
      </article>
    </div>
  </section>
</template>
