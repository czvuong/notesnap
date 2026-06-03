/**
 * PublicNoteView.jsx — Read-only public page at /share/:slug
 *
 * This page is accessible WITHOUT authentication.
 * It is rendered OUTSIDE the Clerk <SignedIn> wrapper in App.jsx.
 *
 * Only notes with is_public = true are returned by the backend.
 * The viewer cannot edit, delete, or interact with the note in any way.
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Loader2, AlertCircle, BookOpen } from 'lucide-react'
import { getPublicNote } from '../api.js'
import { renderInlineMath, renderRichText } from '../utils/mathRender.jsx'
import './PublicNoteView.css'

const CONTENT_TYPE_LABELS = {
  text:                'Text',
  bullet_list:         'Bullets',
  equation:            'Equation',
  image:               'Image',
  diagram_description: 'Diagram',
}

export default function PublicNoteView() {
  const { slug } = useParams()
  const [note,    setNote]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    getPublicNote(slug)
      .then(setNote)
      .catch(e => setError(e.status === 404 ? 'This note is not available.' : (e.message ?? 'Could not load note.')))
      .finally(() => setLoading(false))
  }, [slug])

  return (
    <div className="public-page">
      {/* Minimal branding header */}
      <header className="public-header">
        <Link to="/" className="public-brand">
          <BookOpen size={18} />
          <span>NoteSnap</span>
        </Link>
        <span className="public-badge">Shared note · view only</span>
      </header>

      <main className="public-main">
        {loading && (
          <div className="public-loading">
            <Loader2 size={22} className="spin" />
            <span>Loading…</span>
          </div>
        )}

        {!loading && error && (
          <div className="public-error">
            <AlertCircle size={22} />
            <h2>{error}</h2>
            <p>The note may have been made private or the link is incorrect.</p>
          </div>
        )}

        {!loading && note && (
          <article className="public-note">
            <h1 className="public-note-title">{note.title}</h1>
            <p className="public-note-meta">
              {note.extraction_mode === 'study_guide' ? 'Study guide' : 'Transcription'}
              {' · '}
              {new Date(note.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <div className="public-sections">
              {note.sections.map(section => (
                <PublicSection key={section.id} section={section} />
              ))}
            </div>
          </article>
        )}
      </main>

      <footer className="public-footer">
        <p>Created with <Link to="/">NoteSnap</Link> · AI-powered note extraction</p>
      </footer>
    </div>
  )
}


// ── Individual section renderer ────────────────────────────────────────────────

function PublicSection({ section }) {
  const { heading, content_type, content } = section

  const renderContent = () => {
    if (content_type === 'image') {
      return <img src={content} alt={heading ?? 'Note image'} className="public-section-image" />
    }

    if (content_type === 'equation') {
      return (
        <div className="public-section-equation">
          {renderInlineMath(`$$${content}$$`)}
        </div>
      )
    }

    if (content_type === 'bullet_list') {
      return (
        <ul className="public-section-bullets">
          {content.split('\n').filter(Boolean).map((line, i) => (
            <li key={i}>{renderRichText(line.replace(/^[-•]\s*/, ''))}</li>
          ))}
        </ul>
      )
    }

    if (content_type === 'diagram_description') {
      return (
        <div className="public-section-diagram">
          <p className="public-section-type-label">{CONTENT_TYPE_LABELS[content_type]}</p>
          <p>{renderRichText(content)}</p>
        </div>
      )
    }

    // Default: text
    return <div className="public-section-text">{renderRichText(content)}</div>
  }

  return (
    <section className="public-section">
      {heading && <h2 className="public-section-heading">{heading}</h2>}
      {renderContent()}
    </section>
  )
}
