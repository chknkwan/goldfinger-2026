import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { role, password } = await req.json()
  const key = role === 'admin' ? 'ADMIN_PASSWORD' : role === 'scoring' ? 'SCORING_PASSWORD' : null
  if (!key) return NextResponse.json({ ok: false }, { status: 400 })
  const correct = process.env[key]
  if (!correct) return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้งรหัสผ่านในระบบ' }, { status: 500 })
  return NextResponse.json({ ok: password === correct })
}
