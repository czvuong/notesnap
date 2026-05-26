import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Trash2, RotateCcw, FileText, BookOpen, Layers,
  Clock, Loader2, Inbox, AlertTriangle,
} from 'lucide-react'
import { listTrash, restoreNote, restoreSection, restoreCourse } from '../api.js'
import './Trash.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TTL_DAYS = 7

function daysLeft(deletedAt) {
  if (!deletedAt) return 0
  const expiry = new Date(deletedAt).getTime() + TTL_DAYS * 86_400_000
  return Math.max(0, Math.ceil((expiry - Date.now()) / 86_400_000))
}

function formatDeletedAt(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const TYPE_META = {
  note:    { label: 'Note',    Icon: FileText,  restoreFn: restoreNote    },
  section: { label: 'Section', Icon: Layers,    restoreFn: restoreSection },
  course:  { label: 'Course',  Icon: BookOpen,  restoreFn: restoreCourse  },
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Trash() {
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [restoring, setRestoring] = useState(null) // id being restored

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await listTrash()
      setItems(data)
    } catch (e) {
      setError(e.message ?? 'Failed to load trash.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore(item) {
    const itemType = item.item_type ?? item.type
    const meta = TYPE_META[itemType]
    if (!meta) return
    setRestoring(item.id)
    try {
      await meta.restoreFn(item.id)
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (e) {
      alert(e.message ?? 'Restore failed.')
    } finally {
      setRestoring(null)
    }
  }

  // Backend returns `item_type` (not `type`) — normalise here
  const byType = {
    note:    items.filter(i => (i.item_type ?? i.type) === 'note'),
    section: items.filter(i => (i.item_type ?? i.type) === 'section'),
    course:  items.filter(i => (i.item_type ?? i.type) === 'course'),
  }

  return (
    <div className="trash-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Trash</h1>
          <p>Items are permanently deleted after {TTL_DAYS} days.</p>
        </div>
      </div>

      <div className="trash-notice">
        <Clock size={14} />
        Items deleted more than {TTL_DAYS} days ago are gone permanently and cannot be recovered.
      </div>

      {loading ? (
        <div className="trash-loading">
          <Loader2 size={28} className="spin" style={{ color: 'var(--color-primary)' }} />
          <p className="text-muted text-sm">Loading…</p>
        </div>
      ) : error ? (
        <div className="banner banner-error" style={{ marginTop: 24 }}>{error}</div>
      ) : items.length === 0 ? (
        <EmptyTrash />
      ) : (
        <div className="trash-sections">
          {['note', 'course', 'section'].map(type => {
            const group = byType[type]
            if (!group.length) return null
            const { label, Icon } = TYPE_META[type]
            return (
              <section key={type} className="trash-group">
                <div className="trash-group-header">
                  <Icon size={15} />
                  <span>{label}s ({group.length})</span>
                </div>
                <div className="trash-list">
                  {group.map(item => (
                    <TrashItem
                      key={item.id}
                      item={item}
                      itemType={type}
                      restoring={restoring === item.id}
                      onRestore={() => handleRestore(item)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Trash item row ────────────────────────────────────────────────────────────

function TrashItem({ item, itemType, restoring, onRestore }) {
  const type = itemType
  const remaining = daysLeft(item.deleted_at)
  const urgent    = remaining <= 1

  return (
    <div className={`trash-item${urgent ? ' trash-item--urgent' : ''}`}>
      <div className="trash-item-info">
        <p className="trash-item-title">{item.label ?? item.title ?? item.heading ?? item.name ?? 'Untitled'}</p>
        <div className="trash-item-meta">
          {item.course_name && (
            <span className="trash-item-meta-chip">
              <BookOpen size={11} /> {item.course_name}
            </span>
          )}
          {item.note_title && type === 'section' && (
            <span className="trash-item-meta-chip">
              <FileText size={11} /> {item.note_title}
            </span>
          )}
          <span className="trash-item-meta-chip">
            <Clock size={11} /> Deleted {formatDeletedAt(item.deleted_at)}
          </span>
        </div>
      </div>

      <div className="trash-item-right">
        {urgent ? (
          <span className="trash-ttl trash-ttl--urgent">
            <AlertTriangle size={12} />
            {remaining === 0 ? 'Expires today' : `${remaining}d left`}
          </span>
        ) : (
          <span className="trash-ttl">
            <Clock size={12} /> {remaining}d left
          </span>
        )}

        <button
          className="btn btn-secondary btn-sm"
          disabled={restoring}
          onClick={onRestore}
        >
          {restoring
            ? <><Loader2 size={13} className="spin" /> Restoring…</>
            : <><RotateCcw size={13} /> Restore</>}
        </button>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyTrash() {
  return (
    <div className="trash-empty">
      <div className="trash-empty-icon">
        <Trash2 size={28} />
      </div>
      <p className="trash-empty-title">Trash is empty</p>
      <p className="text-muted text-sm">Deleted notes, sections, and courses will appear here.</p>
      <Link to="/library" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
        Back to Library
      </Link>
    </div>
  )
}
