<script setup>
// Gefuehrtes Sprechtraining zu einem Diagramm (V1, ohne Aufnahme und ohne automatische Bewertung):
// A selbst versuchen -> B Beispielsaetze zeigen -> C Uebersetzung/Erklaerung optional -> D erneut sprechen.
// Alle Texte kommen aus den privaten Figurendaten und werden nur per Interpolation ausgegeben (kein HTML).
// Es wird nichts gespeichert; der Zustand gilt nur fuer die geoeffnete Aufgabe.
//
// Die Beispielsaetze koennen die Loesung der zugehoerigen Quizaufgabe verraten. Sie sind deshalb erst nach einer
// tatsaechlich abgegebenen Antwort (richtig oder falsch) freigegeben (Prop "unlocked", von App.vue aus dem Antwortablauf
// abgeleitet). Vorher stehen sie weder im DOM noch sind sie ueber den Button erreichbar.
import { computed, ref } from 'vue'

const props = defineProps({
  speaking: { type: Object, required: true },
  uid: { type: String, required: true },
  unlocked: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle'])

const ROLE_LABELS = {
  introduce: 'Diagramm vorstellen',
  initial: 'Ausgangslage',
  development: 'Entwicklung',
  'key-figures': 'Zahlen und Vergleiche',
  summary: 'Kernaussage',
}

const showSamples = ref(false)
const showGerman = ref(false)
const listId = computed(() => `${props.uid}-samples`)
const hintId = computed(() => `${props.uid}-locked`)
// Auch wenn "unlocked" wieder auf false faellt, werden die Saetze sofort ausgeblendet.
const samplesVisible = computed(() => props.unlocked && showSamples.value)
const count = computed(() => props.speaking.sentences.length)

function onToggle(event) {
  emit('toggle', event.target.open)
}
</script>

<template>
  <details class="chart-speaking" @toggle="onToggle">
    <summary>Diagramm auf Englisch beschreiben</summary>
    <div class="chart-speaking-body">
      <p class="chart-speaking-hint"><strong>Selbst versuchen:</strong> Sieh dir das Diagramm an. Versuche zuerst, es in zwei bis drei englischen Sätzen laut zu beschreiben.</p>

      <template v-if="!samplesVisible">
        <button type="button" class="chart-speaking-button" :disabled="!unlocked" :aria-describedby="unlocked ? undefined : hintId" :aria-controls="listId" aria-expanded="false" @click="showSamples = true">{{ count }} Beispielsätze anzeigen</button>
        <p v-if="!unlocked" :id="hintId" class="chart-speaking-small chart-speaking-locked">Beantworte zuerst die Aufgabe. Danach kannst du {{ count === 5 ? 'die fünf Beispielsätze' : 'die Beispielsätze' }} ansehen.</p>
      </template>

      <template v-else>
        <ol :id="listId" class="chart-speaking-list">
          <li v-for="sentence in speaking.sentences" :key="sentence.sentenceId">
            <span class="chart-speaking-role">{{ ROLE_LABELS[sentence.role] }}</span>
            <span class="chart-speaking-en" lang="en">{{ sentence.en }}</span>
            <template v-if="showGerman">
              <span class="chart-speaking-de" lang="de">{{ sentence.de }}</span>
              <span class="chart-speaking-note" lang="de">{{ sentence.note }}</span>
            </template>
          </li>
        </ol>
        <div class="chart-speaking-actions">
          <label class="chart-speaking-toggle"><input v-model="showGerman" type="checkbox" /> Deutsche Übersetzungen und Erklärungen anzeigen</label>
          <button type="button" class="chart-speaking-button chart-speaking-secondary" :aria-controls="listId" aria-expanded="true" @click="showSamples = false; showGerman = false">Beispielsätze ausblenden</button>
        </div>
        <p class="chart-speaking-hint"><strong>Erneut sprechen:</strong> Versuche jetzt, das Diagramm erneut ohne Hilfe zu beschreiben.</p>
      </template>

      <p class="chart-speaking-small">Es gibt keine Aufnahme und keine automatische Bewertung – Aussprache und Formulierung prüfst du selbst.</p>
    </div>
  </details>
</template>
