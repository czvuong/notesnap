import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  GraduationCap, Search, BookOpen, Sparkles,
  Layers, HelpCircle, ChevronRight, Loader2, Inbox, X,
  CheckSquare, Square, CheckCircle2, XCircle, Eye, EyeOff,
  RotateCcw, ChevronLeft, History, Trash2,
} from 'lucide-react'
import { listNotes, listCourses, generateStudySession, listStudySessions, deleteStudySession } from '../api.js'
import { renderRichText } from '../utils/mathRender.jsx'
import './StudyHub.css'

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchAllNotes() {
  const all = []
  let page = 1
  while (true) {
    const batch = await listNotes({ limit: 100, sort: 'newest', page })
    const items = Array.isArray(batch) ? batch : (batch.items ?? [])
    all.push(...items)
    if (items.length < 100) break
    page++
  }
  return all
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StudyHub() {
  const [notes,    setNotes]    = useState([])
  const [courses,  setCourses]  = useState([])
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [q,        setQ]        = useState('')
  const [courseId, setCourseId] = useState('')

  // Multi-select
  const [selected, setSelected] = useState(new Set())

  // Active study session overlay
  const [session,            setSession]            = useState(null)
  const [sessionGenerating,  setSessionGenerating]  = useState(false)
  const [sessionError,       setSessionError]       = useState(null)

  function loadSessions() {
    listStudySessions().then(setSessions).catch(() => {})
  }

  useEffect(() => {
    Promise.all([fetchAllNotes(), listCourses()])
      .then(([n, c]) => { setNotes(n); setCourses(c) })
      .finally(() => setLoading(false))
    loadSessions()
  }, [])

  const filtered = notes.filter(note => {
    const matchQ = !q || note.title.toLowerCase().includes(q.toLowerCase())
    const matchC = !courseId || String(note.course_id) === courseId
    return matchQ && matchC
  })

  const grouped = filtered.reduce((acc, note) => {
    const key = note.course?.name ?? 'No course'
    if (!acc[key]) acc[key] = []
    acc[key].push(note)
    return acc
  }, {})

  function toggleNote(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll()     { setSelected(new Set(filtered.map(n => n.id))) }
  function clearSelection(){ setSelected(new Set()) }

  async function startSession(tool) {
    if (selected.size === 0) return
    setSessionGenerating(true)
    setSessionError(null)
    try {
      const data = await generateStudySession([...selected], tool)
      setSession(data)
      loadSessions()   // refresh history list
    } catch (e) {
      setSessionError(e.message ?? 'Failed to generate study session.')
    } finally {
      setSessionGenerating(false)
    }
  }

  async function handleDeleteSession(id) {
    await deleteStudySession(id).catch(() => {})
    setSessions(prev => prev.filter(s => s.id !== id))
    if (session?.id === id) setSession(null)
  }

  const selectedCount = selected.size
  const selectedNotes = notes.filter(n => selected.has(n.id))

  return (
    <div className="study-hub">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Study Tools</h1>
          <p>Select notes to generate a combined flashcard or practice session.</p>
        </div>
      </div>

      {/* Filters + select-all */}
      <div className="hub-toolbar">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input
            className="input search-input"
            type="search"
            placeholder="Search notes…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {q && (
            <button className="btn btn-ghost btn-icon btn-sm search-clear" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <select
          className="select hub-course-select"
          value={courseId}
          onChange={e => setCourseId(e.target.value)}
        >
          <option value="">All courses</option>
          {courses.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {filtered.length > 0 && (
          <button
            className="btn btn-ghost btn-sm hub-select-all"
            onClick={selectedCount === filtered.length ? clearSelection : selectAll}
          >
            {selectedCount === filtered.length
              ? <><CheckSquare size={14} /> Deselect all</>
              : <><Square size={14} /> Select all</>}
          </button>
        )}
      </div>

      {/* Selection action bar — appears when ≥1 note is selected */}
      {selectedCount > 0 && (
        <div className="hub-selection-bar">
          <span className="hub-selection-label">
            {selectedCount} note{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <div className="hub-selection-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={sessionGenerating}
              onClick={() => startSession('flashcards')}
            >
              {sessionGenerating
                ? <><Loader2 size={13} className="spin" /> Generating…</>
                : <><Layers size={13} /> Flashcards</>}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={sessionGenerating}
              onClick={() => startSession('practice_questions')}
            >
              {sessionGenerating
                ? <><Loader2 size={13} className="spin" /> Generating…</>
                : <><GraduationCap size={13} /> Practice questions</>}
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
            <X size={13} /> Clear
          </button>
          {sessionError && (
            <span className="hub-session-error">{sessionError}</span>
          )}
        </div>
      )}

      {/* Note list */}
      {loading ? (
        <div className="hub-loading">
          <Loader2 size={28} className="spin" style={{ color: 'var(--color-primary)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="hub-empty">
          <Inbox size={36} className="hub-empty-icon" />
          {notes.length === 0
            ? <>
                <p className="text-muted">No notes yet. Upload some notes to get started.</p>
                <Link to="/library" className="btn btn-secondary btn-sm">Go to Library</Link>
              </>
            : <p className="text-muted">No notes match your search.</p>
          }
        </div>
      ) : (
        <div className="hub-groups">
          {Object.entries(grouped).map(([courseName, groupNotes]) => (
            <div key={courseName} className="hub-group">
              <div className="hub-group-header">
                <BookOpen size={14} />
                <span>{courseName}</span>
                <span className="hub-group-count">{groupNotes.length}</span>
              </div>
              <div className="hub-cards">
                {groupNotes.map(note => (
                  <NoteStudyCard
                    key={note.id}
                    note={note}
                    checked={selected.has(note.id)}
                    onToggle={() => toggleNote(note.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Saved sessions history */}
      {sessions.length > 0 && (
        <div className="hub-sessions">
          <div className="hub-group-header" style={{ marginTop: 32 }}>
            <History size={14} />
            <span>Saved sessions</span>
            <span className="hub-group-count">{sessions.length}</span>
          </div>
          <div className="hub-cards">
            {sessions.map(s => (
              <SavedSessionCard
                key={s.id}
                session={s}
                onOpen={() => setSession(s)}
                onDelete={() => handleDeleteSession(s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Multi-note study session overlay */}
      {session && (
        <StudySessionOverlay
          session={session}
          onClose={() => { setSession(null); setSessionError(null) }}
        />
      )}
    </div>
  )
}

// ── Note card with checkbox ───────────────────────────────────────────────────

function NoteStudyCard({ note, checked, onToggle }) {
  const hasFlashcards = (note.flashcard_count ?? 0) > 0
  const hasQuestions  = (note.question_count  ?? 0) > 0

  return (
    <div
      className={`hub-card${checked ? ' hub-card--selected' : ''}`}
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && onToggle()}
    >
      <div className="hub-card-check">
        {checked
          ? <CheckSquare size={17} className="hub-check-icon hub-check-icon--on" />
          : <Square size={17} className="hub-check-icon" />}
      </div>

      <div className="hub-card-body">
        <div className="hub-card-icon">
          {note.extraction_mode === 'study_guide'
            ? <Sparkles size={15} />
            : <BookOpen size={15} />
          }
        </div>
        <div className="hub-card-info">
          <p className="hub-card-title">{note.title}</p>
          <div className="hub-card-pills">
            {hasFlashcards && (
              <span className="badge badge-gray hub-pill">
                <Layers size={10} /> {note.flashcard_count} cards
              </span>
            )}
            {hasQuestions && (
              <span className="badge badge-gray hub-pill">
                <HelpCircle size={10} /> {note.question_count} questions
              </span>
            )}
            {!hasFlashcards && !hasQuestions && (
              <span className="text-faint" style={{ fontSize: '0.75rem' }}>No saved study materials</span>
            )}
          </div>
        </div>
      </div>

      {/* Individual study link — stop propagation so it doesn't toggle the checkbox */}
      <Link
        to={`/notes/${note.id}/study`}
        className="btn btn-ghost btn-sm hub-card-btn"
        title="Study this note individually"
        onClick={e => e.stopPropagation()}
      >
        <ChevronRight size={13} />
      </Link>
    </div>
  )
}

// ── Saved session card ────────────────────────────────────────────────────────

function SavedSessionCard({ session, onOpen, onDelete }) {
  const isFlashcards = session.tool === 'flashcards'
  const date = new Date(session.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="hub-card hub-session-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div className="hub-card-check">
        {isFlashcards ? <Layers size={17} style={{ color: 'var(--color-primary)' }} /> : <GraduationCap size={17} style={{ color: 'var(--color-primary)' }} />}
      </div>
      <div className="hub-card-body">
        <div className="hub-card-info">
          <p className="hub-card-title">
            {isFlashcards ? 'Flashcards' : 'Practice Questions'}
            <span className="hub-session-count"> · {session.items.length} {isFlashcards ? 'cards' : 'questions'}</span>
          </p>
          <div className="hub-card-pills">
            {session.note_titles.map((t, i) => (
              <span key={i} className="session-note-chip">{t}</span>
            ))}
            <span className="text-faint" style={{ fontSize: '0.72rem' }}>{date}</span>
          </div>
        </div>
      </div>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={e => { e.stopPropagation(); onDelete() }}
        aria-label="Delete session"
        title="Delete session"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// ── Study session overlay ─────────────────────────────────────────────────────

function StudySessionOverlay({ session, onClose }) {
  const isFlashcards = session.tool === 'flashcards'

  return (
    <div className="session-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="session-modal">
        <div className="session-modal-header">
          <div className="session-modal-meta">
            {isFlashcards ? <Layers size={15} /> : <GraduationCap size={15} />}
            <span className="session-modal-tool">
              {isFlashcards ? 'Flashcards' : 'Practice Questions'}
            </span>
            <span className="session-modal-dot">·</span>
            <div className="session-note-chips">
              {session.note_titles.map((t, i) => (
                <span key={i} className="session-note-chip">{t}</span>
              ))}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close session">
            <X size={16} />
          </button>
        </div>

        <div className="session-modal-body">
          {isFlashcards
            ? <EphemeralFlashcards cards={session.items} />
            : <EphemeralQuestions  questions={session.items} />}
        </div>
      </div>
    </div>
  )
}

// ── Ephemeral flashcard session ───────────────────────────────────────────────

function EphemeralFlashcards({ cards }) {
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

// ── Ephemeral practice questions ──────────────────────────────────────────────

function EphemeralQuestions({ questions }) {
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
          // options may be a pre-parsed array (from study session) or a JSON string (from DB)
          let options = null
          try {
            if (Array.isArray(q.options)) options = q.options
            else if (q.options)           options = JSON.parse(q.options)
          } catch { /* noop */ }

          // Map answer letter (A/B/C/D) to index for highlighting
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
