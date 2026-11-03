import { describe, expect, it } from 'vitest'
import { CHECK_POSITIONS, ERROR_TAGS, NOT_CHECKED, checkConditionalType1, checkSentence, compareAttempts, didImprove, isStructureSuccess, validateCheckConfig } from '../coachSentenceCheck.js'

const check = (sentence, position = 'any', references = []) => checkConditionalType1(sentence, { position, references })
const states = (result) => Object.fromEntries(result.items.map((entry) => [entry.id, entry.state]))

describe('Strukturcheck Conditional Type 1: sicher erkannte Fehler', () => {
  it.each([
    ['If the scanner fails we will call the engineer.', 'start', 'missing-comma'],
    ['If the scanner fails then we will call the engineer.', 'start', 'missing-comma'],
    ['We will reschedule the call if the vendor cannot join.', 'start', 'wrong-position'],
    ['If the vendor cannot join, we will reschedule the call.', 'end', 'wrong-position'],
    ['If the scanner fails,', 'start', 'no-main-clause'],
    ['If', 'any', 'empty-if-part'],
    ['We will call you if', 'any', 'empty-if-part'],
    ['We will call the engineer.', 'any', 'no-if'],
    ['Wenn das Backup fehlschlägt, rufen wir an.', 'any', 'no-if'],
  ])('%s (%s) -> %s', (sentence, position, tag) => {
    const result = check(sentence, position)
    expect(result.outcome).toBe('issues')
    expect(result.tags).toContain(tag)
    expect(ERROR_TAGS).toContain(tag)
  })

  it('jeder Fehler hat eine verstaendliche deutsche Meldung und der Check nennt, was er nicht prueft', () => {
    const result = check('If the scanner fails we will call the engineer.', 'start')
    const problem = result.items.find((entry) => entry.state === 'problem')
    expect(problem.message).toMatch(/Komma/)
    expect(result.notChecked).toBe(NOT_CHECKED)
    expect(NOT_CHECKED.join(' ')).toMatch(/Rechtschreibung/)
    expect(NOT_CHECKED.join(' ')).toMatch(/-s bei he\/she\/it/)
  })
})

describe('Strukturcheck: Struktur erfuellt (nicht: grammatisch korrekt)', () => {
  it('erkennt vollstaendige Saetze mit if vorn und hinten', () => {
    expect(check('If the deploy fails, we will page the duty engineer.', 'start').outcome).toBe('met')
    expect(check('We will reschedule the call if the vendor cannot join.', 'end').outcome).toBe('met')
    expect(states(check('We will reschedule the call if the vendor cannot join.', 'end'))).toMatchObject({ comma: 'na', position: 'ok' })
  })

  it('Struktur erfuellt bedeutet nicht Grammatikpruefung: Verbfehler, Rechtschreibung und Unsinn werden NICHT bemerkt', () => {
    // fehlendes -s, falsche Verbform, Tippfehler: der Strukturcheck sagt trotzdem "met" - und das ist ehrlich so gemeint
    for (const sentence of ['If the scanner fail, we will notify the engineer.', 'If the scaner fails, we will notify the enginer.', 'If the moon fails, we will notify the banana.']) {
      expect(check(sentence, 'start').outcome).toBe('met')
    }
    expect(isStructureSuccess(check('If the scanner fails, we will notify the engineer.', 'start'))).toBe(true)
  })
})

