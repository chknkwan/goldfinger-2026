'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { computeStandings, computeMatchResult, Player, GameRow } from '@/lib/gf-logic'

type Level = 'มต้น' | 'มปลาย'
type View = 'standings' | 'tables' | 'playoff' | 'awards'

interface Standing { rank: number; player: Player; points: number; diffSum: number; w: number; t: number; l: number }
interface TARow { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean; table_num: number; game: number }
interface PFRow { round: string; pair_no: number; player1: Player; player2: Player | null; score1: number | null; score2: number | null }

export default function DisplayPage() {
  const [level, setLevel] = useState<Level>('มต้น')
  const [view, setView] = useState<View>('standings')
  const [standings, setStandings] = useState<Standing[]>([])
  const [tables, setTables] = useState<TARow[]>([])
  const [latestGame, setLatestGame] = useState(0)
  const [playoffs, setPlayoffs] = useState<PFRow[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [gameRows, setGameRows] = useState<GameRow[]>([])
  const [lastUpdate, setLastUpdate] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [realtimeOk, setRealtimeOk] = useState(true)
  const [projector, setProjector] = useState(false)
  const [clock, setClock] = useState('')
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ข้อ 7: นาฬิกา real-time
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const loadAll = useCallback(async () => {
    const [{ data: p }, { data: g }, { data: ta }, { data: pf }] = await Promise.all([
      supabase.from('players').select('*').eq('level', level).order('number'),
      supabase.from('games').select('*').eq('level', level),
      supabase.from('table_assignments').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level).order('game', { ascending: false }).order('table_num').order('sub_table'),
      supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level),
    ])
    const ps = (p || []) as Player[]
    const gs = (g || []) as GameRow[]
    setPlayers(ps)
    setGameRows(gs)
    setStandings(computeStandings(ps, gs) as Standing[])
    const taRows = (ta || []) as TARow[]
    const maxGame = taRows.reduce((m, r) => Math.max(m, r.game), 0)
    setLatestGame(maxGame)
    setTables(taRows.filter(r => r.game === maxGame))
    setPlayoffs((pf || []) as PFRow[])
    setLastUpdate(new Date().toLocaleTimeString('th-TH'))

    // ข้อ 3: reset disconnect timer ทุกครั้งที่ได้รับข้อมูล
    setRealtimeOk(true)
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    realtimeTimer.current = setTimeout(() => setRealtimeOk(false), 30000)
  }, [level])

  useEffect(() => {
    loadAll()
    const ch = supabase.channel(`display-${level}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `level=eq.${level}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_assignments', filter: `level=eq.${level}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playoffs', filter: `level=eq.${level}` }, loadAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast' }, payload => {
        const { type, level: bLevel, payload: p } = payload.new as { type: string; level: string; payload: { game?: number } }
        if (type === 'reset') { setResetKey(k => k + 1); loadAll() }
        if (type === 'current_game' && bLevel === level) { setLatestGame(p.game || 0); loadAll() }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setRealtimeOk(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeOk(false)
      })
    return () => { supabase.removeChannel(ch); if (realtimeTimer.current) clearTimeout(realtimeTimer.current) }
  }, [level, loadAll, resetKey])

  function getAwards() {
    const pfFinal = playoffs.find(p => p.round === 'ชิงชนะเลิศ')
    const pfSemis = playoffs.filter(p => p.round === 'รองชนะเลิศ')
    let champion: Player | null = null, runnerUp: Player | null = null, thirdPlace: Player[] = []
    if (pfFinal && pfFinal.score1 !== null && pfFinal.score2 !== null) {
      const r = computeMatchResult(pfFinal.score1, pfFinal.score2)
      champion = r.resultA === 'W' ? pfFinal.player1 : pfFinal.player2
      runnerUp = r.resultA === 'W' ? pfFinal.player2 : pfFinal.player1
    }
    pfSemis.forEach(s => {
      if (s.score1 !== null && s.score2 !== null) {
        const r = computeMatchResult(s.score1, s.score2)
        thirdPlace.push(r.resultA === 'L' ? s.player1 : (s.player2 || s.player1))
      }
    })
    return { champion, runnerUp, thirdPlace }
  }

  const tablesByNum: Record<number, TARow[]> = {}
  tables.forEach(r => {
    if (!tablesByNum[r.table_num]) tablesByNum[r.table_num] = []
    tablesByNum[r.table_num].push(r)
  })

  const awards = getAwards()

  // ข้อ 5: font sizes ตาม projector mode
  const fs = projector
    ? { name: 'text-xl', stat: 'text-lg', pts: 'text-2xl', cell: 'p-4', header: 'text-lg' }
    : { name: 'text-sm', stat: 'text-sm', pts: 'text-base', cell: 'p-3', header: 'text-sm' }

  return (
    <div className="min-h-screen p-4 pb-16">
      {/* Header */}
      <div className="max-w-4xl mx-auto rounded-3xl p-5 text-center text-white mb-4 shadow-xl"
        style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
        <div className="flex items-center justify-between mb-1">
          {/* ข้อ 7: นาฬิกา */}
          <span className="font-black text-yellow-200 text-lg tabular-nums w-32 text-left">{clock}</span>
          <h1 style={{ fontFamily: "'Nunito',sans-serif" }} className="text-2xl font-black flex-1">🥇 กระดานคะแนน Goldfinger</h1>
          {/* ข้อ 5: ปุ่มโหมดจอฉาย */}
          <button onClick={() => setProjector(v => !v)}
            className={`w-32 text-right text-xs font-bold px-3 py-1.5 rounded-lg transition ${projector ? 'bg-white text-amber-800' : 'bg-white/20 text-yellow-100 hover:bg-white/30'}`}>
            {projector ? '🔍 ปกติ' : '📽️ จอฉาย'}
          </button>
        </div>
        <span className="inline-block px-4 py-1 bg-green-700 rounded-full text-sm font-bold">Math Week 2026 • โรงเรียนพูลเจริญวิทยาคม</span>
      </div>

      {/* ข้อ 3: แจ้งเตือน realtime หลุด */}
      {!realtimeOk && (
        <div className="max-w-4xl mx-auto mb-3 rounded-xl p-3 bg-red-100 border-2 border-red-400 text-red-700 font-bold text-sm text-center flex items-center justify-center gap-2">
          ⚠️ การเชื่อมต่อ Realtime หลุด — ข้อมูลอาจไม่อัปเดต
          <button onClick={loadAll} className="ml-2 px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700">โหลดใหม่</button>
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        {/* Controls */}
        <div className="bg-white rounded-2xl p-3 border-2 border-yellow-200 shadow mb-4 flex flex-wrap gap-3 items-center justify-center">
          <select value={level} onChange={e => setLevel(e.target.value as Level)}
            className="px-4 py-2 border-2 border-amber-400 rounded-xl text-amber-800 font-bold text-sm bg-white">
            <option value="มต้น">มัธยมศึกษาตอนต้น</option>
            <option value="มปลาย">มัธยมศึกษาตอนปลาย</option>
          </select>
          <div className="flex bg-amber-50 rounded-xl p-1">
            {[['standings', 'ตารางอันดับ'], ['tables', 'การจับคู่'], ['playoff', 'เพลย์ออฟ'], ['awards', '🏆 รางวัล']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v as View)}
                className={`px-3 py-2 rounded-lg font-bold text-xs transition ${view === v ? 'bg-amber-500 text-white shadow' : 'text-amber-700 hover:bg-amber-100'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Current game banner */}
        {latestGame > 0 && (
          <div className="rounded-2xl p-3 mb-4 text-center text-white font-black text-base shadow"
            style={{ background: '#dc2626' }}>
            ⚠️ ขณะนี้อยู่ในเกมที่ {latestGame} ({level})
          </div>
        )}

        {/* Standings */}
        {view === 'standings' && (
          <div className="bg-white rounded-2xl shadow overflow-hidden border border-yellow-200">
            <table className="w-full">
              <thead><tr style={{ background: '#92400e' }} className="text-white">
                <th className={`${fs.cell} ${fs.header}`}>อันดับ</th>
                <th className={`${fs.cell} ${fs.header} text-left`}>ชื่อ-สกุล</th>
                <th className={`${fs.cell} ${fs.header}`}>ห้อง</th>
                <th className={`${fs.cell} ${fs.header}`}>W-T-L</th>
                <th className={`${fs.cell} ${fs.header}`}>แต้ม</th>
                <th className={`${fs.cell} ${fs.header}`}>ผลต่าง</th>
              </tr></thead>
              <tbody>
                {standings.length === 0 && <tr><td colSpan={6} className="text-center p-8 text-amber-300">ยังไม่มีข้อมูล</td></tr>}
                {standings.map((s, i) => (
                  <tr key={s.player.id} className={`border-b border-yellow-100 ${i === 0 ? 'bg-yellow-100' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'}`}>
                    <td className={`${fs.cell} text-center`}>
                      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-black ${i === 0 ? 'bg-amber-400 text-white text-lg' : i === 1 ? 'bg-slate-300 text-white text-lg' : i === 2 ? 'bg-orange-400 text-white text-lg' : 'bg-gray-200 text-gray-600 text-sm'}`}>
                        {i < 3 ? ['🥇', '🥈', '🥉'][i] : s.rank}
                      </span>
                    </td>
                    <td className={`${fs.cell} font-semibold ${fs.name}`}>
                      {s.player.name} <span className="text-amber-500 font-normal text-xs">({s.player.number})</span>
                    </td>
                    <td className={`${fs.cell} text-center text-gray-500 ${fs.stat}`}>{s.player.room}</td>
                    <td className={`${fs.cell} text-center ${fs.stat}`}>{s.w}-{s.t}-{s.l}</td>
                    <td className={`${fs.cell} text-center font-black ${fs.pts}`}>{s.points}</td>
                    <td className={`${fs.cell} text-center font-bold ${fs.stat} ${s.diffSum > 0 ? 'text-green-700' : s.diffSum < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {s.diffSum > 0 ? '+' : ''}{s.diffSum}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tables */}
        {view === 'tables' && (
          <div>
            {tables.length === 0 ? <p className="text-center text-amber-300 py-12">ยังไม่มีการจัดโต๊ะ</p> : (
              <>
                <p className={`font-bold text-amber-800 mb-3 ${projector ? 'text-xl' : ''}`}>เกมที่ {latestGame}</p>
                <div className="space-y-3">
                  {Object.entries(tablesByNum).sort(([a], [b]) => Number(a) - Number(b)).map(([tn, rows]) => (
                    <div key={tn} className="bg-white rounded-2xl p-4 border border-yellow-200 shadow flex items-start gap-4">
                      <div className={`rounded-xl px-4 py-2 text-white font-black min-w-[72px] text-center ${projector ? 'text-lg' : 'text-sm'}`}
                        style={{ background: '#d97706' }}>โต๊ะ {tn}</div>
                      <div className="flex-1 space-y-1.5">
                        {rows.map(r => (
                          <p key={r.sub_table} className={projector ? 'text-base' : 'text-sm'}>
                            <strong className="text-amber-700">{r.sub_table.slice(-1)}:</strong>{' '}
                            {r.is_bye
                              ? <span className="text-blue-600">🎁 {r.player1?.name} ({r.player1?.number}) ได้ bye</span>
                              : <span>{r.player1?.name} <span className="text-amber-500 font-black">({r.player1?.number})</span> <strong className="text-amber-600 mx-1">VS</strong> {r.player2?.name} <span className="text-amber-500 font-black">({r.player2?.number})</span></span>
                            }
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Playoff */}
        {view === 'playoff' && (
          <div className="space-y-3">
            {playoffs.length === 0 ? <p className="text-center text-amber-300 py-12">ยังไม่มีข้อมูลเพลย์ออฟ</p> : playoffs.map((p, i) => {
              const hasTie = p.score1 !== null && p.score2 !== null && p.score1 === p.score2
              const r = (p.score1 !== null && p.score2 !== null) ? computeMatchResult(p.score1, p.score2) : null
              return (
                <div key={i} className="bg-white rounded-2xl p-4 border border-yellow-200 shadow flex items-center gap-4">
                  <div className={`rounded-xl px-3 py-2 text-white font-black min-w-[90px] text-center ${projector ? 'text-base' : 'text-xs'}`} style={{ background: '#92400e' }}>
                    {p.round}<br />คู่ {p.pair_no}
                  </div>
                  <div className="flex-1">
                    <div className={`flex items-center gap-3 ${projector ? 'text-lg' : 'text-sm'}`}>
                      <span className={`font-bold ${r?.resultA === 'W' ? 'text-green-700' : r?.resultA === 'L' ? 'text-red-500' : ''}`}>{p.player1?.name} ({p.player1?.number})</span>
                      <span className="font-black text-amber-600">{p.score1 ?? '-'}</span>
                      <span className="font-black text-gray-400">vs</span>
                      <span className="font-black text-amber-600">{p.score2 ?? '-'}</span>
                      <span className={`font-bold ${r?.resultB === 'W' ? 'text-green-700' : r?.resultB === 'L' ? 'text-red-500' : ''}`}>{p.player2?.name} ({p.player2?.number})</span>
                    </div>
                    {hasTie && <p className="text-xs text-orange-600 font-bold mt-1">⚠️ เสมอกัน — กรรมการต้องตัดสินเพิ่ม</p>}
                    {r && !hasTie && <p className="text-xs text-green-700 font-bold mt-1">✅ ผู้ชนะ: {r.resultA === 'W' ? p.player1?.name : p.player2?.name}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Awards */}
        {view === 'awards' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => window.print()} className="px-4 py-2 rounded-xl border border-amber-400 text-amber-800 font-bold text-sm hover:bg-amber-50">🖨️ พิมพ์ใบรางวัล</button>
            </div>
            {awards.champion && (
              <div className="rounded-2xl p-6 mb-3 flex gap-4 items-center border-2 border-yellow-400 bg-yellow-50 shadow">
                <span className={projector ? 'text-7xl' : 'text-5xl'}>🥇</span>
                <div>
                  <p className="text-xs font-bold text-amber-700">ชนะเลิศ</p>
                  <p className={`font-black ${projector ? 'text-3xl' : 'text-xl'}`}>{awards.champion.name}</p>
                  <p className={`text-amber-600 ${projector ? 'text-base' : 'text-sm'}`}>หมายเลข {awards.champion.number} • {awards.champion.room}</p>
                </div>
              </div>
            )}
            {awards.runnerUp && (
              <div className="rounded-2xl p-6 mb-3 flex gap-4 items-center border-2 border-slate-300 bg-slate-50 shadow">
                <span className={projector ? 'text-7xl' : 'text-5xl'}>🥈</span>
                <div>
                  <p className="text-xs font-bold text-slate-600">รองชนะเลิศ</p>
                  <p className={`font-black ${projector ? 'text-3xl' : 'text-xl'}`}>{awards.runnerUp.name}</p>
                  <p className={`text-slate-500 ${projector ? 'text-base' : 'text-sm'}`}>หมายเลข {awards.runnerUp.number} • {awards.runnerUp.room}</p>
                </div>
              </div>
            )}
            {awards.thirdPlace.map((p, i) => (
              <div key={i} className="rounded-2xl p-6 mb-3 flex gap-4 items-center border-2 border-orange-300 bg-orange-50 shadow">
                <span className={projector ? 'text-7xl' : 'text-5xl'}>🥉</span>
                <div>
                  <p className="text-xs font-bold text-orange-700">อันดับ 3 ร่วม</p>
                  <p className={`font-black ${projector ? 'text-3xl' : 'text-xl'}`}>{p.name}</p>
                  <p className={`text-orange-600 ${projector ? 'text-base' : 'text-sm'}`}>หมายเลข {p.number} • {p.room}</p>
                </div>
              </div>
            ))}
            {!awards.champion && !awards.runnerUp && awards.thirdPlace.length === 0 && (
              <p className="text-center text-amber-300 py-8">⏳ ยังไม่มีผลชิงชนะเลิศ</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-6 text-xs font-semibold">
          {realtimeOk
            ? <span className="text-amber-500"><span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1 animate-pulse"></span>Live • อัปเดตล่าสุด: {lastUpdate || '...'}</span>
            : <span className="text-red-500"><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1"></span>ออฟไลน์ • อัปเดตล่าสุด: {lastUpdate || '...'}</span>
          }
        </div>
      </div>

      <style>{`
        @media print { .no-print { display: none !important; } }
      `}</style>
    </div>
  )
}
