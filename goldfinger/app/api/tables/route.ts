import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  generateGame1, generateCrossover, generateSwiss,
  computeStandings, TableDef, Player, GameRow
} from '@/lib/gf-logic'

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get('level')!
  const game = req.nextUrl.searchParams.get('game')

  let q = supabase.from('table_assignments')
    .select('*, player1:player1_id(*), player2:player2_id(*)')
    .eq('level', level).order('table_num').order('sub_table')
  if (game) q = q.eq('game', game)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { level, game } = body as { level: string; game: number }

  const { data: playersData } = await supabase.from('players').select('*').eq('level', level).order('number')
  const players = (playersData || []) as Player[]
  const playerMap: Record<number, Player> = {}
  players.forEach(p => { playerMap[p.id] = p })

  // ตรวจว่ากรอกผลเกมก่อนหน้าครบ
  if (game > 1) {
    const prevGame = game - 1
    const { data: ta } = await supabase.from('table_assignments').select('sub_table, is_bye').eq('level', level).eq('game', prevGame)
    if (!ta || ta.length === 0) {
      return NextResponse.json({ error: `ยังไม่ได้จัดโต๊ะเกม ${prevGame} กรุณาจัดโต๊ะตามลำดับ` }, { status: 400 })
    }
    const { data: scored } = await supabase.from('games').select('sub_table, score1, score2').eq('level', level).eq('game', prevGame)
    const scoredMap: Record<string, { score1: number | null; score2: number | null }> = {}
    ;(scored || []).forEach((r: { sub_table: string; score1: number | null; score2: number | null }) => { scoredMap[r.sub_table] = r })
    const missing = (ta || [])
      .filter((t: { sub_table: string; is_bye: boolean }) => !t.is_bye)
      .filter((t: { sub_table: string; is_bye: boolean }) => {
        const s = scoredMap[t.sub_table]
        return !s || s.score1 === null || s.score2 === null
      })
      .map((t: { sub_table: string }) => t.sub_table)
    if (missing.length > 0) {
      return NextResponse.json({ error: `กรอกผลเกม ${prevGame} ยังไม่ครบ (เหลือ: ${missing.join(', ')})` }, { status: 400 })
    }
  }

  // สร้างการจัดโต๊ะ
  // Game 1: random | even games: crossover จาก game ก่อนหน้า | odd games (3+): Swiss
  let tables: TableDef[] = []
  if (game === 1) {
    tables = generateGame1(players)
  } else if (game % 2 === 0) {
    // Crossover จาก game ก่อนหน้า
    const prevGame = game - 1
    const { data: prevTA } = await supabase.from('table_assignments')
      .select('*, player1:player1_id(*), player2:player2_id(*)')
      .eq('level', level).eq('game', prevGame).order('table_num')
    const { data: prevScores } = await supabase.from('games')
      .select('*').eq('level', level).eq('game', prevGame)

    const tableMap: Record<number, TableDef> = {}
    for (const row of (prevTA || [])) {
      const tn = row.table_num
      if (!tableMap[tn]) tableMap[tn] = { table_num: tn, pairA: null, pairB: null, byeA: null, byeB: null }
      const t = tableMap[tn]
      if (row.is_bye) { t.byeA = row.player1 as Player; continue }
      if (row.sub_table.endsWith('A')) { t.pairA = { p1: row.player1 as Player, p2: row.player2 as Player } }
      else { t.pairB = { p1: row.player1 as Player, p2: row.player2 as Player } }
    }
    const prevTables = Object.values(tableMap).sort((a, b) => a.table_num - b.table_num)
    tables = generateCrossover(prevTables, (prevScores || []) as GameRow[], playerMap)
  } else {
    // Swiss — ใช้คะแนนสะสมทุกเกมก่อนหน้า
    const prevGames = Array.from({ length: game - 1 }, (_, i) => i + 1)
    const { data: allScores } = await supabase.from('games').select('*').eq('level', level).in('game', prevGames)
    const standings = computeStandings(players, (allScores || []) as GameRow[])
    tables = generateSwiss(standings)
  }

  // บันทึกลง DB
  await supabase.from('table_assignments').delete().eq('level', level).eq('game', game)

  const rows: object[] = []
  const byeGameRows: object[] = []
  for (const t of tables) {
    if (t.byeA) {
      rows.push({ game, level, table_num: t.table_num, sub_table: `${t.table_num}A`, player1_id: t.byeA.id, player2_id: null, is_bye: true, note: 'bye' })
      byeGameRows.push({ game, level, table_num: t.table_num, sub_table: `${t.table_num}A`, player1_id: t.byeA.id, score1: 20, player2_id: null, score2: null })
    } else {
      if (t.pairA) rows.push({ game, level, table_num: t.table_num, sub_table: `${t.table_num}A`, player1_id: t.pairA.p1.id, player2_id: t.pairA.p2.id, is_bye: false, note: '' })
      if (t.pairB) rows.push({ game, level, table_num: t.table_num, sub_table: `${t.table_num}B`, player1_id: t.pairB.p1.id, player2_id: t.pairB.p2.id, is_bye: false, note: '' })
      if (t.byeB) {
        rows.push({ game, level, table_num: t.table_num, sub_table: `${t.table_num}B`, player1_id: t.byeB.id, player2_id: null, is_bye: true, note: 'bye' })
        byeGameRows.push({ game, level, table_num: t.table_num, sub_table: `${t.table_num}B`, player1_id: t.byeB.id, score1: 20, player2_id: null, score2: null })
      }
    }
  }

  const { error: insertErr } = await supabase.from('table_assignments').insert(rows)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  if (byeGameRows.length > 0) {
    for (const br of byeGameRows) {
      await supabase.from('games').upsert(br, { onConflict: 'game,level,sub_table' })
    }
  }

  await supabase.from('broadcast').insert({ type: 'current_game', level, payload: { game } })

  return NextResponse.json({ ok: true, tables })
}
