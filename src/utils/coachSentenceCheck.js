// Lokaler Strukturcheck fuer eigene Saetze (Lerncoach, Conditional Type 1).
//
// Das ist KEINE Grammatikpruefung und keine Grammatik-Engine. Der Check erkennt nur wenige, eng
// umrissene Strukturmerkmale und sagt ausdruecklich, was er NICHT prueft (NOT_CHECKED).
// Jedes Merkmal hat einen von vier Zustaenden:
//   ok      - Merkmal sicher erkannt
//   problem - sicher erkannter Strukturfehler (nur dann steht ein Fehlercode im Ergebnis)
//   unsure  - nicht zuverlaessig pruefbar (Variante, mehrdeutig, unvollstaendig) - kein Urteil
//   na      - fuer diesen Satz nicht relevant
//
// Grundsatz: NUR SICHER ERKENNBARE PROBLEME sind "problem". Bei jedem lexikalischen oder
// syntaktischen Zweifel (Einschub, Relativsatz, will als Substantiv, Fragment, ...) steht "unsure".
//
// Gesamtergebnis (outcome): 'issues' (mindestens ein sicherer Strukturfehler), 'unclear' (kein
// sicherer Fehler, aber nicht alles zuverlaessig pruefbar) oder 'met' (alle geprueften
// Strukturmerkmale erfuellt). 'met' heisst NIE "grammatisch korrekt" - nur: die hier aufgelisteten
// Merkmale sind erfuellt.
//
// Reine Funktionen, keine Seiteneffekte, keine Speicherung, kein Netzwerk. Der Satz wird nur
// ausgewertet und nie weitergegeben.

export const CHECK_TYPE_CONDITIONAL_1 = 'conditional-type-1'
export const CHECK_TYPES = [CHECK_TYPE_CONDITIONAL_1]
export const CHECK_POSITIONS = ['start', 'end', 'any']
export const OUTCOMES = ['issues', 'unclear', 'met']
// Nur diese Codes duerfen je gespeichert werden (Allowlist in coachStorage.js).
export const ERROR_TAGS = ['no-if', 'empty-if-part', 'wrong-position', 'will-in-if', 'missing-comma', 'no-main-clause', 'copy-of-example']

export const NOT_CHECKED = [
  'Verbformen (zum Beispiel das -s bei he/she/it oder die Grundform nach will)',
  'Rechtschreibung',
  'Wortwahl und Artikel',
  'Bedeutung und Stil',
]

const OUTCOME_RANK = { issues: 0, unclear: 1, met: 2 }

