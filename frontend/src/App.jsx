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
  LogOut,
} from 'lucide-react'
import { SignedIn, SignedOut, RedirectToSignIn, useAuth, useUser, UserButton } from '@clerk/clerk-react'
import { useEffect } from 'react'
import { useTheme } from './hooks/useTheme.js'
import { setTokenGetter } from './api.js'
import Dashboard    from './pages/Dashboard.jsx'
import UploadPage   from './pages/Upload.jsx'
import BatchUpload  from './pages/BatchUpload.jsx'
import NoteEditor   from './pages/NoteEditor.jsx'
import Library      from './pages/Library.jsx'
import CourseDetail from './pages/CourseDetail.jsx'
import StudyTools   from './pages/StudyTools.jsx'
import StudyHub     from './pages/StudyHub.jsx'
import TrashPage    from './pages/Trash.jsx'
import Preferences  from './pages/Preferences.jsx'
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

export default function App() {
  // Initialise theme on mount — reads localStorage and sets data-theme on <html>
  useTheme()

  return (
    <BrowserRouter>
      {/* Always sync the Clerk token into api.js when signed in */}
      <SignedIn>
        <AuthTokenSyncer />
      </SignedIn>

      {/* Redirect to Clerk's hosted sign-in page if not authenticated */}
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>

      <SignedIn>
        <div className="app-layout">
          <Sidebar />
          <main className="app-main">
            <Routes>
              <Route path="/"              element={<Dashboard />}  />
              <Route path="/upload"        element={<UploadPage />} />
              <Route path="/batch"         element={<BatchUpload />} />
              <Route path="/notes/:id"     element={<NoteEditor />} />
              <Route path="/notes/:id/study" element={<StudyTools />} />
              <Route path="/study"         element={<StudyHub />}   />
              <Route path="/library"       element={<Library />}    />
              <Route path="/courses/:id"   element={<CourseDetail />} />
              <Route path="/trash"         element={<TrashPage />}  />
              <Route path="/settings"      element={<Preferences />} />
              <Route path="*"              element={<NotFound />}   />
            </Routes>
          </main>
        </div>
      </SignedIn>
    </BrowserRouter>
  )
}

const NAV_ITEMS = [
  { to: '/',        label: 'Dashboard',    Icon: LayoutDashboard, end: true },
  { to: '/upload',  label: 'Upload',       Icon: Upload },
  { to: '/batch',   label: 'Batch Upload', Icon: Layers },
  { to: '/library', label: 'Library',      Icon: BookOpen },
  { to: '/study',   label: 'Study Tools',  Icon: GraduationCap },
  { to: '/trash',   label: 'Trash',        Icon: Trash2 },
  { to: '/settings',label: 'Preferences',  Icon: Settings },
]

function Sidebar() {
  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <BookMarked size={18} />
        </div>
        <span className="sidebar-brand-name">NoteSnap</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
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
          href="http://localhost:8000/docs"
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
