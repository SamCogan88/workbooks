import {
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  ExternalLink,
  FileImage,
  GraduationCap,
  Home,
  LogIn,
  UserRound,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { loadSession } from '../lib/storage'
import type { WorksheetDefinition } from '../lib/types'
import { useTeacherAuth } from './TeacherAuth'

const RESPONSE_ID_KEY = 'worksheet-session-id'

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
    '/teacher': 'My workbooks',
  }

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 text-sm text-slate-600">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="inline-flex items-center gap-1.5 font-medium text-slate-800 hover:text-blue-700">
            <Home className="h-4 w-4" />
            Home
          </Link>
          {location.pathname !== '/' && (
            <>
              <span aria-hidden="true">/</span>
              <span className="truncate">{location.pathname.startsWith('/join') ? 'Join workbook' : location.pathname.startsWith('/teacher/workbooks/') ? 'Workbook responses' : labels[location.pathname] ?? 'Start'}</span>
            </>
          )}
        </div>
        <Link to={user ? '/teacher' : '/account'} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 hover:text-blue-700">
          <LogIn className="h-4 w-4" />
          {loading ? 'Teacher' : user ? 'My workbooks' : 'Teacher sign in'}
        </Link>
      </div>
    </div>
  )
}

interface HomeScreenProps {
  definition: WorksheetDefinition
}

function LearnerIllustration() {
  return (
    <div aria-hidden="true" className="relative h-52 w-72">
      <div className="absolute inset-2 rounded-[45%] bg-blue-50" />
      <div className="absolute bottom-2 left-5 h-28 w-4 -rotate-12 rounded-full bg-emerald-300/60" />
      <div className="absolute bottom-1 left-12 h-36 w-5 -rotate-[24deg] rounded-full bg-emerald-600/65" />
      <div className="absolute left-16 top-10 h-40 w-40 -rotate-6 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 shadow-lg" />
      <div className="absolute left-24 top-14 h-40 w-40 rotate-3 rounded-xl border border-blue-100 bg-white p-7 shadow-xl">
        <div className="h-2 w-24 rounded-full bg-slate-200" />
        <div className="mt-4 flex gap-5">
          <div className="space-y-3 pt-1">
            <span className="block h-4 w-4 rounded-full bg-blue-400" />
            <span className="block h-4 w-4 rounded-full bg-blue-300" />
            <span className="block h-4 w-4 rounded-full bg-blue-300" />
          </div>
          <div className="space-y-4">
            <div className="h-14 w-16 rounded-lg bg-blue-50 p-3"><FileImage className="h-8 w-8 text-blue-400" /></div>
            <div className="h-2 w-20 rounded-full bg-slate-200" />
          </div>
        </div>
      </div>
    </div>
  )
}

function TeacherIllustration() {
  return (
    <div aria-hidden="true" className="relative h-52 w-72">
      <div className="absolute inset-2 rounded-[45%] bg-blue-50" />
      <div className="absolute bottom-6 right-7 h-28 w-5 rotate-12 rounded-full bg-emerald-500/60" />
      <div className="absolute bottom-7 right-16 h-36 w-5 rotate-[22deg] rounded-full bg-emerald-700/60" />
      <div className="absolute bottom-4 right-0 h-4 w-32 rounded-full bg-blue-400" />
      <div className="absolute bottom-10 right-2 h-4 w-28 rounded-full bg-emerald-500" />
      <div className="absolute left-8 top-12 h-32 w-48 -skew-x-3 rounded-xl border-[10px] border-slate-300 bg-white p-5 shadow-xl">
        <div className="flex gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500"><Check className="h-4 w-4 text-white" /></div>
          <div className="space-y-2 pt-1"><div className="h-2 w-20 rounded bg-slate-200" /><div className="h-2 w-14 rounded bg-slate-200" /></div>
        </div>
        <div className="mt-4 flex gap-3"><div className="h-7 w-7 rounded-md bg-blue-50" /><div className="mt-2 h-2 w-20 rounded bg-slate-200" /></div>
      </div>
      <div className="absolute bottom-5 left-5 h-3 w-52 -skew-x-12 rounded-full bg-slate-400" />
    </div>
  )
}

