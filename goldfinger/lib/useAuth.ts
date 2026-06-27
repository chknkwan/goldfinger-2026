'use client'
import { useState, useEffect } from 'react'

const PASSWORD = process.env.NEXT_PUBLIC_APP_PASSWORD || 'goldfinger2026'
const SESSION_KEY = 'gf_auth'

export function useAuth() {
  const [authed, setAuthed] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    setChecked(true)
  }, [])

  function login(pw: string) {
    if (pw === PASSWORD) {
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
