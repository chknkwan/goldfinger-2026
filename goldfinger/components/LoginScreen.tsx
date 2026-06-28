'use client'
import { useState } from 'react'

interface Props {
  role?: 'admin' | 'scoring'
  onLogin: (pw: string) => boolean
}

const CONFIG = {
  admin: {
    icon: '🛡️',
    label: 'แผงแอดมิน',
    hint: 'สำหรับกรรมการจัดโต๊ะ',
    grad: 'from-[#A8D5D0] to-[#c9ecea]',
    border: 'border-teal-100',
    focus: 'focus:border-teal-400',
    bg: 'bg-teal-50',
    btn: 'from-[#A8D5D0] to-[#c9ecea]',
    text: 'text-teal-600',
    sub: 'text-teal-400',
  },
  scoring: {
    icon: '✍️',
    label: 'กรอกคะแนน',
    hint: 'สำหรับกรรมการประจำโต๊ะ',
    grad: 'from-[#F98B8B] to-[#FDBBBB]',
    border: 'border-pink-100',
    focus: 'focus:border-pink-400',
    bg: 'bg-pink-50',
    btn: 'from-[#F98B8B] to-[#FDBBBB]',
    text: 'text-pink-600',
    sub: 'text-pink-400',
  },
}

export default function LoginScreen({ role = 'admin', onLogin }: Props) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const [loading, setLoading] = useState(false)
  const cfg = CONFIG[role]

  const eventName = process.env.NEXT_PUBLIC_EVENT_NAME || 'Gold Finger'
  const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || ''

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => {
      const ok = onLogin(pw)
      setLoading(false)
      if (!ok) { setErr(true); setPw('') }
    }, 300)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#FEFAF2' }}>
      <div className="w-full max-w-sm">
        <div className={`rounded-3xl p-8 bg-gradient-to-br ${cfg.grad} text-white text-center mb-4 shadow-xl`}>
          <div className="text-6xl mb-3">{cfg.icon}</div>
          <h1 className="text-2xl font-black" style={{ fontFamily: "'Nunito',sans-serif" }}>Gold Finger</h1>
          <p className="text-white/80 text-sm mt-1 font-semibold">{cfg.label}</p>
        </div>

        <div className={`rounded-3xl p-7 bg-white shadow-lg border-2 ${cfg.border}`}>
          <p className={`text-center text-sm font-semibold ${cfg.sub} mb-6`}>{cfg.hint}</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={`block text-sm font-bold ${cfg.text} mb-2`}>รหัสผ่าน</label>
              <input
                type="password"
                value={pw}
                onChange={e => { setPw(e.target.value); setErr(false) }}
                className={`w-full px-4 py-3 rounded-2xl border-2 ${cfg.border} ${cfg.bg} text-lg font-semibold focus:outline-none ${cfg.focus} transition`}
                placeholder="••••••"
                autoFocus
              />
              {err && (
                <p className="text-red-400 text-sm font-bold mt-2">❌ รหัสผ่านไม่ถูกต้อง</p>
              )}
            </div>
            <button
              type="submit"
              disabled={loading || !pw}
              className={`w-full py-3 rounded-2xl bg-gradient-to-r ${cfg.btn} text-white font-bold text-lg shadow hover:opacity-90 active:scale-95 transition-all disabled:opacity-50`}
            >
              {loading ? '⏳ กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
          <p className={`text-center text-xs ${cfg.sub} mt-5 font-semibold`}>
            {eventName} · {schoolName}
          </p>
        </div>
      </div>
    </div>
  )
}
