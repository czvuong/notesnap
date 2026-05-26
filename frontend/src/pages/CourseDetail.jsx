import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  BookOpen, ArrowLeft, Pencil, Trash2, Check, X,
  FileText, Sparkles, Plus, Loader2, Calendar,
  GraduationCap, AlertCircle,
} from 'lucide-react'
import {
  getCourse, updateCourse, deleteCourse,
  listNotes, generateCourseSummary,
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CourseDetail() {
  const { id }    = useParams()
  const navigate  = useNavigate()

  const [course,    setCourse]    = useState(null)
  const [notes,     setNotes]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  // Inline title edit
  const [editName,  setEditName]  = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const nameRef = useRef(null)

  // Course summary (AI)
  const [summary,         setSummary]         = useState(null)
  const [summaryLoading,  setSummaryLoading]  = useState(false)
  const [summaryError,    setSummaryError]    = useState(null)

  // Delete modal
  const [showDelete, setShowDelete] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      getCourse(id),
      listNotes({ course_id: id, sort: 'newest', limit: 50 }),
    ])
      .then(([c, n]) => {
        setCourse(c)
        setNotes(n.items ?? n)
      })
      .catch(e => setError(e.message ?? 'Failed to load course.'))
      .finally(() => setLoading(false))
  }, [id])

  // Focus name input when editing
  useEffect(() => {
    if (editName) nameRef.current?.focus()
  }, [editName])

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
      navigate('/', { replace: true })
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
      setSummary(result.summary ?? result.content ?? JSON.stringify(result))
    } catch (e) {
      setSummaryError(e.message ?? 'Could not generate summary.')
    } finally {
      setSummaryLoading(false)
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
        <Link to="/" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
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
          <Link to="/" className="btn btn-ghost btn-sm back-btn">
            <ArrowLeft size={14} /> Dashboard
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
            <h2>Course summary</h2>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={summaryLoading || notes.length === 0}
            onClick={handleGenerateSummary}
          >
            {summaryLoading
              ? <><Loader2 size={13} className="spin" /> Generating…</>
              : <><Sparkles size={13} /> Generate</>}
          </button>
        </div>

        {summaryError && (
          <div className="banner banner-error">
            <AlertCircle size={13} /> {summaryError}
          </div>
        )}

        {summary ? (
          <div className="course-summary-body">
            {summary.split('\n').filter(Boolean).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">
            {notes.length === 0
              ? 'Add notes to this course to generate a summary.'
              : 'Click Generate to create an AI-powered summary of all notes in this course.'}
          </p>
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
