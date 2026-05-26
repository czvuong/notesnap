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


// ── Notes ─────────────────────────────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string}  [params.course_id]
 * @param {string}  [params.tag]
 * @param {string}  [params.mode]       - "transcribe" | "study_guide"
 * @param {string}  [params.q]          - search query
 * @param {string}  [params.sort]       - "newest" | "oldest" | "alpha"
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
  const res = await fetch(`${BASE}/api/images/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, err.detail ?? 'Image upload failed')
  }
  return res.json() // { url: "/static/images/..." }
}
