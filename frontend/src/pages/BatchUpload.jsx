/**
 * BatchUpload.jsx — Upload multiple documents in one go.
 *
 * Flow:
 *   setup    → user picks files, selects mode + optional course
 *   running  → SSE stream fires per-file events; status cards update live
 *   done     → summary shown with link to Library batch view
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Upload as UploadIcon, FileText, Sparkles, X,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, Layers,
  ChevronRight, RotateCcw, ExternalLink, File as FileIcon,
} from 'lucide-react'
import { batchExtract, listCourses, hashFile, checkImageHashes } from '../api.js'
import './BatchUpload.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPTED      = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf']
const ACCEPT_ATTR   = ACCEPTED.join(',')
const MAX_MB        = 10
const MAX_FILES     = 20

const MODES = [
  {
    id:    'transcribe',
    label: 'Transcribe',
    desc:  'Faithful copy — preserves structure, equations, handwriting.',
    Icon:  FileText,
  },
  {
    id:    'study_guide',
    label: 'Study Guide',
    desc:  'Cleaned notes with key concepts and definitions surfaced.',
    Icon:  Sparkles,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFileState(file) {
  return {
    file,
    status:         'pending',   // 'pending' | 'processing' | 'done' | 'error'
    noteId:         null,
    title:          null,
    confidence:     null,
    error:          null,
    isDuplicate:    false,       // true if this file is already in the library
    duplicateTitle: null,        // title of the existing note
  }
}

function validateFile(file) {
  if (!ACCEPTED.includes(file.type))
    return `Unsupported type (${file.type || 'unknown'}) — use JPEG, PNG, WebP, GIF, HEIC, or PDF`
  if (file.size > MAX_MB * 1024 * 1024)
    return `File exceeds ${MAX_MB} MB`
  if (file.size === 0)
    return 'File is empty'
  return null
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BatchUpload() {
  const navigate = useNavigate()

  // phase: 'setup' | 'running' | 'done'
  const [phase,      setPhase]      = useState('setup')
  const [fileStates, setFileStates] = useState([])   // array of makeFileState(file)
  const [mode,       setMode]       = useState('transcribe')
  const [courseId,   setCourseId]   = useState('')
  const [courses,    setCourses]    = useState([])
  const [batchId,    setBatchId]    = useState(null)
  const [summary,    setSummary]    = useState(null)
  const [topError,   setTopError]   = useState(null)
  const [drag,       setDrag]       = useState(false)
  const [dupModal,   setDupModal]   = useState(null)  // null | [{ name, title }]
  const inputRef = useRef(null)

  useEffect(() => { listCourses().then(setCourses).catch(() => {}) }, [])

  // ── File management ──────────────────────────────────────────────────────

  function addFiles(incoming) {
    const next  = [...fileStates]
    const warns = []

    for (const file of incoming) {
      if (next.length >= MAX_FILES) {
        warns.push(`Only ${MAX_FILES} files per batch — some were skipped.`)
        break
      }
      const err = validateFile(file)
      if (err) { warns.push(`${file.name}: ${err}`); continue }
      // Deduplicate by name + size
      const dup = next.some(s => s.file.name === file.name && s.file.size === file.size)
      if (!dup) next.push(makeFileState(file))
    }

    setFileStates(next)
    setTopError(warns.length ? warns.join(' · ') : null)

    // Async duplicate check — hash every new file and ask the backend which
    // are already in the library. Updates isDuplicate on the file state.
    checkDuplicates(next)
  }

  async function checkDuplicates(states) {
    try {
      const hashes = await Promise.all(states.map(s => hashFile(s.file)))
      const { duplicates } = await checkImageHashes(hashes)
      if (!Object.keys(duplicates).length) return

      // Collect the duplicates and show a modal
      const found = hashes
        .map((h, i) => duplicates[h] ? { name: states[i].file.name, title: duplicates[h].title } : null)
        .filter(Boolean)
      if (found.length) setDupModal(found)
    } catch {
      // Silently ignore — duplicate check is best-effort
    }
  }

  function removeFile(idx) {
    setFileStates(prev => prev.filter((_, i) => i !== idx))
    setTopError(null)
  }

  const onDrop = useCallback(e => {
    e.preventDefault()
    setDrag(false)
    addFiles([...e.dataTransfer.files])
  }, [fileStates])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Batch execution ──────────────────────────────────────────────────────

  async function startBatch() {
    if (!fileStates.length) return

    // Reset all statuses to pending
    setFileStates(prev => prev.map(s => makeFileState(s.file)))
    setPhase('running')
    setTopError(null)

    try {
      await batchExtract(
        fileStates.map(s => s.file),
        mode,
        courseId || null,
        {
          batch_start: ({ batch_id }) => {
            setBatchId(batch_id)
          },
          file_start: ({ index }) => {
            setFileStates(prev => {
              const next = [...prev]
              if (next[index]) next[index] = { ...next[index], status: 'processing' }
              return next
            })
          },
          file_done: ({ index, note_id, title, confidence }) => {
            setFileStates(prev => {
              const next = [...prev]
              if (next[index]) next[index] = { ...next[index], status: 'done', noteId: note_id, title, confidence }
              return next
            })
          },
          file_error: ({ index, error }) => {
            setFileStates(prev => {
              const next = [...prev]
              if (next[index]) next[index] = { ...next[index], status: 'error', error }
              return next
            })
          },
          batch_complete: (data) => {
            setSummary(data)
            setPhase('done')
            // Persist so Library can show "View last batch" after navigation
            try {
              localStorage.setItem('lastBatch', JSON.stringify({
                batch_id:  data.batch_id,
                succeeded: data.succeeded,
                total:     data.total,
                ts:        Date.now(),
              }))
            } catch { /* quota or private mode */ }
          },
        }
      )
    } catch (e) {
      setTopError(e.message ?? 'Batch upload failed. Please try again.')
      setPhase('setup')
    }
  }

  function reset() {
    setPhase('setup')
    setFileStates([])
    setBatchId(null)
    setSummary(null)
    setTopError(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="batch-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Batch Upload</h1>
          <p>
            Upload up to {MAX_FILES} documents at once.
            Each file is extracted and saved automatically.
          </p>
        </div>
        {phase === 'setup' && (
          <div className="page-header-actions">
            <Link to="/upload" className="btn btn-ghost btn-sm">
              Single upload
            </Link>
          </div>
        )}
      </div>

      {topError && (
        <div className="banner banner-error" style={{ marginBottom: 16 }}>
          <AlertCircle size={15} />
          {topError}
        </div>
      )}

      {phase === 'setup' && (
        <SetupPhase
          fileStates={fileStates}
          mode={mode}
          courseId={courseId}
          courses={courses}
          drag={drag}
          inputRef={inputRef}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onFilesAdded={addFiles}
          onRemoveFile={removeFile}
          onModeChange={setMode}
          onCourseChange={setCourseId}
          onStart={startBatch}
        />
      )}

      {(phase === 'running' || phase === 'done') && (
        <ProcessingPhase
          fileStates={fileStates}
          phase={phase}
          summary={summary}
          batchId={batchId}
          onViewBatch={() => navigate(`/library?batch_id=${batchId}`)}
          onReset={reset}
        />
      )}

      {dupModal && (
        <BatchDuplicateModal
          duplicates={dupModal}
          onProceed={() => setDupModal(null)}
          onRemove={() => {
            const dupNames = new Set(dupModal.map(d => d.name))
            setFileStates(prev => prev.filter(s => !dupNames.has(s.file.name)))
            setDupModal(null)
          }}
        />
      )}
    </div>
  )
}


