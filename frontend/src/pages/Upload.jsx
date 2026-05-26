import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload as UploadIcon, FileText, Sparkles, ChevronRight,
  X, Plus, GripVertical, AlertCircle, CheckCircle2,
  Loader2, RotateCcw, Save,
} from 'lucide-react'
import { extractNote, createNote, listCourses, createCourse, listTags, hashFile, checkImageHashes } from '../api.js'
import { saveSourceFile } from '../utils/fileStore.js'
import TagSelect from '../components/TagSelect.jsx'
import './Upload.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf']
const MAX_MB   = 10

const MODES = [
  {
    id:    'transcribe',
    label: 'Transcribe Exactly',
    desc:  'Faithful to the source — preserves structure, equations, and spacing.',
    Icon:  FileText,
  },
  {
    id:    'study_guide',
    label: 'Generate Study Guide',
    desc:  'Cleaned notes with key concepts, definitions, and examples surfaced.',
    Icon:  Sparkles,
  },
]

const CONTENT_TYPES = ['text', 'bullet_list', 'equation', 'diagram_description']
const CONTENT_TYPE_LABELS = {
  text:                'Text',
  bullet_list:         'Bullets',
  equation:            'Equation',
  diagram_description: 'Diagram',
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Upload() {
  const navigate = useNavigate()

  // step: 'upload' → 'extracting' → 'review' → 'saving'
  const [step,          setStep]          = useState('upload')
  const [file,          setFile]          = useState(null)
  const [fileHash,      setFileHash]      = useState(null)   // SHA-256 of the current file
  const [dupInfo,       setDupInfo]       = useState(null)   // { title } if duplicate found
  const [showDupModal,  setShowDupModal]  = useState(false)
  const [mode,          setMode]          = useState('transcribe')
  const [result,        setResult]        = useState(null)
  const [error,         setError]         = useState(null)

  // Review state
  const [title,    setTitle]    = useState('')
  const [sections, setSections] = useState([])
  const [courseId, setCourseId] = useState('')
  const [tags,     setTags]     = useState([])
  const [courses,  setCourses]  = useState([])
  const [allTags,  setAllTags]  = useState([])

  useEffect(() => {
    listCourses().then(setCourses).catch(() => {})
    listTags().then(ts => setAllTags(ts.map(t => t.name ?? t))).catch(() => {})
  }, [])

  // ── File validation ─────────────────────────────────────────────────────────

  function handleFile(f) {
    if (!f) { setFile(null); return }
    if (!ACCEPTED.includes(f.type)) {
      setError('Unsupported file type. Please upload a JPEG, PNG, WebP, or PDF.')
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`File too large. Maximum size is ${MAX_MB} MB.`)
      return
    }
    setError(null)
    setFile(f)
    setFileHash(null)
    setDupInfo(null)

    // Hash the file and check for duplicates in the background
    hashFile(f).then(hash => {
      setFileHash(hash)
      return checkImageHashes([hash])
    }).then(({ duplicates }) => {
      const match = Object.values(duplicates)[0]
      if (match) setDupInfo(match)
    }).catch(() => {})   // best-effort — never block the user
  }

  // ── Extract ─────────────────────────────────────────────────────────────────

  async function handleExtract() {
    if (!file) return
    // If a duplicate was found, show a confirmation modal before proceeding
    if (dupInfo) { setShowDupModal(true); return }
    await doExtract()
  }

  async function doExtract() {
    setShowDupModal(false)
    setStep('extracting')
    setError(null)
    try {
      const data = await extractNote(file, mode)
      setResult(data)
      setTitle(data.suggested_title)
      setSections(data.sections.map(s => ({ ...s, _key: crypto.randomUUID() })))
      setStep('review')
    } catch (e) {
      setError(e.message ?? 'Extraction failed. Please try again.')
      setStep('upload')
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!title.trim())     { setError('Please add a title.'); return }
    if (!sections.length)  { setError('Note has no sections.'); return }
    setStep('saving')
    setError(null)
    try {
      const note = await createNote({
        title:           title.trim(),
        course_id:       courseId || null,
        tags:            tags,
        extraction_mode: mode,
        ai_model_used:   result.ai_model_used,
        image_hash:      fileHash || result.image_hash || null,
        sections:        sections.map((s, i) => ({
          heading:       s.heading || null,
          content_type:  s.content_type,
          content:       s.content,
          section_order: i,
        })),
      })
      // Persist source file in IndexedDB so NoteEditor can show it as a reference
      if (file) await saveSourceFile(note.id, file).catch(() => {})
      navigate(`/notes/${note.id}`)
    } catch (e) {
      setError(e.message ?? 'Could not save note. Please try again.')
      setStep('review')
    }
  }

  function handleReExtract() {
    setStep('upload')
    setResult(null)
    setSections([])
    setTitle('')
    setError(null)
  }

  // ── Tag helpers ─────────────────────────────────────────────────────────────

  function handleAddTag(name) {
    const t = name.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
  }

  function handleRemoveTag(name) {
    setTags(prev => prev.filter(t => t !== name))
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="upload-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Upload Notes</h1>
          <p>Upload a photo of your whiteboard, handwritten notes, or slides.</p>
        </div>
      </div>

      <StepIndicator step={step} />

      {error && (
        <div className="banner banner-error" style={{ margin: '16px 0' }}>
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {step === 'upload' && (
        <UploadStep
          file={file}
          mode={mode}
          onFile={handleFile}
          onMode={setMode}
          onExtract={handleExtract}
        />
      )}

      {step === 'extracting' && <ExtractingStep mode={mode} />}

      {(step === 'review' || step === 'saving') && (
        <ReviewStep
          file={file}
          title={title}
          sections={sections}
          courses={courses}
          courseId={courseId}
          tags={tags}
          allTags={allTags}
          result={result}
          saving={step === 'saving'}
          onTitleChange={setTitle}
          onSectionsChange={setSections}
          onCourseChange={setCourseId}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onSave={handleSave}
          onReExtract={handleReExtract}
        />
      )}

      {showDupModal && (
        <DuplicateModal
          title={dupInfo?.title}
          onProceed={doExtract}
          onCancel={() => setShowDupModal(false)}
        />
      )}
    </div>
  )
}

// ── Duplicate modal ───────────────────────────────────────────────────────────

function DuplicateModal({ title, onProceed, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header" style={{ marginBottom: 12 }}>
          <AlertCircle size={20} style={{ color: 'var(--color-warning, #d97706)' }} />
          <h3>Already in your library</h3>
        </div>
        <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
          {title
            ? <>This document was already transcribed as <strong>"{title}"</strong>.</>
            : <>This document is already in your library.</>
          }{' '}
          Transcribing it again will create a duplicate note.
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onProceed}>
            Transcribe anyway
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }) {
  const steps  = [
    { id: 'upload',     label: 'Upload'  },
    { id: 'extracting', label: 'Extract' },
    { id: 'review',     label: 'Review'  },
  ]
  const current = step === 'saving' ? 'review' : step
  const idx     = steps.findIndex(s => s.id === current)

  return (
    <div className="step-indicator">
      {steps.map((s, i) => (
        <div key={s.id} className="step-row">
          <div className={`step-dot ${i < idx ? 'done' : i === idx ? 'active' : ''}`}>
            {i < idx ? <CheckCircle2 size={13} /> : <span>{i + 1}</span>}
          </div>
          <span className={`step-label ${i === idx ? 'active' : ''}`}>{s.label}</span>
          {i < steps.length - 1 && <div className={`step-line ${i < idx ? 'done' : ''}`} />}
        </div>
      ))}
    </div>
  )
}

// ── Upload step ───────────────────────────────────────────────────────────────

function UploadStep({ file, mode, onFile, onMode, onExtract }) {
  const inputRef     = useRef(null)
  const [drag, setDrag] = useState(false)

  const onDrop = useCallback(e => {
    e.preventDefault()
    setDrag(false)
    onFile(e.dataTransfer.files[0] ?? null)
  }, [onFile])

  return (
    <div className="upload-step">
      {/* Drop zone */}
      <div
        className={`dropzone${drag ? ' dropzone--drag' : ''}${file ? ' dropzone--has-file' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && !file && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          style={{ display: 'none' }}
          onChange={e => onFile(e.target.files[0] ?? null)}
        />

        {file ? (
          <div className="dropzone-file">
            <div className="dropzone-file-icon"><FileText size={26} /></div>
            <div className="flex-1">
              <p className="dropzone-file-name">{file.name}</p>
              <p className="text-muted text-sm">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={e => { e.stopPropagation(); onFile(null) }}
              data-tooltip="Remove file"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="dropzone-empty">
            <div className="dropzone-icon"><UploadIcon size={22} /></div>
            <p className="dropzone-title">Drop your image here</p>
            <p className="text-muted text-sm">
              or click to browse · JPEG, PNG, WebP, PDF · max {MAX_MB} MB
            </p>
          </div>
        )}
      </div>

      <p className="upload-privacy-note">
        🔒 Your image is processed and immediately discarded — we never store uploaded files.
      </p>

      {/* Mode selector */}
      <div className="mode-selector">
        <p className="section-label">Extraction mode</p>
        <div className="mode-cards">
          {MODES.map(({ id, label, desc, Icon }) => (
            <button
              key={id}
              className={`mode-card${mode === id ? ' mode-card--active' : ''}`}
              onClick={() => onMode(id)}
            >
              <div className="mode-card-icon"><Icon size={18} /></div>
              <div className="flex-1">
                <p className="mode-card-label">{label}</p>
                <p className="mode-card-desc">{desc}</p>
              </div>
              {mode === id && <CheckCircle2 className="mode-card-check" size={16} />}
            </button>
          ))}
        </div>
      </div>

      <div className="upload-actions">
        <button
          className="btn btn-primary btn-lg"
          onClick={onExtract}
          disabled={!file}
        >
          Extract Notes <ChevronRight size={17} />
        </button>
      </div>
    </div>
  )
}

// ── Extracting step ───────────────────────────────────────────────────────────

function ExtractingStep({ mode }) {
  return (
    <div className="extracting-step">
      <Loader2 size={36} className="extracting-spinner" />
      <h3>{mode === 'study_guide' ? 'Generating study guide…' : 'Transcribing your notes…'}</h3>
      <p className="text-muted text-sm">Reading and structuring your content. This takes a few seconds.</p>
    </div>
  )
}

// ── Review step ───────────────────────────────────────────────────────────────

function ReviewStep({
  file,
  title, sections, courses: coursesProp, courseId, tags, allTags = [], result, saving,
  onTitleChange, onSectionsChange, onCourseChange,
  onAddTag, onRemoveTag, onSave, onReExtract,
}) {
  // Local course list so we can append a newly-created course without prop drilling
  const [localCourses, setLocalCourses] = useState(coursesProp)
  const [addingCourse,  setAddingCourse]  = useState(false)
  const [newCourseName, setNewCourseName] = useState('')
  const [courseError,   setCourseError]   = useState(null)
  const [courseLoading, setCourseLoading] = useState(false)

  // Source file preview — create an object URL from the in-memory File
  const [previewUrl, setPreviewUrl] = useState(null)
  const isPdf = file?.type === 'application/pdf'

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Sync if parent updates (e.g. re-render before saving)
  useState(() => { setLocalCourses(coursesProp) }, [coursesProp])

  async function handleCreateCourse() {
    const name = newCourseName.trim()
    if (!name) return
    setCourseLoading(true)
    setCourseError(null)
    try {
      const created = await createCourse({ name })
      setLocalCourses(prev => [...prev, created])
      onCourseChange(String(created.id))
      setNewCourseName('')
      setAddingCourse(false)
    } catch (e) {
      setCourseError(e.message ?? 'Failed to create course')
    } finally {
      setCourseLoading(false)
    }
  }

  function updateSection(key, field, value) {
    onSectionsChange(prev => prev.map(s => s._key === key ? { ...s, [field]: value } : s))
  }
  function removeSection(key) {
    onSectionsChange(prev => prev.filter(s => s._key !== key))
  }
  function addSection() {
    onSectionsChange(prev => [...prev, {
      _key: crypto.randomUUID(),
      heading: '',
      content_type: 'text',
      content: '',
    }])
  }

  return (
    <div className="review-step">
      <div className={`review-layout${previewUrl ? ' review-layout--with-source' : ''}`}>

        {/* Source preview pane (only when a file was uploaded) */}
        {previewUrl && (
          <div className="review-source-pane">
            <p className="review-source-label">Source file</p>
            {isPdf ? (
              <iframe
                className="review-source-pdf"
                src={previewUrl}
                title="Uploaded PDF"
              />
            ) : (
              <img
                className="review-source-img"
                src={previewUrl}
                alt="Uploaded file preview"
              />
            )}
          </div>
        )}

        {/* Centre: title + sections */}
        <div className="review-main">

          {result?.warnings?.length > 0 && (
            <div className="banner banner-warning" style={{ marginBottom: 16 }}>
              <AlertCircle size={15} />
              <span>{result.warnings.join(' · ')}</span>
            </div>
          )}

          <div className="field" style={{ marginBottom: 20 }}>
            <label>Title</label>
            <input
              className="input"
              style={{ fontSize: '1rem', fontWeight: 600 }}
              value={title}
              onChange={e => onTitleChange(e.target.value)}
              placeholder="Note title"
            />
          </div>

          {result && (
            <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
              <span className="section-label" style={{ marginBottom: 0 }}>Confidence</span>
              <span className={`badge ${
                result.confidence === 'high'   ? 'badge-green'  :
                result.confidence === 'medium' ? 'badge-yellow' : 'badge-red'
              }`}>
                {result.confidence}
              </span>
              <span className="text-faint text-xs">· {result.ai_model_used}</span>
            </div>
          )}

          <p className="section-label">Sections — edit before saving</p>

          <div className="review-sections">
            {sections.map(s => (
              <SectionEditor
                key={s._key}
                section={s}
                onChange={(field, value) => updateSection(s._key, field, value)}
                onRemove={() => removeSection(s._key)}
              />
            ))}
          </div>

          <button className="btn btn-secondary btn-sm mt-2" onClick={addSection}>
            <Plus size={13} /> Add section
          </button>
        </div>

        {/* Right: metadata + save */}
        <div className="review-sidebar">
          <div className="card card-flat" style={{ padding: 16 }}>

            <div className="field">
              <label>Course</label>
              {addingCourse ? (
                <div className="new-course-wrap">
                  <input
                    className="input"
                    placeholder="Course name"
                    value={newCourseName}
                    autoFocus
                    onChange={e => setNewCourseName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateCourse()
                      if (e.key === 'Escape') { setAddingCourse(false); setNewCourseName('') }
                    }}
                    disabled={courseLoading}
                  />
                  <div className="new-course-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleCreateCourse}
                      disabled={courseLoading || !newCourseName.trim()}
                    >
                      {courseLoading ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                      {courseLoading ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setAddingCourse(false); setNewCourseName('') }}
                      disabled={courseLoading}
                    >
                      Cancel
                    </button>
                  </div>
                  {courseError && <p className="text-danger text-xs mt-1">{courseError}</p>}
                </div>
              ) : (
                <div className="course-select-wrap">
                  <select className="select" value={courseId} onChange={e => onCourseChange(e.target.value)}>
                    <option value="">No course</option>
                    {localCourses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-ghost btn-sm new-course-btn"
                    onClick={() => setAddingCourse(true)}
                    type="button"
                  >
                    <Plus size={13} /> New course
                  </button>
                </div>
              )}
            </div>

            <div className="field mt-3">
              <label>Tags</label>
              <TagSelect
                selectedTags={tags}
                allTags={allTags}
                onAdd={onAddTag}
                onRemove={onRemoveTag}
                placeholder="Add tag, press Enter"
              />
            </div>

            <hr className="divider" />

            <div className="flex flex-col gap-2">
              <button className="btn btn-primary w-full" onClick={onSave} disabled={saving}>
                {saving
                  ? <><Loader2 size={14} className="spin" /> Saving…</>
                  : <><Save size={14} /> Save note</>}
              </button>
              <button className="btn btn-ghost w-full btn-sm" onClick={onReExtract} disabled={saving}>
                <RotateCcw size={13} /> Re-extract
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section editor ────────────────────────────────────────────────────────────

function SectionEditor({ section, onChange, onRemove }) {
  return (
    <div className="section-editor">
      <div className="section-editor-header">
        <GripVertical size={14} className="drag-handle" />
        <input
          className="input section-heading-input"
          placeholder="Heading (optional)"
          value={section.heading || ''}
          onChange={e => onChange('heading', e.target.value)}
        />
        <select
          className="select section-type-select"
          value={section.content_type}
          onChange={e => onChange('content_type', e.target.value)}
        >
          {CONTENT_TYPES.map(t => (
            <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onRemove}
          data-tooltip="Remove section"
        >
          <X size={13} />
        </button>
      </div>
      <textarea
        className={`textarea section-content${section.content_type === 'equation' ? ' section-content--mono' : ''}`}
        value={section.content}
        onChange={e => onChange('content', e.target.value)}
        placeholder="Section content…"
        rows={4}
      />
    </div>
  )
}
