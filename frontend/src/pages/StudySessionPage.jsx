import { useState, useEffect } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import {
  ArrowLeft, Layers, GraduationCap, Loader2,
  CheckCircle2, XCircle, HelpCircle, RotateCcw,
  ChevronLeft, ChevronRight, Eye, EyeOff,
} from 'lucide-react'
import { listStudySessions } from '../api.js'
import { renderRichText } from '../utils/mathRender.jsx'
import './StudyTools.css'
import './StudyHub.css'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudySessionPage() {
  const { sessionId } = useParams()
  const location      = useLocation()

  // If navigated here with state (e.g. right after generating), use it immediately
  // to avoid an extra round-trip.  Otherwise fetch from the saved-sessions list.
  const [session, setSession] = useState(location.state?.session ?? null)
  const [loading, setLoading] = useState(!location.state?.session)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (location.state?.session) return   // already have it
    listStudySessions()
      .then(sessions => {
        const found = sessions.find(s => s.id === sessionId)
        if (found) setSession(found)
        else       setError('Session not found.')
      })
      .catch(e => setError(e.message ?? 'Failed to load session.'))
      .finally(() => setLoading(false))
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="study-page">
        <div className="study-loading">
          <Loader2 size={26} className="spin" style={{ color: 'var(--color-primary)' }} />
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="study-page" style={{ paddingTop: 24 }}>
        <Link to="/study" className="btn btn-ghost btn-sm back-btn">
          <ArrowLeft size={14} /> Study Tools
        </Link>
        <p className="text-muted" style={{ marginTop: 16 }}>{error ?? 'Session not found.'}</p>
      </div>
    )
  }

  const isFlashcards = session.tool === 'flashcards'
  const Icon  = isFlashcards ? Layers : GraduationCap
  const label = isFlashcards ? 'Flashcards' : 'Practice Questions'
  const count = session.items.length

  return (
    <div className="study-page">
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-left">
          <Link to="/study" className="btn btn-ghost btn-sm back-btn">
            <ArrowLeft size={14} /> Study Tools
          </Link>
          <h1>{label}</h1>
          <div className="session-note-chips" style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {session.note_titles.map((t, i) => (
              <span key={i} className="session-note-chip">{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab-style indicator ── */}
      <div className="study-tabs">
        <button className="study-tab study-tab--active" style={{ cursor: 'default' }}>
          <Icon size={14} />
          {label} · {count} {isFlashcards ? 'card' : 'question'}{count !== 1 ? 's' : ''}
        </button>
      </div>

      {/* ── Content ── */}
      {isFlashcards
        ? <SessionFlashcards cards={session.items} />
        : <SessionQuestions  questions={session.items} />}
    </div>
  )
}

// ── Flashcard session ─────────────────────────────────────────────────────────

function SessionFlashcards({ cards }) {
  const [index,   setIndex]   = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState({})
  const [done,    setDone]    = useState(false)

  function handleResult(result) {
    setResults(prev => ({ ...prev, [index]: result }))
    if (index + 1 >= cards.length) {
      setDone(true)
    } else {
      setIndex(i => i + 1)
      setFlipped(false)
    }
  }

  function restart() {
    setIndex(0); setFlipped(false); setResults({}); setDone(false)
  }

  const known   = Object.values(results).filter(r => r === 'known').length
  const partial = Object.values(results).filter(r => r === 'partial').length
  const missed  = Object.values(results).filter(r => r === 'missed').length

  if (done) {
    const pct = Math.round((known / cards.length) * 100)
    return (
      <div className="session-summary">
        <div className="session-summary-icon"><GraduationCap size={28} /></div>
        <h3>Session complete</h3>
        <p className="text-muted text-sm">{cards.length} card{cards.length !== 1 ? 's' : ''} reviewed</p>
        <div className="session-stats">
          <div className="session-stat session-stat--known">  <CheckCircle2 size={16} /><span>{known} known</span></div>
          <div className="session-stat session-stat--partial"><HelpCircle   size={16} /><span>{partial} partial</span></div>
          <div className="session-stat session-stat--missed"> <XCircle      size={16} /><span>{missed} missed</span></div>
        </div>
        <div className="session-score">
          <div className="session-score-ring" style={{ '--pct': pct }}><span>{pct}%</span></div>
        </div>
        <button className="btn btn-primary" onClick={restart}>
          <RotateCcw size={14} /> Restart session
        </button>
      </div>
    )
  }

  return (
    <div className="flashcard-panel">
      <div className="card-progress-bar">
        <div className="card-progress-fill" style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
      </div>
      <p className="card-counter text-sm text-muted">{index + 1} / {cards.length}</p>

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

      {flipped ? (
        <div className="card-rating">
          <p className="text-sm text-muted" style={{ marginBottom: 8 }}>How did you do?</p>
          <div className="card-rating-buttons">
            <button className="btn btn-rating btn-rating--missed"  onClick={() => handleResult('missed')}>
              <XCircle size={15} /> Missed
            </button>
            <button className="btn btn-rating btn-rating--partial" onClick={() => handleResult('partial')}>
              <HelpCircle size={15} /> Partial
            </button>
            <button className="btn btn-rating btn-rating--known"   onClick={() => handleResult('known')}>
              <CheckCircle2 size={15} /> Got it
            </button>
          </div>
        </div>
      ) : (
        <div className="card-nav">
          <button className="btn btn-ghost btn-icon" disabled={index <= 0}
            onClick={() => { setIndex(i => i - 1); setFlipped(false) }}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-ghost btn-icon" disabled={index >= cards.length - 1}
            onClick={() => { setIndex(i => i + 1); setFlipped(false) }}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Practice questions session ────────────────────────────────────────────────

function SessionQuestions({ questions }) {
  const [revealed, setRevealed] = useState(new Set())

  function toggleReveal(i) {
    setRevealed(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const allRevealed = revealed.size === questions.length

  return (
    <div className="questions-panel">
      <div className="panel-toolbar">
        <p className="text-sm text-muted">
          {questions.length} question{questions.length !== 1 ? 's' : ''}
        </p>
        <button className="btn btn-ghost btn-sm"
          onClick={() => setRevealed(allRevealed ? new Set() : new Set(questions.map((_, i) => i)))}>
          {allRevealed
            ? <><EyeOff size={13} /> Hide all</>
            : <><Eye    size={13} /> Reveal all</>}
        </button>
      </div>

      <div className="questions-list">
        {questions.map((q, i) => {
          // options may be a pre-parsed array (study session) or a JSON string (DB)
          let options = null
          try {
            if (Array.isArray(q.options)) options = q.options
            else if (q.options)           options = JSON.parse(q.options)
          } catch { /* noop */ }

          const answerLetter      = q.answer_text?.trim().toUpperCase().replace(/[^A-D]/, '')
          const answerIndex       = answerLetter ? 'ABCD'.indexOf(answerLetter) : -1
          const correctOptionText =
            options && answerIndex >= 0 && options[answerIndex]
              ? options[answerIndex].replace(/^[A-D][.)]\s*/, '')
              : null

          return (
            <div key={i} className={`question-card${revealed.has(i) ? ' question-card--revealed' : ''}`}>
              <div className="question-card-header">
                <span className="question-index">{i + 1}</span>
                <p className="question-text">{renderRichText(q.question_text)}</p>
                {q.question_type && (
                  <span className="badge badge-gray badge-xs" style={{ flexShrink: 0 }}>
                    {q.question_type.replace('_', ' ')}
                  </span>
                )}
              </div>

              {options && (
                <ul className="question-options">
                  {options.map((opt, j) => (
                    <li
                      key={j}
                      className={revealed.has(i) && j === answerIndex ? 'question-option--correct' : ''}
                    >
                      {renderRichText(opt.replace(/^[A-D][.)]\s*/, ''))}
                    </li>
                  ))}
                </ul>
              )}

              <button className="btn btn-ghost btn-sm question-reveal-btn" onClick={() => toggleReveal(i)}>
                {revealed.has(i)
                  ? <><EyeOff size={13} /> Hide answer</>
                  : <><Eye    size={13} /> Reveal answer</>}
              </button>

              {revealed.has(i) && (
                <div className="question-answer">
                  {correctOptionText ? (
                    <p>
                      <strong style={{ marginRight: 6 }}>{answerLetter}.</strong>
                      {renderRichText(correctOptionText)}
                    </p>
                  ) : (
                    <p>{renderRichText(q.answer_text)}</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
