import type { ChangeEvent } from 'react'
import { BarChart3, FileText, GraduationCap, Home, LogIn, Play, Trash2, Upload, User, UserPlus, Wrench } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import type { WorksheetDefinition } from '../lib/types'
import { useTeacherAuth } from './TeacherAuth'

export function GlobalBreadcrumb() {
  const location = useLocation()
  const { user, loading } = useTeacherAuth()
  const labels: Record<string, string> = {
    '/builder': 'Worksheet builder',
    '/system-guide': 'System guide',
    '/synthesis': 'Student synthesis',
    '/synthesis/ai-tool-lab': 'Student synthesis',
    '/report': 'Teacher report',
    '/report/ai-tool-lab': 'Teacher report',
    '/worksheet': 'Worksheet player',
    '/worksheet/ai-tool-lab': 'Worksheet player',
    '/preview': 'Worksheet preview',
    '/account': 'Teacher account',
  }

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 text-sm text-slate-600">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="inline-flex items-center gap-1.5 font-medium text-slate-800 hover:text-blue-700">
            <Home className="h-4 w-4" />
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <span className="truncate">{location.pathname.startsWith('/join') ? 'Join workbook' : labels[location.pathname] ?? 'Start'}</span>
        </div>
        <Link to="/account" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 hover:text-blue-700">
          <LogIn className="h-4 w-4" />
          {loading ? 'Account' : user ? (user.user_metadata?.display_name || user.email || 'Account') : 'Teacher sign in'}
        </Link>
      </div>
    </div>
  )
}

interface HomeScreenProps {
  definition: WorksheetDefinition
  definitionStatus: string
  importAndOpenWorksheet: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  clearWorksheetDefinition: () => void
}

export function HomeScreen({ definition, definitionStatus, importAndOpenWorksheet, clearWorksheetDefinition }: HomeScreenProps) {
  const hasLoadedWorksheet = definition.pages.length > 0
  const { user } = useTeacherAuth()

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Interactive worksheet platform</p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Central Worksheet Hub</h1>
        <p className="mt-4 max-w-2xl text-slate-600">Use the student and teacher entry points below to quickly get to the right tools.</p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Active worksheet</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{definition.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{definition.id} · version {definition.version} · {definition.pages.length} pages</p>
          <p className="mt-2 text-sm text-slate-600">{definitionStatus}</p>
          <button onClick={clearWorksheetDefinition} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400">
            <Trash2 className="h-4 w-4" />
            Clear active worksheet
          </button>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-blue-700"><User className="h-4 w-4" />Student</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">Complete worksheet</h3>
            <p className="mt-1 text-sm text-slate-600">Open the active worksheet and submit your response.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/join" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-500"><UserPlus className="h-4 w-4" />Join with a code</Link>
              {hasLoadedWorksheet ? (
                <Link to="/worksheet" className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-medium text-blue-700 hover:border-blue-400"><Play className="h-4 w-4" />Continue local worksheet</Link>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-500">
                  <Upload className="h-4 w-4" />Load worksheet
                  <input type="file" accept="application/json" className="hidden" onChange={importAndOpenWorksheet} />
                </label>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700"><GraduationCap className="h-4 w-4" />Teacher</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">Create and analyze</h3>
            <p className="mt-1 text-sm text-slate-600">Build worksheets and combine class response files into one synthesis report.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/account" className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-600"><GraduationCap className="h-4 w-4" />{user ? 'Teacher account' : 'Teacher sign in'}</Link>
              <Link to="/builder" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"><Wrench className="h-4 w-4" />Worksheet builder</Link>
              <Link to="/report" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"><BarChart3 className="h-4 w-4" />Reports &amp; synthesis</Link>
            </div>
          </section>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Reference</p>
          <Link to="/system-guide" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><FileText className="h-4 w-4" />Open system guide</Link>
        </div>
      </div>
    </main>
  )
}
