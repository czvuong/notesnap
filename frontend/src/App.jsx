import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Upload,
  BookOpen,
  GraduationCap,
  Trash2,
  Settings,
  Plug,
  BookMarked,
  Layers,
  Menu,
  X,
} from 'lucide-react'
import { SignedIn, SignedOut, RedirectToSignIn, useAuth, useUser, UserButton } from '@clerk/clerk-react'
import { useEffect, useState } from 'react'
import { useTheme } from './hooks/useTheme.js'
import { setTokenGetter, getPreferences } from './api.js'
import Dashboard       from './pages/Dashboard.jsx'
import UploadPage      from './pages/Upload.jsx'
import BatchUpload     from './pages/BatchUpload.jsx'
import NoteEditor      from './pages/NoteEditor.jsx'
import Library         from './pages/Library.jsx'
import CoursesPage     from './pages/Courses.jsx'
import CourseDetail    from './pages/CourseDetail.jsx'
import StudyTools      from './pages/StudyTools.jsx'
import StudyHub        from './pages/StudyHub.jsx'
import TrashPage       from './pages/Trash.jsx'
import Preferences     from './pages/Preferences.jsx'
import PublicNoteView  from './pages/PublicNoteView.jsx'
import './App.css'

/**
 * Syncs the Clerk token getter into our api.js module so every request
 * automatically gets an Authorization header. Renders nothing.
 */
function AuthTokenSyncer() {
  const { getToken } = useAuth()
  useEffect(() => {
    setTokenGetter(() => getToken())
    return () => setTokenGetter(null)
  }, [getToken])
  return null
}

/**
 * Fetches the user's saved theme from the backend on app load and applies it.
 * This syncs the theme across devices — localStorage is the fast-load fallback,
 * but the backend value is authoritative. Renders nothing.
 */
function ThemeSyncer({ userId }) {
  const { setTheme } = useTheme(userId)
  useEffect(() => {
    if (!userId) return
    getPreferences()
      .then(prefs => { if (prefs?.theme) setTheme(prefs.theme) })
      .catch(() => {}) // silently fall back to localStorage value
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * AuthenticatedLayout — renders the full app shell (sidebar + routes) for
 * signed-in users, and redirects unauthenticated visitors to Clerk's sign-in.
 * Extracted so that the public /share/:slug route can live OUTSIDE this wrapper.
 */
function AuthenticatedLayout() {
  const { user } = useUser()
  useTheme(user?.id ?? null)

  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <>
      {/* Always sync the Clerk token into api.js when signed in */}
      <SignedIn>
        <AuthTokenSyncer />
        <ThemeSyncer userId={user?.id ?? null} />
      </SignedIn>

      {/* Redirect unauthenticated visitors to Clerk sign-in */}
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>

      <SignedIn>
        {/* Mobile topbar — only visible on small screens via CSS */}
        <div className="mobile-topbar">
          <div className="mobile-topbar-brand">
            <div className="mobile-topbar-brand-icon">
              <BookMarked size={15} />
            </div>
            <span>NoteSnap</span>
          </div>
          <button
            className="mobile-hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
        </div>

        {/* Overlay backdrop — tapping closes sidebar on mobile */}
        <div
          className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay--visible' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />

        <div className="app-layout">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="app-main">
            <Routes>
              <Route path="/"              element={<Dashboard />}  />
              <Route path="/upload"        element={<UploadPage />} />
              <Route path="/batch"         element={<BatchUpload />} />
              <Route path="/notes/:id"     element={<NoteEditor />} />
              <Route path="/notes/:id/study" element={<StudyTools />} />
              <Route path="/study"         element={<StudyHub />}   />
              <Route path="/library"       element={<Library />}    />
              <Route path="/courses"       element={<CoursesPage />} />
              <Route path="/courses/:id"   element={<CourseDetail />} />
              <Route path="/trash"         element={<TrashPage />}  />
              <Route path="/settings"      element={<Preferences />} />
              <Route path="*"              element={<NotFound />}   />
            </Routes>
          </main>
        </div>
      </SignedIn>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/*
          Public share page — accessible WITHOUT authentication.
          Must be declared BEFORE the catch-all authenticated route.
        */}
        <Route path="/share/:slug" element={<PublicNoteView />} />

        {/* Everything else requires a Clerk sign-in */}
        <Route path="/*" element={<AuthenticatedLayout />} />
      </Routes>
    </BrowserRouter>
  )
}

const NAV_ITEMS = [
  { to: '/',        label: 'Dashboard',    Icon: LayoutDashboard, end: true },
  { to: '/upload',  label: 'Upload',       Icon: Upload },
  { to: '/batch',   label: 'Batch Upload', Icon: Layers },
  { to: '/library', label: 'Library',      Icon: BookOpen },
  { to: '/courses', label: 'Courses',      Icon: BookMarked },
  { to: '/study',   label: 'Study Tools',  Icon: GraduationCap },
  { to: '/trash',   label: 'Trash',        Icon: Trash2 },
  { to: '/settings',label: 'Preferences',  Icon: Settings },
]

function Sidebar({ open, onClose }) {
  return (
    <aside className={`sidebar${open ? ' sidebar--open' : ''}`}>
      {/* Brand (with close button on mobile) */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <BookMarked size={18} />
        </div>
        <span className="sidebar-brand-name">NoteSnap</span>
        <button
          className="sidebar-close-btn"
          onClick={onClose}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            className={({ isActive }) =>
              `sidebar-link${isActive ? ' sidebar-link--active' : ''}`
            }
          >
            <Icon size={16} className="sidebar-link-icon" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <a
          href="https://notesnap.up.railway.app/docs"
          target="_blank"
          rel="noreferrer"
          className="sidebar-link sidebar-link--subtle"
        >
          <Plug size={14} className="sidebar-link-icon" />
          <span>API Docs</span>
        </a>
        {/* Clerk user avatar + sign-out dropdown */}
        <div style={{ paddingTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    </aside>
  )
}

function NotFound() {
  return (
    <div className="empty-state" style={{ marginTop: '80px' }}>
      <div className="empty-state-icon">
        <BookOpen size={24} />
      </div>
      <h3>Page not found</h3>
      <p>The page you're looking for doesn't exist.</p>
      <a href="/" className="btn btn-primary mt-3">Go home</a>
    </div>
  )
}
