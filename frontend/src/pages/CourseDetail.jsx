import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  BookOpen, ArrowLeft, Pencil, Trash2, Check, X,
  FileText, Sparkles, Plus, Loader2, Calendar,
  GraduationCap, AlertCircle, Layers, HelpCircle,
} from 'lucide-react'
import {
  getCourse, updateCourse, deleteCourse,
  listNotes, generateCourseSummary, generateStudySession, listStudySessions,
} from '../api.js'
import './CourseDetail.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  const d    = new Date(iso)
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Render a short segment of text with **bold** and *italic* handled inline.
 */
function renderInline(text, key) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return (
    <span key={key}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2, -2)}</strong>
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={i}>{part.slice(1, -1)}</em>
        return part
      })}
    </span>
  )
}

/**
 * Convert a markdown string into React elements, handling the most common
 * patterns produced by the AI: headings, bullets, bold/italic, hr, paragraphs.
 */
function renderMarkdown(text) {
  if (!text) return null
  const lines    = text.split('\n')
  const elements = []
  let bulletBuffer = []
  let keyCounter   = 0
  const k = () => keyCounter++

  function flushBullets() {
    if (bulletBuffer.length === 0) return
    elements.push(
      <ul key={k()} className="course-md-list">
        {bulletBuffer.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    )
    bulletBuffer = []
  }

  for (const line of lines) {
    const t = line.trim()

    if (!t) {
      flushBullets()
      continue
    }

    if (t.startsWith('### ')) {
      flushBullets()
      elements.push(<h4 key={k()} className="course-md-h3">{renderInline(t.slice(4), 0)}</h4>)
    } else if (t.startsWith('## ')) {
      flushBullets()
      elements.push(<h3 key={k()} className="course-md-h2">{renderInline(t.slice(3), 0)}</h3>)
    } else if (t.startsWith('# ')) {
      flushBullets()
      elements.push(<h2 key={k()} className="course-md-h1">{renderInline(t.slice(2), 0)}</h2>)
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      bulletBuffer.push(renderInline(t.slice(2), k()))
    } else if (t === '---') {
      flushBullets()
      elements.push(<hr key={k()} className="course-md-hr" />)
    } else {
      flushBullets()
      elements.push(<p key={k()} className="course-md-p">{renderInline(t, 0)}</p>)
    }
  }
  flushBullets()
  return elements
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CourseDetail() {
  const { id }    = useParams()
  const navigate  = useNavigate()

  const [course,    setCourse]    = useState(null)
  const [notes,     setNotes]     = useState([])
  const [sessions,  setSessions]  = useState([])   // study sessions for this course
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  // Inline title edit
  const [editName,  setEditName]  = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const nameRef = useRef(null)

  // Course summary (AI) — persisted in localStorage
  const [summary,         setSummary]         = useState(() => {
    try { return localStorage.getItem(`notesnap_summary_${id}`) ?? null }
    catch { return null }
  })
  const [summaryLoading,  setSummaryLoading]  = useState(false)
  const [summaryError,    setSummaryError]    = useState(null)

  // Study tool generation
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false)
  const [generatingQuestions,  setGeneratingQuestions]  = useState(false)

  // Delete modal
  const [showDelete, setShowDelete] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      getCourse(id),
      listNotes({ course_id: id, sort: 'newest', limit: 50 }),
      listStudySessions().catch(() => []),
    ])
      .then(([c, n, allSessions]) => {
        setCourse(c)
        const notesArr = n.items ?? n
        setNotes(notesArr)
        // Keep only sessions that include at least one note from this course
        const noteIdSet = new Set(notesArr.map(note => note.id))
        setSessions(allSessions.filter(s =>
          Array.isArray(s.note_ids) && s.note_ids.some(nid => noteIdSet.has(nid))
        ))
      })
      .catch(e => setError(e.message ?? 'Failed to load course.'))
      .finally(() => setLoading(false))
  }, [id])

  // Focus name input when editing
  useEffect(() => {
    if (editName) nameRef.current?.focus()
  }, [editName])

  // ── Computed totals ───────────────────────────────────────────────────────
  // Per-note counts come from individual note generation.
  // Session counts come from generateStudySession (cross-note sessions).
  // We show the combined total.

  const noteIds = notes.map(n => n.id)

  const flashcardSessions       = sessions.filter(s => s.tool === 'flashcards')
  const questionSessions        = sessions.filter(s => s.tool === 'practice_questions')

  const perNoteFlashcardTotal   = notes.reduce((sum, n) => sum + (n.flashcard_count ?? 0), 0)
  const perNoteQuestionTotal    = notes.reduce((sum, n) => sum + (n.question_count  ?? 0), 0)
  const sessionFlashcardTotal   = flashcardSessions.reduce((sum, s) => sum + (s.items?.length ?? 0), 0)
  const sessionQuestionTotal    = questionSessions.reduce((sum, s) => sum + (s.items?.length ?? 0), 0)

  const flashcardTotal = perNoteFlashcardTotal + sessionFlashcardTotal
  const questionTotal  = perNoteQuestionTotal  + sessionQuestionTotal

  // Most-recent sessions for "Study" buttons
  const latestFlashcardSession  = flashcardSessions[0] ?? null
  const latestQuestionSession   = questionSessions[0]  ?? null

  // ── Rename ────────────────────────────────────────────────────────────────

  function startEditName() {
    setNameDraft(course.name)
    setEditName(true)
  }

  async function saveName() {
    if (!nameDraft.trim() || nameDraft.trim() === course.name) {
      setEditName(false)
      return
    }
    try {
      const updated = await updateCourse(id, { name: nameDraft.trim() })
      setCourse(updated)
    } catch { /* keep old name */ }
    setEditName(false)
  }

  function handleNameKey(e) {
    if (e.key === 'Enter')  saveName()
    if (e.key === 'Escape') setEditName(false)
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteCourse(id)
      navigate('/courses', { replace: true })
    } catch (e) {
      alert(e.message ?? 'Delete failed.')
      setDeleting(false)
      setShowDelete(false)
    }
  }

  // ── AI summary ────────────────────────────────────────────────────────────

  async function handleGenerateSummary() {
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const result = await generateCourseSummary(id)
      const text   = result.summary ?? result.content ?? JSON.stringify(result)
      setSummary(text)
      try { localStorage.setItem(`notesnap_summary_${id}`, text) } catch { /* quota */ }
    } catch (e) {
      setSummaryError(e.message ?? 'Could not generate summary.')
    } finally {
      setSummaryLoading(false)
    }
  }

  // ── Study tool generation ─────────────────────────────────────────────────

  async function handleGenerateFlashcards() {
    if (noteIds.length === 0) return
    setGeneratingFlashcards(true)
    try {
      const data = await generateStudySession(noteIds, 'flashcards')
      setSessions(prev => [data, ...prev])
      navigate(`/study-session/${data.id}`, { state: { session: data } })
    } catch (e) {
      alert(e.message ?? 'Could not generate flashcards.')
      setGeneratingFlashcards(false)
    }
  }

  async function handleGenerateQuestions() {
    if (noteIds.length === 0) return
    setGeneratingQuestions(true)
    try {
      const data = await generateStudySession(noteIds, 'practice_questions')
      setSessions(prev => [data, ...prev])
      navigate(`/study-session/${data.id}`, { state: { session: data } })
    } catch (e) {
      alert(e.message ?? 'Could not generate practice questions.')
      setGeneratingQuestions(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="course-detail-page">
        <div className="detail-loading">
          <Loader2 size={28} className="spin" style={{ color: 'var(--color-primary)' }} />
        </div>
      </div>
    )
  }

  if (error || !course) {
    return (
      <div className="course-detail-page">
        <div className="banner banner-error" style={{ marginTop: 24 }}>
          {error ?? 'Course not found.'}
        </div>
        <Link to="/courses" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
          <ArrowLeft size={14} /> Back
        </Link>
      </div>
    )
  }

  const studyGuideCount = notes.filter(n => n.extraction_mode === 'study_guide').length

  return (
    <div className="course-detail-page">
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-left">
          <Link to="/courses" className="btn btn-ghost btn-sm back-btn">
            <ArrowLeft size={14} /> Courses
          </Link>
          <div className="course-title-row">
            {editName ? (
              <div className="course-title-edit">
                <input
                  ref={nameRef}
                  className="input course-title-input"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={handleNameKey}
                  onBlur={saveName}
                />
                <button className="btn btn-ghost btn-icon btn-sm" onClick={saveName}>
                  <Check size={14} />
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditName(false)}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="course-title-static">
                <div className="course-hero-icon"><BookOpen size={20} /></div>
                <h1>{course.name}</h1>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={startEditName}>
                  <Pencil size={14} />
                </button>
              </div>
            )}
            {course.term && <span className="badge badge-gray">{course.term}</span>}
          </div>
        </div>
        <div className="page-header-actions">
          <Link to={`/upload?course=${id}`} className="btn btn-secondary">
            <Plus size={14} /> Add note
          </Link>
          <button className="btn btn-ghost btn-icon" onClick={() => setShowDelete(true)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Stat strip ── */}
      <div className="course-stats">
        <div className="course-stat">
          <FileText size={14} />
          <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="course-stat">
          <Sparkles size={14} />
          <span>{studyGuideCount} study guide{studyGuideCount !== 1 ? 's' : ''}</span>
        </div>
        {course.created_at && (
          <div className="course-stat">
            <Calendar size={14} />
            <span>Created {formatDate(course.created_at)}</span>
          </div>
        )}
      </div>

      {/* ── AI Summary ── */}
      <section className="course-summary-section">
        <div className="course-summary-header">
          <div className="course-summary-title">
            <GraduationCap size={15} />
            <h2>About this course</h2>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={summaryLoading || notes.length === 0}
            onClick={handleGenerateSummary}
          >
            {summaryLoading
              ? <><Loader2 size={13} className="spin" /> Generating…</>
              : <><Sparkles size={13} /> {summary ? 'Regenerate' : 'Generate'}</>}
          </button>
        </div>

        {summaryError && (
          <div className="banner banner-error">
            <AlertCircle size={13} /> {summaryError}
          </div>
        )}

        {summary ? (
          <div className="course-summary-body course-md">
            {renderMarkdown(summary)}
          </div>
        ) : (
          <p className="text-muted text-sm">
            {notes.length === 0
              ? 'Add notes to this course to generate a summary.'
              : 'Click Generate to create a short overview of what this course covers.'}
          </p>
        )}
      </section>

      {/* ── Flashcards ── */}
      <section className="course-study-section">
        <div className="course-study-header">
          <div className="course-study-title">
            <Layers size={15} />
            <h2>Flashcards</h2>
          </div>
          {flashcardTotal > 0 && (
            <span className="badge badge-primary">
              {flashcardTotal} card{flashcardTotal !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {flashcardTotal > 0 ? (
          <div className="course-study-body">
            <p className="text-sm text-muted">
              {flashcardTotal} flashcard{flashcardTotal !== 1 ? 's' : ''} across {notes.length} note{notes.length !== 1 ? 's' : ''}.
            </p>
            <div className="course-study-actions">
              {latestFlashcardSession ? (
                <Link
                  to={`/study-session/${latestFlashcardSession.id}`}
                  state={{ session: latestFlashcardSession }}
                  className="btn btn-secondary btn-sm"
                >
                  Study flashcards
                </Link>
              ) : (
                <Link to="/study" className="btn btn-secondary btn-sm">
                  Study flashcards
                </Link>
              )}
              <button
                className="btn btn-ghost btn-sm"
                disabled={generatingFlashcards || notes.length === 0}
                onClick={handleGenerateFlashcards}
              >
                {generatingFlashcards
                  ? <><Loader2 size={13} className="spin" /> Generating…</>
                  : <><Sparkles size={13} /> Generate more</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="course-study-empty">
            <p className="text-sm text-muted">
              {notes.length === 0
                ? 'Add notes to this course to create flashcards.'
                : 'No flashcards yet for this course.'}
            </p>
            {notes.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                disabled={generatingFlashcards}
                onClick={handleGenerateFlashcards}
              >
                {generatingFlashcards
                  ? <><Loader2 size={13} className="spin" /> Generating…</>
                  : <><Sparkles size={13} /> Create flashcards</>}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Practice Questions ── */}
      <section className="course-study-section">
        <div className="course-study-header">
          <div className="course-study-title">
            <HelpCircle size={15} />
            <h2>Practice questions</h2>
          </div>
          {questionTotal > 0 && (
            <span className="badge badge-primary">
              {questionTotal} question{questionTotal !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {questionTotal > 0 ? (
          <div className="course-study-body">
            <p className="text-sm text-muted">
              {questionTotal} practice question{questionTotal !== 1 ? 's' : ''} across {notes.length} note{notes.length !== 1 ? 's' : ''}.
            </p>
            <div className="course-study-actions">
              {latestQuestionSession ? (
                <Link
                  to={`/study-session/${latestQuestionSession.id}`}
                  state={{ session: latestQuestionSession }}
                  className="btn btn-secondary btn-sm"
                >
                  Practice now
                </Link>
              ) : (
                <Link to="/study" className="btn btn-secondary btn-sm">
                  Practice now
                </Link>
              )}
              <button
                className="btn btn-ghost btn-sm"
                disabled={generatingQuestions || notes.length === 0}
                onClick={handleGenerateQuestions}
              >
                {generatingQuestions
                  ? <><Loader2 size={13} className="spin" /> Generating…</>
                  : <><Sparkles size={13} /> Generate more</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="course-study-empty">
            <p className="text-sm text-muted">
              {notes.length === 0
                ? 'Add notes to this course to create practice questions.'
                : 'No practice questions yet for this course.'}
            </p>
            {notes.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                disabled={generatingQuestions}
                onClick={handleGenerateQuestions}
              >
                {generatingQuestions
                  ? <><Loader2 size={13} className="spin" /> Generating…</>
                  : <><Sparkles size={13} /> Create practice questions</>}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Notes list ── */}
      <section className="course-notes-section">
        <h2 className="course-notes-heading">Notes</h2>

        {notes.length === 0 ? (
          <div className="course-notes-empty">
            <p className="text-muted text-sm">No notes in this course yet.</p>
            <Link to={`/upload?course=${id}`} className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>
              <Plus size={14} /> Upload notes
            </Link>
          </div>
        ) : (
          <div className="course-notes-list">
            {notes.map(note => (
              <Link key={note.id} to={`/notes/${note.id}`} className="course-note-row">
                <div className="course-note-row-icon">
                  {note.extraction_mode === 'study_guide'
                    ? <Sparkles size={14} />
                    : <FileText size={14} />}
                </div>
                <div className="course-note-row-info">
                  <span className="course-note-row-title">{note.title}</span>
                  {note.tags?.length > 0 && (
                    <span className="course-note-row-tags">
                      {note.tags.slice(0, 3).map(t => (
                        <span key={t.id ?? t} className="badge badge-gray badge-xs">{t.name ?? t}</span>
                      ))}
                    </span>
                  )}
                </div>
                <span className="course-note-row-date">{formatDate(note.created_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Delete modal ── */}
      {showDelete && (
        <div className="modal-backdrop" onClick={() => setShowDelete(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ marginBottom: 12 }}>
              <Trash2 size={18} />
              <h3>Delete course?</h3>
            </div>
            <p className="text-sm text-muted" style={{ marginBottom: 20 }}>
              <strong>{course.name}</strong> will be moved to trash. Notes in this course are kept
              but will no longer be associated with a course.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? <><Loader2 size={13} className="spin" /> Deleting…</> : 'Delete course'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
