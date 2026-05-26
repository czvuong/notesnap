/**
 * useTheme.js — Theme management hook.
 *
 * Persists the user's chosen theme in localStorage and applies it
 * as a data-theme attribute on <html> so all CSS variables update instantly.
 *
 * Themes are defined entirely in index.css — adding a new theme only
 * requires adding a [data-theme="name"] block there.
 */

import { useState, useEffect } from 'react'

export const THEMES = [
  { id: 'violet', label: 'Violet',    swatch: '#8458b3' },
  { id: 'blue',   label: 'Ocean',     swatch: '#3b82f6' },
  { id: 'sage',   label: 'Sage',      swatch: '#059669' },
  { id: 'dark',   label: 'Dark',      swatch: '#a78bfa' },
]

const STORAGE_KEY = 'notesnap_theme'
const DEFAULT     = 'violet'

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  // Apply on first render too
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return { theme, setTheme: setThemeState, themes: THEMES }
}
