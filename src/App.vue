<script setup>
import { computed, ref } from 'vue'
import PrivateContentImporter from './components/PrivateContentImporter.vue'
import ScoreBox from './components/ScoreBox.vue'
import ChoiceCard from './components/ChoiceCard.vue'
import OrderedStepsTrainer from './components/OrderedStepsTrainer.vue'
import GapInputTrainer from './components/GapInputTrainer.vue'
import LearningNavigator from './components/LearningNavigator.vue'
import { recordItemResult, saveLastPosition, getAreaItemStatuses, getLastPosition, resolveNextOpenTarget } from './utils/progressStorage.js'

const THEME_STORAGE_KEY = 'businessEnglishTheme'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(value) {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', value)
}

const theme = ref(getInitialTheme())
applyTheme(theme.value)
const isDarkMode = computed(() => theme.value === 'dark')

function toggleTheme() {
  theme.value = isDarkMode.value ? 'light' : 'dark'
  applyTheme(theme.value)
  window.localStorage.setItem(THEME_STORAGE_KEY, theme.value)
}

const view = ref('home') // 'home' | 'lessons' | 'scenarios' | 'run' | 'result'

const libraryRegistry = ref({ libraryByAreaId: {}, conflictsByAreaId: {} })
const importReport = ref(null)
const importer = ref(null)
const selectedAreaId = ref(null)
const selectedLessonId = ref(null)
const activeAreaId = ref(null)
const allItems = ref([])
const itemStatuses = ref({})
const progressTick = ref(0)

// Neu berechnet, sobald sich die geladenen Libraries aendern oder eine neue
// Antwort gespeichert wird (progressTick). Nur Bereiche mit geladener,
// konfliktfreier Library und mindestens einer noch offenen Aufgabe tauchen
// hier auf - siehe resolveNextOpenTarget. Der echte Fortschritt (itemStatus)
// bestimmt das Ziel, lastPosition dient nur als Startpunkt.
function resolveAreaResume(areaId, library) {
  return resolveNextOpenTarget(library, getAreaItemStatuses(areaId), getLastPosition(areaId))
}

const resumeByAreaId = computed(() => {
  progressTick.value
  const result = {}
  for (const [areaId, entry] of Object.entries(libraryRegistry.value.libraryByAreaId)) {
    if (libraryRegistry.value.conflictsByAreaId[areaId]) continue
    const target = resolveAreaResume(areaId, entry.library)
    if (target) result[areaId] = target
  }
  return result
})

const runItems = ref([])
const isReviewMode = ref(false)
const currentIndex = ref(0)
const selectedAnswer = ref(null)
const isAnswered = ref(false)
const score = ref(0)
const answeredLog = ref([]) // [{ id, correct }]

const currentItem = computed(() => runItems.value[currentIndex.value])
const totalRunItems = computed(() => runItems.value.length)
const isLastItem = computed(() => currentIndex.value === totalRunItems.value - 1)
const wrongCount = computed(() => totalRunItems.value - score.value)
const scorePercentage = computed(() =>
  totalRunItems.value === 0 ? 0 : Math.round((score.value / totalRunItems.value) * 100),
)
const incorrectItemIds = computed(() => [...new Set(answeredLog.value.filter((entry) => !entry.correct).map((entry) => entry.id))])

const resultMessage = computed(() => {
  if (scorePercentage.value >= 90) return 'Sehr sicher unterwegs am Telefon.'
  if (scorePercentage.value >= 75) return 'Solide Basis – ein paar Formulierungen noch festigen.'
  if (scorePercentage.value >= 60) return 'Guter Start – wiederhole die offenen Punkte.'
  return 'Noch unsicher – lohnt sich, die Fehler zu wiederholen.'
})

function startRun(items, { reviewMode = false } = {}) {
  runItems.value = items
  isReviewMode.value = reviewMode
  currentIndex.value = 0
  selectedAnswer.value = null
  isAnswered.value = false
  score.value = 0
  answeredLog.value = []
  view.value = 'run'
}

function onLibrariesLoaded(result) {
  libraryRegistry.value = { libraryByAreaId: result.libraryByAreaId, conflictsByAreaId: result.conflictsByAreaId }
  importReport.value = result.report
  itemStatuses.value = selectedAreaId.value ? getAreaItemStatuses(selectedAreaId.value) : {}
  view.value = 'home'
}

function openArea(areaId) {
  if (!libraryRegistry.value.libraryByAreaId[areaId] || libraryRegistry.value.conflictsByAreaId[areaId]) return
  selectedAreaId.value = areaId
  selectedLessonId.value = null
  itemStatuses.value = getAreaItemStatuses(areaId)
  view.value = 'lessons'
}

