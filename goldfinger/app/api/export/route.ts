import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { computeStandings, computeMatchResult, Player, GameRow } from '@/lib/gf-logic'
import * as XLSX from 'xlsx'

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get('level') || 'all'

  const levels = level === 'all' ? ['มต้น', 'มปลาย'] : [level]
  const wb = XLSX.utils.book_new()

  for (const lv of levels) {
    const { data: players } = await supabase.from('players').select('*').eq('level', lv).order('number')
    const { data: games } = await supabase.from('games').select('*').eq('level', lv)
    const { data: playoffs } = await supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', lv)

    const standings = computeStandings((players || []) as Player[], (games || []) as GameRow[])
    const playerMap: Record<number, Player> = {}
    ;(players || []).forEach((p: Player) => { playerMap[p.id] = p })

    // Sheet 1: ตารางอันดับ
    const standRows = standings.map(s => ({
      'อันดับ': s.rank,
      'หมายเลข': s.player.number,
      'ชื่อ-สกุล': s.player.name,
      'ระดับ': s.player.level,
      'ห้อง': s.player.room,
      'แต้มสะสม': s.points,
      'ผลต่างสะสม': s.diffSum,
      'ชนะ': s.w,
      'เสมอ': s.t,
      'แพ้': s.l,
    }))
    const ws1 = XLSX.utils.json_to_sheet(standRows)
    XLSX.utils.book_append_sheet(wb, ws1, `อันดับ ${lv}`)

    // Sheet 2: ผลการแข่งขันทั้งหมด
    const gameRows2 = (games || []).map((g: GameRow & { player1?: Player; player2?: Player }) => {
      const p1 = playerMap[g.player1_id]
      const p2 = g.player2_id ? playerMap[g.player2_id] : null
      const r = p2 ? computeMatchResult(g.score1, g.score2) : null
      return {
        'เกมที่': g.game,
        'โต๊ะย่อย': g.sub_table,
        'หมายเลข ผู้เล่น 1': p1?.number || '',
        'ชื่อ ผู้เล่น 1': p1?.name || '',
        'คะแนน ผู้เล่น 1': g.score1 ?? '',
        'หมายเลข ผู้เล่น 2': p2?.number || (g.player2_id ? '' : 'BYE'),
        'ชื่อ ผู้เล่น 2': p2?.name || (g.player2_id ? '' : 'BYE'),
        'คะแนน ผู้เล่น 2': g.score2 ?? '',
        'ผล ผู้เล่น 1': r ? r.resultA : 'W',
      }
    })
    const ws2 = XLSX.utils.json_to_sheet(gameRows2)
    XLSX.utils.book_append_sheet(wb, ws2, `ผลแข่งขัน ${lv}`)

    // Sheet 3: เพลย์ออฟ
    if (playoffs && playoffs.length > 0) {
      const pfRows = playoffs.map((p: { round: string; pair_no: number; player1: Player; score1: number | null; player2: Player; score2: number | null }) => {
        const r = computeMatchResult(p.score1, p.score2)
        return {
          'รอบ': p.round,
          'คู่ที่': p.pair_no,
          'ชื่อ ผู้เล่น 1': p.player1?.name || '',
          'คะแนน ผู้เล่น 1': p.score1 ?? '',
          'ชื่อ ผู้เล่น 2': p.player2?.name || '',
          'คะแนน ผู้เล่น 2': p.score2 ?? '',
          'ผู้ชนะ': (p.score1 !== null && p.score2 !== null) ? (r.resultA === 'W' ? p.player1?.name : p.player2?.name) : '-',
        }
      })
      const ws3 = XLSX.utils.json_to_sheet(pfRows)
      XLSX.utils.book_append_sheet(wb, ws3, `เพลย์ออฟ ${lv}`)
    }
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="goldfinger_results.xlsx"`,
    }
  })
}
