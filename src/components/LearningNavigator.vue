<script setup>
import { computed } from 'vue'

const props = defineProps({
  libraryByAreaId: { type: Object, default: () => ({}) },
  conflictsByAreaId: { type: Object, default: () => ({}) },
  itemStatuses: { type: Object, default: () => ({}) },
  resumeByAreaId: { type: Object, default: () => ({}) },
  selectedGroupId: { type: String, default: null },
  selectedAreaId: { type: String, default: null },
  selectedLessonId: { type: String, default: null },
  coachEntry: { type: Object, default: null },
  coachConflict: { type: Object, default: null },
})

const emit = defineEmits(['open-area', 'resume-area', 'open-group', 'back-to-groups', 'open-lesson', 'start-scenario', 'back-to-areas', 'back-to-lessons', 'request-import', 'open-coach'])

const knownAreas = [
  { id: 'telephoning', icon: '📞', title: 'Business Telephoning' },
  { id: 'email-writing', icon: '✉️', title: 'Business Email Writing' },
  { id: 'vocabulary', icon: '📚', title: 'Business & Professional Vocabulary' },
  { id: 'socialising-opinions', icon: '💬', title: 'Professional Socialising & Opinions' },
]

// Gruppen fassen mehrere Bereiche unter einer Hauptkachel zusammen. Die
// areaIds sind stabil (Fortschritt und Audio-Dateinamen haengen daran); Inhalte
// (Lektionen/Szenarien) kommen ausschliesslich aus den privaten Bibliotheken.
const areaGroups = [
  {
    id: 'w3',
    icon: '🎓',
    title: 'Business English W3',
    areas: [
      { id: 'w3-unterricht', icon: '📘', title: 'Unterricht & Lernmaterialien' },
      { id: 'w3-klausurtraining', icon: '📝', title: 'Klausurtraining' },
      { id: 'w3-praesentation', icon: '🎤', title: 'Präsentationstraining' },
    ],
  },
]

function buildAreaCard(area) {
  const library = props.libraryByAreaId[area.id]?.library
  const conflict = props.conflictsByAreaId[area.id]
  const scenarioCount = library?.lessons.reduce((count, lesson) => count + lesson.scenarios.length, 0) ?? 0
  const resume = !conflict && library ? (props.resumeByAreaId[area.id] ?? null) : null
  return { ...area, kind: 'area', library, conflict, scenarioCount, resume, status: conflict ? 'conflict' : library ? 'loaded' : 'missing' }
}

// Eigenstaendige Lerncoach-Kachel innerhalb der W3-Gruppe. Sie ist bewusst KEIN Bereich
// (areaGroups), damit die "x von 3 Bereichen geladen"-Zaehler unveraendert bleiben.
const COACH_GROUP_ID = 'w3'
const coachCard = computed(() => ({
  status: props.coachConflict ? 'conflict' : props.coachEntry ? 'loaded' : 'missing',
  unitCount: props.coachEntry?.library.units.length ?? 0,
}))

const groupCards = computed(() => areaGroups.map((group) => {
  const areas = group.areas.map(buildAreaCard)
  return {
    id: group.id,
    icon: group.icon,
    title: group.title,
    kind: 'group',
    areas,
    loadedCount: areas.filter((area) => area.status === 'loaded').length,
    conflictCount: areas.filter((area) => area.status === 'conflict').length,
  }
}))

const areaCards = computed(() => {
  const groupedIds = new Set(areaGroups.flatMap((group) => group.areas.map((area) => area.id)))
  const knownIds = new Set(knownAreas.map((area) => area.id))
  const extras = [...new Set([...Object.keys(props.libraryByAreaId), ...Object.keys(props.conflictsByAreaId)])]
    .filter((id) => !knownIds.has(id) && !groupedIds.has(id))
    .map((id) => ({ id, icon: '📖', title: props.libraryByAreaId[id]?.library.areaTitle ?? `Lernbereich: ${id}` }))

  return [...knownAreas, ...extras].map(buildAreaCard)
})

