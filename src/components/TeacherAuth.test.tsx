// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

import { TeacherAccountPage, TeacherAuthProvider } from './TeacherAuth'

afterEach(cleanup)

describe('teacher account accessibility', () => {
  it('gives the sign-in submit button a distinct accessible name', async () => {
    render(
      createElement(TeacherAuthProvider, null,
        createElement(MemoryRouter, null, createElement(TeacherAccountPage)),
      ),
    )

    const modeButton = await screen.findByRole('button', { name: 'Sign in' })
    const submitButton = screen.getByRole('button', { name: 'Sign in to Workbooks' })

    expect(modeButton.getAttribute('aria-pressed')).toBe('true')
    expect(submitButton.getAttribute('type')).toBe('submit')
  })
})
