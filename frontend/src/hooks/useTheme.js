/**
 * useTheme.js — Theme management hook.
 *
 * Persists the user's chosen theme in localStorage and applies it
 * as a data-theme attribute on <html> so all CSS variables update instantly.
 *
 * The storage key is scoped by userId so that different Clerk accounts
 * on the same browser each keep their own theme choice.
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

const DEFAULT = 'violet'

function getStorageKey(userId) {
  return userId ? `notesnap_theme_${userId}` : 'notesnap_theme'
}

export function useTheme(userId = null) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem(getStorageKey(userId)) || DEFAULT
  })

  // When userId becomes available (after sign-in) or changes (account switch),
  // load that specific user's stored theme preference.
  useEffect(() => {
    const stored = localStorage.getItem(getStorageKey(userId))
    setThemeState(stored || DEFAULT)
  }, [userId])

  // Apply to DOM and persist whenever theme or the active user changes.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(getStorageKey(userId), theme)
  }, [theme, userId])

  return { theme, setTheme: setThemeState, themes: THEMES }
}
