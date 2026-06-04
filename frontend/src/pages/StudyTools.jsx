import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Sparkles, Loader2, RefreshCw,
  ChevronLeft, ChevronRight, CheckCircle2,
  HelpCircle, XCircle, RotateCcw, BookOpen,
  Eye, EyeOff, GraduationCap, Layers,
} from 'lucide-react'
import {
  getNote,
  generateFlashcards, listFlashcards, reviewFlashcard,
  generateQuestions, listQuestions,
} from '../api.js'
import { renderRichText } from '../utils/mathRender.jsx'
import './StudyTools.css'

// ── Tab IDs ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'flashcards', label: 'Flashcards',          Icon: Layers       },
  { id: 'questions',  label: 'Practice questions',  Icon: GraduationCap },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StudyTools() {
  const { id } = useParams()

  const [note,    setNote]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('flashcards')

  useEffect(() => {
    getNote(id)
      .then(setNote)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="study-page">
        <div className="study-loading">
          <Loader2 size={26} className="spin" style={{ color: 'var(--color-primary)' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="study-page">
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-left">
          <Link to={`/notes/${id}`} className="btn btn-ghost btn-sm back-btn">
            <ArrowLeft size={14} /> Back to note
          </Link>
          <h1>{note?.title ?? 'Study tools'}</h1>
          {note?.course && (
            <p className="study-course-label">
              <BookOpen size={12} /> {note.course.name}
            </p>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="study-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`study-tab${tab === t.id ? ' study-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <t.Icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === 'flashcards' && <FlashcardPanel noteId={id} />}
      {tab === 'questions'  && <QuestionsPanel noteId={id} />}
    </div>
  )
}

// ── Flashcard panel ───────────────────────────────────────────────────────────

function FlashcardPanel({ noteId }) {
  const [cards,      setCards]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState(null)

  // Card session
  const [index,   setIndex]   = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState({}) // id → 'known'|'partial'|'missed'
  const [done,    setDone]    = useState(false)

  useEffect(() => { loadCards() }, [noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCards() {
    setLoading(true)
    try {
      const data = await listFlashcards(noteId)
      setCards(data)
      resetSession(data)
    } catch (e) {
      setError(e.message ?? 'Could not load flashcards.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const data = await generateFlashcards(noteId)
      setCards(data)
      resetSession(data)
    } catch (e) {
      setError(e.message ?? 'Failed to generate flashcards. Make sure the backend is running.')
    } finally {
      setGenerating(false)
    }
  }

  function resetSession(cardList) {
    setIndex(0)
    setFlipped(false)
    setResults({})
    setDone(false)
    if (cardList) setCards(cardList)
  }

  async function handleResult(result) {
    const card = cards[index]
    setResults(prev => ({ ...prev, [card.id]: result }))
    reviewFlashcard(card.id, result).catch(() => {}) // fire-and-forget

    if (index + 1 >= cards.length) {
      setDone(true)
    } else {
      setIndex(i => i + 1)
      setFlipped(false)
    }
  }

  function prev() { if (index > 0) { setIndex(i => i - 1); setFlipped(false) } }
  function next() { if (index < cards.length - 1) { setIndex(i => i + 1); setFlipped(false) } }

  const knownCount   = Object.values(results).filter(r => r === 'known').length
  const partialCount = Object.values(results).filter(r => r === 'partial').length
  const missedCount  = Object.values(results).filter(r => r === 'missed').length

  if (loading) return <PanelLoading />

  return (
    <div className="flashcard-panel">
      <div className="panel-toolbar">
        <p className="text-sm text-muted">
          {cards.length > 0
            ? `${cards.length} card${cards.length !== 1 ? 's' : ''}`
            : 'No flashcards yet'}
        </p>
        <button
          className="btn btn-secondary btn-sm"
          disabled={generating}
          onClick={handleGenerate}
        >
          {generating
            ? <><Loader2 size={13} className="spin" /> Generating…</>
            : <><Sparkles size={13} /> {cards.length ? 'Regenerate' : 'Generate'}</>}
        </button>
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {cards.length === 0 ? (
        <EmptyPanel
          icon={<Layers size={28} />}
          title="No flashcards yet"
          body="Click Generate to create flashcards from this note's content."
        />
      ) : done ? (
        <SessionSummary
          total={cards.length}
          known={knownCount}
          partial={partialCount}
          missed={missedCount}
          onRestart={() => resetSession()}
        />
      ) : (
        <>
          {/* Progress bar */}
          <div className="card-progress-bar">
            <div
              className="card-progress-fill"
              style={{ width: `${((index + 1) / cards.length) * 100}%` }}
            />
          </div>
          <p className="card-counter text-sm text-muted">
            {index + 1} / {cards.length}
          </p>

          {/* The card */}
          <div
            className={`flashcard${flipped ? ' flashcard--flipped' : ''}`}
            onClick={() => setFlipped(f => !f)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setFlipped(f => !f)}
          >
            <div className="flashcard-inner">
              <div className="flashcard-front">
                <span className="card-side-label">Question</span>
                <p className="card-text">{renderRichText(cards[index].front)}</p>
                <span className="card-tap-hint text-faint text-sm">Tap to reveal answer</span>
              </div>
              <div className="flashcard-back">
                <span className="card-side-label">Answer</span>
                <p className="card-text">{renderRichText(cards[index].back)}</p>
              </div>
            </div>
          </div>

          {/* Rating buttons — only shown after flip */}
          {flipped ? (
            <div className="card-rating">
              <p className="text-sm text-muted" style={{ marginBottom: 8 }}>How did you do?</p>
              <div className="card-rating-buttons">
                <button className="btn btn-rating btn-rating--missed" onClick={() => handleResult('missed')}>
                  <XCircle size={15} /> Missed
                </button>
                <button className="btn btn-rating btn-rating--partial" onClick={() => handleResult('partial')}>
                  <HelpCircle size={15} /> Partial
                </button>
                <button className="btn btn-rating btn-rating--known" onClick={() => handleResult('known')}>
                  <CheckCircle2 size={15} /> Got it
                </button>
              </div>
            </div>
          ) : (
            <div className="card-nav">
              <button className="btn btn-ghost btn-icon" disabled={index <= 0} onClick={prev}>
                <ChevronLeft size={16} />
              </button>
              <button className="btn btn-ghost btn-icon" disabled={index >= cards.length - 1} onClick={next}>
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Session summary ───────────────────────────────────────────────────────────

function SessionSummary({ total, known, partial, missed, onRestart }) {
  const pct = Math.round((known / total) * 100)
  return (
    <div className="session-summary">
      <div className="session-summary-icon">
        <GraduationCap size={28} />
      </div>
      <h3>Session complete</h3>
      <p className="text-muted text-sm">{total} card{total !== 1 ? 's' : ''} reviewed</p>

      <div className="session-stats">
        <div className="session-stat session-stat--known">
          <CheckCircle2 size={16} />
          <span>{known} known</span>
        </div>
        <div className="session-stat session-stat--partial">
          <HelpCircle size={16} />
          <span>{partial} partial</span>
        </div>
        <div className="session-stat session-stat--missed">
          <XCircle size={16} />
          <span>{missed} missed</span>
        </div>
      </div>

      <div className="session-score">
        <div
          className="session-score-ring"
          style={{ '--pct': pct }}
        >
          <span>{pct}%</span>
        </div>
      </div>

      <button className="btn btn-primary" onClick={onRestart}>
        <RotateCcw size={14} /> Restart session
      </button>
    </div>
  )
}

// ── Practice questions panel ──────────────────────────────────────────────────

function QuestionsPanel({ noteId }) {
  const [questions,  setQuestions]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState(null)
  const [revealed,   setRevealed]   = useState(new Set())

  useEffect(() => {
    listQuestions(noteId)
      .then(setQuestions)
      .catch(e => setError(e.message ?? 'Could not load questions.'))
      .finally(() => setLoading(false))
  }, [noteId])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const data = await generateQuestions(noteId)
      setQuestions(data)
      setRevealed(new Set())
    } catch (e) {
      setError(e.message ?? 'Failed to generate questions.')
    } finally {
      setGenerating(false)
    }
  }

  function toggleReveal(id) {
    setRevealed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function revealAll()  { setRevealed(new Set(questions.map(q => q.id))) }
  function hideAll()    { setRevealed(new Set()) }

  if (loading) return <PanelLoading />

  return (
    <div className="questions-panel">
      <div className="panel-toolbar">
        <p className="text-sm text-muted">
          {questions.length > 0
            ? `${questions.length} question${questions.length !== 1 ? 's' : ''}`
            : 'No questions yet'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {questions.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={revealed.size ? hideAll : revealAll}>
              {revealed.size ? <><EyeOff size={13} /> Hide all</> : <><Eye size={13} /> Reveal all</>}
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            disabled={generating}
            onClick={handleGenerate}
          >
            {generating
              ? <><Loader2 size={13} className="spin" /> Generating…</>
              : <><Sparkles size={13} /> {questions.length ? 'Regenerate' : 'Generate'}</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {questions.length === 0 ? (
        <EmptyPanel
          icon={<GraduationCap size={28} />}
          title="No questions yet"
          body="Click Generate to create practice questions from this note."
        />
      ) : (
        <div className="questions-list">
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              index={i + 1}
              question={q}
              revealed={revealed.has(q.id)}
              onToggle={() => toggleReveal(q.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Question card ─────────────────────────────────────────────────────────────

function QuestionCard({ index, question, revealed, onToggle }) {
  let options = null
  try {
    options = question.options ? JSON.parse(question.options) : null
  } catch { /* not valid JSON */ }

  // Map answer letter (A/B/C/D) to the index into the options array
  const answerLetter = question.answer_text?.trim().toUpperCase().replace(/[^A-D]/, '')
  const answerIndex  = answerLetter ? 'ABCD'.indexOf(answerLetter) : -1
  // Full answer text for multiple choice: look up the matching option
  const correctOptionText =
    options && answerIndex >= 0 && options[answerIndex]
      ? options[answerIndex].replace(/^[A-D][.)]\s*/, '')
      : null

  return (
    <div className={`question-card${revealed ? ' question-card--revealed' : ''}`}>
      <div className="question-card-header">
        <span className="question-index">{index}</span>
        <p className="question-text">{renderRichText(question.question_text)}</p>
        {question.question_type && (
          <span className="badge badge-gray badge-xs" style={{ flexShrink: 0 }}>
            {question.question_type.replace('_', ' ')}
          </span>
        )}
      </div>

      {options && (
        <ul className="question-options">
          {options.map((opt, i) => (
            <li
              key={i}
              className={revealed && i === answerIndex ? 'question-option--correct' : ''}
            >
              {renderRichText(opt.replace(/^[A-D][.)]\s*/, ''))}
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn-ghost btn-sm question-reveal-btn" onClick={onToggle}>
        {revealed
          ? <><EyeOff size={13} /> Hide answer</>
          : <><Eye size={13} /> Reveal answer</>}
      </button>

      {revealed && (
        <div className="question-answer">
          {correctOptionText ? (
            <p>
              <strong style={{ marginRight: 6 }}>{answerLetter}.</strong>
              {renderRichText(correctOptionText)}
            </p>
          ) : (
            <p>{renderRichText(question.answer_text)}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function PanelLoading() {
  return (
    <div className="panel-loading">
      <Loader2 size={22} className="spin" style={{ color: 'var(--color-primary)' }} />
    </div>
  )
}

function EmptyPanel({ icon, title, body }) {
  return (
    <div className="panel-empty">
      <div className="panel-empty-icon">{icon}</div>
      <p className="panel-empty-title">{title}</p>
      <p className="text-muted text-sm">{body}</p>
    </div>
  )
}
