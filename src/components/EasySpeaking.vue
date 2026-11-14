<script setup>
// W3 – Easy Speaking & Discussion: fuenf Trainingsbereiche mit je einer Uebung auf einmal.
// Die Musterantwort ist jederzeit per Knopfdruck sichtbar - ohne Eingabe, Aufnahme oder vorherige Bewertung.
// Der Lernstatus ("beherrscht" / "noch ueben") wird lokal gespeichert (speakingProgress.js). Alle Texte laufen
// ueber Vue-Interpolation (kein innerHTML).
import { computed, ref, watch } from 'vue'
import SpeakingChart from './SpeakingChart.vue'
import { SPEAKING_CATEGORIES, getSpeakingExercises, shuffleChunks, speakingAudioFile, splitSentences } from '../utils/speakingLibrary.js'
import { SPEAKING_STATUS, loadSpeakingProgress, saveSpeakingProgress, withSpeakingStatus } from '../utils/speakingProgress.js'

const props = defineProps({
  entry: { type: Object, required: true }, // aktive Sprech-Bibliothek { library, fingerprint, ... }
  // Aufnahmen { [dateiname]: { url } }. Eine Uebung zeigt einen Player nur, wenn "<Uebungs-ID>.mp3" tatsaechlich geladen ist
  // (spaeter ergaenzbarer eigener Audio-Pack); ohne Datei wird nichts als verfuegbar dargestellt.
  tracks: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['back'])

const library = props.entry.library
const libraryId = library.libraryId

const categoryId = ref(SPEAKING_CATEGORIES[0].id)
const filter = ref('all') // 'all' | 'practice' | 'mastered'
const index = ref(0)
const answerShown = ref(false)
const picked = ref([]) // Sentence Builder: Indizes der gewaehlten Bausteine in Reihenfolge
const progress = ref(loadSpeakingProgress(libraryId))
const saveFailed = ref(false)

const statusOf = (exercise) => progress.value[exercise.id] ?? null

const categories = computed(() => SPEAKING_CATEGORIES.map((category) => {
  const exercises = getSpeakingExercises(props.entry, category.id)
  return {
    ...category,
    exercises,
    total: exercises.length,
    mastered: exercises.filter((exercise) => statusOf(exercise) === SPEAKING_STATUS.MASTERED).length,
    practice: exercises.filter((exercise) => statusOf(exercise) === SPEAKING_STATUS.PRACTICE).length,
  }
}))
const category = computed(() => categories.value.find((entry) => entry.id === categoryId.value))
const totals = computed(() => ({
  all: library.exercises.length,
  mastered: categories.value.reduce((sum, entry) => sum + entry.mastered, 0),
  practice: categories.value.reduce((sum, entry) => sum + entry.practice, 0),
}))

const filters = computed(() => [
  { id: 'all', label: 'Alle', count: category.value.total },
  { id: 'practice', label: 'Noch üben', count: category.value.practice },
  { id: 'mastered', label: 'Beherrscht', count: category.value.mastered },
])
const exercises = computed(() => {
  if (filter.value === 'all') return category.value.exercises
  const wanted = filter.value === 'practice' ? SPEAKING_STATUS.PRACTICE : SPEAKING_STATUS.MASTERED
  return category.value.exercises.filter((exercise) => statusOf(exercise) === wanted)
})
const current = computed(() => exercises.value[index.value] ?? null)
const currentStatus = computed(() => (current.value ? statusOf(current.value) : null))
const track = computed(() => (current.value ? props.tracks[speakingAudioFile(current.value)] ?? null : null))
const solutionId = computed(() => `speaking-solution-${current.value?.id}`)

watch([categoryId, filter], () => { index.value = 0 })
watch(() => current.value?.id, () => {
  answerShown.value = false
  picked.value = []
})

function jumpLabel(exercise, position) {
  const mark = statusOf(exercise) === SPEAKING_STATUS.MASTERED ? ' ✓' : statusOf(exercise) === SPEAKING_STATUS.PRACTICE ? ' ↻' : ''
  const text = exercise.category === 'sentence_builder' ? exercise.targetSentence : exercise.prompt
  return `${position + 1}. ${text.length > 48 ? `${text.slice(0, 47)}…` : text}${mark}`
}

function go(step) {
  index.value = Math.min(Math.max(index.value + step, 0), exercises.value.length - 1)
}

function jumpTo(event) {
  index.value = Number(event.target.value)
}

// Zufalls-Training: eine andere Uebung aus der aktuellen Auswahl (Bereich + Filter).
function pickRandom() {
  const count = exercises.value.length
  if (count < 2) return
  const other = Math.floor(Math.random() * (count - 1))
  index.value = other >= index.value ? other + 1 : other
}

function mark(status) {
  if (!current.value) return
  progress.value = withSpeakingStatus(progress.value, current.value.id, currentStatus.value === status ? null : status)
  saveFailed.value = !saveSpeakingProgress(libraryId, progress.value)
  // Verlaesst die Uebung durch die Markierung die gefilterte Liste, bleibt die Position gueltig.
  if (index.value >= exercises.value.length) index.value = Math.max(0, exercises.value.length - 1)
}

// ---- Sentence Builder ----
const chunkOrder = computed(() => (current.value?.chunks ? shuffleChunks(current.value) : []))
const availableChunks = computed(() => chunkOrder.value.filter((chunkIndex) => !picked.value.includes(chunkIndex)))
const builtSentence = computed(() => (current.value?.chunks ? picked.value.map((chunkIndex) => current.value.chunks[chunkIndex]).join(' ') : ''))
const builderComplete = computed(() => Boolean(current.value?.chunks) && picked.value.length === current.value.chunks.length)
const builderCorrect = computed(() => builderComplete.value && builtSentence.value === current.value.targetSentence)

function roleLabel(key) {
  return `${key} · ${current.value.roles[key]}`
}
</script>

<template>
  <section class="speaking-view" aria-label="W3 – Easy Speaking &amp; Discussion">
    <button type="button" class="back-button" @click="emit('back')">← Business English W3</button>
    <div class="navigator-heading">
      <p class="eyebrow">Business English W3</p>
      <h2>{{ library.title ?? 'W3 – Easy Speaking & Discussion' }}</h2>
      <p>{{ totals.all }} Übungen · {{ totals.mastered }} beherrscht · {{ totals.practice }} noch üben</p>
    </div>

    <nav class="speaking-tabs" aria-label="Trainingsbereiche">
      <button
        v-for="entry in categories"
        :key="entry.id"
        type="button"
        class="speaking-tab"
        :class="{ 'speaking-tab-active': entry.id === categoryId }"
        :aria-pressed="entry.id === categoryId"
        @click="categoryId = entry.id"
      >
        <span aria-hidden="true">{{ entry.icon }}</span>
        <strong>{{ entry.label }}</strong>
        <small>{{ entry.total }} Übungen · {{ entry.mastered }} ✓</small>
      </button>
    </nav>

    <div class="speaking-filter" role="group" aria-label="Auswahl der Übungen">
      <button
        v-for="option in filters"
        :key="option.id"
        type="button"
        class="speaking-filter-button"
        :class="{ 'speaking-filter-active': option.id === filter }"
        :aria-pressed="option.id === filter"
        @click="filter = option.id"
      >{{ option.label }} ({{ option.count }})</button>
      <button type="button" class="secondary-button speaking-random" :disabled="exercises.length < 2" @click="pickRandom">🎲 Zufällige Übung</button>
    </div>

    <p v-if="!current" class="explanation speaking-empty">
      {{ filter === 'practice' ? 'Hier ist noch nichts zum Wiederholen markiert. Markiere eine Übung mit „Noch üben“, dann erscheint sie hier.' : filter === 'mastered' ? 'Noch keine Übung als „Beherrscht“ markiert.' : 'In diesem Bereich gibt es keine Übungen.' }}
    </p>

    <article v-else class="question-card speaking-card" :aria-label="`${category.label}: Übung ${index + 1} von ${exercises.length}`">
      <div class="speaking-card-head">
        <p class="eyebrow speaking-topic">{{ current.topic }}</p>
        <label class="speaking-jump">
          <span class="practice-progress">Übung {{ index + 1 }} von {{ exercises.length }}</span>
          <select :value="index" aria-label="Zu einer Übung springen" @change="jumpTo">
            <option v-for="(exercise, position) in exercises" :key="exercise.id" :value="position">{{ jumpLabel(exercise, position) }}</option>
          </select>
        </label>
      </div>

      <p class="speaking-prompt" lang="en">{{ current.prompt }}</p>

      <ul v-if="current.roles" class="speaking-roles" aria-label="Rollen">
        <li v-for="(role, key) in current.roles" :key="key"><strong>{{ key }}</strong> {{ role }}</li>
      </ul>

      <SpeakingChart v-if="current.chartData" :key="current.id" :chart-data="current.chartData" :uid="`speaking-chart-${current.id}`" />

      <div v-if="current.chunks" class="speaking-builder">
        <p class="speaking-hint">Deutsch: {{ current.translationDe }}</p>
        <p class="practice-label">Dein Satz</p>
        <div class="speaking-built" aria-live="polite">
          <button v-for="(chunkIndex, position) in picked" :key="chunkIndex" type="button" class="speaking-chunk speaking-chunk-placed" :aria-label="`${current.chunks[chunkIndex]} – entfernen`" @click="picked.splice(position, 1)">{{ current.chunks[chunkIndex] }}</button>
          <span v-if="picked.length === 0" class="practice-small">Tippe unten auf die Satzbausteine in der richtigen Reihenfolge.</span>
        </div>
        <p class="practice-label">Satzbausteine</p>
        <div class="speaking-pool">
          <button v-for="chunkIndex in availableChunks" :key="chunkIndex" type="button" class="speaking-chunk" @click="picked.push(chunkIndex)">{{ current.chunks[chunkIndex] }}</button>
          <span v-if="availableChunks.length === 0" class="practice-small">Alle Bausteine sind gesetzt.</span>
        </div>
        <p v-if="builderComplete" :class="builderCorrect ? 'feedback-correct' : 'feedback-wrong'" role="status">
          {{ builderCorrect ? '✓ Das ist der Zielsatz.' : 'Das ist noch nicht der Zielsatz – tausche Bausteine oder zeige die Musterantwort.' }}
        </p>
        <button type="button" class="secondary-button speaking-reset" :disabled="picked.length === 0" @click="picked = []">Zurücksetzen</button>
      </div>

      <section v-if="current.keywords.length" class="speaking-keywords" aria-label="Keywords">
        <h3 class="speaking-subhead">Keywords</h3>
        <dl class="practice-vocab">
          <div v-for="keyword in current.keywords" :key="keyword.term">
            <dt lang="en">{{ keyword.term }}</dt>
            <dd>{{ keyword.de ?? '' }}</dd>
          </div>
        </dl>
      </section>

      <div v-if="track" class="practice-audio">
        <audio class="practice-audio-player" controls preload="metadata" :src="track.url" :aria-label="`Aufnahme: ${current.id}`" />
      </div>

      <div class="practice-solution">
        <button type="button" class="secondary-button practice-solution-toggle" :aria-expanded="answerShown" :aria-controls="solutionId" @click="answerShown = !answerShown">
          {{ answerShown ? 'Musterantwort ausblenden' : 'Musterantwort anzeigen' }}
        </button>
        <div v-if="answerShown" :id="solutionId" class="practice-solution-body speaking-solution" role="region" aria-label="Musterantwort">
          <template v-if="current.turns">
            <h4>Musterdialog</h4>
            <ol class="speaking-dialog">
              <li v-for="(turn, position) in current.turns" :key="position" :class="`speaking-turn speaking-turn-${turn.speaker === Object.keys(current.roles)[0] ? 'first' : 'second'}`">
                <strong class="speaking-speaker">{{ roleLabel(turn.speaker) }}</strong>
                <span class="practice-solution-en" lang="en">{{ turn.text }}</span>
                <small v-if="turn.de" class="speaking-turn-de">{{ turn.de }}</small>
              </li>
            </ol>
          </template>
          <template v-else-if="current.chunks">
            <h4>Zielsatz</h4>
            <p class="practice-solution-en" lang="en">{{ current.targetSentence }}</p>
            <template v-if="current.pattern">
              <h4>Muster</h4>
              <p>{{ current.pattern }}</p>
            </template>
          </template>
          <template v-else-if="current.category === 'business_discussion'">
            <h4>Einfache Argumente</h4>
            <ul class="speaking-arguments" lang="en">
              <li v-for="(sentence, position) in splitSentences(current.modelAnswer)" :key="position">{{ sentence }}</li>
            </ul>
            <h4>Deutsch</h4>
            <p>{{ current.translationDe }}</p>
          </template>
          <template v-else>
            <h4>Musterantwort</h4>
            <p class="practice-solution-en" lang="en">{{ current.modelAnswer }}</p>
            <h4>Deutsch</h4>
            <p>{{ current.translationDe }}</p>
          </template>
        </div>
      </div>

      <div class="speaking-status" role="group" aria-label="Lernstatus">
        <button type="button" class="secondary-button speaking-status-button speaking-status-mastered" :aria-pressed="currentStatus === 'mastered'" @click="mark('mastered')">✓ Beherrscht</button>
        <button type="button" class="secondary-button speaking-status-button speaking-status-practice" :aria-pressed="currentStatus === 'practice'" @click="mark('practice')">↻ Noch üben</button>
      </div>
      <p v-if="saveFailed" class="feedback-wrong" role="alert">Der Lernstand konnte in diesem Browser nicht gespeichert werden und gilt nur für diese Sitzung.</p>

      <div class="practice-nav">
        <button type="button" class="secondary-button" :disabled="index === 0" @click="go(-1)">← Vorherige Aufgabe</button>
        <button type="button" class="primary-button speaking-next" :disabled="index >= exercises.length - 1" @click="go(1)">Nächste Aufgabe →</button>
      </div>
    </article>
  </section>
</template>