// Springt direkt zur naechsten noch offenen Aufgabe eines Bereichs (siehe
// resolveNextOpenTarget). Gibt es kein Ziel (nichts begonnen, alles erledigt),
// faellt es auf den normalen Bereichseinstieg zurueck - kein Crash.
function resumeArea(areaId) {
  const entry = libraryRegistry.value.libraryByAreaId[areaId]
  if (!entry || libraryRegistry.value.conflictsByAreaId[areaId]) return

  const target = resolveAreaResume(areaId, entry.library)
  if (!target) {
    openArea(areaId)
    return
  }

  selectedAreaId.value = areaId
  selectedLessonId.value = target.lessonId
  itemStatuses.value = getAreaItemStatuses(areaId)

  const lesson = entry.library.lessons.find((candidate) => candidate.lessonId === target.lessonId)
  const scenario = lesson.scenarios.find((candidate) => candidate.scenarioId === target.scenarioId)
  activeAreaId.value = areaId
  allItems.value = scenario.items
  // Resume-Run: ab dem Ziel nur noch Aufgaben ohne Progress-Eintrag (richtig
  // oder falsch zaehlt als bearbeitet), das Ziel selbst bleibt enthalten.
  // Der normale Szenario-Start (startScenario) bleibt linear.
  const statuses = itemStatuses.value
  const startIndex = Math.max(0, scenario.items.findIndex((item) => item.id === target.itemId))
  startRun(scenario.items.filter((item, index) => index >= startIndex && (item.id === target.itemId || !statuses[item.id])))
}

function openLesson(lessonId) {
  selectedLessonId.value = lessonId
  view.value = 'scenarios'
}

function startScenario(scenarioId) {
  const lesson = libraryRegistry.value.libraryByAreaId[selectedAreaId.value]?.library.lessons.find((candidate) => candidate.lessonId === selectedLessonId.value)
  const scenario = lesson?.scenarios.find((candidate) => candidate.scenarioId === scenarioId)
  if (!scenario) return
  activeAreaId.value = selectedAreaId.value
  allItems.value = scenario.items
  startRun(scenario.items)
}

function backToAreas() {
  selectedAreaId.value = null
  selectedLessonId.value = null
  view.value = 'home'
}

function backToLessons() {
  selectedLessonId.value = null
  view.value = 'lessons'
}

function recordAnswer(id, correct) {
  answeredLog.value.push({ id, correct })
  if (correct) score.value++

  recordItemResult(activeAreaId.value, id, correct)
  itemStatuses.value = { ...itemStatuses.value, [id]: { status: correct ? 'correct' : 'incorrect' } }
  const item = currentItem.value
  if (item?.lessonId && item?.scenarioId) {
    saveLastPosition(activeAreaId.value, { lessonId: item.lessonId, scenarioId: item.scenarioId, itemId: item.id })
  }
  progressTick.value++
}

function selectAnswer(option) {
  if (isAnswered.value) return
  selectedAnswer.value = option
  isAnswered.value = true
  recordAnswer(currentItem.value.id, option === currentItem.value.correctAnswer)
}

function onOrderedCompleted({ id, correct }) {
  recordAnswer(id, correct)
}

function onGapCompleted({ id, correct }) {
  recordAnswer(id, correct)
}

function nextItem() {
  currentIndex.value++
  selectedAnswer.value = null
  isAnswered.value = false
}

function finishRun() {
  view.value = 'result'
}

function repeatIncorrect() {
  const idsToRepeat = new Set(incorrectItemIds.value)
  const items = allItems.value.filter((item) => idsToRepeat.has(item.id))
  if (items.length === 0) return
  startRun(items, { reviewMode: true })
}

function restartFullRun() {
  startRun(allItems.value)
}

