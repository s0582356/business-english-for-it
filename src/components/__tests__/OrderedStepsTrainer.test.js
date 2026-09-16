import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OrderedStepsTrainer from '../OrderedStepsTrainer.vue'

const item = {
  id: 'tel-ordered-01',
  type: 'ordered',
  intent: 'dialog-reconstruction',
  category: 'Business Telephoning',
  prompt: 'Bring these steps into the correct order.',
  steps: [
    { id: 'greet', label: 'Good morning, this is Mark Weber.' },
    { id: 'reason', label: 'I am calling about our meeting.' },
  ],
  correctOrder: ['greet', 'reason'],
  explanation: 'Eröffnung kommt vor dem Anliegen.',
  stepFeedback: { reason: 'Das Anliegen folgt erst nach der Vorstellung.' },
}

function correctLabelsOf(testItem) {
  return testItem.correctOrder.map((id) => testItem.steps.find((step) => step.id === id).label)
}

function displayedLabels(wrapper) {
  return wrapper.findAll('.process-step-label').map((el) => el.text())
}

describe('OrderedStepsTrainer - Startreihenfolge (Finding 1)', () => {
  it('startet bei zwei Schritten NICHT bereits in correctOrder, sondern in der einzigen Alternative', () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })
    const correctLabels = correctLabelsOf(item)

    expect(displayedLabels(wrapper)).not.toEqual(correctLabels)
    // Bei genau zwei Schritten gibt es nur eine einzige alternative Permutation.
    expect(displayedLabels(wrapper)).toEqual([...correctLabels].reverse())
  })

  it('tauscht deterministisch zwei Elemente, falls der Shuffle zufällig genau correctOrder ergäbe', () => {
    // Math.random so mocken, dass Fisher-Yates jeden Swap mit sich selbst
    // ausführt (kein tatsächliches Mischen) - ohne Fallback wäre das
    // Ergebnis exakt correctOrder. Kein erneutes Shuffeln, keine Schleife:
    // die Komponente muss stattdessen deterministisch Position 0/1 tauschen.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    try {
      const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })
      const correctLabels = correctLabelsOf(item)

      expect(displayedLabels(wrapper)).not.toEqual(correctLabels)
      // Bei zwei Schritten ist der Tausch von Position 0/1 exakt die Umkehrung.
      expect(displayedLabels(wrapper)).toEqual([...correctLabels].reverse())
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('startet auch bei mehr Schritten zuverlässig nicht bereits in correctOrder (mehrfach geprüft)', () => {
    const largerItem = {
      ...item,
      id: 'tel-ordered-large',
      steps: [
        { id: 's1', label: 'Step one.' },
        { id: 's2', label: 'Step two.' },
        { id: 's3', label: 'Step three.' },
        { id: 's4', label: 'Step four.' },
      ],
      correctOrder: ['s1', 's2', 's3', 's4'],
      stepFeedback: undefined,
    }
    const correctLabels = correctLabelsOf(largerItem)

    for (let attempt = 0; attempt < 25; attempt++) {
      const wrapper = mount(OrderedStepsTrainer, { props: { item: largerItem, isLastItem: false } })
      const shown = displayedLabels(wrapper)
      expect(shown).not.toEqual(correctLabels)
      expect([...shown].sort()).toEqual([...correctLabels].sort())
    }
  })

  it('erzeugt beim Wechsel auf ein neues Item eine neue, ebenfalls nicht bereits korrekte Startreihenfolge', async () => {
    const otherItem = {
      ...item,
      id: 'tel-ordered-02',
      steps: [
        { id: 'a', label: 'First line.' },
        { id: 'b', label: 'Second line.' },
      ],
      correctOrder: ['a', 'b'],
      stepFeedback: undefined,
    }
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })

    await wrapper.setProps({ item: otherItem })

    const correctLabelsOther = correctLabelsOf(otherItem)
    expect(displayedLabels(wrapper)).not.toEqual(correctLabelsOther)
    expect([...displayedLabels(wrapper)].sort()).toEqual([...correctLabelsOther].sort())
  })

  it('mutiert weder item.steps noch item.correctOrder beim Initialisieren oder Umsortieren', async () => {
    const stepsBefore = JSON.stringify(item.steps)
    const correctOrderBefore = JSON.stringify(item.correctOrder)
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })

    const upButtons = wrapper.findAll('button[aria-label="Nach oben verschieben"]')
    await upButtons[1].trigger('click')
    await wrapper.find('.primary-button').trigger('click')

    expect(JSON.stringify(item.steps)).toBe(stepsBefore)
    expect(JSON.stringify(item.correctOrder)).toBe(correctOrderBefore)
  })
})

describe('OrderedStepsTrainer - Auswertung', () => {
  it('kann durch Sortieren die korrekte Reihenfolge erreichen und wird als richtig erkannt', async () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })
    // Start ist garantiert die umgekehrte Reihenfolge (siehe Finding-1-Tests) -
    // einmal nach oben schieben stellt die korrekte Reihenfolge her.
    const upButtons = wrapper.findAll('button[aria-label="Nach oben verschieben"]')
    await upButtons[1].trigger('click')
    await wrapper.find('.primary-button').trigger('click')

    expect(wrapper.emitted('completed')[0][0]).toEqual({ id: 'tel-ordered-01', correct: true })
    expect(wrapper.find('.feedback-correct').exists()).toBe(true)
  })

  it('erkennt eine falsche Reihenfolge, zeigt Schritt-Feedback und die vollständige richtige Reihenfolge (Finding 2)', async () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })
    // Ohne Umsortieren prüfen: der Start ist bereits garantiert falsch (Finding 1).
    await wrapper.find('.primary-button').trigger('click')

    expect(wrapper.emitted('completed')[0][0]).toEqual({ id: 'tel-ordered-01', correct: false })
    expect(wrapper.find('.feedback-wrong').exists()).toBe(true)
    expect(wrapper.text()).toContain('Das Anliegen folgt erst nach der Vorstellung.')

    const revealed = wrapper.findAll('.correct-order-list li').map((li) => li.text())
    expect(revealed).toEqual(correctLabelsOf(item))
  })

  it('deaktiviert ▲ beim ersten und ▼ beim letzten Schritt', () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })
    const upButtons = wrapper.findAll('button[aria-label="Nach oben verschieben"]')
    const downButtons = wrapper.findAll('button[aria-label="Nach unten verschieben"]')
    expect(upButtons[0].attributes('disabled')).toBeDefined()
    expect(downButtons[downButtons.length - 1].attributes('disabled')).toBeDefined()
  })

  it('emittiert "finish" statt "next-item" beim letzten Item', async () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: true } })
    await wrapper.find('.primary-button').trigger('click')

    expect(wrapper.text()).toContain('Ergebnis anzeigen')
    await wrapper.find('.feedback-box .primary-button').trigger('click')
    expect(wrapper.emitted('finish')).toBeTruthy()
    expect(wrapper.emitted('next-item')).toBeFalsy()
  })
})
