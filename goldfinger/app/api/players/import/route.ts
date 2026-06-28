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

  // แจ้งเตือนถ้ามีระดับที่ไม่รู้จัก
  const invalidLevel = toInsert.filter(r => r.level !== 'มต้น' && r.level !== 'มปลาย')
  if (invalidLevel.length > 0) {
    return NextResponse.json({ error: `พบระดับที่ไม่ถูกต้อง: ${[...new Set(invalidLevel.map(r => r.level))].join(', ')} — ใช้ "มต้น" หรือ "มปลาย" เท่านั้น` }, { status: 400 })
  }

  if (duplicates.length > 0 && !force) {
    return NextResponse.json({ duplicates, toInsert: toInsert.length })
  }

  // insert ที่ไม่ซ้ำ — ทีละคนเพื่อหลีกเลี่ยง race condition บนเลขผู้เล่น
  const results = []
  for (const level of ['มต้น', 'มปลาย']) {
    const levelRows = toInsert.filter(r => r.level === level)
    for (const row of levelRows) {
      let inserted = false
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: last } = await supabase.from('players').select('number').eq('level', level).order('number', { ascending: false }).limit(1)
        const nextNum = last && last.length > 0 ? last[0].number + 1 : 1
        const { data, error } = await supabase.from('players').insert({ number: nextNum, name: row.name.trim(), level: row.level, room: row.room || '' }).select().single()
        if (!error) { results.push(data); inserted = true; break }
        if (!error.message.includes('unique') && !error.message.includes('duplicate')) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }
      if (!inserted) return NextResponse.json({ error: `ไม่สามารถกำหนดหมายเลขให้ ${row.name} ได้` }, { status: 500 })
    }
  }

  return NextResponse.json({ inserted: results.length, duplicatesSkipped: duplicates.length })
}
