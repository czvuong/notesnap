/**
 * api.js — Centralised API client.
 *
 * All HTTP calls go through here. Benefits:
 *   - One place to change the base URL or add auth headers later
 *   - Consistent error handling across the whole app
 *   - Each function mirrors an API endpoint from the spec exactly
 *
 * Every function returns the parsed JSON body on success, or throws
 * an ApiError with a human-readable message on failure.
 */

// In dev, Vite proxies /api → http://localhost:8000 (see vite.config.js)
// In production, set VITE_API_BASE in your .env to the deployed server URL
const BASE = import.meta.env.VITE_API_BASE ?? ''

// ── Auth token injection ───────────────────────────────────────────────────────
// App.jsx calls setTokenGetter() once the Clerk session is ready.
// Every request then attaches Authorization: Bearer <token> automatically.

let _getToken = null

/** Called by AuthTokenSyncer in App.jsx to wire up Clerk's getToken. */
export function setTokenGetter(fn) {
  _getToken = fn
}

// ── Error class ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name    = 'ApiError'
    this.status  = status
  }
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function request(method, path, body = null, isFormData = false) {
  const headers = {}
  if (body && !isFormData) headers['Content-Type'] = 'application/json'

  // Attach Clerk Bearer token if available
  if (_getToken) {
    try {
      const token = await _getToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
    } catch {
      // If token fetch fails, continue unauthenticated (backend will return 401)
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : null,
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const err = await res.json()
      message = err.detail ?? err.message ?? message
    } catch { /* response wasn't JSON */ }
    throw new ApiError(res.status, message)
  }

  // 204 No Content
  if (res.status === 204) return null

  return res.json()
}

const get    = (path)         => request('GET',    path)
const post   = (path, body)   => request('POST',   path, body)
const patch  = (path, body)   => request('PATCH',  path, body)
const del    = (path)         => request('DELETE', path)
const upload = (path, form)   => request('POST',   path, form, true)


// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Send an image file to the AI extraction pipeline.
 * The image is processed in memory server-side and never persisted.
 *
 * @param {File}   file - The uploaded image File object
 * @param {string} mode - "transcribe" | "study_guide"
 * @returns {Promise<ExtractionResult>}
 */
export function extractNote(file, mode = 'transcribe') {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  return upload('/api/extract', form)
}

/**
 * Upload multiple files to the batch extraction endpoint.
 * Consumes the Server-Sent Events stream and fires callbacks for each event.
 *
 * @param {File[]}  files    - Array of File objects to upload
 * @param {string}  mode     - "transcribe" | "study_guide"
 * @param {string|null} courseId - Optional course UUID to assign all notes to
 * @param {Object}  callbacks - Event handlers keyed by SSE event name:
 *   { batch_start, file_start, file_done, file_error, batch_complete }
 * @returns {Promise<void>}  Resolves when the stream closes.
 */
export async function batchExtract(files, mode, courseId, callbacks) {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  form.append('mode', mode)
  if (courseId) form.append('course_id', courseId)

  const batchHeaders = {}
  if (_getToken) {
    try {
      const token = await _getToken()
      if (token) batchHeaders['Authorization'] = `Bearer ${token}`
    } catch { /* continue without token */ }
  }

  const res = await fetch(`${BASE}/api/extract/batch`, {
    method: 'POST',
    headers: batchHeaders,
    body: form,
  })

  if (!res.ok) {
    let message = `Batch upload failed (${res.status})`
    try {
      const err = await res.json()
      message = err.detail ?? message
    } catch { /* non-JSON body */ }
    throw new ApiError(res.status, message)
  }

  // Parse the SSE stream manually (EventSource only supports GET; we need POST)
  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // SSE events are separated by blank lines (\n\n)
    const parts = buffer.split('\n\n')
    buffer = parts.pop()  // last element may be an incomplete event — keep buffered

    for (const part of parts) {
      if (!part.trim()) continue
      let eventType = 'message'
      let dataStr   = null

      for (const line of part.split('\n')) {
        if (line.startsWith('event: '))      eventType = line.slice(7).trim()
        else if (line.startsWith('data: '))  dataStr   = line.slice(6).trim()
      }

      if (dataStr) {
        try {
          const data = JSON.parse(dataStr)
          callbacks[eventType]?.(data)
        } catch { /* malformed JSON — skip */ }
      }
    }
  }
}

/** Remove a note from its batch group (sets batch_id → null). */
export function ungroupNote(id) {
  return patch(`/api/notes/${id}`, { batch_id: null })
}

/**
 * Hash a File object with SHA-256 using the browser's native crypto API.
 * Returns a lowercase hex string (64 chars).
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function hashFile(file) {
  const buf = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Check which of the given SHA-256 hashes already exist in the library.
 * @param {string[]} hashes
 * @returns {Promise<Object>} { duplicates: { hash: { note_id, title } } }
 */
export function checkImageHashes(hashes) {
  return post('/api/extract/check-hashes', { hashes })
}


