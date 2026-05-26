/**
 * fileStore.js — IndexedDB wrapper for persisting source files in the browser.
 *
 * Files are stored by note ID so the note editor can retrieve the original
 * uploaded image or PDF without touching the server filesystem.
 *
 * IndexedDB limits: Chrome allows up to ~60% of available disk space.
 * For typical lecture images (1–5 MB) and PDFs (5–20 MB) this is fine
 * for a course project, but files accumulate until the user clears
 * browser site data.
 */

const DB_NAME    = 'notesnap-files'
const STORE_NAME = 'source_files'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = ()  => reject(req.error)
  })
}

/** Persist a File/Blob under the given noteId. */
export async function saveSourceFile(noteId, file) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(file, noteId)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

/** Retrieve a previously saved File/Blob by noteId, or null if not found. */
export async function getSourceFile(noteId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(noteId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror   = () => reject(req.error)
  })
}

/** Remove the stored file for a note (e.g. when the note is deleted). */
export async function deleteSourceFile(noteId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(noteId)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