// ── Duplicate modal ───────────────────────────────────────────────────────────

function BatchDuplicateModal({ duplicates, onProceed, onRemove }) {
  return (
    <div className="modal-backdrop" onClick={onProceed}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header" style={{ marginBottom: 12 }}>
          <AlertTriangle size={20} style={{ color: 'var(--color-warning, #d97706)' }} />
          <h3>
            {duplicates.length === 1
              ? 'Document already in library'
              : `${duplicates.length} documents already in library`}
          </h3>
        </div>
        <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
          {duplicates.length === 1
            ? 'This file has already been transcribed:'
            : 'These files have already been transcribed:'}
        </p>
        <ul style={{ margin: '0 0 16px 0', padding: '0 0 0 18px' }}>
          {duplicates.map((d, i) => (
            <li key={i} className="text-sm" style={{ marginBottom: 4 }}>
              <span className="text-faint">{d.name}</span>
              {d.title && <> → <strong>{d.title}</strong></>}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onRemove}>
            Remove duplicates
          </button>
          <button className="btn btn-primary" onClick={onProceed}>
            Upload anyway
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Setup phase ───────────────────────────────────────────────────────────────

function SetupPhase({
  fileStates, mode, courseId, courses, drag, inputRef,
  onDragOver, onDragLeave, onDrop, onFilesAdded, onRemoveFile,
  onModeChange, onCourseChange, onStart,
}) {
  const files = fileStates.map(s => s.file)

  return (
    <div className="batch-setup">
      {/* Drop zone */}
      <div
        className={`batch-dropzone${drag ? ' batch-dropzone--drag' : ''}${files.length ? ' batch-dropzone--has-files' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => files.length < MAX_FILES && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          style={{ display: 'none' }}
          onChange={e => { onFilesAdded([...e.target.files]); e.target.value = '' }}
        />
        {files.length === 0 ? (
          <div className="batch-dropzone-empty">
            <div className="batch-dropzone-icon"><Layers size={28} /></div>
            <p className="batch-dropzone-title">Drop your files here</p>
            <p className="text-muted text-sm">
              or click to browse · up to {MAX_FILES} files · JPEG, PNG, WebP, PDF · max {MAX_MB} MB each
            </p>
          </div>
        ) : (
          <div className="batch-dropzone-hint">
            <UploadIcon size={14} className="text-faint" />
            <span className="text-muted text-sm">
              {files.length}/{MAX_FILES} files added — drop more or click to browse
            </span>
          </div>
        )}
      </div>

      {/* File list */}
      {fileStates.length > 0 && (
        <div className="batch-file-list">
          {fileStates.map((s, i) => (
            <FileRow
              key={`${s.file.name}-${s.file.size}-${i}`}
              state={s}
              onRemove={() => onRemoveFile(i)}
            />
          ))}
        </div>
      )}

      {/* Settings */}
      <div className="batch-settings">
        <div className="batch-settings-section">
          <p className="section-label">Extraction mode</p>
          <div className="batch-mode-cards">
            {MODES.map(({ id, label, desc, Icon }) => (
              <button
                key={id}
                className={`batch-mode-card${mode === id ? ' batch-mode-card--active' : ''}`}
                onClick={() => onModeChange(id)}
              >
                <Icon size={16} className="batch-mode-icon" />
                <div className="flex-1">
                  <p className="batch-mode-label">{label}</p>
                  <p className="batch-mode-desc">{desc}</p>
                </div>
                {mode === id && <CheckCircle2 size={14} className="batch-mode-check" />}
              </button>
            ))}
          </div>
        </div>

        {courses.length > 0 && (
          <div className="batch-settings-section">
            <p className="section-label">Assign to course (optional)</p>
            <select
              className="select"
              style={{ maxWidth: 320 }}
              value={courseId}
              onChange={e => onCourseChange(e.target.value)}
            >
              <option value="">No course</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="batch-actions">
        <button
          className="btn btn-primary btn-lg"
          onClick={onStart}
          disabled={fileStates.length === 0}
        >
          <Layers size={16} />
          Process {fileStates.length} file{fileStates.length !== 1 ? 's' : ''}
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}


// ── Processing phase ──────────────────────────────────────────────────────────

function ProcessingPhase({ fileStates, phase, summary, batchId, onViewBatch, onReset }) {
  const done       = phase === 'done'
  const succeeded  = fileStates.filter(s => s.status === 'done').length
  const failed     = fileStates.filter(s => s.status === 'error').length
  const processing = fileStates.filter(s => s.status === 'processing').length
  const pending    = fileStates.filter(s => s.status === 'pending').length
  const total      = fileStates.length

  return (
    <div className="batch-processing">
      {/* Progress header */}
      <div className="batch-progress-header">
        {done ? (
          <>
            <div className={`batch-progress-icon ${failed === 0 ? 'batch-progress-icon--success' : 'batch-progress-icon--partial'}`}>
              {failed === 0
                ? <CheckCircle2 size={22} />
                : <AlertCircle size={22} />}
            </div>
            <div>
              <p className="batch-progress-title">
                {failed === 0
                  ? `All ${total} files saved!`
                  : `${succeeded} of ${total} saved${failed > 0 ? `, ${failed} failed` : ''}`}
              </p>
              <p className="text-muted text-sm">
                {succeeded > 0
                  ? 'Your notes are ready. Click "View batch" to see them in the Library.'
                  : 'All files encountered errors. Check the details below and try again.'}
              </p>
            </div>
          </>
        ) : (
          <>
            <Loader2 size={22} className="spin text-primary" />
            <div>
              <p className="batch-progress-title">
                Processing {pending + processing} of {total} remaining…
              </p>
              <p className="text-muted text-sm">
                {succeeded > 0 && `${succeeded} saved · `}
                {failed > 0 && `${failed} failed · `}
                {processing > 0 && `1 in progress · `}
                {pending > 0 && `${pending} queued`}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Progress bar */}
      {!done && (
        <div className="batch-progress-bar-track">
          <div
            className="batch-progress-bar-fill"
            style={{ width: `${Math.round(((succeeded + failed) / total) * 100)}%` }}
          />
        </div>
      )}

      {/* Per-file status list */}
      <div className="batch-file-list">
        {fileStates.map((s, i) => (
          <FileRow key={`${s.file.name}-${i}`} state={s} showNote />
        ))}
      </div>

      {/* Actions */}
      {done && (
        <div className="batch-done-actions">
          {succeeded > 0 && (
            <button className="btn btn-primary" onClick={onViewBatch}>
              View batch in Library <ExternalLink size={14} />
            </button>
          )}
          <button className="btn btn-secondary" onClick={onReset}>
            <RotateCcw size={14} /> Upload another batch
          </button>
        </div>
      )}
    </div>
  )
}


// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({ state, onRemove, showNote = false }) {
  const { file, status, title, confidence, error, noteId } = state
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1)

  return (
    <div className={`batch-file-row batch-file-row--${status}`}>
      {/* Icon */}
      <div className="batch-file-icon">
        <FileIcon size={16} />
      </div>

      {/* Info */}
      <div className="batch-file-info">
        <p className="batch-file-name">
          {status === 'done' && title ? title : file.name}
        </p>
        <p className="batch-file-meta">
          {status === 'pending'    && <span className="text-faint">{sizeMb} MB · Queued</span>}
          {status === 'processing' && <span className="text-primary" style={{ fontWeight: 600 }}>Extracting…</span>}
          {status === 'done'       && (
            <span className="batch-file-done-meta">
              <span className="text-success">Saved</span>
              {confidence && (
                <span className={`badge badge-xs ${
                  confidence === 'high'   ? 'badge-green'  :
                  confidence === 'medium' ? 'badge-yellow' : 'badge-red'
                }`}>{confidence}</span>
              )}
              {showNote && noteId && (
                <Link to={`/notes/${noteId}`} className="batch-file-open-link">
                  Open <ExternalLink size={11} />
                </Link>
              )}
            </span>
          )}
          {status === 'error'      && (
            <span className="text-danger" title={error}>{error || 'Failed'}</span>
          )}
        </p>
      </div>

      {/* Status indicator / remove button */}
      <div className="batch-file-status">
        {status === 'pending'    && onRemove && (
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onRemove} data-tooltip="Remove">
            <X size={13} />
          </button>
        )}
        {status === 'processing' && <Loader2 size={16} className="spin text-primary" />}
        {status === 'done'       && <CheckCircle2 size={16} className="text-success" />}
        {status === 'error'      && <AlertCircle  size={16} className="text-danger"  />}
      </div>
    </div>
  )
}
