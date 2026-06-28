'use client'
import { useState, useEffect } from 'react'

export function useAuth(role: 'admin' | 'scoring' = 'admin') {
  const SESSION_KEY = `gf_auth_${role}`

  const [authed, setAuthed] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    setChecked(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  async function login(pw: string): Promise<boolean> {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, password: pw }),
      })
      const data = await res.json()
      if (data.ok) {
        sessionStorage.setItem(SESSION_KEY, '1')
        setAuthed(true)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setAuthed(false)
  }

  return { authed, checked, login, logout }
}
