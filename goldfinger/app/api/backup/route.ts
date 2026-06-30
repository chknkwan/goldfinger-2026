import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET — download full backup as JSON
export async function GET() {
  const [{ data: players }, { data: games }, { data: tables }, { data: playoffs }, { data: broadcast }] =
    await Promise.all([
      supabase.from('players').select('*').order('level').order('number'),
      supabase.from('games').select('*').order('id'),
      supabase.from('table_assignments').select('*').order('id'),
      supabase.from('playoffs').select('*').order('id'),
      supabase.from('broadcast').select('*').order('id'),
    ])

  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    players: players || [],
    games: games || [],
    table_assignments: tables || [],
    playoffs: playoffs || [],
    broadcast: broadcast || [],
  }

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="goldfinger-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}

// POST — restore from JSON backup
export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body?.version || !Array.isArray(body.players)) {
    return NextResponse.json({ error: 'ไฟล์ไม่ถูกต้อง' }, { status: 400 })
  }

  // Delete all existing data
  await Promise.all([
    supabase.from('broadcast').delete().neq('id', 0),
    supabase.from('playoffs').delete().neq('id', 0),
    supabase.from('table_assignments').delete().neq('id', 0),
    supabase.from('games').delete().neq('id', 0),
    supabase.from('players').delete().neq('id', 0),
  ])

  // Re-insert ทุกตารางด้วย id ใหม่จาก sequence (ไม่คง id เดิม) แล้ว remap FK
  // — ป้องกัน sequence ของ id ตามหลัง max(id) ซึ่งทำให้ insert ใหม่ภายหลัง id ชนกัน
  const strip = (r: Record<string, unknown>, ...keys: string[]) => {
    const c = { ...r }; for (const k of keys) delete c[k]; return c
  }

  type DBPlayer = { id: number; number: number; level: string }
  const idMap = new Map<number, number>()   // old player id → new player id

  if (body.players?.length) {
    const toInsert = (body.players as Record<string, unknown>[]).map(p => strip(p, 'id', 'created_at'))
    const { data: inserted, error } = await supabase.from('players').insert(toInsert).select('id, number, level')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // จับคู่ id เดิม→ใหม่ ผ่าน (number|level) ซึ่ง unique
    const newByKey = new Map<string, number>()
    for (const np of (inserted || []) as DBPlayer[]) newByKey.set(`${np.number}|${np.level}`, np.id)
    for (const op of body.players as DBPlayer[]) {
      const newId = newByKey.get(`${op.number}|${op.level}`)
      if (newId != null) idMap.set(op.id, newId)
    }
  }

  const remap = (id: number | null | undefined) => (id == null ? null : idMap.get(id) ?? null)
  const remapRows = (rows: Record<string, unknown>[]) =>
    rows.map(r => ({
      ...strip(r, 'id', 'updated_at', 'saved_at', 'created_at'),
      player1_id: remap(r.player1_id as number | null),
      player2_id: remap(r.player2_id as number | null),
    }))

  if (body.games?.length) {
    const { error } = await supabase.from('games').insert(remapRows(body.games))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (body.table_assignments?.length) {
    const { error } = await supabase.from('table_assignments').insert(remapRows(body.table_assignments))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (body.playoffs?.length) {
    const { error } = await supabase.from('playoffs').insert(remapRows(body.playoffs))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// DELETE — reset data
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode') // 'results' or 'all'

  await Promise.all([
    supabase.from('broadcast').delete().neq('id', 0),
    supabase.from('playoffs').delete().neq('id', 0),
    supabase.from('table_assignments').delete().neq('id', 0),
    supabase.from('games').delete().neq('id', 0),
  ])

  if (mode === 'all') {
    await supabase.from('players').delete().neq('id', 0)
  }

  await supabase.from('broadcast').insert({ type: 'reset', level: null, payload: {} })
  return NextResponse.json({ ok: true })
}