// ── Notes ─────────────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string}  [params.course_id]
 * @param {string}  [params.tag]
 * @param {string}  [params.mode]       - "transcribe" | "study_guide"
 * @param {string}  [params.q]          - search query
 * @param {string}  [params.sort]       - "newest" | "oldest" | "alpha"
 * @param {string}  [params.batch_id]   - filter to one batch upload group
 * @param {number}  [params.page]
 * @param {number}  [params.limit]
 */
export function listNotes(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString()
  return get(`/api/notes${qs ? `?${qs}` : ''}`)
}

export function getNote(id)           { return get(`/api/notes/${id}`) }
export function createNote(body)      { return post('/api/notes', body) }
export function updateNote(id, body)  { return patch(`/api/notes/${id}`, body) }
export function deleteNote(id)        { return del(`/api/notes/${id}`) }

export function addTag(noteId, name)       { return post(`/api/notes/${noteId}/tags`, { name }) }
export function removeTag(noteId, tagId)   { return del(`/api/notes/${noteId}/tags/${tagId}`) }


// ── Sections ──────────────────────────────────────────────────────────────────

export function listSections(noteId)               { return get(`/api/notes/${noteId}/sections`) }
export function addSection(noteId, body)            { return post(`/api/notes/${noteId}/sections`, body) }
export function updateSection(noteId, sectionId, body) {
  return patch(`/api/notes/${noteId}/sections/${sectionId}`, body)
}
export function deleteSection(noteId, sectionId)   { return del(`/api/notes/${noteId}/sections/${sectionId}`) }
export function reorderSections(noteId, order)      { return patch(`/api/notes/${noteId}/sections`, { order }) }

export function getSectionRevisions(noteId, sectionId) {
  return get(`/api/notes/${noteId}/sections/${sectionId}/revisions`)
}
export function restoreRevision(noteId, sectionId, revisionId) {
  return post(`/api/notes/${noteId}/sections/${sectionId}/revisions/${revisionId}/restore`)
}


// ── Courses ───────────────────────────────────────────────────────────────────

export function listCourses()            { return get('/api/courses') }
export function getCourse(id)            { return get(`/api/courses/${id}`) }
export function createCourse(body)       { return post('/api/courses', body) }
export function updateCourse(id, body)   { return patch(`/api/courses/${id}`, body) }
export function deleteCourse(id)         { return del(`/api/courses/${id}`) }


// ── Corrections ───────────────────────────────────────────────────────────────

export function listCorrections()              { return get('/api/corrections') }
export function createCorrection(body)         { return post('/api/corrections', body) }
export function updateCorrection(id, body)     { return patch(`/api/corrections/${id}`, body) }
export function deleteCorrection(id)           { return del(`/api/corrections/${id}`) }


// ── Study tools ───────────────────────────────────────────────────────────────

export function generateFlashcards(noteId)     { return post(`/api/notes/${noteId}/flashcards/generate`) }
export function listFlashcards(noteId)         { return get(`/api/notes/${noteId}/flashcards`) }
export function reviewFlashcard(id, result)    { return post(`/api/flashcards/${id}/review`, { result }) }

export function generateQuestions(noteId)      { return post(`/api/notes/${noteId}/practice-questions/generate`) }
export function listQuestions(noteId)          { return get(`/api/notes/${noteId}/practice-questions`) }

export function generateCourseSummary(courseId) { return post(`/api/courses/${courseId}/summary/generate`) }

/** Generate flashcards or questions across multiple notes and save the session.
 *  @param {string[]} noteIds
 *  @param {'flashcards'|'practice_questions'} tool
 */
export function generateStudySession(noteIds, tool) {
  return post('/api/study-session/generate', { note_ids: noteIds, tool })
}

export function listStudySessions()          { return get('/api/study-sessions') }
export function deleteStudySession(id)       { return del(`/api/study-sessions/${id}`) }


// ── Trash ─────────────────────────────────────────────────────────────────────

export function listTrash()                    { return get('/api/trash') }
export function restoreNote(id)                { return post(`/api/trash/notes/${id}/restore`) }
export function restoreSection(id)             { return post(`/api/trash/sections/${id}/restore`) }
export function restoreCourse(id)              { return post(`/api/trash/courses/${id}/restore`) }


// ── Preferences ───────────────────────────────────────────────────────────────

export function getPreferences()               { return get('/api/preferences') }
export function updatePreferences(body)        { return patch('/api/preferences', body) }


// ── Health ────────────────────────────────────────────────────────────────────

export function checkHealth()                  { return get('/api/health') }


// ── Tags ──────────────────────────────────────────────────────────────────────

export function listTags()                     { return get('/api/tags') }

// ── Images ────────────────────────────────────────────────────────────────────

export async function uploadSectionImage(file) {
  const form = new FormData()
  form.append('file', file)

  const imgHeaders = {}
  if (_getToken) {
    try {
      const token = await _getToken()
      if (token) imgHeaders['Authorization'] = `Bearer ${token}`
    } catch { /* continue */ }
  }

  const res = await fetch(`${BASE}/api/images/upload`, { method: 'POST', headers: imgHeaders, body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, err.detail ?? 'Image upload failed')
  }
  return res.json() // { url: "/static/images/..." }
}
