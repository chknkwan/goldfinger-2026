'use client'
import { useState } from 'react'

export default function LoginScreen({ onLogin }: { onLogin: (pw: string) => boolean }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!onLogin(pw)) { setErr(true); setPw('') }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl p-8 shadow-xl border border-yellow-200 bg-white">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🥇</div>
            <h1 style={{ fontFamily: "'Nunito', sans-serif" }} className="text-2xl font-black text-amber-800">Goldfinger</h1>
            <p className="text-sm text-amber-600 mt-1 font-semibold">Math Week 2026 • โรงเรียนพูลเจริญวิทยาคม</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-amber-800 mb-2">รหัสผ่าน</label>
              <input
                type="password"
                value={pw}
                onChange={e => { setPw(e.target.value); setErr(false) }}
                className="w-full px-4 py-3 rounded-xl border-2 border-yellow-300 bg-amber-50 text-lg font-semibold focus:outline-none focus:border-amber-500"
                placeholder="••••••••"
                autoFocus
              />
              {err && <p className="text-red-600 text-sm font-bold mt-2">รหัสผ่านไม่ถูกต้อง</p>}
            </div>
            <button type="submit" className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-800 to-amber-500 text-white font-bold text-lg shadow-md hover:opacity-90 transition">
              เข้าสู่ระบบ
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