describe('Strukturcheck: zulaessige Varianten werden nie als sicherer Fehler abgelehnt', () => {
  const valid = [
    'If the vendor accepts, we can begin the rollout on Monday.',
    "We will lose the contract if we don't answer the tender.",
    'Please call me if the server goes down.',
    'If the deploy fails, call the duty engineer.',
    "If the build fails, don't deploy.",
    'If you can help, I will finish earlier.',
    "If the tenant doesn't sign by Monday, we can offer the flat elsewhere.",
    "Unless we receive more time, we won't accept a new order.",
    'If it rains, the match is cancelled.',
    "If you'll excuse me, I will leave.",
    'If you will wait here, I will get the manager.',
    'If the server is down, we should inform the client.',
    "We'll restart the server if the scanner fails.",
    "If everything works, we won't need a rollback.",
    'The call will be moved if the vendor does not join.',
    'If we find a bug, we are going to fix it.',
    'If I were you, I would call the client.',
    "If he won't listen, we will escalate it.",
    'Also, if the scanner fails, we will call.',
    'If the client says no, then we will stop.',
    'If A and B fail, we will call.',
  ]
  it.each(valid)('%s', (sentence) => {
    const result = check(sentence)
    expect(result.outcome, JSON.stringify(result.items.map((entry) => `${entry.id}:${entry.state}`))).not.toBe('issues')
    expect(result.tags).toEqual([])
  })

  it('Aufforderung, Modalverben, Verneinung und Kurzformen zaehlen als erkennbarer Hauptsatz', () => {
    for (const sentence of ['If the build fails, call the team.', 'If the build fails, we can retry.', "If the build fails, we shouldn't deploy.", "If the build fails, we'll retry."]) {
      expect(states(check(sentence, 'start')).main, sentence).toBe('ok')
    }
  })
})

describe('Strukturcheck: unsichere Faelle sind "nicht zuverlaessig pruefbar", kein Urteil', () => {
  it.each([
    ['If the deploy fails, the duty engineer gets an alert.', 'main'],
    ['If the scanner fails.', 'comma'],
    ['Unless we receive more time, we accept no order.', 'ifPart'],
    ['When the scanner fails, we will call.', 'ifPart'],
    ['If it rains and if it snows, we will stay.', 'ifPart'],
    ['Also, if the scanner fails, we will call.', 'position'],
    ['If the scanner fails we call you.', 'will'],
    ["If the vendor won't join, we will move it.", 'will'],
    ['If you will wait, I will help.', 'will'],
  ])('%s', (sentence, item) => {
    const position = item === 'position' ? 'start' : 'any'
    const result = check(sentence, position)
    expect(states(result)[item]).toBe('unsure')
    expect(result.outcome).not.toBe('met')
    expect(result.outcome).not.toBe('issues')
  })

  it('unvollstaendiger Satz bekommt einen hilfreichen Hinweis statt einer pauschalen Fehlermeldung', () => {
    const result = check('If the scanner fails.', 'start')
    expect(result.items.find((entry) => entry.state === 'unsure').message).toMatch(/Komma|Hauptsatz/)
  })
})

describe('Strukturcheck: Position, Kopieren und Konfiguration', () => {
  it('Position wird nur geprueft, wenn die Aufgabe sie verlangt', () => {
    expect(states(check('We will go if it rains.', 'any')).position).toBe('ok')
    expect(states(check('We will go if it rains.', 'start')).position).toBe('problem')
    expect(states(check('If it rains, we will go.', 'end')).position).toBe('problem')
  })

  it('wortgleiche Uebernahme (auch mit anderer Gross-/Kleinschreibung und Satzzeichen) wird erkannt, ein eigener Satz nicht', () => {
    const references = ['If the printer jams, we will clear the paper.']
    const copied = check('if the printer jams we will clear the paper', 'any', references)
    expect(copied.copied).toBe(true)
    expect(copied.tags).toContain('copy-of-example')
    expect(copied.outcome).toBe('issues')
    expect(isStructureSuccess(copied)).toBe(false)
    const own = check('If the printer jams, we will replace the tray.', 'any', references)
    expect(own.copied).toBe(false)
    expect(own.outcome).toBe('met')
  })

  it('keine Mindestwortzahl als Grammatikregel: sehr kurze, aber vollstaendige Saetze sind in Ordnung', () => {
    expect(check('If it fails, call.', 'start').outcome).toBe('met')
  })

  it('checkSentence ignoriert unbekannte Pruefarten, validateCheckConfig prueft die Konfiguration', () => {
    expect(checkSentence({ type: 'unbekannt', position: 'any' }, 'If x, y.')).toBeNull()
    expect(checkSentence({ type: 'conditional-type-1', position: 'any' }, 'If it fails, we will call.').outcome).toBe('met')
    expect(validateCheckConfig({ type: 'conditional-type-1', position: 'start' })).toBeNull()
    expect(validateCheckConfig({ type: 'x', position: 'start' })).toMatch(/type/)
    expect(validateCheckConfig({ type: 'conditional-type-1', position: 'mitte' })).toMatch(/position/)
    expect(validateCheckConfig(null)).toMatch(/Objekt/)
    expect(CHECK_POSITIONS).toEqual(['start', 'end', 'any'])
  })
})

