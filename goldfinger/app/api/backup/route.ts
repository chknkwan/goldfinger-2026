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

  // Re-insert — keep player IDs so FK references in games/table_assignments/playoffs remain valid
  const stripExceptId = (rows: Record<string, unknown>[]) => rows.map(r => { const c = { ...r }; delete c.updated_at; return c })
  const stripAll = (rows: Record<string, unknown>[]) => rows.map(r => { const c = { ...r }; delete c.id; delete c.updated_at; return c })

  if (body.players?.length) await supabase.from('players').insert(stripExceptId(body.players))
  if (body.games?.length) await supabase.from('games').insert(stripAll(body.games))
  if (body.table_assignments?.length) await supabase.from('table_assignments').insert(stripAll(body.table_assignments))
  if (body.playoffs?.length) await supabase.from('playoffs').insert(stripAll(body.playoffs))

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
