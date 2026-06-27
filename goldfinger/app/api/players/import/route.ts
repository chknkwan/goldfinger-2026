import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/players/import — รับ array ของ { name, level, room }
// เช็คซ้ำกับ DB แล้วคืนรายการซ้ำก่อน ถ้า force=true ให้ข้ามคนซ้ำและ insert ที่ไม่ซ้ำ
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { rows, force = false } = body as { rows: { name: string; level: string; room: string }[]; force: boolean }

  const { data: existing } = await supabase.from('players').select('name, level')
  const existingSet = new Set((existing || []).map((p: { name: string; level: string }) => `${p.name}|${p.level}`))

  const duplicates: typeof rows = []
  const toInsert: typeof rows = []

  // เช็คซ้ำในไฟล์เอง
  const seenInFile = new Set<string>()
  for (const r of rows) {
    const key = `${r.name.trim()}|${r.level}`
    if (seenInFile.has(key)) { duplicates.push(r); continue }
    seenInFile.add(key)
    if (existingSet.has(key)) { duplicates.push(r) } else { toInsert.push(r) }
  }

  if (duplicates.length > 0 && !force) {
    return NextResponse.json({ duplicates, toInsert: toInsert.length })
  }

  // insert ที่ไม่ซ้ำ
  const results = []
  for (const level of ['มต้น', 'มปลาย']) {
    const levelRows = toInsert.filter(r => r.level === level)
    if (!levelRows.length) continue
    const { data: last } = await supabase.from('players').select('number').eq('level', level).order('number', { ascending: false }).limit(1)
    let nextNum = last && last.length > 0 ? last[0].number + 1 : 1
    const insertData = levelRows.map(r => ({ number: nextNum++, name: r.name.trim(), level: r.level, room: r.room || '' }))
    const { data, error } = await supabase.from('players').insert(insertData).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    results.push(...(data || []))
  }

  return NextResponse.json({ inserted: results.length, duplicatesSkipped: duplicates.length })
}