describe('Strukturcheck 046: reproduzierte Gegenbeispiele (nur sicher erkennbare Probleme sind sichere Fehler)', () => {
  const noSureError = (sentence, position = 'any') => {
    const result = check(sentence, position)
    expect(result.tags, sentence).toEqual([])
    return result
  }

  it.each([
    'If the server fails, will.',
    'If the server fails, please.',
    'If the server fails, we will.',
    'If the server fails, we will not.',
    "If the server fails, we can't.",
    'If the server fails, please,',
    'If the server fails, we are going to.',
  ])('Fragment: %s -> nicht "met", kein sicherer Fehler, Hauptsatz als unvollstaendig gekennzeichnet', (sentence) => {
    const result = noSureError(sentence, 'start')
    expect(result.outcome).toBe('unclear')
    expect(states(result).main).toBe('unsure')
    expect(result.items.find((entry) => entry.id === 'main').message).toMatch(/unvollständig|Hauptsatz/)
  })

  it.each([
    ['If the will of the client changes, we will call.', 'will'],
    ['If his will is unclear, we will call the lawyer.', 'will'],
    ['If the server that will host the app fails, we will call.', 'will'],
    ['If the server (which will restart) fails, we will call.', 'will'],
    ['If the server, which will restart, fails, we will call.', 'will'],
    ['If the client who will pay later cancels, we will call.', 'will'],
    ['If the server fails, the will of the team decides.', 'main'],
    ['If the server fails, free will helps.', 'main'],
  ])('will als Substantiv oder im Nebensatz: %s', (sentence, item) => {
    const result = noSureError(sentence, 'start')
    expect(result.outcome).toBe('unclear')
    expect(states(result)[item]).toBe('unsure')
  })

  it.each([
    'If, as planned, the server fails, we will call.',
    'If, however, the server fails, we will call.',
    'If the server, which runs nightly, fails, we will call.',
    'If the server fails, again, we will call.',
    'If the server – which runs nightly – fails, we will call.',
  ])('Einschub oder eingebettetes Komma nach if: %s -> nie empty-if-part oder ein anderer sicherer Fehler', (sentence) => {
    const result = noSureError(sentence, 'start')
    expect(result.outcome).not.toBe('issues')
    expect(states(result).ifPart).toBe('ok')
  })

  it('"empty-if-part" nur, wenn nach "if" gar kein Wort steht', () => {
    for (const sentence of ['If', 'If.', 'If,', 'We will call you if']) expect(check(sentence).tags, sentence).toEqual(['empty-if-part'])
    expect(check('If, however, we will call.').tags).toEqual([])
  })

  it.each([
    ['Please call me if the server fails.', 'end'],
    ['Call me if the server fails.', 'end'],
    ['If the server fails, please call me.', 'start'],
    ["If the server fails, don't deploy.", 'start'],
    ["If the server doesn't start, we won't wait.", 'start'],
    ['If the server fails, we may need to restart it.', 'start'],
    ['If the server fails, we have to restart it.', 'start'],
    ['If the server fails, we are going to restart it.', 'start'],
    ["If the server fails, we shouldn't deploy.", 'start'],
    ["If the server fails, we can't wait.", 'start'],
    ['If the server fails, we must not wait.', 'start'],
    ['If the server fails, you ought to call me.', 'start'],
    ['We might restart it if the server fails.', 'end'],
  ])('zulaessige Variante bleibt "met": %s', (sentence, position) => {
    expect(check(sentence, position).outcome, sentence).toBe('met')
  })

  it('mehrdeutige Hauptsaetze (Nomen am Satzanfang, die wie Aufforderungen aussehen) sind nicht "met"', () => {
    for (const sentence of ['If the server fails, log files help.', 'If the server fails, update times vary.', 'If the server fails, start times change.']) {
      expect(noSureError(sentence, 'start').outcome, sentence).toBe('unclear')
    }
  })

  it('sichere Fehler bleiben sicher, wenn der Satz sauber gebaut ist', () => {
    expect(check('If the scanner fails we will call.', 'start').tags).toEqual(['missing-comma'])
    expect(check('If the scanner fails,', 'start').tags).toEqual(['no-main-clause'])
  })

  it('"met" nennt nur die geprueften Merkmale: jede Antwort traegt die Liste dessen, was nicht geprueft wurde', () => {
    const result = check('If the scanner fail, we will notify the team.', 'start')
    expect(result.outcome).toBe('met')
    expect(result.notChecked).toEqual(NOT_CHECKED)
    expect(result.items.every((entry) => entry.message && !/korrekt|richtig/i.test(entry.message))).toBe(true)
  })
})

