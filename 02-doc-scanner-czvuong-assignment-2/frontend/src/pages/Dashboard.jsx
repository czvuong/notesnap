import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, BookOpen, Upload, Sparkles, ArrowRight,
  Loader2, TrendingUp, Clock,
} from 'lucide-react'
import { listNotes, listCourses } from '../api.js'
import './Dashboard.css'

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

export default function Dashboard() {
  const [recentNotes,     setRecentNotes]     = useState([])
  const [courses,         setCourses]         = useState([])
  const [totalNotes,      setTotalNotes]      = useState(0)
  const [studyGuideCount, setStudyGuideCount] = useState(0)
  const [loading,         setLoading]         = useState(true)

  useEffect(() => {
    Promise.all([
      listNotes({ sort: 'newest', limit: 6 }),              // recent 6 for display
      listNotes({ mode: 'study_guide', limit: 1 }),         // just for .total count
      listCourses(),
    ])
      .then(([notesData, studyData, coursesData]) => {
        setRecentNotes(notesData.items ?? notesData)
        setTotalNotes(notesData.total ?? 0)
        setStudyGuideCount(studyData.total ?? 0)
        setCourses(coursesData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalCourses = courses.length

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Dashboard</h1>
          <p>Welcome back. Here's what's happening.</p>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="stat-grid">
        <StatCard
          icon={<FileText size={20} />}
          label="Notes"
          value={loading ? '—' : totalNotes}
          sub="in your library"
          to="/library"
        />
        <StatCard
          icon={<BookOpen size={20} />}
          label="Courses"
          value={loading ? '—' : totalCourses}
          sub="active this term"
          to="/library?sort=alpha"
        />
        <StatCard
          icon={<Sparkles size={20} />}
          label="Study guides"
          value={loading ? '—' : studyGuideCount}
          sub="AI-structured notes"
          to="/library?mode=study_guide"
        />
        <StatCard
          icon={<TrendingUp size={20} />}
          label="Quick upload"
          value={null}
          sub="Snap and process a new photo"
          to="/upload"
          cta
        />
      </div>

      {/* ── Recent notes ── */}
      <section className="dash-section">
        <div className="dash-section-header">
          <div className="dash-section-title">
            <Clock size={15} />
            <h2>Recent notes</h2>
          </div>
          <Link to="/library" className="btn btn-ghost btn-sm">
            View all <ArrowRight size={13} />
          </Link>
        </div>

        {loading ? (
          <div className="dash-loading">
            <Loader2 size={22} className="spin" style={{ color: 'var(--color-primary)' }} />
          </div>
        ) : recentNotes.length === 0 ? (
          <EmptyRecent />
        ) : (
          <div className="recent-grid">
            {recentNotes.map(note => (
              <RecentNoteCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </section>

      {/* ── Courses ── */}
      {courses.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">
              <BookOpen size={15} />
              <h2>Courses</h2>
            </div>
          </div>
          <div className="course-list">
            {courses.map(c => (
              <Link key={c.id} to={`/courses/${c.id}`} className="course-row">
                <div className="course-row-icon">
                  <BookOpen size={14} />
                </div>
                <div className="course-row-info">
                  <span className="course-row-name">{c.name}</span>
                  {c.term && <span className="course-row-term">{c.term}</span>}
                </div>
                <div className="course-row-right">
                  <span className="badge badge-gray">{c.note_count ?? 0} notes</span>
                  <ArrowRight size={14} className="course-row-arrow" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, to, cta }) {
  return (
    <Link to={to} className={`stat-card${cta ? ' stat-card--cta' : ''}`}>
      <div className="stat-card-icon">{icon}</div>
      <div className="stat-card-body">
        <p className="stat-card-label">{label}</p>
        {value !== null
          ? <p className="stat-card-value">{value}</p>
          : <p className="stat-card-cta-text">{sub}</p>
        }
        {value !== null && <p className="stat-card-sub">{sub}</p>}
      </div>
      {cta && (
        <div className="stat-card-arrow">
          <Upload size={18} />
        </div>
      )}
    </Link>
  )
}

// ── Recent note card ──────────────────────────────────────────────────────────

function RecentNoteCard({ note }) {
  return (
    <Link to={`/notes/${note.id}`} className="recent-card">
      <div className="recent-card-top">
        <span className={`badge ${note.extraction_mode === 'study_guide' ? 'badge-purple' : 'badge-gray'}`}>
          {note.extraction_mode === 'study_guide' ? 'Study guide' : 'Transcription'}
        </span>
        <span className="recent-card-date">{formatDate(note.created_at)}</span>
      </div>
      <p className="recent-card-title">{note.title}</p>
      {note.course && (
        <p className="recent-card-course">
          <BookOpen size={11} /> {note.course.name}
        </p>
      )}
    </Link>
  )
}

// ── Empty recent ──────────────────────────────────────────────────────────────

function EmptyRecent() {
  return (
    <div className="dash-empty">
      <p className="text-muted text-sm">No notes yet.</p>
      <Link to="/upload" className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>
        <Upload size={14} /> Upload your first note
      </Link>
    </div>
  )
}
