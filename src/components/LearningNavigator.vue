<script setup>
import { computed } from 'vue'

const props = defineProps({
  libraryByAreaId: { type: Object, default: () => ({}) },
  conflictsByAreaId: { type: Object, default: () => ({}) },
  itemStatuses: { type: Object, default: () => ({}) },
  resumeByAreaId: { type: Object, default: () => ({}) },
  selectedAreaId: { type: String, default: null },
  selectedLessonId: { type: String, default: null },
})

const emit = defineEmits(['open-area', 'resume-area', 'open-lesson', 'start-scenario', 'back-to-areas', 'back-to-lessons', 'request-import'])

const knownAreas = [
  { id: 'telephoning', icon: '📞', title: 'Business Telephoning' },
  { id: 'email-writing', icon: '✉️', title: 'Business Email Writing' },
  { id: 'vocabulary', icon: '📚', title: 'Business & Professional Vocabulary' },
  { id: 'socialising-opinions', icon: '💬', title: 'Professional Socialising & Opinions' },
]

const areaCards = computed(() => {
  const knownIds = new Set(knownAreas.map((area) => area.id))
  const extras = [...new Set([...Object.keys(props.libraryByAreaId), ...Object.keys(props.conflictsByAreaId)])]
    .filter((id) => !knownIds.has(id))
    .map((id) => ({ id, icon: '📖', title: props.libraryByAreaId[id]?.library.areaTitle ?? `Lernbereich: ${id}` }))

  return [...knownAreas, ...extras].map((area) => {
    const library = props.libraryByAreaId[area.id]?.library
    const conflict = props.conflictsByAreaId[area.id]
    const scenarioCount = library?.lessons.reduce((count, lesson) => count + lesson.scenarios.length, 0) ?? 0
    const resume = !conflict && library ? (props.resumeByAreaId[area.id] ?? null) : null
    return { ...area, library, conflict, scenarioCount, resume, status: conflict ? 'conflict' : library ? 'loaded' : 'missing' }
  })
})

const selectedArea = computed(() => areaCards.value.find((area) => area.id === props.selectedAreaId) ?? null)
const selectedLesson = computed(() => selectedArea.value?.library.lessons.find((lesson) => lesson.lessonId === props.selectedLessonId) ?? null)
function progressFor(items) { return { completed: items.filter((item) => props.itemStatuses[item.id]?.status === 'correct').length, total: items.length } }
function lessonItemCount(lesson) { return lesson.scenarios.reduce((count, scenario) => count + scenario.items.length, 0) }
</script>

<template>
  <section v-if="!selectedArea" class="navigator-view" aria-label="Bereichsauswahl">
    <div class="navigator-heading"><p class="eyebrow">Lernbibliotheken</p><h2>Bereich auswählen</h2><p>Wähle einen geladenen Bereich und anschließend Lektion und Szenario.</p></div>
    <div class="navigator-grid">
      <article v-for="area in areaCards" :key="area.id" class="navigator-card" :class="`navigator-card-${area.status}`">
        <span class="area-card-icon" aria-hidden="true">{{ area.icon }}</span><h3>{{ area.title }}</h3>
        <template v-if="area.status === 'loaded'">
          <p class="navigator-status navigator-status-loaded">Lernbibliothek geladen</p>
          <p class="navigator-meta">{{ area.library.lessons.length }} Lektionen · {{ area.scenarioCount }} Szenarien</p>
          <template v-if="area.resume">
            <p class="navigator-resume-info">Weiter bei: {{ area.resume.lessonTitle }}<span v-if="area.resume.scenarioTitle"> · {{ area.resume.scenarioTitle }}</span></p>
            <button type="button" class="primary-button" @click="emit('resume-area', area.id)">Weiterlernen</button>
          </template>
          <button v-else type="button" class="primary-button" @click="emit('open-area', area.id)">Bereich öffnen</button>
        </template>
        <template v-else-if="area.status === 'conflict'"><p class="navigator-status navigator-status-conflict">⚠ Konflikt bei dieser Lernbibliothek</p><p class="navigator-meta">Mehrere unterschiedliche Lernbibliotheken wurden erkannt.</p><button type="button" class="secondary-button" @click="emit('request-import')">Lernbibliotheken laden</button></template>
        <template v-else><p class="navigator-status">Noch nicht geladen</p><p class="navigator-meta">Für diesen Bereich ist noch keine Lernbibliothek geladen.</p><button type="button" class="secondary-button" @click="emit('request-import')">Lernbibliotheken laden</button></template>
      </article>
    </div>
  </section>

  <section v-else-if="!selectedLesson" class="navigator-view" aria-label="Lektionsauswahl">
    <button type="button" class="back-button" @click="emit('back-to-areas')">← Alle Bereiche</button>
    <div class="navigator-heading"><p class="eyebrow">{{ selectedArea.title }}</p><h2>Lektion auswählen</h2></div>
    <div class="navigator-list"><button v-for="(lesson, index) in selectedArea.library.lessons" :key="lesson.lessonId" type="button" class="navigator-list-card" @click="emit('open-lesson', lesson.lessonId)"><span class="navigator-number">{{ index + 1 }}</span><span class="navigator-list-content"><strong>{{ lesson.lessonTitle }}</strong><small>{{ lesson.scenarios.length }} Szenarien · {{ lessonItemCount(lesson) }} Aufgaben · {{ progressFor(lesson.scenarios.flatMap((scenario) => scenario.items)).completed }}/{{ lessonItemCount(lesson) }} richtig</small></span><span aria-hidden="true">→</span></button></div>
  </section>

  <section v-else class="navigator-view" aria-label="Szenarioauswahl">
    <button type="button" class="back-button" @click="emit('back-to-lessons')">← Zurück zu den Lektionen</button>
    <div class="navigator-heading"><p class="eyebrow">{{ selectedArea.title }}</p><h2>{{ selectedLesson.lessonTitle }}</h2><p>Szenario auswählen und gezielt trainieren.</p></div>
    <div class="navigator-list"><article v-for="scenario in selectedLesson.scenarios" :key="scenario.scenarioId" class="navigator-list-card scenario-card"><span class="navigator-list-content"><strong>{{ scenario.scenarioTitle }}</strong><small>{{ scenario.items.length }} Aufgaben · {{ progressFor(scenario.items).completed }}/{{ scenario.items.length }} richtig</small></span><button type="button" class="primary-button" @click="emit('start-scenario', scenario.scenarioId)">Lernen</button></article></div>
  </section>
</template>
