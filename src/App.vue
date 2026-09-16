<script setup>
import { computed, ref } from 'vue'
import PrivateContentImporter from './components/PrivateContentImporter.vue'
import ScoreBox from './components/ScoreBox.vue'
import ChoiceCard from './components/ChoiceCard.vue'
import OrderedStepsTrainer from './components/OrderedStepsTrainer.vue'
import { getRunSummary, saveRunSummary } from './utils/progressStorage.js'

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

// Langfristige V1-Bereiche. Nur "telephoning" ist in diesem Slice aktiv -
// die anderen werden bewusst als "kommt in V1" markiert, nicht verborgen.
const areas = [
  { id: 'vocabulary', icon: '📚', title: 'Vocabulary & Phrases', available: false },
  { id: 'socialising', icon: '💬', title: 'Socialising & Opinions', available: false },
  { id: 'telephoning', icon: '📞', title: 'Business Telephoning', available: true },
  { id: 'email', icon: '✉️', title: 'Email Writing', available: false },
]

const view = ref('home') // 'home' | 'run' | 'result'

const allItems = ref([])
const fileName = ref(null)
const fingerprint = ref(null)
const lastRunSummary = ref(null)

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

function onItemsLoaded({ items, fileName: importedFileName, fingerprint: importedFingerprint }) {
  allItems.value = items
  fileName.value = importedFileName
  fingerprint.value = importedFingerprint
  lastRunSummary.value = getRunSummary(importedFingerprint)
  startRun(items)
}

function recordAnswer(id, correct) {
  answeredLog.value.push({ id, correct })
  if (correct) score.value++
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

function nextItem() {
  currentIndex.value++
  selectedAnswer.value = null
  isAnswered.value = false
}

function finishRun() {
  view.value = 'result'
  if (fingerprint.value) {
    saveRunSummary(fingerprint.value, {
      fileName: fileName.value,
      itemCount: totalRunItems.value,
      score: score.value,
      incorrectItemIds: incorrectItemIds.value,
      completedAt: new Date().toISOString(),
    })
    lastRunSummary.value = getRunSummary(fingerprint.value)
  }
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
  view.value = 'home'
}

function formatSavedAt(value) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
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
      <p class="intro">
        Vokabular, Socialising, Telefonate und E-Mails für Studium, Praktikum und IT-Beruf.
        Dieser erste Bereich: <strong>Business Telephoning</strong>.
      </p>
    </header>

    <section v-if="view === 'home'" class="home-view">
      <div class="area-grid">
        <article
          v-for="area in areas"
          :key="area.id"
          class="area-card"
          :class="{ 'area-card-disabled': !area.available }"
        >
          <span class="area-card-icon" aria-hidden="true">{{ area.icon }}</span>
          <h2>{{ area.title }}</h2>
          <span v-if="area.available" class="area-card-badge area-card-badge-active">Aktiv</span>
          <span v-else class="area-card-badge area-card-badge-soon">Kommt in V1</span>
        </article>
      </div>

      <section v-if="lastRunSummary" class="last-run-card" aria-label="Letzte Lernrunde">
        <p>
          Zuletzt geübt: <strong>{{ lastRunSummary.fileName }}</strong> ·
          {{ lastRunSummary.score }}/{{ lastRunSummary.itemCount }} richtig ·
          <time :datetime="lastRunSummary.completedAt">{{ formatSavedAt(lastRunSummary.completedAt) }}</time>
        </p>
      </section>

      <PrivateContentImporter @items-loaded="onItemsLoaded" />

      <p v-if="allItems.length === 0" class="empty-hint">
        Noch kein Lernpaket geladen. Wähle oben eine private JSON-Datei mit Telephoning-Items aus, um zu starten.
      </p>
    </section>

    <section v-else-if="view === 'run' && currentItem" class="quiz-layout">
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
        v-else
        :item="currentItem"
        :is-last-item="isLastItem"
        @completed="onOrderedCompleted"
        @next-item="nextItem"
        @finish="finishRun"
      />
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
      <span>Business English · V1-Slice</span>
      <span>Telephoning</span>
    </footer>
  </main>
</template>