describe('Strukturcheck 046: Verbesserung zwischen erster und zweiter Fassung (alle Uebergaenge)', () => {
  const result = (outcome, tags = [], copied = false) => ({ outcome, tags, copied })
  const cmp = (a, b, changed = true) => compareAttempts(a, b, { changed })

  it.each([
    // [von, nach, erwartet]
    [result('issues', ['will-in-if']), result('met'), 'improved'],
    [result('unclear'), result('met'), 'improved'],
    [result('issues', ['will-in-if']), result('unclear'), 'partial'], // kein nachgewiesener Erfolg
    [result('issues', ['will-in-if', 'missing-comma']), result('issues', ['missing-comma']), 'partial'],
    [result('issues', ['will-in-if']), result('issues', ['will-in-if']), 'none'],
    [result('issues', ['missing-comma']), result('issues', ['will-in-if', 'missing-comma']), 'none'],
    [result('issues', ['will-in-if']), result('issues', ['wrong-position']), 'none'], // gleich viele Fehler, andere Art
    [result('unclear'), result('unclear'), 'none'],
    [result('unclear'), result('issues', ['no-if']), 'none'],
    [result('met'), result('met'), 'none'],
    [result('met'), result('unclear'), 'none'],
    [result('met'), result('issues', ['will-in-if']), 'none'],
  ])('%j -> %j: %s', (first, second, expected) => {
    expect(cmp(first, second)).toBe(expected)
    expect(didImprove(first, second, { changed: true })).toBe(expected === 'improved')
  })

  it('unveraenderter Satz und kopierte Musterloesung gelten nie als Verbesserung oder Teilfortschritt', () => {
    expect(cmp(result('issues', ['will-in-if']), result('met'), false)).toBe('none')
    expect(cmp(result('issues', ['will-in-if']), result('issues', [], true))).toBe('none')
    expect(cmp(result('issues', ['will-in-if', 'missing-comma']), result('issues', ['copy-of-example'], true))).toBe('none')
    expect(cmp(null, result('met'))).toBe('none')
    expect(cmp(result('issues'), null)).toBe('none')
  })

  it('echte Saetze: issues -> met ist Verbesserung der Struktur, issues -> unclear nur Teilfortschritt, Abschreiben nie', () => {
    const references = ['If the test fails, we will stop the release.']
    const first = check('If the test will fail we will stop the work', 'start', references)
    expect(cmp(first, check('If the test fails, we will stop the work', 'start', references))).toBe('improved')
    expect(cmp(first, check('Unless the test passes, we stop the work', 'start', references))).toBe('partial') // issues -> unclear: nur Teilfortschritt
    expect(cmp(first, check('If the test fails, we will stop the release.', 'start', references))).toBe('none') // kopiert
  })

  it('Satz ohne sichere Fehler, aber nicht bestaetigbar: partial (issues -> unclear)', () => {
    const first = check('We stop the work if the test fails', 'start') // wrong-position
    const second = check('If the test fails, the team stops the work', 'start')
    expect([first.outcome, second.outcome]).toEqual(['issues', 'unclear'])
    expect(cmp(first, second)).toBe('partial')
  })
})