// Startseite: bestehende Bereiche, danach die Gruppen, danach unbekannte Bereiche.
// Innerhalb einer geoeffneten Gruppe: nur deren Bereiche.
const selectedGroup = computed(() => groupCards.value.find((group) => group.id === props.selectedGroupId) ?? null)
const visibleCards = computed(() => {
  if (selectedGroup.value) return selectedGroup.value.areas
  const knownIds = new Set(knownAreas.map((area) => area.id))
  const known = areaCards.value.filter((card) => knownIds.has(card.id))
  const extras = areaCards.value.filter((card) => !knownIds.has(card.id))
  return [...known, ...groupCards.value, ...extras]
})
// Bereich -> zugehoerige Gruppe (fuer den Zurueck-Button der Lektionsliste).
const allAreaCards = computed(() => [...areaCards.value, ...groupCards.value.flatMap((group) => group.areas)])
const groupOfSelectedArea = computed(() => groupCards.value.find((group) => group.areas.some((area) => area.id === props.selectedAreaId)) ?? null)

const selectedArea = computed(() => allAreaCards.value.find((area) => area.id === props.selectedAreaId) ?? null)
const selectedLesson = computed(() => selectedArea.value?.library.lessons.find((lesson) => lesson.lessonId === props.selectedLessonId) ?? null)
function progressFor(items) { return { completed: items.filter((item) => props.itemStatuses[item.id]?.status === 'correct').length, total: items.length } }
function lessonItemCount(lesson) { return lesson.scenarios.reduce((count, scenario) => count + scenario.items.length, 0) }
</script>

