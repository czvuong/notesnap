import { useState, useRef, useEffect } from 'react'
import { X, Tag } from 'lucide-react'
import './TagSelect.css'

/**
 * TagSelect – a multi-value tag picker that matches the `.select` courses dropdown style.
 *
 * Props:
 *   selectedTags  – string[]        currently selected tag names
 *   allTags       – string[]        full list of known tag names (for suggestions)
 *   onAdd(name)   – fn              called when the user confirms a new tag
 *   onRemove(name)– fn              called when the user removes a tag chip
 *   placeholder   – string          placeholder text (default "Add tag…")
 */
export default function TagSelect({
  selectedTags = [],
  allTags = [],
  onAdd,
  onRemove,
  placeholder = 'Add tag…',
}) {
  const [input, setInput] = useState('')
  const [open,  setOpen]  = useState(false)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)

  // Options shown in dropdown
  const filtered = allTags
    .filter(t => !selectedTags.includes(t))
    .filter(t => !input.trim() || t.toLowerCase().includes(input.trim().toLowerCase()))

  // True when the user typed something that doesn't already exist
  const isNew = input.trim() !== '' &&
    !allTags.some(t => t.toLowerCase() === input.trim().toLowerCase()) &&
    !selectedTags.includes(input.trim().toLowerCase())

  const showDropdown = open && (filtered.length > 0 || isNew)

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setInput('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function commit(name) {
    const n = name.trim().toLowerCase()
    if (n && !selectedTags.includes(n)) onAdd(n)
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      commit(input)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setInput('')
    } else if (e.key === 'Backspace' && !input && selectedTags.length > 0) {
      onRemove(selectedTags[selectedTags.length - 1])
    }
  }

  return (
    <div
      className="tag-select-wrap"
      ref={wrapRef}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Selected tag chips */}
      {selectedTags.map(t => (
        <span key={t} className="badge badge-gray">
          {t}
          <button
            className="tag-remove"
            type="button"
            onClick={e => { e.stopPropagation(); onRemove(t) }}
          >
            <X size={10} />
          </button>
        </span>
      ))}

      {/* Text input */}
      <input
        ref={inputRef}
        className="tag-input"
        placeholder={selectedTags.length === 0 ? placeholder : ''}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {/* Dropdown */}
      {showDropdown && (
        <div className="tag-select-dropdown">
          {filtered.map(t => (
            <button
              key={t}
              className="tag-select-option"
              type="button"
              onMouseDown={e => { e.preventDefault(); commit(t) }}
            >
              {t}
            </button>
          ))}
          {isNew && (
            <button
              className="tag-select-option tag-select-option-new"
              type="button"
              onMouseDown={e => { e.preventDefault(); commit(input) }}
            >
              <Tag size={12} />
              Create &ldquo;{input.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