const MODALS = new Set(['will', "won't", 'wont', 'can', "can't", 'cannot', 'could', "couldn't", 'should', "shouldn't", 'shall', 'may', 'might', 'must', "mustn't"])
const SEMI_MODAL_PAIRS = new Set(['going to', 'have to', 'has to', 'need to', 'needs to', 'ought to', 'had better'])
// Verben, die einen Aufforderungssatz einleiten koennen. Mehrdeutige Woerter (Substantiv/Verb) zaehlen nur,
// wenn danach ein typischer Objekt-/Ortsbegriff folgt (siehe imperativeState).
const IMPERATIVE_VERBS = new Set([
  'call', 'phone', 'ring', 'contact', 'inform', 'tell', 'notify', 'alert', 'ask', 'send', 'check', 'restart', 'start', 'stop', 'wait', 'email',
  'write', 'remember', 'make', 'keep', 'use', 'try', 'open', 'close', 'take', 'give', 'bring', 'move', 'postpone', 'reschedule', 'cancel', 'confirm',
  'fix', 'reply', 'answer', 'escalate', 'forward', 'follow', 'get', 'go', 'come', 'join', 'help', 'say', 'restore', 'switch', 'ping',
])
const IMPERATIVE_AUX = new Set(['do', "don't", 'never', 'always', 'let', "let's", 'be'])
const OBJECT_LIKE = new Set([
  'the', 'a', 'an', 'me', 'us', 'him', 'her', 'them', 'it', 'you', 'your', 'our', 'my', 'his', 'their', 'this', 'that', 'these', 'those', 'all',
  'everyone', 'someone', 'anyone', 'immediately', 'now', 'again', 'back', 'up', 'out', 'off', 'on', 'in', 'to', 'tomorrow', 'today', 'tonight',
  'early', 'quickly', 'first', 'more', 'another', 'not',
])
const ADVERBS = new Set(['not', 'never', 'also', 'always', 'just', 'then', 'soon', 'probably', 'definitely', 'surely', 'still', 'really', 'only', 'immediately', 'first', 'all', 'even', 'certainly', 'simply'])
// Gaengige Basisverben. Ein Hilfsverb oder "please" zaehlt nur dann als Hauptsatz-Konstruktion, wenn danach ein
// ERKANNTES Verb folgt (auch in -s/-ed/-ing-Form; die Verbform selbst wird nicht geprueft). Ein unbekanntes Wort
// (zum Beispiel ein Substantiv wie "database") bestaetigt den Hauptsatz nicht -> "nicht zuverlaessig pruefbar".
const KNOWN_VERBS = new Set(`be have do see know need want let stay leave work run pay charge refund invoice bill order ship deliver provide offer support
handle manage prepare plan schedule organize organise meet attend discuss decide agree finish complete begin start continue hold review update document log track
assign approve reject accept test monitor investigate resolve repair replace release publish merge revert roll rollback deploy patch reboot migrate upgrade install
uninstall fail crash break happen occur change arrive respond reach lose miss hire sign print save delete remove add create build compile download upload delay
pause resume ignore avoid prevent reduce increase improve extend expire renew cost find look turn put set show share submit report raise lower drop refuse allow
enable disable activate block unblock warn page assist adapt proceed process cover consider expect lead limit mention note pass pick pull push read receive record
recover remain repeat require rest return search select sell sort speak spend split stand store study suggest talk teach think throw train transfer travel trust
understand unlock verify visit watch win call phone ring contact inform tell notify alert ask send check restart stop wait email write remember make keep use try
open close take give bring move postpone reschedule cancel confirm fix reply answer escalate forward follow get go come join help say restore switch ping`.split(/\s+/))

// Grundform eines gaengigen Verbs (auch mit re-: retry, rebuild). Gebeugte Formen (-s, -ed, -ing) zaehlen bewusst NICHT:
// nach einem Hilfsverb steht die Grundform, und "public will changes" zeigt, dass "will" + -s-Form ein Substantiv-Satz sein kann.
function isBaseVerb(token) {
  if (!token) return false
  return KNOWN_VERBS.has(token) || KNOWN_VERBS.has(token.replace(/^re/, ''))
}

// Woerter, nach denen "will/can/may/might/must" ein Substantiv sein kann ("the will of ...", "free will", "his might").
const NOUN_CUES = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'our', 'my', 'your', 'its', 'this', 'that', 'free', 'good', 'ill', 'strong', 'last', 'political', 'whose', 'with'])
const PREFIX_WORDS = new Set(['and', 'but', 'so', 'then', 'also', 'now', 'well', 'ok', 'okay', 'yes', 'sure', 'even', 'only', 'especially', 'particularly', 'just', 'however', 'therefore', 'thus', 'still', 'finally', 'first', 'second', 'third'])
const OTHER_CONNECTORS = ['unless', 'provided', 'providing', 'supposing', 'assuming', 'given that', 'on condition', 'when', 'once', 'whenever', 'as soon as', 'as long as', 'so long as', 'in case', 'otherwise']
const INVERSION_STARTERS = new Set(['should', 'were', 'had'])
const CLAUSE_BREAK_WORDS = new Set(['and', 'but', 'so', 'then', 'because', 'which', 'while', 'although', 'or'])
const GERMAN_WORDS = new Set(['wenn', 'dann', 'nicht', 'und', 'ich', 'wir', 'ist', 'der', 'das', 'den', 'dem', 'kunde', 'werden', 'wird'])

const IF_PATTERN = /(?<![\p{L}\p{N}'_-])if(?![\p{L}\p{N}'_-])/giu

