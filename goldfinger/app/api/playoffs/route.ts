import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { computeStandings, computeMatchResult, Player, GameRow } from '@/lib/gf-logic'

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get('level')!
  const { data, error } = await supabase.from('playoffs')
    .select('*, player1:player1_id(*), player2:player2_id(*)')
    .eq('level', level).order('round').order('pair_no')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, level } = body

  if (action === 'semi') {
    // ตรวจครบ 4 เกม
    for (let g = 1; g <= 4; g++) {
      const { data: ta } = await supabase.from('table_assignments').select('sub_table, is_bye').eq('level', level).eq('game', g)
      const { data: scored } = await supabase.from('games').select('sub_table, score1, score2').eq('level', level).eq('game', g)
      const scoredMap: Record<string, { score1: number | null; score2: number | null }> = {}
      ;(scored || []).forEach((r: { sub_table: string; score1: number | null; score2: number | null }) => { scoredMap[r.sub_table] = r })
      const missing = (ta || [])
        .filter((t: { sub_table: string; is_bye: boolean }) => !t.is_bye)
        .filter((t: { sub_table: string }) => { const s = scoredMap[t.sub_table]; return !s || s.score1 === null || s.score2 === null })
      if (missing.length) return NextResponse.json({ error: `เกม ${g} ยังกรอกไม่ครบ` }, { status: 400 })
    }

    const { data: players } = await supabase.from('players').select('*').eq('level', level)
    const { data: games } = await supabase.from('games').select('*').eq('level', level)
    const standings = computeStandings((players || []) as Player[], (games || []) as GameRow[])
    const top4 = standings.slice(0, 4)
    if (top4.length < 4) return NextResponse.json({ error: 'ผู้เล่นน้อยกว่า 4 คน' }, { status: 400 })

    await supabase.from('playoffs').delete().eq('level', level).eq('round', 'รองชนะเลิศ')
    await supabase.from('playoffs').insert([
      { level, round: 'รองชนะเลิศ', pair_no: 1, player1_id: top4[0].player.id, player2_id: top4[3].player.id },
      { level, round: 'รองชนะเลิศ', pair_no: 2, player1_id: top4[1].player.id, player2_id: top4[2].player.id }
    ])
    return NextResponse.json({ ok: true, pairs: [
      { pairNo: 1, p1: top4[0].player, p2: top4[3].player },
      { pairNo: 2, p1: top4[1].player, p2: top4[2].player }
    ]})
  }

  if (action === 'final') {
    const { data: semis } = await supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level).eq('round', 'รองชนะเลิศ')
    if (!semis || semis.length < 2) return NextResponse.json({ error: 'ยังไม่มีผลรองชนะเลิศ' }, { status: 400 })
    const incomplete = semis.filter((s: { score1: number | null; score2: number | null }) => s.score1 === null || s.score2 === null)
    if (incomplete.length) return NextResponse.json({ error: 'กรอกผลรองชนะเลิศยังไม่ครบ' }, { status: 400 })

    function getWinner(s: { player1_id: number; score1: number; player2_id: number; score2: number }) {
      const r = computeMatchResult(s.score1, s.score2)
      if (r.resultA === 'T') throw new Error('ผลรองชนะเลิศเสมอ — กรรมการต้องตัดสินก่อน')
      return r.resultA === 'W' ? { winner: s.player1_id, loser: s.player2_id } : { winner: s.player2_id, loser: s.player1_id }
    }
    let r1, r2
    try { r1 = getWinner(semis[0]); r2 = getWinner(semis[1]) }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
    await supabase.from('playoffs').delete().eq('level', level).eq('round', 'ชิงชนะเลิศ')
    await supabase.from('playoffs').insert([{ level, round: 'ชิงชนะเลิศ', pair_no: 1, player1_id: r1.winner, player2_id: r2.winner }])
    return NextResponse.json({ ok: true, final: { p1Id: r1.winner, p2Id: r2.winner }, thirdPlace: [r1.loser, r2.loser] })
  }

  if (action === 'save') {
    const { level, round, pair_no, player1_id, score1, player2_id, score2 } = body
    const { data, error } = await supabase.from('playoffs')
      .upsert({ level, round, pair_no, player1_id, score1, player2_id, score2, updated_at: new Date().toISOString() }, { onConflict: 'level,round,pair_no' })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
