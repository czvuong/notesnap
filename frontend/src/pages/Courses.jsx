import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BookMarked, Plus, Loader2, BookOpen, FileText,
  GraduationCap,
} from 'lucide-react'
import { listCourses, createCourse } from '../api.js'
import './Courses.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  const d    = new Date(iso)
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CoursesPage() {
  const navigate = useNavigate()

  const [courses,     setCourses]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  // Create-course inline form
  const [showCreate,  setShowCreate]  = useState(false)
  const [newName,     setNewName]     = useState('')
  const [newTerm,     setNewTerm]     = useState('')
  const [creating,    setCreating]    = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    listCourses()
      .then(data => setCourses(Array.isArray(data) ? data : (data.items ?? [])))
      .catch(e => setError(e.message ?? 'Failed to load courses.'))
      .finally(() => setLoading(false))
  }, [])

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const course = await createCourse({
        name: newName.trim(),
        ...(newTerm.trim() ? { term: newTerm.trim() } : {}),
      })
      // Navigate directly to the new course
      navigate(`/courses/${course.id}`)
    } catch (err) {
      alert(err.message ?? 'Could not create course.')
      setCreating(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="courses-page">
        <div className="courses-loading">
          <Loader2 size={28} className="spin" style={{ color: 'var(--color-primary)' }} />
          <span>Loading courses…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="courses-page">
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-icon">
            <BookMarked size={18} />
          </div>
          <div>
            <h1 className="page-title">Courses</h1>
            <p className="page-subtitle text-muted text-sm">
              {courses.length} course{courses.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(v => !v)}
          >
            <Plus size={14} /> New course
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ── Create form ── */}
      {showCreate && (
        <form className="courses-create-form" onSubmit={handleCreate}>
          <input
            className="input"
            placeholder="Course name (e.g. Intro to Machine Learning)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
            required
          />
          <input
            className="input"
            placeholder="Term (optional, e.g. Spring 2025)"
            value={newTerm}
            onChange={e => setNewTerm(e.target.value)}
          />
          <div className="courses-create-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setShowCreate(false); setNewName(''); setNewTerm('') }}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={creating || !newName.trim()}
            >
              {creating
                ? <><Loader2 size={13} className="spin" /> Creating…</>
                : 'Create course'}
            </button>
          </div>
        </form>
      )}

      {/* ── Course grid / empty state ── */}
      {courses.length === 0 && !showCreate ? (
        <div className="courses-empty">
          <div className="courses-empty-icon">
            <BookOpen size={28} />
          </div>
          <h3 className="courses-empty-title">No courses yet</h3>
          <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
            Create a course to organize your notes by subject.
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} /> New course
          </button>
        </div>
      ) : (
        <div className="courses-grid">
          {courses.map(course => (
            <Link key={course.id} to={`/courses/${course.id}`} className="course-card">
              <div className="course-card-icon-wrap">
                <GraduationCap size={26} />
              </div>

              <div className="course-card-body">
                <div className="course-card-name">{course.name}</div>
                {course.term && (
                  <span className="badge badge-gray badge-xs course-card-term">{course.term}</span>
                )}
              </div>

              <div className="course-card-footer">
                {course.note_count != null && (
                  <span className="course-card-stat">
                    <FileText size={11} />
                    {course.note_count} note{course.note_count !== 1 ? 's' : ''}
                  </span>
                )}
                {course.created_at && (
                  <span className="course-card-stat course-card-date">
                    {formatDate(course.created_at)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
