import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2, GraduationCap, LoaderCircle, LockKeyhole, Mail, UserRound } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

interface TeacherAuthContextValue {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const TeacherAuthContext = createContext<TeacherAuthContextValue | null>(null)

function isPermanentTeacher(user: User | null) {
  return Boolean(user && !user.is_anonymous)
}

export function TeacherAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) {
      return
    }

    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(isPermanentTeacher(data.session?.user ?? null) ? data.session!.user : null)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setUser(isPermanentTeacher(session?.user ?? null) ? session!.user : null)
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return <TeacherAuthContext.Provider value={{ user, loading, signOut }}>{children}</TeacherAuthContext.Provider>
}

export function useTeacherAuth() {
  const context = useContext(TeacherAuthContext)
  if (!context) throw new Error('useTeacherAuth must be used inside TeacherAuthProvider.')
  return context
}

type AuthMode = 'sign-in' | 'sign-up'

function getAuthErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match.'
  if (/user already registered/i.test(message)) return 'An account already exists for that email. Try signing in instead.'
  if (/password should be at least/i.test(message)) return 'Use a password with at least 8 characters.'
  if (/email rate limit/i.test(message)) return 'Too many emails have been requested. Please wait a few minutes and try again.'
  return message
}

export function TeacherAccountPage() {
  const { user, loading, signOut } = useTeacherAuth()
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setMessage('')
    setError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return

    setSubmitting(true)
    setMessage('')
    setError('')

    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (signInError) throw signInError
        setMessage('Signed in successfully.')
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
          },
        })
        if (signUpError) throw signUpError
        setMessage(data.session
          ? 'Your teacher account is ready.'
          : 'Account created. Check your email and follow the confirmation link to finish signing in.')
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    setSubmitting(true)
    setError('')
    try {
      await signOut()
      setMessage('You have signed out.')
    } catch (authError) {
      setError(getAuthErrorMessage(authError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-45px)] max-w-5xl items-center px-5 py-10">
      <div className="grid w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
        <section className="bg-slate-900 p-8 text-white sm:p-10">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
            <GraduationCap className="h-6 w-6" />
          </span>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Workbooks for teachers</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Keep your worksheets and responses together.</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">A teacher account will let you publish worksheets, share a simple learner link, and collect submissions without passing JSON files around.</p>
          <ul className="mt-8 space-y-3 text-sm text-slate-200">
            {['Publish with a short class code', 'Collect learner submissions online', 'Open responses in Reports & synthesis'].map((item) => (
              <li key={item} className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />{item}</li>
            ))}
          </ul>
        </section>

        <section className="p-8 sm:p-10">
          {loading ? (
            <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-600"><LoaderCircle className="h-5 w-5 animate-spin" />Checking your account…</div>
          ) : user ? (
            <div className="flex min-h-80 flex-col justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><UserRound className="h-6 w-6" /></div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Signed in</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Welcome back{user.user_metadata?.display_name ? `, ${user.user_metadata.display_name}` : ''}.</h2>
              <p className="mt-2 text-sm text-slate-600">{user.email}</p>
              <p className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Your account is ready. Publishing and online response controls are the next part of the teacher workflow.</p>
              {message && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}
              {error && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p>}
              <button type="button" onClick={handleSignOut} disabled={submitting} className="mt-7 w-fit rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-60">Sign out</button>
            </div>
          ) : !isSupabaseConfigured ? (
            <div className="flex min-h-80 flex-col justify-center">
              <h2 className="text-2xl font-bold text-slate-900">Teacher accounts are not configured</h2>
              <p className="mt-3 text-sm text-slate-600">Add the Supabase URL and publishable key to this deployment to enable sign up and sign in.</p>
            </div>
          ) : (
            <>
              <div className="flex rounded-lg bg-slate-100 p-1" aria-label="Teacher account action">
                <button type="button" onClick={() => changeMode('sign-in')} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${mode === 'sign-in' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>Sign in</button>
                <button type="button" onClick={() => changeMode('sign-up')} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${mode === 'sign-up' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>Create account</button>
              </div>

              <h2 className="mt-7 text-2xl font-bold text-slate-900">{mode === 'sign-in' ? 'Sign in to Workbooks' : 'Create your teacher account'}</h2>
              <p className="mt-2 text-sm text-slate-600">{mode === 'sign-in' ? 'Continue building and managing your class worksheets.' : 'Use your school or personal email. Workbooks remains free for educators.'}</p>

              <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                {mode === 'sign-up' && (
                  <label className="block text-sm font-medium text-slate-700">Name
                    <span className="relative mt-1.5 block"><UserRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></span>
                  </label>
                )}
                <label className="block text-sm font-medium text-slate-700">Email
                  <span className="relative mt-1.5 block"><Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></span>
                </label>
                <label className="block text-sm font-medium text-slate-700">Password
                  <span className="relative mt-1.5 block"><LockKeyhole className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input required type="password" minLength={8} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></span>
                  {mode === 'sign-up' && <span className="mt-1 block text-xs font-normal text-slate-500">At least 8 characters.</span>}
                </label>

                {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
                {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

                <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">
                  {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  {submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create free account'}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
