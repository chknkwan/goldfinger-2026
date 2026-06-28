import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get('level')!
  const game = req.nextUrl.searchParams.get('game')
  let q = supabase.from('games')
    .select('*, player1:player1_id(*), player2:player2_id(*)')
    .eq('level', level)
  if (game) q = q.eq('game', game)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { game, level, sub_table, player1_id, score1, player2_id, score2, force } = body

  const table_num = parseInt(sub_table.replace(/[^0-9]/g, ''), 10)

  // ถ้าไม่ force ให้เช็คว่ามีผลอยู่แล้วไหม — ถ้ามีให้ return 409
  if (!force) {
    const { data: existing } = await supabase.from('games')
      .select('id, score1').eq('game', game).eq('level', level).eq('sub_table', sub_table).single()
    if (existing && existing.score1 !== null) {
      return NextResponse.json({ conflict: true }, { status: 409 })
    }
  }

  const { data, error } = await supabase.from('games')
    .upsert(
      { game, level, table_num, sub_table, player1_id, score1, player2_id, score2, updated_at: new Date().toISOString() },
      { onConflict: 'game,level,sub_table' }
    )
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
