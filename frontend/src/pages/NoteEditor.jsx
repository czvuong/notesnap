import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Pencil, Trash2, Clock, BookOpen, Tag,
  X, Check, Plus, ChevronDown, ChevronUp, AlertCircle,
  RotateCcw, Sparkles, GraduationCap, Loader2, Save, FileImage,
  Share2, Copy, Download, Globe, Lock,
} from 'lucide-react'
import {
  getNote, updateNote, updateSection, deleteNote,
  addTag, removeTag, listCourses, listTags, createCourse,
  getSectionRevisions, restoreRevision,
  createCorrection, deleteSection, addSection, uploadSectionImage,
  shareNote,
} from '../api.js'
import { getSourceFile } from '../utils/fileStore.js'
import './NoteEditor.css'

import { stripMdBold, renderInlineMath, renderRichText } from '../utils/mathRender.jsx'
import TagSelect from '../components/TagSelect.jsx'

const CONTENT_TYPE_LABELS = {
  text:                'Text',
  bullet_list:         'Bullets',
  equation:            'Equation',
  image:               'Image',
  diagram_description: 'Diagram',
}

const CORRECTION_TYPES = [
  { id: 'spelling',      label: 'Spelling fix'    },
  { id: 'terminology',   label: 'Wrong term'      },
  { id: 'formatting',    label: 'Formatting'      },
  { id: 'content',       label: 'Wrong content'   },
  { id: 'section_rename',label: 'Section rename'  },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NoteEditor() {
  const { id }     = useParams()
  const navigate   = useNavigate()

  const [note,          setNote]          = useState(null)
  const [courses,       setCourses]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)

  // Which section is being edited inline
  const [editingId,     setEditingId]     = useState(null)
  const [editDraft,     setEditDraft]     = useState({})

  // Correction prompt shown after a section save
  const [corrPrompt,    setCorrPrompt]    = useState(null)  // { sectionId, original, corrected }

  // Revision history drawer
  const [revisionsId,   setRevisionsId]   = useState(null)
  const [revisions,     setRevisions]     = useState([])
  const [revisionsLoading, setRevisionsLoading] = useState(false)

  // Title editing
  const [editingTitle,  setEditingTitle]  = useState(false)
  const [titleDraft,    setTitleDraft]    = useState('')

  // Course editing
  const [showCourseEdit,setShowCourseEdit]= useState(false)

  // Delete confirmation
  const [showDelete,    setShowDelete]    = useState(false)
  const [deleting,      setDeleting]      = useState(false)

  // Share modal
  const [showShare,     setShowShare]     = useState(false)
  const [shareLoading,  setShareLoading]  = useState(false)
  const [copied,        setCopied]        = useState(false)

  // All tag names for suggestions
  const [allTags,       setAllTags]       = useState([])

  // Inline new-course creation inside the sidebar
  const [addingCourse,  setAddingCourse]  = useState(false)
  const [newCourseName, setNewCourseName] = useState('')
  const [courseCreating, setCourseCreating] = useState(false)

  // Source file reference panel
  const [sourceUrl,     setSourceUrl]     = useState(null)
  const [sourceOpen,    setSourceOpen]    = useState(false)
  const [sourceIsPdf,   setSourceIsPdf]   = useState(false)

  // ── Load note ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    Promise.all([getNote(id), listCourses(), listTags()])
      .then(([n, c, t]) => {
        setNote(n)
        setCourses(c)
        setAllTags(t.map(tag => tag.name ?? tag))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  // Load source file from IndexedDB (best-effort — not all notes will have one)
  useEffect(() => {
    let objectUrl = null
    getSourceFile(id)
      .then(file => {
        if (!file) return
        objectUrl = URL.createObjectURL(file)
        setSourceUrl(objectUrl)
        setSourceIsPdf(file.type === 'application/pdf')
      })
      .catch(() => {})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id])

  // ── Title editing ───────────────────────────────────────────────────────────

  function startEditTitle() {
    setTitleDraft(note.title)
    setEditingTitle(true)
  }
  async function saveTitle() {
    if (!titleDraft.trim()) return
    try {
      const updated = await updateNote(id, { title: titleDraft.trim() })
      setNote(n => ({ ...n, title: updated.title }))
    } catch (e) { setError(e.message) }
    setEditingTitle(false)
  }

  // ── Section editing ─────────────────────────────────────────────────────────

  function startEdit(section) {
    setEditingId(section.id)
    setEditDraft({ heading: section.heading || '', content: section.content, content_type: section.content_type })
    setRevisionsId(null)
  }

  async function saveSection(section) {
    const changed = editDraft.content !== section.content || editDraft.heading !== (section.heading || '')
    try {
      const updated = await updateSection(id, section.id, {
        heading:      editDraft.heading || null,
        content:      editDraft.content,
        content_type: editDraft.content_type,
      })
      setNote(n => ({
        ...n,
        sections: n.sections.map(s => s.id === section.id ? updated : s),
      }))
      setEditingId(null)

      // Offer correction prompt only if content actually changed
      if (changed) {
        setCorrPrompt({
          sectionId: section.id,
          original:  section.content,
          corrected: editDraft.content,
        })
      }
    } catch (e) { setError(e.message) }
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft({})
  }

  async function handleDeleteSection(sectionId) {
    try {
      await deleteSection(id, sectionId)
      setNote(n => ({ ...n, sections: n.sections.filter(s => s.id !== sectionId) }))
    } catch (e) { setError(e.message) }
  }

  async function handleAddSection() {
    const order = note.sections.length
    try {
      // Backend requires content.length >= 1; use a placeholder that gets
      // auto-populated into the edit textarea so the user can replace it.
      const s = await addSection(id, { heading: '', content_type: 'text', content: 'New section', section_order: order })
      setNote(n => ({ ...n, sections: [...n.sections, s] }))
      startEdit(s)
    } catch (e) { setError(typeof e.message === 'string' ? e.message : 'Failed to add section.') }
  }

  // ── Corrections ─────────────────────────────────────────────────────────────

  async function saveCorrection(type) {
    if (!corrPrompt) return
    try {
      await createCorrection({
        section_id:     corrPrompt.sectionId,
        original_text:  corrPrompt.original,
        corrected_text: corrPrompt.corrected,
        correction_type: type,
      })
    } catch (e) { /* non-critical */ }
    setCorrPrompt(null)
  }

  // ── Revision history ────────────────────────────────────────────────────────

  async function toggleRevisions(sectionId) {
    if (revisionsId === sectionId) { setRevisionsId(null); return }
    setRevisionsId(sectionId)
    setRevisionsLoading(true)
    try {
      const data = await getSectionRevisions(id, sectionId)
      setRevisions(data)
    } catch (e) { setError(e.message) }
    finally { setRevisionsLoading(false) }
  }

  async function handleRestoreRevision(sectionId, revisionId) {
    try {
      const restored = await restoreRevision(id, sectionId, revisionId)
      setNote(n => ({
        ...n,
        sections: n.sections.map(s => s.id === sectionId ? restored : s),
      }))
      setRevisionsId(null)
    } catch (e) { setError(e.message) }
  }

  // ── Tags ────────────────────────────────────────────────────────────────────

  async function handleAddTagByName(name) {
    const normalized = name.trim().toLowerCase()
    if (!normalized) return
    try {
      const updated = await addTag(id, normalized)
      setNote(n => ({ ...n, tags: updated.tags }))
    } catch (e) { setError(e.message) }
  }

  async function handleRemoveTag(tagId) {
    try {
      await removeTag(id, tagId)
      setNote(n => ({ ...n, tags: n.tags.filter(t => t.id !== tagId) }))
    } catch (e) { setError(e.message) }
  }

  async function handleRemoveTagByName(name) {
    const tag = note.tags.find(t => t.name === name)
    if (tag) await handleRemoveTag(tag.id)
  }

  // ── Course ──────────────────────────────────────────────────────────────────

  async function handleCourseChange(courseId) {
    if (courseId === '__new__') {
      setAddingCourse(true)
      return
    }
    try {
      const updated = await updateNote(id, { course_id: courseId || null })
      setNote(n => ({ ...n, course_id: updated.course_id, course: updated.course }))
    } catch (e) { setError(e.message) }
    setShowCourseEdit(false)
  }

  async function handleCreateCourseInline() {
    const name = newCourseName.trim()
    if (!name) return
    setCourseCreating(true)
    try {
      const created = await createCourse({ name })
      setCourses(prev => [...prev, created])
      const updated = await updateNote(id, { course_id: created.id })
      setNote(n => ({ ...n, course_id: updated.course_id, course: updated.course }))
      setNewCourseName('')
      setAddingCourse(false)
      setShowCourseEdit(false)
    } catch (e) { setError(e.message) }
    finally { setCourseCreating(false) }
  }

  // ── Delete note ─────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteNote(id)
      navigate('/library')
    } catch (e) {
      setError(e.message)
      setDeleting(false)
      setShowDelete(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="editor-loading">
      <Loader2 size={28} className="spin" />
      <p className="text-muted">Loading note…</p>
    </div>
  )

  if (error && !note) return (
    <div className="empty-state">
      <div className="empty-state-icon"><AlertCircle size={24} /></div>
      <h3>Could not load note</h3>
      <p>{error}</p>
      <Link to="/library" className="btn btn-secondary mt-3"><ArrowLeft size={14} /> Back to Library</Link>
    </div>
  )

  return (
    <div className="note-editor">

      {/* Top bar */}
      <div className="editor-topbar">
        <Link to="/library" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Library
        </Link>
        <div className="editor-topbar-actions">
          <Link to={`/study?note=${id}`} className="btn btn-secondary btn-sm">
            <GraduationCap size={14} /> Study tools
          </Link>
          {sourceUrl && (
            <button
              className={`btn btn-sm${sourceOpen ? ' btn-secondary' : ' btn-ghost'}`}
              onClick={() => setSourceOpen(o => !o)}
              data-tooltip="Toggle source reference"
            >
              <FileImage size={14} /> Source
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowShare(true)}
            data-tooltip="Share or export"
          >
            <Share2 size={14} /> Share
          </button>
          <button className="btn btn-ghost btn-sm text-danger" onClick={() => setShowDelete(true)}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>
          <AlertCircle size={15} />{error}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setError(null)} style={{ marginLeft: 'auto' }}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className={`editor-body${sourceOpen && sourceUrl ? ' editor-body--with-source' : ''}`}>

        {/* Source reference pane */}
        {sourceOpen && sourceUrl && (
          <div className="editor-source-pane">
            <p className="editor-source-label">Source reference</p>
            {sourceIsPdf ? (
              <iframe
                className="editor-source-pdf"
                src={sourceUrl}
                title="Source PDF"
              />
            ) : (
              <img
                className="editor-source-img"
                src={sourceUrl}
                alt="Source file"
              />
            )}
          </div>
        )}

        <div className="editor-layout">

        {/* ── Main content ── */}
        <div className="editor-main">

          {/* Title */}
          <div className="editor-title-row">
            {editingTitle ? (
              <div className="editor-title-edit">
                <input
                  className="input editor-title-input"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveTitle()}
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" onClick={saveTitle}><Check size={13} /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingTitle(false)}><X size={13} /></button>
              </div>
            ) : (
              <>
                <h1 className="editor-title">{note.title}</h1>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={startEditTitle} data-tooltip="Edit title">
                  <Pencil size={14} />
                </button>
              </>
            )}
          </div>

          {/* Meta row */}
          <div className="editor-meta">
            <span className={`badge ${note.extraction_mode === 'study_guide' ? 'badge-accent' : 'badge-gray'}`}>
              {note.extraction_mode === 'study_guide' ? <><Sparkles size={10} /> Study guide</> : <><BookOpen size={10} /> Transcript</>}
            </span>
            <span className="text-faint text-xs">·</span>
            <span className="text-faint text-xs">{note.ai_model_used}</span>
            <span className="text-faint text-xs">·</span>
            <span className="text-faint text-xs">{formatDate(note.created_at)}</span>
          </div>

          {/* Correction prompt */}
          {corrPrompt && (
            <CorrectionPrompt
              onSave={saveCorrection}
              onDismiss={() => setCorrPrompt(null)}
            />
          )}

          {/* Sections */}
          <div className="editor-sections">
            {note.sections.map(section => (
              <div key={section.id} className="editor-section-wrap">
                {editingId === section.id ? (
                  <SectionEditCard
                    draft={editDraft}
                    onChange={setEditDraft}
                    onSave={() => saveSection(section)}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <SectionViewCard
                    section={section}
                    showingRevisions={revisionsId === section.id}
                    onEdit={() => startEdit(section)}
                    onDelete={() => handleDeleteSection(section.id)}
                    onToggleRevisions={() => toggleRevisions(section.id)}
                  />
                )}

                {/* Revision history drawer */}
                {revisionsId === section.id && (
                  <RevisionDrawer
                    revisions={revisions}
                    loading={revisionsLoading}
                    onRestore={revId => handleRestoreRevision(section.id, revId)}
                    onClose={() => setRevisionsId(null)}
                  />
                )}
              </div>
            ))}
          </div>

          <button className="btn btn-secondary btn-sm mt-3" onClick={handleAddSection}>
            <Plus size={13} /> Add section
          </button>
        </div>

        {/* ── Sidebar ── */}
        <aside className="editor-sidebar">

          {/* Course */}
          <div className="sidebar-section">
            <p className="section-label">Course</p>
            {showCourseEdit ? (
              addingCourse ? (
                <div className="flex flex-col gap-2">
                  <input
                    className="input"
                    placeholder="Course name"
                    value={newCourseName}
                    autoFocus
                    onChange={e => setNewCourseName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateCourseInline()
                      if (e.key === 'Escape') { setAddingCourse(false); setNewCourseName('') }
                    }}
                    disabled={courseCreating}
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleCreateCourseInline}
                      disabled={courseCreating || !newCourseName.trim()}
                    >
                      {courseCreating ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      {courseCreating ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setAddingCourse(false); setNewCourseName('') }}
                      disabled={courseCreating}
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <select
                    className="select"
                    defaultValue={note.course_id || ''}
                    onChange={e => handleCourseChange(e.target.value)}
                  >
                    <option value="">No course</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value="__new__">+ Add new course</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowCourseEdit(false)}>
                    Cancel
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2">
                {note.course ? (
                  <Link to={`/courses/${note.course.id}`} className="badge">
                    <BookOpen size={10} /> {note.course.name}
                  </Link>
                ) : (
                  <span className="text-muted text-sm">No course</span>
                )}
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowCourseEdit(true)} data-tooltip="Change course">
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="sidebar-section">
            <p className="section-label">Tags</p>
            <TagSelect
              selectedTags={note.tags.map(t => t.name)}
              allTags={allTags}
              onAdd={handleAddTagByName}
              onRemove={handleRemoveTagByName}
              placeholder="Add tag…"
            />
          </div>

          {/* Stats */}
          <div className="sidebar-section">
            <p className="section-label">Details</p>
            <div className="editor-stats">
              <div className="editor-stat">
                <span className="text-muted text-xs">Sections</span>
                <span className="text-sm" style={{ fontWeight: 600 }}>{note.sections.length}</span>
              </div>
              <div className="editor-stat">
                <span className="text-muted text-xs">Created</span>
                <span className="text-sm">{formatDate(note.created_at)}</span>
              </div>
              <div className="editor-stat">
                <span className="text-muted text-xs">Last edited</span>
                <span className="text-sm">{formatDate(note.updated_at)}</span>
              </div>
            </div>
          </div>

        </aside>
        </div>{/* end editor-layout */}
      </div>{/* end editor-body */}

      {/* Delete confirmation modal */}
      {showDelete && (
        <DeleteModal
          title={note.title}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {/* Share / export modal */}
      {showShare && (
        <ShareModal
          note={note}
          loading={shareLoading}
          copied={copied}
          onTogglePublic={async (makePublic) => {
            setShareLoading(true)
            try {
              const updated = await shareNote(id, makePublic)
              setNote(updated)
            } catch (e) {
              setError(e.message ?? 'Could not update sharing.')
            } finally {
              setShareLoading(false)
            }
          }}
          onCopy={() => {
            const url = `${window.location.origin}/share/${note.public_slug}`
            navigator.clipboard.writeText(url).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }}
          onDownload={() => {
            const md = noteToMarkdown(note)
            const blob = new Blob([md], { type: 'text/markdown' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${note.title.replace(/[^a-z0-9]/gi, '_')}.md`
            a.click()
            URL.revokeObjectURL(a.href)
          }}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}

// ── Section view ──────────────────────────────────────────────────────────────

function SectionViewCard({ section, showingRevisions, onEdit, onDelete, onToggleRevisions }) {
  return (
    <div className="section-view">

      {/* Hover-reveal action toolbar — absolutely positioned top-right */}
      <div className="section-view-actions">
        <button
          className={`btn btn-ghost btn-icon btn-sm ${showingRevisions ? 'active' : ''}`}
          onClick={onToggleRevisions}
          data-tooltip="Version history"
        >
          <Clock size={13} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onEdit} data-tooltip="Edit section">
          <Pencil size={13} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm text-danger" onClick={onDelete} data-tooltip="Delete section">
          <Trash2 size={13} />
        </button>
      </div>

      {/* Small type label above heading */}
      <div className="section-type-pill">{CONTENT_TYPE_LABELS[section.content_type]}</div>

      {/* Document-style heading — strip any stray ** markers the model may emit */}
      {section.heading && (
        <h3 className="section-heading-display">{stripMdBold(section.heading)}</h3>
      )}

      <SectionContent section={section} />
    </div>
  )
}

// ── KaTeX helpers ─────────────────────────────────────────────────────────────

// Render a block equation.
// Content may be:
//   (a) Already-delimited: $$...$$ / $...$ / \[...\] / \(...\) — use renderInlineMath directly
//   (b) Raw LaTeX without delimiters (from bullet-list parser) — wrap in $$ first
function EquationBlock({ content }) {
  const hasDelimiters = /\$|\\\[|\\\(/.test(content)
  const source = hasDelimiters ? content : `$$${content.trim()}$$`
  return (
    <div className="section-equation-wrap">
      {renderInlineMath(source)}
    </div>
  )
}

// ── Section content renderers ─────────────────────────────────────────────────

/**
 * Pre-process a bullet list content string.
 * The AI sometimes outputs display equations spread across multiple bullet lines:
 *   $$
 *   \frac{a}{b} = c
 *   $$
 * This parser detects those patterns and returns a mixed array of
 * { type: 'bullet', text } and { type: 'equation', content } items.
 */
function parseBulletContent(raw) {
  const lines = raw.split('\n').filter(l => l.trim() !== '')
  const items = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed === '$$') {
      // Collect equation content until the next $$ line
      const eqLines = []
      i++
      while (i < lines.length && lines[i].trim() !== '$$') {
        eqLines.push(lines[i])
        i++
      }
      i++ // skip closing $$
      items.push({ type: 'equation', content: eqLines.join('\n').trim() })
    } else {
      items.push({ type: 'bullet', text: trimmed.replace(/^[-•→]\s*/, '') })
      i++
    }
  }
  return items
}

function SectionContent({ section }) {
  const { content, content_type } = section
  if (content_type === 'bullet_list') {
    const items = parseBulletContent(content)
    return (
      <ul className="section-bullets">
        {items.map((item, i) =>
          item.type === 'equation' ? (
            <li key={i} className="bullet-equation-item">
              <EquationBlock content={item.content} />
            </li>
          ) : (
            <li key={i}>{renderRichText(item.text)}</li>
          )
        )}
      </ul>
    )
  }
  if (content_type === 'equation') {
    return <EquationBlock content={content} />
  }
  if (content_type === 'diagram_description') {
    return <p className="section-diagram">{renderRichText(content)}</p>
  }
  if (content_type === 'image') {
    // content is a server URL like /static/images/abc123.png
    const BASE = import.meta.env.VITE_API_BASE ?? ''
    return (
      <div className="section-image-wrap">
        <img
          src={`${BASE}${content}`}
          alt="Attached image"
          className="section-image"
        />
      </div>
    )
  }
  return (
    <p className="section-text">
      {renderRichText(content)}
    </p>
  )
}

// ── Section edit card ─────────────────────────────────────────────────────────

function SectionEditCard({ draft, onChange, onSave, onCancel }) {
  const [imgUploading, setImgUploading] = React.useState(false)
  const [imgError, setImgError]         = React.useState(null)
  const BASE = import.meta.env.VITE_API_BASE ?? ''

  async function handleImageFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImgUploading(true)
    setImgError(null)
    try {
      const { url } = await uploadSectionImage(file)
      onChange(d => ({ ...d, content: url }))
    } catch (err) {
      setImgError(err.message)
    } finally {
      setImgUploading(false)
    }
  }

  return (
    <div className="section-edit-card">
      <div className="section-edit-header">
        <input
          className="section-heading-input"
          placeholder="Section heading (optional)"
          value={draft.heading || ''}
          onChange={e => onChange(d => ({ ...d, heading: e.target.value }))}
        />
        <select
          className="section-type-select"
          value={draft.content_type}
          onChange={e => onChange(d => ({ ...d, content_type: e.target.value, content: '' }))}
        >
          {Object.entries(CONTENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {draft.content_type === 'image' ? (
        <div className="section-image-edit">
          {draft.content && (
            <img src={`${BASE}${draft.content}`} alt="preview" className="section-image-preview" />
          )}
          <label className="btn btn-secondary btn-sm section-image-upload-btn">
            {imgUploading ? 'Uploading…' : draft.content ? 'Replace image' : 'Choose image'}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageFile}
              disabled={imgUploading}
            />
          </label>
          {imgError && <p className="text-error text-sm">{imgError}</p>}
        </div>
      ) : (
        <textarea
          className={`textarea section-edit-content${draft.content_type === 'equation' ? ' section-content--mono' : ''}`}
          value={draft.content}
          onChange={e => onChange(d => ({ ...d, content: e.target.value }))}
          rows={6}
          autoFocus
        />
      )}

      <div className="section-edit-footer">
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={imgUploading}>
          <Save size={13} /> Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Revision drawer ───────────────────────────────────────────────────────────

function RevisionDrawer({ revisions, loading, onRestore, onClose }) {
  return (
    <div className="revision-drawer">
      <div className="revision-drawer-header">
        <div className="flex items-center gap-2">
          <Clock size={13} />
          <span className="text-sm" style={{ fontWeight: 600 }}>Version history</span>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2" style={{ padding: '12px 16px' }}>
          <Loader2 size={14} className="spin" />
          <span className="text-muted text-sm">Loading…</span>
        </div>
      )}

      {!loading && revisions.length === 0 && (
        <p className="text-muted text-sm" style={{ padding: '12px 16px' }}>No edits yet.</p>
      )}

      {!loading && revisions.map(rev => (
        <div key={rev.id} className="revision-item">
          <div className="revision-meta">
            <span className="text-xs text-muted">{formatDate(rev.changed_at)}</span>
            <span className={`badge badge-gray`}>{rev.changed_by}</span>
          </div>
          <p className="revision-preview">{rev.new_content.slice(0, 120)}{rev.new_content.length > 120 ? '…' : ''}</p>
          <button className="btn btn-ghost btn-sm" onClick={() => onRestore(rev.id)}>
            <RotateCcw size={12} /> Restore
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Correction prompt ─────────────────────────────────────────────────────────

function CorrectionPrompt({ onSave, onDismiss }) {
  return (
    <div className="correction-prompt">
      <div className="correction-prompt-header">
        <Sparkles size={13} />
        <span>Was this edit a correction? Save it to improve future extractions.</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onDismiss}>
          <X size={12} />
        </button>
      </div>
      <div className="correction-types">
        {CORRECTION_TYPES.map(({ id, label }) => (
          <button key={id} className="btn btn-secondary btn-sm" onClick={() => onSave(id)}>
            {label}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={onDismiss}>Not a correction</button>
      </div>
    </div>
  )
}

// ── Share modal ───────────────────────────────────────────────────────────────

function ShareModal({ note, loading, copied, onTogglePublic, onCopy, onDownload, onClose }) {
  const isPublic = note?.is_public ?? false
  const shareUrl = isPublic && note?.public_slug
    ? `${window.location.origin}/share/${note.public_slug}`
    : null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Share2 size={18} />
          <h3>Share &amp; export</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ marginLeft: 'auto' }}>
            <X size={15} />
          </button>
        </div>

        {/* ── Share to web ── */}
        <div className="share-section">
          <div className="share-section-row">
            <div className="share-section-info">
              {isPublic ? <Globe size={15} className="share-icon-public" /> : <Lock size={15} className="share-icon-private" />}
              <div>
                <p className="share-section-title">{isPublic ? 'Anyone with the link can view' : 'Only you can view this note'}</p>
                <p className="share-section-sub">
                  {isPublic
                    ? 'The shared page is read-only — no editing or account needed.'
                    : 'Enable sharing to create a public, view-only link.'}
                </p>
              </div>
            </div>
            <button
              className={`share-toggle${isPublic ? ' share-toggle--on' : ''}`}
              onClick={() => onTogglePublic(!isPublic)}
              disabled={loading}
              aria-label={isPublic ? 'Disable sharing' : 'Enable sharing'}
            >
              {loading ? <Loader2 size={13} className="spin" /> : null}
              <span className="share-toggle-knob" />
            </button>
          </div>

          {isPublic && shareUrl && (
            <div className="share-url-row">
              <input className="share-url-input" readOnly value={shareUrl} />
              <button className="btn btn-secondary btn-sm" onClick={onCopy}>
                {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy link</>}
              </button>
            </div>
          )}
        </div>

        {/* ── Download ── */}
        <div className="share-section share-section--download">
          <p className="share-section-title" style={{ marginBottom: 4 }}>Download</p>
          <p className="share-section-sub" style={{ marginBottom: 10 }}>
            Save this note as a Markdown file you can open in any text editor.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={onDownload}>
            <Download size={13} /> Download as Markdown
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Convert note sections → Markdown string ───────────────────────────────────

function noteToMarkdown(note) {
  const lines = [`# ${note.title}`, '']
  for (const section of note.sections ?? []) {
    if (section.heading) lines.push(`## ${section.heading}`, '')
    if (section.content_type === 'bullet_list') {
      section.content.split('\n').forEach(line => lines.push(line.startsWith('-') || line.startsWith('•') ? line : `- ${line}`))
    } else if (section.content_type === 'equation') {
      lines.push(`$$`, section.content, `$$`)
    } else {
      lines.push(section.content)
    }
    lines.push('')
  }
  return lines.join('\n')
}


// ── Delete modal ──────────────────────────────────────────────────────────────

function DeleteModal({ title, deleting, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <Trash2 size={18} className="text-danger" />
          <h3>Delete note?</h3>
        </div>
        <p className="text-muted text-sm" style={{ margin: '8px 0 20px' }}>
          <strong>"{title}"</strong> will be moved to Trash and permanently deleted after 7 days.
          You can restore it from the Trash page within that window.
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? <><Loader2 size={14} className="spin" /> Deleting…</> : <><Trash2 size={14} /> Delete</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}