function clean(text) {
  return String(text ?? '').replace(/[‘’‛`´]/g, "'").replace(/\s+/g, ' ').trim()
}

function wordsOf(text) {
  return clean(text).toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)*/gu) ?? []
}

function stripEnd(text) {
  return text.replace(/[\s.!?;:]+$/u, '').trim()
}

function normalizeForCopy(text) {
  return clean(text).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
}

function isWillToken(token) {
  return token === 'will' || token.endsWith("'ll")
}

// "won't" im if-Teil kann "will nicht" (Weigerung: "if he won't listen") bedeuten und ist daher kein sicherer Fehler.
function isWontToken(token) {
  return token === "won't" || token === 'wont'
}

// Ist das Wort an Position i hier ein Hilfsverb? 'noun' = steht vermutlich als Substantiv ("the will of ...").
function modalKind(tokens, index) {
  const token = tokens[index]
  if (token.endsWith("'ll")) return 'modal'
  if (NOUN_CUES.has(tokens[index - 1]) || tokens[index + 1] === 'of') return 'noun'
  return 'modal'
}

// Nach dem Hilfsverb muss ein erkanntes Verb folgen (Verneinung und Adverbien werden uebersprungen).
function verbFollows(tokens, index) {
  return isBaseVerb(tokens.slice(index + 1).find((token) => !ADVERBS.has(token)))
}

function imperativeState(tokens) {
  let rest = tokens
  const please = rest[0] === 'please'
  if (please) rest = rest.slice(1)
  if (rest.length === 0) return please ? 'fragment' : 'none'
  const first = rest[0]
  if (please) return isBaseVerb(first) || IMPERATIVE_AUX.has(first) ? 'marker' : 'none' // "please database" bestaetigt nichts
  if (first === "let's") return isBaseVerb(rest[1]) ? 'marker' : rest.length === 1 ? 'fragment' : 'none'
  if (first === 'let') return OBJECT_LIKE.has(rest[1]) ? 'marker' : rest.length === 1 ? 'fragment' : 'none'
  if (IMPERATIVE_AUX.has(first)) {
    const after = rest[1] === 'not' ? rest[2] : rest[1]
    return isBaseVerb(after) ? 'marker' : rest.length <= 2 ? 'fragment' : 'none'
  }
  if (IMPERATIVE_VERBS.has(first)) return rest.length === 1 || OBJECT_LIKE.has(rest[1]) ? 'marker' : 'none'
  return 'none'
}

// 'marker' = erkennbarer Hauptsatz (Hilfsverb + Verb oder Aufforderung), 'fragment' = Hilfsverb bzw.
// "please" ohne folgendes Verb, 'none' = nichts davon erkannt.
function mainClauseState(tokens, { imperative = true } = {}) {
  let fragment = false
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (MODALS.has(token) || token.endsWith("'ll")) {
      // Ein Hilfsverb am Satzanfang ("will restart") ist kein Aussage-Hauptsatz; ein Substantiv ("the will") auch nicht.
      if ((index === 0 && !token.endsWith("'ll")) || modalKind(tokens, index) !== 'modal') continue
      if (verbFollows(tokens, index)) return 'marker'
      fragment = true
    }
    const pair = index < tokens.length - 1 ? `${token} ${tokens[index + 1]}` : ''
    if (index >= 1 && SEMI_MODAL_PAIRS.has(pair)) {
      if (isBaseVerb(tokens.slice(index + 2).find((rest) => !ADVERBS.has(rest)))) return 'marker'
      fragment = true
    }
  }
  if (imperative) {
    const state = imperativeState(tokens)
    if (state === 'marker') return 'marker'
    if (state === 'fragment') fragment = true
  }
  return fragment ? 'fragment' : 'none'
}

// Ab dem ersten Wort, das einen neuen Teilsatz einleitet, gehoert nichts mehr zum if-Teil.
function cutAtClauseBreak(tokens) {
  const index = tokens.findIndex((token) => CLAUSE_BREAK_WORDS.has(token))
  return index === -1 ? { scope: tokens, remainder: [] } : { scope: tokens.slice(0, index), remainder: tokens.slice(index) }
}

function item(id, label, state, message, code = null) {
  return { id, label, state, message, code }
}

const LABELS = {
  ifPart: 'if-Teil vorhanden',
  position: 'Position des if-Teils',
  will: 'Kein „will“ im if-Teil',
  comma: 'Komma nach vorangestelltem if-Teil',
  main: 'Hauptsatz erkennbar',
  own: 'Eigener Satz (nicht aus der Lektion kopiert)',
}

function positionMessage(wanted, layout) {
  if (wanted === 'any') return layout === 'end' ? 'Der if-Teil steht hinten.' : 'Der if-Teil steht vorn.'
  return wanted === 'start' ? 'Der if-Teil steht am Anfang, wie verlangt.' : 'Der if-Teil steht am Ende, wie verlangt.'
}

function copyItem(sentence, references) {
  const own = normalizeForCopy(sentence)
  const copied = own !== '' && (references ?? []).some((reference) => normalizeForCopy(reference) === own)
  return copied
    ? item('own', LABELS.own, 'problem', 'Genau dieser Satz steht schon in der Lektion. Formuliere einen eigenen Satz mit anderen Wörtern.', 'copy-of-example')
    : item('own', LABELS.own, 'ok', 'Der Satz ist nicht wortgleich mit einem Beispielsatz aus der Lektion.')
}

function skippedItems(reason) {
  return [
    item('position', LABELS.position, 'na', reason),
    item('will', LABELS.will, 'na', reason),
    item('comma', LABELS.comma, 'na', reason),
    item('main', LABELS.main, 'na', reason),
  ]
}

function finish(type, items) {
  const problems = items.filter((entry) => entry.state === 'problem')
  const outcome = problems.length > 0 ? 'issues' : items.some((entry) => entry.state === 'unsure') ? 'unclear' : 'met'
  return {
    type,
    outcome,
    items,
    tags: [...new Set(problems.map((entry) => entry.code).filter(Boolean))],
    copied: items.some((entry) => entry.code === 'copy-of-example'),
    notChecked: NOT_CHECKED,
  }
}

function mainItem(mainText) {
  const tokens = wordsOf(mainText)
  if (tokens.length === 0) return item('main', LABELS.main, 'problem', 'Nach dem Komma fehlt der Hauptsatz – was passiert dann?', 'no-main-clause')
  const state = mainClauseState(tokens)
  if (state === 'marker') return item('main', LABELS.main, 'ok', 'Im Hauptsatz erkenne ich will, can, should oder eine Aufforderung.')
  if (state === 'fragment') return item('main', LABELS.main, 'unsure', 'Der Hauptsatz wirkt unvollständig oder unklar: Nach will, can oder please erkenne ich kein Verb. Ich kann ihn nicht zuverlässig prüfen.')
  const would = tokens.includes('would') ? ' „would“ gehört zu Conditional Type 2.' : ''
  return item('main', LABELS.main, 'unsure', `Im Hauptsatz erkenne ich kein will, can, should und keine Aufforderung.${would} Das kann ein anderer Satztyp sein; für Type 1 erwartet die Aufgabe meist will + Grundform.`)
}

// Prueft den if-Teil auf "will". Ein "will" im if-Teil ist NIE ein sicherer Fehler: Es kann Hilfsverb (Type-1-Lernfehler oder
// Bereitschaft: "if he will cooperate"), Substantiv ("public will", "the client's will") oder Name ("Will") sein, und eine
// lokale Heuristik kann das nicht zuverlaessig unterscheiden. Deshalb nur: "unsure" mit nicht wertendem Hinweis auf die
// uebliche Type-1-Bildung. Keine Wort- oder Sonderfalllisten. (Der Fehlercode "will-in-if" bleibt in ERROR_TAGS, damit aeltere
// gespeicherte Staende lesbar bleiben; er wird nicht mehr erzeugt.)
const WILL_HINT = 'Im normalen Conditional Type 1 verwenden wir im if-Satz meistens das Present Simple.'

function willItem({ clauseRaw, ifPartTokens, boundaryReliable }) {
  const tokens = wordsOf(clauseRaw)
  const { scope, remainder } = cutAtClauseBreak(tokens)
  const everywhere = ifPartTokens ?? tokens
  const hasWill = [...scope, ...remainder, ...(boundaryReliable ? [] : everywhere)].some(isWillToken)
  if (hasWill) {
    return item('will', LABELS.will, 'unsure', `Hier steht „will“ im if-Teil. ${WILL_HINT} „will“ kann aber auch ein Substantiv, ein Name oder eine Bereitschaft („if you will help“) sein – das kann ich nicht sicher beurteilen und werte es nicht als Fehler.`)
  }
  if (scope.some(isWontToken)) {
    return item('will', LABELS.will, 'unsure', `Im if-Teil steht „won’t“. ${WILL_HINT} „won’t“ ist nur in der Bedeutung „will nicht / weigert sich“ üblich; für „nicht“ im Present Simple verwendest du „does not“ oder „do not“.`)
  }
  if (scope.includes('would') || scope.some((token) => token.endsWith("'d"))) {
    return item('will', LABELS.will, 'unsure', 'Im if-Teil steht „would“ oder „’d“. Das gehört zu Conditional Type 2 und ist hier nicht sicher prüfbar.')
  }
  return item('will', LABELS.will, 'ok', 'Im if-Teil steht kein „will“.')
}

export function checkConditionalType1(sentence, { position = 'any', references = [] } = {}) {
  const text = clean(sentence)
  const wanted = CHECK_POSITIONS.includes(position) ? position : 'any'
  const matches = [...text.matchAll(IF_PATTERN)]
  const own = copyItem(text, references)

  if (matches.length === 0) {
    const lower = ` ${text.toLowerCase()} `
    const connector = OTHER_CONNECTORS.find((word) => lower.includes(` ${word} `))
    const tokens = wordsOf(text)
    const seemsGerman = /[äöüß]/i.test(text) || tokens.some((token) => GERMAN_WORDS.has(token))
    if (connector || INVERSION_STARTERS.has(tokens[0])) {
      const named = connector ? `„${connector}“` : 'eine andere Satzform'
      return finish(CHECK_TYPE_CONDITIONAL_1, [
        item('ifPart', LABELS.ifPart, 'unsure', `Ich finde kein „if“, aber ${named}. Das kann ein richtiger Bedingungssatz sein, aber dieser Check kennt nur if-Sätze – das kann ich nicht zuverlässig prüfen.`),
        ...skippedItems('Ohne „if“ nicht prüfbar.'),
        own,
      ])
    }
    const german = seemsGerman ? ' Der Satz sieht teilweise deutsch aus – schreibe ihn auf Englisch.' : ''
    return finish(CHECK_TYPE_CONDITIONAL_1, [
      item('ifPart', LABELS.ifPart, 'problem', `Ich finde kein „if“ in deinem Satz. Die Aufgabe verlangt einen if-Satz.${german}`, 'no-if'),
      ...skippedItems('Ohne „if“ nicht prüfbar.'),
      own,
    ])
  }

  if (matches.length > 1) {
    return finish(CHECK_TYPE_CONDITIONAL_1, [
      item('ifPart', LABELS.ifPart, 'unsure', 'Ich finde mehr als ein „if“. Bei so einem Satz kann ich die Teile nicht zuverlässig trennen.'),
      ...skippedItems('Bei mehreren „if“ nicht prüfbar.'),
      own,
    ])
  }

  const ifIndex = matches[0].index
  const before = text.slice(0, ifIndex).replace(/^["'([]+/, '').trim()
  const afterIf = text.slice(ifIndex + 2).trim()
  const beforeTokens = wordsOf(before)
  const prefixed = before !== '' && beforeTokens.length > 0
    && ((before.endsWith(',') && beforeTokens.length <= 6) || (beforeTokens.length === 1 && PREFIX_WORDS.has(beforeTokens[0])))
  const layout = before === '' ? 'start' : prefixed ? 'start-prefixed' : 'end'
  const frontLayout = layout !== 'end'

  // Nach "if" steht gar kein Wort: nur dann ist der if-Teil sicher leer. Ein Einschub ("If, as planned, ...") ist nicht leer.
  if (!/\p{L}/u.test(afterIf)) {
    return finish(CHECK_TYPE_CONDITIONAL_1, [
      item('ifPart', LABELS.ifPart, 'problem', 'Nach „if“ fehlt der Rest des if-Teils – zum Beispiel wer etwas tut oder was passiert.', 'empty-if-part'),
      ...skippedItems('Der if-Teil ist leer.'),
      own,
    ])
  }

  const core = afterIf.replace(/[\s,.!?;:]+$/u, '')
  const trailingComma = /,\s*[.!?;:]*\s*$/.test(afterIf)
  const segments = core.split(',').map((segment) => segment.trim())
  const interiorCommas = segments.length - 1
  const hasComma = interiorCommas > 0 || trailingComma
  const embedded = interiorCommas >= 2 || (interiorCommas >= 1 && !/\p{L}/u.test(segments[0])) // mehrere Kommas oder Einschub gleich nach "if"
  const items = [item('ifPart', LABELS.ifPart, 'ok', 'Ich finde einen if-Teil.')]

  // 2 Position
  if (wanted === 'any') {
    items.push(item('position', LABELS.position, 'ok', positionMessage('any', frontLayout ? 'start' : 'end')))
  } else if (layout === 'start-prefixed') {
    items.push(item('position', LABELS.position, 'unsure', `Vor dem „if“ steht noch „${before}“. Ob das noch als ${wanted === 'start' ? 'Satzanfang' : 'Satzende'} gilt, kann ich nicht sicher sagen.`))
  } else if ((wanted === 'start') === (layout === 'start')) {
    items.push(item('position', LABELS.position, 'ok', positionMessage(wanted, layout)))
  } else {
    const message = wanted === 'start'
      ? 'Die Aufgabe verlangt den if-Teil am Anfang. Dein Satz beginnt aber nicht mit „if“.'
      : 'Die Aufgabe verlangt den if-Teil am Ende. Dein Satz beginnt aber schon mit „if“.'
    items.push(item('position', LABELS.position, 'problem', message, 'wrong-position'))
  }

  let mainText = null
  if (frontLayout) {
    if (!hasComma) {
      // ohne Komma: Grenze nicht erkennbar
      items.push(item('will', LABELS.will, 'unsure', 'Ohne Komma erkenne ich nicht sicher, wo der if-Teil endet – deshalb urteile ich hier nicht.'))
      const rest = wordsOf(afterIf)
      const state = mainClauseState(rest.slice(1), { imperative: false })
      // Ohne Komma nur eindeutige Folge-Marker (Hilfsverb + Verb, then) - keine Aufforderungs-Verben, die auch im if-Teil stehen koennen.
      // Anderes Satzzeichen statt Komma (Semikolon, Doppelpunkt, Gedankenstrich, Klammer): kein sicheres Urteil.
      const otherPunctuation = /[;:\u2013\u2014\u2026()]|\s-\s/.test(afterIf)
      items.push(otherPunctuation
        ? item('comma', LABELS.comma, 'unsure', 'Statt eines Kommas steht ein anderes Satzzeichen. Dein if-Teil wird normalerweise mit einem Komma vom Hauptsatz getrennt; ob das hier ein Fehler ist, kann ich nicht sicher beurteilen.')
        : state === 'marker' || rest.includes('then')
        ? item('comma', LABELS.comma, 'problem', 'Steht der if-Teil vorn, folgt nach ihm ein Komma – vor dem Hauptsatz fehlt es noch.', 'missing-comma')
        : item('comma', LABELS.comma, 'unsure', 'Ich sehe kein Komma und erkenne auch keinen Hauptsatz. Entweder fehlt das Komma oder der Hauptsatz ist noch nicht fertig.'))
    } else {
      const lastComma = embedded ? segments.length - 1 : 1
      const ifPartText = segments.slice(0, lastComma).join(', ')
      mainText = trailingComma && interiorCommas === 0 ? '' : embedded ? segments[segments.length - 1] : segments.slice(1).join(', ')
      items.push(willItem({ clauseRaw: ifPartText, ifPartTokens: wordsOf(ifPartText), boundaryReliable: !embedded }))
      items.push(item('comma', LABELS.comma, 'ok', 'Nach dem if-Teil steht ein Komma.'))
    }
  } else {
    const clauseRaw = segments[0]
    const restTokens = wordsOf(segments.slice(1).join(', '))
    mainText = stripEnd(before).replace(/,$/, '').trim()
    const willResult = willItem({ clauseRaw, ifPartTokens: null, boundaryReliable: !embedded })
    // will erst im Anschlussteil nach dem Komma: nicht sicher zuordenbar
    items.push(willResult.state === 'ok' && restTokens.some(isWillToken)
      ? item('will', LABELS.will, 'unsure', 'Ein „will“ steht nach dem if-Teil, aber der Satz geht noch weiter. Ob es zum if-Teil gehört, kann ich nicht sicher beurteilen.')
      : willResult)
    items.push(item('comma', LABELS.comma, 'na', 'Steht der if-Teil hinten, braucht der Satz kein Komma.'))
  }

  // 5 Hauptsatz
  items.push(mainText === null
    ? item('main', LABELS.main, 'unsure', 'Ohne Komma erkenne ich nicht sicher, wo der Hauptsatz beginnt.')
    : mainItem(mainText))

  // Mittelstellung: if-Teil hinten, aber nach dem if-Teil geht der Satz weiter
  if (!frontLayout && interiorCommas >= 1 && segments.slice(1).some((segment) => /\p{L}/u.test(segment))) {
    const index = items.findIndex((entry) => entry.id === 'position')
    if (items[index].state === 'ok') {
      items[index] = item('position', LABELS.position, 'unsure', 'Nach dem if-Teil geht der Satz noch weiter. Das ist nicht sicher als „am Ende“ prüfbar.')
    }
  }

  items.push(own)
  return finish(CHECK_TYPE_CONDITIONAL_1, items)
}

export function checkSentence(check, sentence, { references = [] } = {}) {
  if (check?.type === CHECK_TYPE_CONDITIONAL_1) return checkConditionalType1(sentence, { position: check.position, references })
  return null
}

export function validateCheckConfig(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) return 'muss ein Objekt sein.'
  if (!CHECK_TYPES.includes(check.type)) return `"type" muss "${CHECK_TYPES.join('" oder "')}" sein.`
  if (!CHECK_POSITIONS.includes(check.position)) return `"position" muss "${CHECK_POSITIONS.join('", "')}" sein.`
  return null
}

// Vergleich von erster und zweiter Fassung (nur Strukturcheck, keine Grammatikbewertung):
//   'improved' - die ueberprueften Strukturmerkmale sind in der 2. Fassung bestaetigt (issues -> met, unclear -> met)
//   'partial'  - Teilfortschritt: weniger sichere Hinweise (issues -> issues) oder keine sicheren Fehler mehr, aber
//                nicht bestaetigt (issues -> unclear). KEIN nachgewiesener Erfolg.
//   'none'     - alles andere: unveraendert, schlechter, gleich, kopierte Musterloesung.
export function compareAttempts(first, second, { changed }) {
  if (!first || !second || !changed || second.copied) return 'none'
  const rankFirst = OUTCOME_RANK[first.outcome]
  const rankSecond = OUTCOME_RANK[second.outcome]
  if (rankSecond === 2 && rankFirst < 2) return 'improved'
  if (first.outcome === 'issues' && second.outcome === 'unclear') return 'partial'
  if (first.outcome === 'issues' && second.outcome === 'issues' && second.tags.length < first.tags.length) return 'partial'
  return 'none'
}

export function didImprove(first, second, { changed }) {
  return compareAttempts(first, second, { changed }) === 'improved'
}

export function isStructureSuccess(result) {
  return Boolean(result) && result.outcome === 'met' && !result.copied
}
