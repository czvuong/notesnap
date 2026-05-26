import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  GraduationCap, Search, BookOpen, Sparkles,
  Layers, HelpCircle, ChevronRight, Loader2, Inbox, X,
} from 'lucide-react'
import { listNotes, listCourses } from '../api.js'
import './StudyHub.css'

// Backend caps at 100 per page — fetch multiple pages if needed
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

export default function StudyHub() {
  const [notes,    setNotes]    = useState([])
  const [courses,  setCourses]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [q,        setQ]        = useState('')
  const [courseId, setCourseId] = useState('')

  useEffect(() => {
    Promise.all([fetchAllNotes(), listCourses()])
      .then(([n, c]) => {
        setNotes(n)
        setCourses(c)
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = notes.filter(note => {
    const matchQ = !q || note.title.toLowerCase().includes(q.toLowerCase())
    const matchC = !courseId || String(note.course_id) === courseId
    return matchQ && matchC
  })

  // Group by course — when a specific course is filtered, all notes share the same name,
  // so the single group header will show that course's name naturally.
  const grouped = filtered.reduce((acc, note) => {
    const key = note.course?.name ?? 'No course'
    if (!acc[key]) acc[key] = []
    acc[key].push(note)
    return acc
  }, {})

  return (
    <div className="study-hub">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Study Tools</h1>
          <p>Generate flashcards and practice questions for any note.</p>
        </div>
      </div>

      {/* Filters */}
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
      </div>

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
                  <NoteStudyCard key={note.id} note={note} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteStudyCard({ note }) {
  const hasFlashcards = (note.flashcard_count ?? 0) > 0
  const hasQuestions  = (note.question_count  ?? 0) > 0

  return (
    <div className="hub-card">
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
              <span className="text-faint" style={{ fontSize: '0.75rem' }}>No study materials yet</span>
            )}
          </div>
        </div>
      </div>
      <Link
        to={`/notes/${note.id}/study`}
        className="btn btn-primary btn-sm hub-card-btn"
      >
        Study <ChevronRight size={13} />
      </Link>
    </div>
  )
}
