import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Search, FileText, Sparkles, BookOpen,
  Tag, Calendar, ChevronLeft, ChevronRight, X, Plus,
  Loader2, Inbox, Layers, Unlink,
  CheckSquare, Square, Share2, Trash2, Globe, Lock,
} from 'lucide-react'
import { listNotes, listCourses, listTags, createCourse, ungroupNote, shareNote, deleteNote } from '../api.js'
import './Library.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'alpha',  label: 'A → Z'        },
]

const PAGE_SIZE = 12

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Library() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Filter / sort state — sourced from URL so links are shareable
  const [q,        setQ]        = useState(searchParams.get('q')        ?? '')
  const [courseId, setCourseId] = useState(searchParams.get('course')   ?? '')
  const [tag,      setTag]      = useState(searchParams.get('tag')      ?? '')
  const [mode,     setMode]     = useState(searchParams.get('mode')     ?? '')
  const [batchId,  setBatchId]  = useState(searchParams.get('batch_id') ?? '')
  const [sort,     setSort]     = useState(searchParams.get('sort')     ?? 'newest')
  const [page,     setPage]     = useState(Number(searchParams.get('page') ?? 1))

  // Data
  const [notes,   setNotes]   = useState([])
  const [total,   setTotal]   = useState(0)
  const [courses, setCourses] = useState([])
  const [allTags, setAllTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // New course modal
  const [showNewCourse, setShowNewCourse] = useState(false)

  // Multi-select
  const [selectMode,    setSelectMode]    = useState(false)
  const [selected,      setSelected]      = useState(new Set()) // Set of note IDs
  const [bulkDeleting,  setBulkDeleting]  = useState(false)
  const [bulkSharing,   setBulkSharing]   = useState(false)
  const [showBulkDelete,setShowBulkDelete]= useState(false)
  const [showBulkShare, setShowBulkShare] = useState(false)

  // Last batch — read once from localStorage so user can jump back after navigating away
  const [lastBatch, setLastBatch] = useState(() => {
    try {
      const raw = localStorage.getItem('lastBatch')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      // Only surface it if it was within the last 24 hours
      if (Date.now() - parsed.ts > 86_400_000) return null
      return parsed
    } catch { return null }
  })

  // ── Sync URL → state (handles external navigation e.g. clicking Batch badge) ─

  useEffect(() => {
    const urlQ      = searchParams.get('q')        ?? ''
    const urlCourse = searchParams.get('course')   ?? ''
    const urlTag    = searchParams.get('tag')      ?? ''
    const urlMode   = searchParams.get('mode')     ?? ''
    const urlBatch  = searchParams.get('batch_id') ?? ''
    const urlSort   = searchParams.get('sort')     ?? 'newest'
    const urlPage   = Number(searchParams.get('page') ?? 1)

    if (urlQ      !== q)       setQ(urlQ)
    if (urlCourse !== courseId) setCourseId(urlCourse)
    if (urlTag    !== tag)     setTag(urlTag)
    if (urlMode   !== mode)    setMode(urlMode)
    if (urlBatch  !== batchId) setBatchId(urlBatch)
    if (urlSort   !== sort)    setSort(urlSort)
    if (urlPage   !== page)    setPage(urlPage)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync state → URL ──────────────────────────────────────────────────────

  useEffect(() => {
    const p = {}
    if (q)              p.q        = q
    if (courseId)       p.course   = courseId
    if (tag)            p.tag      = tag
    if (mode)           p.mode     = mode
    if (batchId)        p.batch_id = batchId
    if (sort !== 'newest') p.sort  = sort
    if (page > 1)       p.page     = String(page)
    setSearchParams(p, { replace: true })
  }, [q, courseId, tag, mode, batchId, sort, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch notes ───────────────────────────────────────────────────────────

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listNotes({
        q:         q        || undefined,
        course_id: courseId || undefined,
        tag:       tag      || undefined,
        mode:      mode     || undefined,
        batch_id:  batchId  || undefined,
        sort,
        page,
        limit: PAGE_SIZE,
      })
      // Backend may return { items, total } or a plain array
      setNotes(data.items ?? data)
      setTotal(data.total ?? (data.items ? data.total : data.length))
    } catch (e) {
      setError(e.message ?? 'Failed to load notes.')
    } finally {
      setLoading(false)
    }
  }, [q, courseId, tag, mode, batchId, sort, page])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // ── Sidebar data ──────────────────────────────────────────────────────────

  useEffect(() => {
    listCourses().then(setCourses).catch(() => {})
    listTags().then(ts => setAllTags(ts.map(t => t.name ?? t))).catch(() => {})
  }, [])

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSearch(val)       { setQ(val);        setPage(1) }
  function handleCourseFilter(val) { setCourseId(val); setPage(1) }
  function handleTagFilter(val)    { setTag(val);      setPage(1) }
  function handleModeFilter(val)   { setMode(val);     setPage(1) }
  function handleSort(val)         { setSort(val);     setPage(1) }
  function clearBatch()            { setBatchId('');   setPage(1) }

  function clearFilters() {
    setQ(''); setCourseId(''); setTag(''); setMode(''); setBatchId(''); setSort('newest'); setPage(1)
  }

  async function handleUngroup(noteId) {
    try {
      await ungroupNote(noteId)
      // Remove from current view if we're filtering by batch_id
      if (batchId) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        setTotal(prev => prev - 1)
      }
    } catch { /* ignore */ }
  }

  // ── Multi-select handlers ─────────────────────────────────────────────────

  function toggleSelectMode() {
    setSelectMode(s => !s)
    setSelected(new Set())
  }

  function toggleNote(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === notes.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(notes.map(n => n.id)))
    }
  }

  // Capture selected IDs at the moment the action is confirmed, not at render time,
  // so stale React state can't interfere with the in-flight requests.
  async function handleBulkShare(makePublic) {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkSharing(true)
    try {
      // allSettled: don't abort on a single failure
      await Promise.allSettled(ids.map(id => shareNote(id, makePublic)))
      await fetchNotes()
    } finally {
      setBulkSharing(false)
      setShowBulkShare(false)
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkDeleting(true)
    try {
      await Promise.allSettled(ids.map(id => deleteNote(id)))
      setSelected(new Set())
      setSelectMode(false)
      await fetchNotes()
    } finally {
      // Always close the modal even if some requests failed
      setBulkDeleting(false)
      setShowBulkDelete(false)
    }
  }

  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters  = q || courseId || tag || mode || batchId || sort !== 'newest'
  const filterLabel = [
    q        && `"${q}"`,
    courseId && courses.find(c => c.id === courseId)?.name,
    tag      && `#${tag}`,
    mode     && (mode === 'study_guide' ? 'Study guide' : 'Transcription'),
  ].filter(Boolean)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="library-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Library</h1>
          <p>All your notes in one place.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary" onClick={() => setShowNewCourse(true)}>
            <BookOpen size={14} /> New course
          </button>
          <Link to="/batch" className="btn btn-secondary">
            <Layers size={14} /> Batch upload
          </Link>
          {lastBatch && lastBatch.batch_id !== batchId && (
            <button
              className="library-last-batch-btn"
              onClick={() => { setBatchId(lastBatch.batch_id); setPage(1) }}
              title="Jump back to your most recent batch upload"
            >
              <Layers size={13} />
              View last batch ({lastBatch.succeeded}/{lastBatch.total})
            </button>
          )}
          <button
            className={`btn${selectMode ? ' btn-primary' : ' btn-secondary'}`}
            onClick={toggleSelectMode}
          >
            <CheckSquare size={14} /> {selectMode ? 'Cancel' : 'Select'}
          </button>
          <Link to="/upload" className="btn btn-primary">
            <Plus size={15} /> New note
          </Link>
        </div>
      </div>

      {/* ── Batch view banner ── */}
      {batchId && (
        <div className="library-batch-banner">
          <Layers size={15} />
          <span>Showing batch upload · {total} note{total !== 1 ? 's' : ''}</span>
          <button className="btn btn-ghost btn-sm" onClick={clearBatch}>
            <X size={13} /> Exit batch view
          </button>
        </div>
      )}

      {/* ── Toolbar row 1: search + sort ── */}
      <div className="library-toolbar-row1">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input
            className="input search-input"
            type="search"
            placeholder="Search notes…"
            value={q}
            onChange={e => handleSearch(e.target.value)}
          />
          {q && (
            <button className="btn btn-ghost btn-icon btn-sm search-clear" onClick={() => handleSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>

        <select
          className="select sort-select"
          value={sort}
          onChange={e => handleSort(e.target.value)}
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Toolbar row 2: filters ── */}
      <div className="library-toolbar-row2">
        <select
          className="select filter-select"
          value={courseId}
          onChange={e => handleCourseFilter(e.target.value)}
        >
          <option value="">All courses</option>
          {courses.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          className="select filter-select"
          value={mode}
          onChange={e => handleModeFilter(e.target.value)}
        >
          <option value="">All modes</option>
          <option value="transcribe">Transcription</option>
          <option value="study_guide">Study guide</option>
        </select>

        <select
          className="select filter-select"
          value={tag}
          onChange={e => handleTagFilter(e.target.value)}
        >
          <option value="">All tags</option>
          {allTags.map(t => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>

        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      {/* Tag filter chips — shown as quick-pick when tags exist */}
      {allTags.length > 0 && (
        <div className="tag-filter-row">
          <Tag size={13} className="text-faint" />
          {allTags.slice(0, 20).map(t => (
            <button
              key={t}
              className={`badge badge-gray tag-filter-chip${tag === t ? ' active' : ''}`}
              onClick={() => handleTagFilter(tag === t ? '' : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {filterLabel.length > 0 && (
        <p className="filter-summary text-sm text-muted">
          {total} result{total !== 1 ? 's' : ''} for {filterLabel.join(' · ')}
        </p>
      )}

      {/* ── Bulk action bar — shown when selectMode is on ── */}
      {selectMode && (
        <div className="bulk-action-bar">
          <button className="btn btn-ghost btn-sm bulk-select-all" onClick={toggleSelectAll}>
            {selected.size === notes.length && notes.length > 0
              ? <CheckSquare size={14} />
              : <Square size={14} />}
            {selected.size === 0
              ? 'Select all'
              : selected.size === notes.length
                ? 'Deselect all'
                : `${selected.size} selected`}
          </button>

          <div className="bulk-action-bar-actions">
            <button
              className="btn btn-secondary btn-sm"
              disabled={selected.size === 0}
              onClick={() => setShowBulkShare(true)}
            >
              <Share2 size={13} /> Share
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={selected.size === 0 || bulkDeleting}
              onClick={() => setShowBulkDelete(true)}
            >
              <Trash2 size={13} /> Delete{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      {loading ? (
        <div className="library-loading">
          <Loader2 size={28} className="spin" style={{ color: 'var(--color-primary)' }} />
          <p className="text-muted text-sm">Loading notes…</p>
        </div>
      ) : error ? (
        <div className="banner banner-error" style={{ marginTop: 24 }}>
          {error}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState hasFilters={!!hasFilters} onClear={clearFilters} />
      ) : (
        <>
          <div className="notes-grid">
            {notes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                inBatchView={!!batchId}
                onUngroup={() => handleUngroup(note.id)}
                selectMode={selectMode}
                selected={selected.has(note.id)}
                onToggleSelect={() => toggleNote(note.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          )}
        </>
      )}

      {showNewCourse && (
        <NewCourseModal
          onClose={() => setShowNewCourse(false)}
          onCreated={c => { setCourses(prev => [...prev, c]); setShowNewCourse(false) }}
        />
      )}

      {showBulkShare && (
        <BulkShareModal
          count={selected.size}
          loading={bulkSharing}
          onShare={() => handleBulkShare(true)}
          onUnshare={() => handleBulkShare(false)}
          onClose={() => setShowBulkShare(false)}
        />
      )}

      {showBulkDelete && (
        <BulkDeleteModal
          count={selected.size}
          deleting={bulkDeleting}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
        />
      )}
    </div>
  )
}

// ── Note card ─────────────────────────────────────────────────────────────────

function NoteCard({ note, inBatchView = false, onUngroup, selectMode = false, selected = false, onToggleSelect }) {
  const sectionCount = note.sections?.length ?? note.section_count ?? 0
  const navigate = useNavigate()

  function handleCardClick(e) {
    if (selectMode) {
      e.preventDefault()
      onToggleSelect?.()
    }
  }

  return (
    <div
      className={`note-card-wrap${note.batch_id ? ' note-card-wrap--batched' : ''}${selectMode ? ' note-card-wrap--selectable' : ''}${selected ? ' note-card-wrap--selected' : ''}`}
    >
      {/* Checkbox overlay — only shown in select mode */}
      {selectMode && (
        <button
          className="note-card-checkbox"
          onClick={e => { e.preventDefault(); onToggleSelect?.() }}
          aria-label={selected ? 'Deselect note' : 'Select note'}
        >
          {selected ? <CheckSquare size={18} /> : <Square size={18} />}
        </button>
      )}

      <Link to={`/notes/${note.id}`} className="note-card" onClick={handleCardClick}>
        <div className="note-card-top">
          <div className="note-card-icon">
            {note.extraction_mode === 'study_guide'
              ? <Sparkles size={18} />
              : <FileText size={18} />}
          </div>
          {note.batch_id && !inBatchView && !selectMode && (
            <button
              className="badge badge-gray note-batch-badge"
              title="View all notes from this batch"
              onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`/library?batch_id=${note.batch_id}`) }}
            >
              <Layers size={10} /> Batch
            </button>
          )}
          <span className={`badge note-card-mode-badge ${note.extraction_mode === 'study_guide' ? 'badge-purple' : 'badge-gray'}`}>
            {note.extraction_mode === 'study_guide' ? 'Study guide' : 'Transcription'}
          </span>
        </div>

        <h3 className="note-card-title">{note.title}</h3>

        {note.course && (
          <div className="note-card-course">
            <BookOpen size={12} />
            <span>{note.course.name}</span>
          </div>
        )}

        <div className="note-card-meta">
          <span className="note-card-meta-item">
            <FileText size={11} />
            {sectionCount} section{sectionCount !== 1 ? 's' : ''}
          </span>
          <span className="note-card-meta-item">
            <Calendar size={11} />
            {formatDate(note.created_at)}
          </span>
        </div>

        {note.tags?.length > 0 && (
          <div className="note-card-tags">
            {note.tags.slice(0, 4).map(t => (
              <span key={t.id ?? t} className="badge badge-gray badge-xs">{t.name ?? t}</span>
            ))}
            {note.tags.length > 4 && (
              <span className="text-faint" style={{ fontSize: '0.75rem' }}>+{note.tags.length - 4}</span>
            )}
          </div>
        )}
      </Link>

      {/* Ungroup button — visible only in batch view, hidden during select */}
      {inBatchView && note.batch_id && !selectMode && (
        <button
          className="note-ungroup-btn"
          onClick={e => { e.preventDefault(); onUngroup?.() }}
          title="Remove from batch"
        >
          <Unlink size={12} /> Ungroup
        </button>
      )}
    </div>
  )
}

// ── Bulk share modal ──────────────────────────────────────────────────────────

function BulkShareModal({ count, loading, onShare, onUnshare, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Share2 size={18} />
          <h3>Share {count} note{count !== 1 ? 's' : ''}</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ marginLeft: 'auto' }}>
            <X size={15} />
          </button>
        </div>

        {/* Make public */}
        <div className="bulk-share-option" style={{ marginTop: 20 }}>
          <div className="share-section-info">
            <Globe size={15} className="share-icon-public" />
            <div>
              <p className="share-section-title">Make public</p>
              <p className="share-section-sub">
                Creates a shareable read-only link for each selected note.
                Links can be found by opening each note individually.
              </p>
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12, alignSelf: 'flex-start' }}
            onClick={onShare}
            disabled={loading}
          >
            {loading ? <Loader2 size={13} className="spin" /> : <Globe size={13} />}
            Share {count} note{count !== 1 ? 's' : ''}
          </button>
        </div>

        {/* Make private */}
        <div className="bulk-share-option bulk-share-option--divider">
          <div className="share-section-info">
            <Lock size={15} className="share-icon-private" />
            <div>
              <p className="share-section-title">Make private</p>
              <p className="share-section-sub">
                Disables public access for all selected notes. Existing links will stop working.
              </p>
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12, alignSelf: 'flex-start' }}
            onClick={onUnshare}
            disabled={loading}
          >
            {loading ? <Loader2 size={13} className="spin" /> : <Lock size={13} />}
            Unshare {count} note{count !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Bulk delete confirmation modal ────────────────────────────────────────────

function BulkDeleteModal({ count, deleting, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Trash2 size={18} className="text-danger" />
          <h3>Delete {count} note{count !== 1 ? 's' : ''}?</h3>
        </div>
        <p className="text-muted text-sm" style={{ margin: '10px 0 20px' }}>
          {count} note{count !== 1 ? 's' : ''} will be moved to Trash.
          You can recover {count !== 1 ? 'them' : 'it'} from the Trash page within <strong>7 days</strong> before permanent deletion.
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting
              ? <><Loader2 size={14} className="spin" /> Deleting…</>
              : <><Trash2 size={14} /> Delete {count} note{count !== 1 ? 's' : ''}</>}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ hasFilters, onClear }) {
  return (
    <div className="library-empty">
      <div className="library-empty-icon">
        <Inbox size={32} />
      </div>
      {hasFilters ? (
        <>
          <p className="library-empty-title">No notes match your filters</p>
          <p className="text-muted text-sm">Try adjusting your search or clearing the filters.</p>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={onClear}>
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="library-empty-title">No notes yet</p>
          <p className="text-muted text-sm">Upload a photo of your notes or slides to get started.</p>
          <Link to="/upload" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
            <Plus size={14} /> Upload notes
          </Link>
        </>
      )}
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPage }) {
  const pages = buildPageRange(page, totalPages)

  return (
    <div className="pagination">
      <button
        className="btn btn-ghost btn-sm btn-icon"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={15} />
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
        ) : (
          <button
            key={p}
            className={`btn btn-sm pagination-page${p === page ? ' active' : ' btn-ghost'}`}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        )
      )}

      <button
        className="btn btn-ghost btn-sm btn-icon"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

function buildPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set(
    [1, total, current, current - 1, current + 1].filter(p => p >= 1 && p <= total)
  )
  const sorted = [...pages].sort((a, b) => a - b)
  const result = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…')
    result.push(sorted[i])
  }
  return result
}

// ── New course modal ──────────────────────────────────────────────────────────

function NewCourseModal({ onClose, onCreated }) {
  const [name,   setName]   = useState('')
  const [term,   setTerm]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Course name is required.'); return }
    setSaving(true)
    try {
      const c = await createCourse({ name: name.trim(), term: term.trim() || null })
      onCreated(c)
    } catch (err) {
      setError(err.message ?? 'Could not create course.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ marginBottom: 16 }}>
          <BookOpen size={18} />
          <h3>New course</h3>
        </div>
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>
          )}
          <div className="field">
            <label>Name <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <input
              ref={inputRef}
              className="input"
              placeholder="e.g. CSE 291P"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Term</label>
            <input
              className="input"
              placeholder="e.g. Spring 2026"
              value={term}
              onChange={e => setTerm(e.target.value)}
            />
          </div>
          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? <><Loader2 size={13} className="spin" /> Creating…</>
                : 'Create course'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

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