describe('Strukturcheck 048: will als Substantiv/Name und unvollstaendige Hauptsaetze (Codex-Gegenbeispiele)', () => {
  const sure = (sentence, position = 'start') => check(sentence, position).tags

  it.each([
    "If the client's will is valid, we will proceed.",
    'If the team’s will changes, we will adapt.', // typografischer Apostroph
    "If the clients' will is valid, we will proceed.", // Plural-Possessiv
    'If Will agrees, we will proceed.',
    'If Mr Will agrees, we will proceed.',
    'If Will and Anna agree, we will proceed.',
    'If WILL agrees, we will proceed.',
    'If will agrees, we will proceed.',
  ])('Possessiv/Eigenname vor oder als "will": %s -> kein sicherer Fehler, unklar', (sentence) => {
    const result = check(sentence, 'start')
    expect(result.tags, sentence).toEqual([])
    expect(result.outcome).toBe('unclear')
    expect(states(result).will).toBe('unsure')
  })

  it('seit 052: ein "will" im if-Teil ist nie ein sicherer Fehler (Hilfsverb, Substantiv, Name oder Bereitschaft sind lokal nicht unterscheidbar)', () => {
    for (const sentence of ['If the client will pay, we will proceed.', 'If the scanner will fail, we will call.', "If the scanner'll fail, we will call.", 'If the vendor will not join, we will move it.']) {
      expect(sure(sentence), sentence).toEqual([])
      expect(check(sentence, 'start').outcome).toBe('unclear')
    }
    expect(sure('We will call you if the scanner will fail.', 'end')).toEqual([])
  })

  it.each([
    'If the server fails, will restart.',
    'If the server fails, please database.',
    'If the server fails, can database.',
    'If the server fails, we will database.',
    'If the server fails, we will the team.',
    'If the server fails, we can to the team.',
    'If the server fails, please the team.',
  ])('unvollstaendiger oder unklarer Hauptsatz: %s -> nie "met", kein sicherer Fehler', (sentence) => {
    const result = check(sentence, 'start')
    expect(result.outcome, sentence).toBe('unclear')
    expect(result.tags).toEqual([])
    expect(states(result).main).toBe('unsure')
  })

  it('Hilfsverb allein oder am Satzanfang bestaetigt keinen Hauptsatz; mit erkanntem Verb schon', () => {
    for (const sentence of ['We will call you if the server fails.', "We'll call you if the server fails.", 'If the server fails, we will restart it.', 'If the server fails, we will retry.', 'If the server fails, please restart it.', 'If the server fails, please call me.']) {
      expect(states(check(sentence)).main, sentence).toBe('ok')
    }
    for (const sentence of ['Will restart if the server fails.', 'If the server fails, will restart.', 'If the server fails, may restart.']) {
      expect(states(check(sentence)).main, sentence).toBe('unsure')
    }
  })

  it('adversarial: Substantive und Verben mit gleicher Schreibweise, Eigennamen im Hauptsatz, verkuerzte Saetze', () => {
    for (const sentence of [
      'If the server fails, call times increase.', // call = Substantiv
      'If the server fails, help desk staff help.', // help = Substantiv
      'If the server fails, Will restarts it.', // Eigenname, kein Hilfsverb
      'If the server fails, we ask Will to restart it.',
      'If the server fails, log files grow.', // log = Substantiv
      'If the server fails, stop signs appear.',
    ]) {
      const result = check(sentence, 'start')
      expect(result.tags, sentence).toEqual([])
      expect(result.outcome, sentence).toBe('unclear')
    }
    expect(check('If it fails, restart.', 'start').outcome).toBe('met') // verkuerzter Aufforderungssatz mit erkanntem Verb
    expect(check('If the server fails, we will.', 'start').outcome).toBe('unclear')
  })

  it('adversarial: ungewoehnliche Satzzeichen statt Komma sind unklar, nie ein sicherer Fehler', () => {
    for (const sentence of ['If the server fails; we will call.', 'If the server fails - we will call.', 'If the server fails: we will call.', 'If the server fails… we will call.', 'If the server (fails) we will call.']) {
      const result = check(sentence, 'start')
      expect(result.tags, sentence).toEqual([])
      expect(result.outcome).toBe('unclear')
    }
    expect(check('If the server fails,, we will call.', 'start').tags).toEqual([]) // Tippfehler im Komma: kein sicherer Fehler
    expect(check('If the server fails we will call.', 'start').tags).toEqual(['missing-comma']) // einfach fehlendes Komma bleibt sicher
  })

  it('adversarial: Negationen, Modalvarianten, Einschuebe und Relativsaetze', () => {
    expect(check("If the server doesn't fail, we won't call.", 'start').outcome).toBe('met')
    expect(check("If the server fails, we can't wait.", 'start').outcome).toBe('met')
    expect(check('If the server fails, we must not wait.', 'start').outcome).toBe('met')
    expect(check('If the server, which will restart, fails, we will call.', 'start').outcome).toBe('unclear')
    expect(check('If the client who will pay later cancels, we will call.', 'start').tags).toEqual([])
    expect(check('If the server fails, we will call, or we will restart.', 'start').tags).toEqual([])
    expect(check('If, as planned, the server fails, we will call.', 'start').tags).toEqual([])
  })

  it('"met" bestaetigt nur geprueften Aufbau: Verbformfehler bleiben unbemerkt (das ist ausdruecklich keine Grammatikpruefung)', () => {
    const result = check('If the scanner fail, we will notify the team.', 'start')
    expect(result.outcome).toBe('met')
    expect(result.notChecked).toEqual(NOT_CHECKED)
  })
})

