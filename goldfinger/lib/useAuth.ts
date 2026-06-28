'use client'
import { useState, useEffect } from 'react'

const PASSWORDS: Record<string, string> = {
  admin: process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'goldfinger2026',
  scoring: process.env.NEXT_PUBLIC_SCORING_PASSWORD || 'goldfinger2026',
}

export function useAuth(role: 'admin' | 'scoring' = 'admin') {
  const SESSION_KEY = `gf_auth_${role}`

  const [authed, setAuthed] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    setChecked(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  function login(pw: string) {
    if (pw === PASSWORDS[role]) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setAuthed(true)
      return true
    }
    return false
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setAuthed(false)
  }

  return { authed, checked, login, logout }
}