function backToHome() {
  view.value = selectedLessonId.value ? 'scenarios' : 'home'
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <button
        type="button"
        class="theme-toggle"
        :aria-label="isDarkMode ? 'Light Mode aktivieren' : 'Dark Mode aktivieren'"
        :aria-pressed="isDarkMode"
        @click="toggleTheme"
      >
        <span aria-hidden="true">{{ isDarkMode ? '☀️' : '🌙' }}</span>
      </button>

      <p class="eyebrow">Business English</p>
      <h1>Deine persönliche Business-English-Lernplattform</h1>
      <p class="intro">Vokabular, Socialising, Telefonate und E-Mails für Studium, Praktikum und IT-Beruf.</p>
    </header>

    <section v-if="view === 'home'" class="home-view">
      <LearningNavigator
        :library-by-area-id="libraryRegistry.libraryByAreaId"
        :conflicts-by-area-id="libraryRegistry.conflictsByAreaId"
        :item-statuses="itemStatuses"
        :resume-by-area-id="resumeByAreaId"
        @open-area="openArea"
        @resume-area="resumeArea"
        @request-import="importer?.openFilePicker()"
      />
      <PrivateContentImporter ref="importer" :current-registry="libraryRegistry" @libraries-loaded="onLibrariesLoaded" />
      <section v-if="importReport" class="import-report" aria-label="Importbericht">
        <p v-for="entry in importReport.loaded" :key="'loaded-' + entry.fileName" class="explanation">Geladen: {{ entry.areaId }} ({{ entry.fileName }})</p>
        <p v-for="entry in importReport.upgrades" :key="'upgrade-' + entry.fileName" class="explanation">Aktualisiert auf Version {{ entry.libraryVersion }}: {{ entry.areaId }}</p>
        <p v-for="entry in importReport.duplicates" :key="'dup-' + entry.fileName" class="explanation">Duplikat übersprungen: {{ entry.fileName }}</p>
        <p v-for="entry in importReport.ignored" :key="'ignored-' + entry.fileName" class="explanation">Ignoriert (ältere Version als bereits geladen): {{ entry.fileName }}</p>
        <p v-for="entry in importReport.conflicts" :key="'conflict-' + entry.fileName" class="feedback-wrong">Konflikt bei „{{ entry.areaId }}": mehrere unterschiedliche Lernbibliotheken erkannt.</p>
        <p v-for="entry in importReport.errors" :key="'error-' + entry.fileName" class="feedback-wrong">Fehler in {{ entry.fileName }}: {{ entry.reason }}</p>
      </section>
    </section>

    <LearningNavigator
      v-else-if="view === 'lessons' || view === 'scenarios'"
      :library-by-area-id="libraryRegistry.libraryByAreaId"
      :conflicts-by-area-id="libraryRegistry.conflictsByAreaId"
      :item-statuses="itemStatuses"
      :selected-area-id="selectedAreaId"
      :selected-lesson-id="view === 'scenarios' ? selectedLessonId : null"
      @open-lesson="openLesson"
      @start-scenario="startScenario"
      @back-to-areas="backToAreas"
      @back-to-lessons="backToLessons"
    />

    <section v-else-if="view === 'run' && currentItem" class="quiz-layout">
      <button type="button" class="back-button quiz-back-button" @click="backToHome">← Zur Szenarioübersicht</button>
      <ScoreBox :current-item-index="currentIndex" :total-items="totalRunItems" :score="score" />

      <ChoiceCard
        v-if="currentItem.type === 'choice'"
        :item="currentItem"
        :selected-answer="selectedAnswer"
        :is-answered="isAnswered"
        :is-last-item="isLastItem"
        @select-answer="selectAnswer"
        @next-item="nextItem"
        @finish="finishRun"
      />

      <OrderedStepsTrainer
        v-else-if="currentItem.type === 'ordered'"
        :item="currentItem"
        :is-last-item="isLastItem"
        @completed="onOrderedCompleted"
        @next-item="nextItem"
        @finish="finishRun"
      />

      <GapInputTrainer
        v-else-if="currentItem.type === 'gap'"
        :item="currentItem"
        :is-last-item="isLastItem"
        @completed="onGapCompleted"
        @next-item="nextItem"
        @finish="finishRun"
      />

      <section v-else class="question-card unsupported-item" role="alert">
        <h2>Dieser Aufgabentyp wird nicht unterstützt.</h2>
        <p class="explanation">Die Aufgabe kann nicht sicher angezeigt werden. Bitte kehre zur Szenarioübersicht zurück.</p>
      </section>
    </section>

    <section v-else-if="view === 'result'" class="result-card">
      <p class="eyebrow">{{ isReviewMode ? 'Wiederholung abgeschlossen' : 'Runde abgeschlossen' }}</p>
      <h2>Ergebnis</h2>

      <div class="result-grid" aria-label="Ergebnisübersicht">
        <div>
          <span>Items</span>
          <strong>{{ totalRunItems }}</strong>
        </div>
        <div>
          <span>Richtig</span>
          <strong>{{ score }}</strong>
        </div>
        <div>
          <span>Falsch</span>
          <strong>{{ wrongCount }}</strong>
        </div>
        <div>
          <span>Prozentwert</span>
          <strong>{{ scorePercentage }}%</strong>
        </div>
      </div>

      <p class="result-message">{{ resultMessage }}</p>
      <p v-if="incorrectItemIds.length === 0" class="perfect-message">
        Alle Items richtig gelöst – keine Wiederholung nötig.
      </p>

      <div class="result-actions">
        <button v-if="incorrectItemIds.length > 0" class="primary-button" type="button" @click="repeatIncorrect">
          Fehler wiederholen
        </button>
        <button class="secondary-button" type="button" @click="restartFullRun">Neu starten</button>
        <button class="secondary-button" type="button" @click="backToHome">Zur Startseite</button>
      </div>
    </section>

    <footer class="app-footer">
      <span>Business English · V1</span>
    </footer>
  </main>
</template>
