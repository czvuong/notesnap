import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  GraduationCap, Search, BookOpen, Sparkles,
  Layers, HelpCircle, ChevronRight, Loader2, Inbox, X,
  CheckSquare, Square, History, Trash2, RefreshCw,
} from 'lucide-react'
import { listNotes, listCourses, generateStudySession, listStudySessions, deleteStudySession } from '../api.js'
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
  const navigate                    = useNavigate()
  const [searchParams]              = useSearchParams()

  const [notes,    setNotes]    = useState([])
  const [courses,  setCourses]  = useState([])
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [q,        setQ]        = useState('')
  const [courseId, setCourseId] = useState('')

  // Multi-select
  const [selected, setSelected] = useState(new Set())

  const [sessionGenerating,  setSessionGenerating]  = useState(false)
  const [sessionError,       setSessionError]       = useState(null)

  function loadSessions() {
    listStudySessions().then(setSessions).catch(() => {})
  }

  useEffect(() => {
    Promise.all([fetchAllNotes(), listCourses()])
      .then(([n, c]) => {
        setNotes(n)
        setCourses(c)
        // Pre-select note if ?note=:id was passed (e.g. from NoteEditor "Study Tools" button)
        const preNote = searchParams.get('note')
        if (preNote) setSelected(new Set([preNote]))
      })
      .finally(() => setLoading(false))
    loadSessions()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function startSession(tool, force = false) {
    if (selected.size === 0) return
    setSessionGenerating(true)
    setSessionError(null)
    try {
      const data = await generateStudySession([...selected], tool, force)
      loadSessions()   // refresh history list
      navigate(`/study-session/${data.id}`, { state: { session: data } })
    } catch (e) {
      setSessionError(e.message ?? 'Failed to generate study session.')
      setSessionGenerating(false)
    }
  }

  async function handleDeleteSession(id) {
    await deleteStudySession(id).catch(() => {})
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  async function handleRegenerateSession(session) {
    setSessionGenerating(true)
    setSessionError(null)
    try {
      const data = await generateStudySession(session.note_ids, session.tool, true)
      loadSessions()
      navigate(`/study-session/${data.id}`, { state: { session: data } })
    } catch (e) {
      setSessionError(e.message ?? 'Failed to regenerate session.')
      setSessionGenerating(false)
    }
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
              className="btn btn-ghost btn-icon btn-sm"
              disabled={sessionGenerating}
              onClick={() => startSession('flashcards', true)}
              title="Generate a fresh set of flashcards (ignore cache)"
            >
              <RefreshCw size={13} />
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
            <button
              className="btn btn-ghost btn-icon btn-sm"
              disabled={sessionGenerating}
              onClick={() => startSession('practice_questions', true)}
              title="Generate a fresh set of practice questions (ignore cache)"
            >
              <RefreshCw size={13} />
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
                    sessions={sessions}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Saved sessions history — grouped by note / course */}
      {sessions.length > 0 && (
        <div className="hub-sessions">
          <div className="hub-group-header" style={{ marginTop: 32 }}>
            <History size={14} />
            <span>Saved sessions</span>
            <span className="hub-group-count">{sessions.length}</span>
          </div>

          <div className="hub-cards">
            {sessions.map(s => {
              const sessionNotes = s.note_ids.map(nid => notes.find(n => n.id === nid)).filter(Boolean)
              return (
                <SavedSessionCard
                  key={s.id}
                  session={s}
                  onOpen={() => navigate(`/study-session/${s.id}`, { state: { session: s } })}
                  onDelete={() => handleDeleteSession(s.id)}
                  onRegenerate={() => handleRegenerateSession(s)}
                  regenerating={sessionGenerating}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Note card with checkbox ───────────────────────────────────────────────────

function NoteStudyCard({ note, checked, onToggle, sessions = [] }) {
  const hasFlashcards = (note.flashcard_count ?? 0) > 0
  const hasQuestions  = (note.question_count  ?? 0) > 0
  // Count saved sessions that include this note (covers Hub-generated sessions)
  const sessionCount  = sessions.filter(
    s => Array.isArray(s.note_ids) && s.note_ids.includes(note.id)
  ).length

  const hasAnything = hasFlashcards || hasQuestions || sessionCount > 0

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
            {sessionCount > 0 && (
              <span className="badge badge-gray hub-pill">
                <History size={10} /> {sessionCount} session{sessionCount !== 1 ? 's' : ''}
              </span>
            )}
            {!hasAnything && (
              <span className="text-faint" style={{ fontSize: '0.75rem' }}>No saved study materials</span>
            )}
          </div>
        </div>
      </div>

      {/* Individual study link — stop propagation so it doesn't toggle the checkbox */}
      <Link
        to={`/notes/${note.id}/study`}
        className="btn btn-ghost btn-sm hub-card-btn"
        title="Open per-note flashcards & questions"
        onClick={e => e.stopPropagation()}
      >
        <ChevronRight size={13} />
      </Link>
    </div>
  )
}

// ── Saved session card ────────────────────────────────────────────────────────

function SavedSessionCard({ session, onOpen, onDelete, onRegenerate, regenerating }) {
  const isFlashcards = session.tool === 'flashcards'
  const date = new Date(session.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  })

  // Always show note title chips
  const chipLabels = (session.note_titles ?? []).map(t => ({ label: t }))

  return (
    <div className="hub-card hub-session-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div className="hub-card-check">
        {isFlashcards
          ? <Layers size={17} style={{ color: 'var(--color-primary)' }} />
          : <GraduationCap size={17} style={{ color: 'var(--color-primary)' }} />}
      </div>
      <div className="hub-card-body">
        <div className="hub-card-info">
          <p className="hub-card-title">
            {isFlashcards ? 'Flashcards' : 'Practice Questions'}
          </p>
          <div className="hub-card-pills" style={{ marginTop: 4 }}>
            {chipLabels.map(({ label }) => (
              <span key={label} className="session-note-chip">
                {label}
              </span>
            ))}
            <span className="text-faint" style={{ fontSize: '0.75rem' }}>
              · {session.items.length} {isFlashcards ? 'cards' : 'questions'} · {date}
            </span>
          </div>
        </div>
      </div>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        disabled={regenerating}
        onClick={e => { e.stopPropagation(); onRegenerate() }}
        aria-label="Generate new set"
        title="Generate a fresh set"
      >
        {regenerating ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
      </button>
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