export function HomeScreen({ definition }: HomeScreenProps) {
  const { user } = useTeacherAuth()
  const responseId = typeof window === 'undefined'
    ? null
    : localStorage.getItem(`${RESPONSE_ID_KEY}:${definition.id}:${definition.version}`)
  const savedSession = responseId ? loadSession(definition.id, definition.version, responseId) : null
  const pageCount = definition.pages.length
  const resumePage = pageCount > 0 && savedSession
    ? Math.min(Math.max(savedSession.pageIndex, 0), pageCount - 1)
    : 0
  const resumeProgress = pageCount > 0 ? ((resumePage + 1) / pageCount) * 100 : 0

  return (
    <main className="min-h-[calc(100vh-49px)] overflow-hidden bg-[radial-gradient(circle_at_50%_16%,#eff6ff_0,white_42%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 lg:pt-16">
        <section className="relative mx-auto min-h-64 max-w-5xl text-center">
          <div className="absolute -left-24 -top-3 hidden lg:block"><LearnerIllustration /></div>
          <div className="absolute -right-24 -top-3 hidden lg:block"><TeacherIllustration /></div>
          <div className="relative z-10 mx-auto max-w-2xl pt-4">
            <h1 className="text-5xl font-extrabold tracking-[-0.045em] text-slate-950 sm:text-6xl">Workbooks</h1>
            <p className="mt-5 text-xl font-medium text-slate-700 sm:text-2xl">Interactive activities for teaching and learning.</p>
            <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-slate-500 sm:text-lg">Learners join with a code, and teachers create, run, and review activities.</p>
          </div>
        </section>

        <section className="mx-auto mt-3 grid max-w-6xl gap-6 md:grid-cols-2" aria-label="Choose how to use Workbooks">
          <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-white to-blue-50/80 p-7 shadow-[0_14px_40px_-28px_rgba(37,99,235,0.55)] sm:p-8">
            <div className="flex items-start gap-5">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600"><UserRound className="h-8 w-8" /></span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-600">Learner</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Join an activity</h2>
                <p className="mt-3 text-base leading-7 text-slate-600">Enter a code from your teacher. No account needed.</p>
                <Link to="/join" className="mt-6 inline-flex items-center gap-4 rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                  Join with a code <ArrowRight className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/80 p-7 shadow-[0_14px_40px_-28px_rgba(5,150,105,0.55)] sm:p-8">
            <div className="flex items-start gap-5">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><GraduationCap className="h-9 w-9" /></span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">Educator</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Teacher workspace</h2>
                <p className="mt-3 text-base leading-7 text-slate-600">Create workbooks, share them, and review responses.</p>
                <Link to={user ? '/teacher' : '/account'} className="mt-6 inline-flex items-center gap-4 rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2">
                  Open teacher workspace <ArrowRight className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {savedSession && pageCount > 0 && (
          <section className="mx-auto mt-7 max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.55)] sm:px-7" aria-label="Continue where you left off">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"><Clock3 className="h-7 w-7" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Continue where you left off</p>
                <h2 className="mt-2 truncate text-xl font-bold text-slate-900">{definition.title}</h2>
                <div className="mt-2 flex items-center gap-3 text-sm text-slate-500">
                  <span>Page {resumePage + 1} of {pageCount}</span>
                  <span className="h-2 w-36 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${resumeProgress}%` }} /></span>
                </div>
              </div>
              <Link to="/worksheet" className="inline-flex shrink-0 items-center justify-center gap-3 rounded-xl bg-blue-50 px-5 py-3 font-semibold text-blue-700 transition hover:bg-blue-100">
                Continue <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </section>
        )}

        <footer className="mx-auto mt-10 flex max-w-6xl justify-center border-t border-slate-200 pt-5">
          <Link to="/system-guide" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-blue-700">
            <BookOpen className="h-4 w-4" /> System guide <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </footer>
      </div>
    </main>
  )
}