<template>
  <section v-if="!selectedArea" class="navigator-view" aria-label="Bereichsauswahl">
    <button v-if="selectedGroup" type="button" class="back-button" @click="emit('back-to-groups')">← Alle Bereiche</button>
    <div class="navigator-heading">
      <p class="eyebrow">{{ selectedGroup ? selectedGroup.title : 'Lernbibliotheken' }}</p>
      <h2>Bereich auswählen</h2>
      <p>{{ selectedGroup ? 'Wähle einen Bereich. Neue Inhalte kommen mit den Lernbibliotheken dazu.' : 'Wähle einen geladenen Bereich und anschließend Lektion und Szenario.' }}</p>
    </div>
    <div class="navigator-grid">
      <template v-for="card in visibleCards" :key="`${card.kind}:${card.id}`">
        <article v-if="card.kind === 'group'" class="navigator-card navigator-card-group">
          <span class="area-card-icon" aria-hidden="true">{{ card.icon }}</span><h3>{{ card.title }}</h3>
          <p class="navigator-status" :class="{ 'navigator-status-loaded': card.loadedCount > 0 }">{{ card.loadedCount }} von {{ card.areas.length }} Bereichen geladen</p>
          <p v-if="card.conflictCount > 0" class="navigator-status navigator-status-conflict">⚠ Konflikt bei {{ card.conflictCount }} {{ card.conflictCount === 1 ? 'Bereich' : 'Bereichen' }}</p>
          <p class="navigator-meta">{{ card.areas.map((area) => area.title).join(' · ') }}</p>
          <button type="button" class="primary-button" @click="emit('open-group', card.id)">Öffnen</button>
        </article>
        <article v-else class="navigator-card" :class="`navigator-card-${card.status}`">
          <span class="area-card-icon" aria-hidden="true">{{ card.icon }}</span><h3>{{ card.title }}</h3>
          <template v-if="card.status === 'loaded'">
            <p class="navigator-status navigator-status-loaded">Lernbibliothek geladen</p>
            <p class="navigator-meta">{{ card.library.lessons.length }} Lektionen · {{ card.scenarioCount }} Szenarien</p>
            <template v-if="card.resume">
              <p class="navigator-resume-info">Weiter bei: {{ card.resume.lessonTitle }}<span v-if="card.resume.scenarioTitle"> · {{ card.resume.scenarioTitle }}</span></p>
              <button type="button" class="primary-button" @click="emit('resume-area', card.id)">Weiterlernen</button>
            </template>
            <button v-else type="button" class="primary-button" @click="emit('open-area', card.id)">Bereich öffnen</button>
          </template>
          <template v-else-if="card.status === 'conflict'"><p class="navigator-status navigator-status-conflict">⚠ Konflikt bei dieser Lernbibliothek</p><p class="navigator-meta">Mehrere unterschiedliche Lernbibliotheken wurden erkannt.</p><button type="button" class="secondary-button" @click="emit('request-import')">Lernbibliotheken laden</button></template>
          <template v-else><p class="navigator-status">Noch nicht geladen</p><p class="navigator-meta">Für diesen Bereich ist noch keine Lernbibliothek geladen.</p><button type="button" class="secondary-button" @click="emit('request-import')">Lernbibliotheken laden</button></template>
        </article>
      </template>
      <article v-if="selectedGroup && selectedGroup.id === COACH_GROUP_ID" class="navigator-card navigator-card-coach" aria-label="Mein Lerncoach">
        <span class="area-card-icon" aria-hidden="true">🧭</span><h3>Mein Lerncoach – Englisch Schritt für Schritt</h3>
        <template v-if="coachCard.status === 'loaded'">
          <p class="coach-card-status coach-card-status-loaded">Lerncoach geladen</p>
          <p class="navigator-meta">{{ coachCard.unitCount }} {{ coachCard.unitCount === 1 ? 'Lerneinheit' : 'Lerneinheiten' }} · verstehen, hören, üben, eigenen Satz bilden</p>
          <button type="button" class="primary-button" @click="emit('open-coach')">Lerncoach öffnen</button>
        </template>
        <template v-else-if="coachCard.status === 'conflict'">
          <p class="coach-card-status coach-card-status-conflict">⚠ Konflikt bei der Lerncoach-Bibliothek</p>
          <p class="navigator-meta">Mehrere unterschiedliche Lerncoach-Bibliotheken wurden erkannt.</p>
          <button type="button" class="secondary-button" @click="emit('request-import')">Lernbibliotheken laden</button>
        </template>
        <template v-else>
          <p class="coach-card-status">Noch nicht geladen</p>
          <p class="navigator-meta">Für den Lerncoach ist noch keine Bibliothek geladen.</p>
          <button type="button" class="secondary-button" @click="emit('request-import')">Lernbibliotheken laden</button>
        </template>
      </article>
    </div>
  </section>

  <section v-else-if="!selectedLesson" class="navigator-view" aria-label="Lektionsauswahl">
    <button type="button" class="back-button" @click="emit('back-to-areas')">← {{ groupOfSelectedArea ? groupOfSelectedArea.title : 'Alle Bereiche' }}</button>
    <div class="navigator-heading"><p class="eyebrow">{{ selectedArea.title }}</p><h2>Lektion auswählen</h2></div>
    <div class="navigator-list"><button v-for="(lesson, index) in selectedArea.library.lessons" :key="lesson.lessonId" type="button" class="navigator-list-card" @click="emit('open-lesson', lesson.lessonId)"><span class="navigator-number">{{ index + 1 }}</span><span class="navigator-list-content"><strong>{{ lesson.lessonTitle }}</strong><small>{{ lesson.scenarios.length }} Szenarien · {{ lessonItemCount(lesson) }} Aufgaben · {{ progressFor(lesson.scenarios.flatMap((scenario) => scenario.items)).completed }}/{{ lessonItemCount(lesson) }} richtig</small></span><span aria-hidden="true">→</span></button></div>
  </section>

  <section v-else class="navigator-view" aria-label="Szenarioauswahl">
    <button type="button" class="back-button" @click="emit('back-to-lessons')">← Zurück zu den Lektionen</button>
    <div class="navigator-heading"><p class="eyebrow">{{ selectedArea.title }}</p><h2>{{ selectedLesson.lessonTitle }}</h2><p>Szenario auswählen und gezielt trainieren.</p></div>
    <div class="navigator-list"><article v-for="scenario in selectedLesson.scenarios" :key="scenario.scenarioId" class="navigator-list-card scenario-card"><span class="navigator-list-content"><strong>{{ scenario.scenarioTitle }}</strong><small>{{ scenario.items.length }} Aufgaben · {{ progressFor(scenario.items).completed }}/{{ scenario.items.length }} richtig</small></span><button type="button" class="primary-button" @click="emit('start-scenario', scenario.scenarioId)">Lernen</button></article></div>
  </section>
</template>
