import { useState, useEffect } from 'react'
import {
  Palette, Type, Cpu, CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react'
import { useUser } from '@clerk/clerk-react'
import { useTheme, THEMES } from '../hooks/useTheme.js'
import { getPreferences, updatePreferences, checkHealth } from '../api.js'
import './Preferences.css'

// ── Option sets ───────────────────────────────────────────────────────────────

const HEADING_STYLES = [
  { value: 'title_case', label: 'Title Case',  preview: 'Introduction to Neural Networks' },
  { value: 'sentence',   label: 'Sentence case', preview: 'Introduction to neural networks' },
  { value: 'upper',      label: 'ALL CAPS',    preview: 'INTRODUCTION TO NEURAL NETWORKS' },
]

const BULLET_STYLES = [
  { value: 'dash',   label: 'Dash',   preview: '— Item one' },
  { value: 'dot',    label: 'Dot',    preview: '• Item one' },
  { value: 'number', label: 'Number', preview: '1. Item one' },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Preferences() {
  const { user } = useUser()
  const { theme, setTheme } = useTheme(user?.id ?? null)

  const [prefs,   setPrefs]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  // Backend health / AI provider info
  const [health,  setHealth]  = useState(null)

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setPrefs({ heading_style: 'title_case', bullet_style: 'dash' }))
      .finally(() => setLoading(false))

    checkHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  async function handleSave() {
    if (!prefs) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await updatePreferences(prefs)
      setPrefs(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e.message ?? 'Could not save preferences.')
    } finally {
      setSaving(false)
    }
  }

  function update(key, val) {
    setPrefs(prev => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  return (
    <div className="prefs-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Preferences</h1>
          <p>Customise how NoteSnap looks and extracts your notes.</p>
        </div>
      </div>

      {/* ── Theme ── */}
      <section className="prefs-section">
        <div className="prefs-section-header">
          <Palette size={16} />
          <h2>Theme</h2>
        </div>
        <p className="prefs-section-desc">
          Choose a colour scheme. Changes apply instantly and are saved in your browser.
        </p>
        <div className="theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-card${theme === t.id ? ' theme-card--active' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <div className="theme-swatch" style={{ background: t.swatch }} />
              <span className="theme-label">{t.label}</span>
              {theme === t.id && (
                <CheckCircle2 size={14} className="theme-check" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ── Extraction style ── */}
      <section className="prefs-section">
        <div className="prefs-section-header">
          <Type size={16} />
          <h2>Extraction style</h2>
        </div>
        <p className="prefs-section-desc">
          These preferences are injected into every AI prompt so your notes stay consistent.
        </p>

        {loading ? (
          <div className="prefs-loading">
            <Loader2 size={18} className="spin" style={{ color: 'var(--color-primary)' }} />
            <span className="text-muted text-sm">Loading…</span>
          </div>
        ) : (
          <>
            <div className="prefs-field">
              <label className="prefs-label">Heading style</label>
              <div className="option-row">
                {HEADING_STYLES.map(o => (
                  <OptionCard
                    key={o.value}
                    label={o.label}
                    preview={o.preview}
                    selected={prefs?.heading_style === o.value}
                    onClick={() => update('heading_style', o.value)}
                  />
                ))}
              </div>
            </div>

            <div className="prefs-field" style={{ marginTop: 20 }}>
              <label className="prefs-label">Bullet style</label>
              <div className="option-row">
                {BULLET_STYLES.map(o => (
                  <OptionCard
                    key={o.value}
                    label={o.label}
                    preview={o.preview}
                    selected={prefs?.bullet_style === o.value}
                    onClick={() => update('bullet_style', o.value)}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="banner banner-error" style={{ marginTop: 16 }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="prefs-save-row">
              {saved && (
                <span className="prefs-saved">
                  <CheckCircle2 size={14} /> Saved
                </span>
              )}
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={handleSave}
              >
                {saving
                  ? <><Loader2 size={13} className="spin" /> Saving…</>
                  : 'Save preferences'}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── AI provider ── */}
      <section className="prefs-section">
        <div className="prefs-section-header">
          <Cpu size={16} />
          <h2>AI provider</h2>
        </div>
        <p className="prefs-section-desc">
          NoteSnap uses TritonAI (UCSD) as the primary vision model with Anthropic as fallback.
          Configure your API keys in the <code>.env</code> file at the project root.
        </p>

        <div className="provider-card">
          <div className="provider-row">
            <span className="provider-name">TritonAI</span>
            <span className={`badge ${health?.tritonai ? 'badge-green' : 'badge-gray'}`}>
              {health?.tritonai ? 'Connected' : 'Not configured'}
            </span>
          </div>
          <div className="provider-row">
            <span className="provider-name">Anthropic (fallback)</span>
            <span className={`badge ${health?.anthropic ? 'badge-green' : 'badge-gray'}`}>
              {health?.anthropic ? 'Connected' : 'Not configured'}
            </span>
          </div>
          {health?.model && (
            <p className="provider-model text-sm text-muted">
              Active model: <code>{health.model}</code>
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

// ── Option card ───────────────────────────────────────────────────────────────

function OptionCard({ label, preview, selected, onClick }) {
  return (
    <button
      className={`option-card${selected ? ' option-card--selected' : ''}`}
      onClick={onClick}
    >
      <span className="option-card-label">{label}</span>
      <span className="option-card-preview">{preview}</span>
      {selected && <CheckCircle2 size={13} className="option-card-check" />}
    </button>
  )
}