describe('Strukturcheck 050/052: mehrdeutiges "will" - nie ein sicherer Fehler', () => {
  const tags = (sentence, position = 'start') => check(sentence, position).tags
  const willState = (sentence, position = 'start') => states(check(sentence, position)).will

  it.each([
    // Codex 049
    'If public will changes, we will adapt.',
    'If collective will changes, we will adapt.',
    // weitere Nominalgruppen mit "will" als Substantiv, ohne Wortliste gedacht: Adjektiv/Substantiv + will + finites Wort
    'If popular will changes, we will adapt.',
    'If general will shifts, we will adapt.',
    'If political will fades, we will adapt.',
    'If national will weakens, we will adapt.',
    'If free will matters, we will adapt.',
    'If good will is shown, we will proceed.',
    'If the public will changes, we will adapt.',
    'If the collective will changes, we will adapt.',
    'If the whole will was changed, we will proceed.',
    "If the client's will is valid, we will proceed.",
    "If the team\u2019s will changes, we will adapt.",
    "If the clients' will is valid, we will proceed.",
    // ohne Artikel/Pronomen vor "will": nicht sicher als Hilfsverb erkennbar, auch mit Grundform danach
    'If public will change, we will adapt.',
    'If collective will remain strong, we will adapt.',
    'If customers will pay late, we will adapt.',
    'If Anna will pay late, we will adapt.',
    // Eigennamen
    'If Will agrees, we will proceed.',
    'If Anna Will agrees, we will proceed.',
    'If Mr Will agrees, we will proceed.',
    'If Will Smith agrees, we will proceed.',
    'If WILL agrees, we will proceed.',
    'If will agrees, we will proceed.',
  ])('Substantiv/Name/unklare Wortart: %s -> unclear, nie will-in-if', (sentence) => {
    const result = check(sentence, 'start')
    expect(result.tags, sentence).toEqual([])
    expect(result.outcome).toBe('unclear')
    expect(willState(sentence)).toBe('unsure')
  })

  it.each([
    'If the client will pay, we will proceed.',
    'If the new server will crash, we will page the team.',
    'If the public will change its mind, we will adapt.',
    'If the scanner will fail, we will call.',
    'If our team will not join, we will move it.',
    'If he will come, we will start.',
    'If it will rain, we will stay.',
    'If we will lose the contract, we will call.',
    'If they will not pay, we will stop.',
    'If I will be late, I will call.',
    "If he'll come, we will start.",
    "If the scanner'll fail, we will call.",
  ])('seit 052 auch typische Lernfehler: %s -> unclear (nicht bestaetigt, aber auch kein sicherer Fehler)', (sentence) => {
    expect(tags(sentence), sentence).toEqual([])
    expect(check(sentence, 'start').outcome).toBe('unclear')
    expect(willState(sentence)).toBe('unsure')
  })

  it('auch hinten stehende if-Teile: nie ein sicherer will-Fehler', () => {
    for (const sentence of ['We will call you if the client will pay.', 'We will call you if he will pay.', 'We will adapt if public will changes.', "We will proceed if the client's will is valid."]) {
      expect(tags(sentence, 'end'), sentence).toEqual([])
      expect(check(sentence, 'end').outcome).toBe('unclear')
    }
  })

  it('"will" gefolgt von einem finiten Wort (-s, is, was, -ed) ist nie ein sicherer Fehler, auch nicht mit Artikel oder Pronomen', () => {
    for (const sentence of ['If the client will changes, we will adapt.', 'If he will is clear, we will adapt.', 'If the plan will was changed, we will adapt.', 'If it will changed, we will adapt.']) {
      expect(tags(sentence), sentence).toEqual([])
    }
  })

  it('der Hinweistext nennt die uebliche Type-1-Bildung und bewertet nicht', () => {
    const item = check('If the client will pay, we will proceed.', 'start').items.find((entry) => entry.id === 'will')
    expect(item.state).toBe('unsure')
    expect(item.message).toContain('Im normalen Conditional Type 1 verwenden wir im if-Satz meistens das Present Simple.')
    expect(item.message).not.toMatch(/ungrammatisch|ist falsch|Problem/)
  })

  it('Hauptsatz: Hilfsverb + gebeugtes Wort (will changes) bestaetigt keinen Hauptsatz; Grundform schon', () => {
    for (const sentence of ['If it fails, public will changes.', 'If it fails, we will informs the team.', 'If it fails, the plan will is clear.']) {
      expect(states(check(sentence, 'start')).main, sentence).toBe('unsure')
      expect(check(sentence, 'start').outcome).toBe('unclear')
    }
    expect(states(check('If it fails, we will notify the team.', 'start')).main).toBe('ok')
  })

  it('"met" bleibt moeglich, wenn alles eindeutig ist; Tippfehler und fehlende -s bleiben unbemerkt (keine Grammatikpruefung)', () => {
    const result = check('If the scanner fail, we will notify the team.', 'start')
    expect(result.outcome).toBe('met')
    expect(result.notChecked).toEqual(NOT_CHECKED)
    expect(check('If the scaner fails, we will notify the enginer.', 'start').outcome).toBe('met')
  })

  it('Alle frueheren Codex-Beispiele (046-049) bleiben wie erwartet', () => {
    const none = [
      "If the client's will is valid, we will proceed.", "If the team's will changes, we will adapt.", 'If Will agrees, we will proceed.',
      'If the server fails, will restart.', 'If the server fails, please database.', 'If, as planned, the server fails, we will call.',
      'If the server fails, the will of the team decides.', 'If the will of the client changes, we will call.',
    ]
    for (const sentence of none) expect(tags(sentence), sentence).toEqual([])
    expect(check('If the server fails, will restart.', 'start').outcome).toBe('unclear')
    expect(check('If the server fails, please database.', 'start').outcome).toBe('unclear')
    expect(check('Please call me if the server fails.', 'end').outcome).toBe('met')
    expect(check('If the server fails, we can begin the rollout.', 'start').outcome).toBe('met')
  })
})

describe('Strukturcheck 052: konservative will-Pruefung (verbindliche Beispiele und Gegenproben)', () => {
  const run = (sentence, position = 'start') => check(sentence, position)

  it.each([
    // zulaessige Nominalkonstruktionen
    'If the collective will to act remains strong, we will adapt.',
    'If the public will for reform survives, we will proceed.',
    'If public will changes, we will adapt.',
    "If the client's will is valid, we will proceed.",
    'If Will agrees, we will proceed.',
    // moegliche Bereitschaftsbedeutung
    'If he will cooperate, we can proceed.',
    'If the client will listen, we will explain it.',
    'If she will help us, we will finish today.',
    // typische Lernfehler: duerfen nicht bestaetigt werden (kein met), werden aber auch nicht als sicherer Fehler behauptet
    'If the client will pay, we will proceed.',
    'If he will come, we will prepare the room.',
    'If it will rain, we will cancel the event.',
  ])('will im if-Teil: %s -> unclear, kein met, kein sicherer Fehler, mit nicht wertendem Hinweis', (sentence) => {
    const result = run(sentence)
    expect(result.outcome, sentence).toBe('unclear')
    expect(result.tags).toEqual([])
    const will = result.items.find((entry) => entry.id === 'will')
    expect(will.state).toBe('unsure')
    expect(will.message).toContain('Present Simple')
    expect(will.message).not.toMatch(/ungrammatisch|ist falsch/)
  })

  it.each([
    ['If the server fails, we will restart it.', 'start'],
    ['We will restart the server if it fails.', 'end'],
    ['If the customer calls, please inform me.', 'start'],
    ['If the vendor accepts, we will begin the rollout.', 'start'],
    ['We will call you if the build breaks.', 'end'],
  ])('regulaere Beispiele bleiben "met": %s', (sentence, position) => {
    expect(run(sentence, position).outcome).toBe('met')
  })

  it('Gegenprobe 1: der Code "will-in-if" wird nie mehr erzeugt - ueber einen breiten Korpus mit "will" an jeder Stelle', () => {
    const corpus = [
      'If the client will pay, we will proceed.', 'If he will come, we will start.', 'If public will changes, we will adapt.', 'If Will agrees, we will proceed.',
      "If he'll come, we will start.", 'If you will help, we will finish.', 'If the will of the team decides, we adapt.', 'If it will rain and we will stay, we will call.',
      'We will call you if the client will pay.', 'We will adapt if public will change.', 'If the server will restart, will restart.', 'if will will will',
      'If the server, which will restart, fails, we will call.', 'If the server (which will restart) fails, we will call.', 'If, as planned, he will come, we will start.',
      'If he comes, he will call.', 'If it fails, will.', 'Will you call me if it fails?',
    ]
    for (const sentence of corpus) for (const position of CHECK_POSITIONS) expect(check(sentence, position).tags, `${position}: ${sentence}`).not.toContain('will-in-if')
  })

  it('Gegenprobe 2: andere sicher erkannte Strukturfehler bleiben bei will im if-Teil erkennbar', () => {
    expect(check('If the client will pay we will proceed.', 'start').tags).toEqual(['missing-comma'])
    expect(check('We will call you if the client will pay.', 'start').tags).toEqual(['wrong-position'])
    expect(check('If the client will pay, we will proceed.', 'end').tags).toEqual(['wrong-position'])
    expect(check('If the client will pay,', 'start').tags).toEqual(['no-main-clause'])
    expect(check('If', 'start').tags).toEqual(['empty-if-part'])
    expect(check('The client will pay.', 'start').tags).toEqual(['no-if'])
    expect(check('If the client will pay, we will proceed.', 'start', ['If the client will pay, we will proceed.']).tags).toEqual(['copy-of-example'])
  })

  it('Gegenprobe 3: "will" nur im Hauptsatz beeintraechtigt nichts', () => {
    expect(check('If he comes, he will call.', 'start').outcome).toBe('met')
    expect(states(check('If he comes, he will call.', 'start')).will).toBe('ok')
    expect(check('He will call if he comes.', 'end').outcome).toBe('met')
  })

  it('Gegenprobe 4: kein "met" allein wegen einer plausibel aussehenden will-Konstruktion', () => {
    for (const sentence of ['If he will come, we will prepare the room.', 'If the client will listen, we will explain it.', 'If the public will for reform survives, we will proceed.']) {
      expect(check(sentence, 'start').outcome, sentence).not.toBe('met')
    }
  })

  it('Gegenprobe 5: ohne will im if-Teil bleibt die Pruefung unveraendert (kein ungewollter Verlust von met)', () => {
    for (const sentence of ['If the client pays, we will proceed.', 'If he comes, we will prepare the room.', 'If it rains, we will cancel the event.', "If he doesn't cooperate, we can't proceed."]) {
      expect(check(sentence, 'start').outcome, sentence).toBe('met')
    }
  })

  it('Gegenprobe 6: gespeicherte Altlasten mit dem frueheren Fehlercode bleiben lesbar und gelten weiter als Wiederholungsbedarf', async () => {
    const { sanitizeProduce } = await import('../coachStorage.js')
    const old = sanitizeProduce({ checked: true, tries: 1, first: 'issues', final: 'issues', tags: ['will-in-if', 'bogus'], improved: false, gaveUp: false, copied: false, self: 'self-ok' })
    expect(old.tags).toEqual(['will-in-if'])
    expect(ERROR_TAGS).toContain('will-in-if')
  })
})
