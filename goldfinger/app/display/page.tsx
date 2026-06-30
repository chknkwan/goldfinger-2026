'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { computeStandings, computeMatchResult, Player, GameRow } from '@/lib/gf-logic'

type Level = 'มต้น' | 'มปลาย'
type View = 'standings' | 'tables' | 'playoff' | 'awards'

interface Standing { rank: number; player: Player; points: number; diffSum: number; w: number; t: number; l: number }
interface TARow { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean; table_num: number; game: number }
interface PFRow { round: string; pair_no: number; player1: Player; player2: Player | null; score1: number | null; score2: number | null }

const VIEW_ICONS: Record<View, string> = { standings: '📊', tables: '🪑', playoff: '🏆', awards: '🎖️' }
const VIEW_LABELS: Record<View, string> = { standings: 'อันดับ', tables: 'โต๊ะ', playoff: 'เพลย์ออฟ', awards: 'รางวัล' }
const VIEWS: View[] = ['standings', 'tables', 'playoff', 'awards']

export default function DisplayPage() {
  const [level, setLevel] = useState<Level>('มต้น')
  const [view, setView] = useState<View>('standings')
  const [standings, setStandings] = useState<Standing[]>([])
  const [tables, setTables] = useState<TARow[]>([])
  const [latestGame, setLatestGame] = useState(0)
  const [totalGames, setTotalGames] = useState(0)
  const [playoffs, setPlayoffs] = useState<PFRow[]>([])
  const [lastUpdate, setLastUpdate] = useState('')
  const [realtimeOk, setRealtimeOk] = useState(true)
  const [projector, setProjector] = useState(false)
  const [dark, setDark] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [clock, setClock] = useState('')
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [scoredSet, setScoredSet] = useState<Set<string>>(new Set())
  const [reconnectKey, setReconnectKey] = useState(0)
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!autoRotate) return
    const interval = projector ? 20000 : 15000
    const id = setInterval(() => setView(v => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]), interval)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate, projector])

  useEffect(() => {
    if (projector) {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {})
    } else {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [projector])

  const loadAll = useCallback(async () => {
    const [{ data: p }, { data: g }, { data: ta }, { data: pf }] = await Promise.all([
      supabase.from('players').select('*').eq('level', level).order('number'),
      supabase.from('games').select('*').eq('level', level),
      supabase.from('table_assignments').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level).order('game', { ascending: false }).order('table_num').order('sub_table'),
      supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level),
    ])
    const ps = (p || []) as Player[]
    const gs = (g || []) as GameRow[]
    setStandings(computeStandings(ps, gs) as Standing[])
    const taRows = (ta || []) as TARow[]
    const maxGame = taRows.reduce((m, r) => Math.max(m, r.game), 0)
    const allGames = [...new Set(taRows.map(r => r.game))]
    setLatestGame(maxGame)
    setTotalGames(allGames.length)
    setTables(taRows.filter(r => r.game === maxGame))
    setPlayoffs((pf || []) as PFRow[])

    const scored = gs.filter(r => (r as unknown as { game: number }).game === maxGame && r.score1 !== null)
    setScoredSet(new Set(scored.map(r => r.sub_table)))

    setLastUpdate(new Date().toLocaleTimeString('th-TH'))
    setRealtimeOk(true)
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    realtimeTimer.current = setTimeout(() => setRealtimeOk(false), 60000)
  }, [level])

  useEffect(() => {
    loadAll()
    const ch = supabase.channel(`display-${level}-${reconnectKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `level=eq.${level}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_assignments', filter: `level=eq.${level}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playoffs', filter: `level=eq.${level}` }, loadAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast' }, payload => {
        const { type, level: bLevel, payload: bp } = payload.new as { type: string; level: string; payload: { game?: number; message?: string } }
        if (type === 'reset') loadAll()
        if (type === 'current_game' && bLevel === level) loadAll()
        if (type === 'announcement' && bp?.message) {
          setAnnouncement(bp.message)
          setTimeout(() => setAnnouncement(null), 30000)
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setRealtimeOk(true)
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeOk(false)
          reconnectTimer.current = setTimeout(() => setReconnectKey(k => k + 1), 10000)
        }
      })
    return () => {
      supabase.removeChannel(ch)
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [level, loadAll, reconnectKey])

  function getAwards() {
    const pfFinal = playoffs.find(p => p.round === 'ชิงชนะเลิศ')
    const pfSemis = playoffs.filter(p => p.round === 'รองชนะเลิศ')
    let champion: Player | null = null, runnerUp: Player | null = null, thirdPlace: Player[] = []
    if (pfFinal && pfFinal.score1 !== null && pfFinal.score2 !== null) {
      const r = computeMatchResult(pfFinal.score1, pfFinal.score2)
      if (r.resultA === 'W') { champion = pfFinal.player1; runnerUp = pfFinal.player2 }
      else if (r.resultB === 'W') { champion = pfFinal.player2; runnerUp = pfFinal.player1 }
    }
    pfSemis.forEach(s => {
      if (s.score1 !== null && s.score2 !== null) {
        const r = computeMatchResult(s.score1, s.score2)
        if (r.resultA === 'L') thirdPlace.push(s.player1)
        else if (r.resultB === 'L') thirdPlace.push(s.player2 || s.player1)
      }
    })
    return { champion, runnerUp, thirdPlace }
  }

  const tablesByNum: Record<number, TARow[]> = {}
  tables.forEach(r => { if (!tablesByNum[r.table_num]) tablesByNum[r.table_num] = []; tablesByNum[r.table_num].push(r) })
  const tableNums = Object.keys(tablesByNum).map(Number).sort((a, b) => a - b)

  const awards = getAwards()

  // non-bye pairs for progress counting
  const nonByeTables = tables.filter(r => !r.is_bye)
  const scoredCount = nonByeTables.filter(r => scoredSet.has(r.sub_table)).length
  // deduplicate by table_num for pair count (each table_num = 1 pair)
  const pairNums = [...new Set(nonByeTables.map(r => r.table_num))]
  const totalPairs = pairNums.length
  const scoredPairs = pairNums.filter(tn => tablesByNum[tn]?.every(r => r.is_bye || scoredSet.has(r.sub_table))).length
  const remainPairs = totalPairs - scoredPairs

  const dk = dark && !projector
    ? { bg: '#1c1410', card: '#292015', border: '#4a3820', text: 'text-amber-100', subtext: 'text-amber-400', thead: '#92400e', rowEven: 'bg-amber-950/20' }
    : { bg: projector ? '#f0f4f8' : '#FEFAF2', card: 'white', border: '#e0e0e0', text: 'text-gray-900', subtext: 'text-teal-600', thead: '#0f766e', rowEven: 'bg-teal-50/40' }

  // ── PROJECTOR MODE ──
  if (projector) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: '#f0f4f8' }}>

        {/* ── Top bar ── */}
        <div className="shrink-0 flex items-center gap-4 px-6 py-3 text-white"
          style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
          {/* Clock */}
          <span className="font-black tabular-nums text-3xl shrink-0">{clock}</span>

          {/* Title + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-black text-2xl leading-tight">🏅 Gold Finger — {level === 'มต้น' ? 'ม.ต้น' : 'ม.ปลาย'}</span>
            </div>
            <div className="text-teal-100 text-base font-semibold mt-0.5">
              {process.env.NEXT_PUBLIC_SCHOOL_NAME}
              {latestGame > 0 && <span className="ml-3">· เกมที่ {latestGame}{totalGames > 0 ? `/${totalGames}` : ''}</span>}
            </div>
          </div>

          {/* Level + View icon buttons + Exit */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Level buttons */}
            {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
              <button key={lv} onClick={() => setLevel(lv)}
                className={`px-4 py-2.5 rounded-2xl font-black text-base transition-all ${level === lv ? 'bg-white text-teal-700 shadow-lg' : 'bg-white/20 text-white hover:bg-white/40'}`}>
                {lv === 'มต้น' ? '🌱 ม.ต้น' : '🌸 ม.ปลาย'}
              </button>
            ))}
            <div className="w-px h-8 bg-white/30 mx-1" />
            {/* View buttons */}
            {VIEWS.map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`w-12 h-12 rounded-2xl text-2xl font-bold flex items-center justify-center transition-all ${view === v ? 'bg-white shadow-lg scale-110' : 'bg-white/20 hover:bg-white/40'}`}>
                {VIEW_ICONS[v]}
              </button>
            ))}
            {/* Exit */}
            <button onClick={() => setProjector(false)}
              className="ml-2 flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-black text-lg transition shadow-lg">
              ✕ ออก
            </button>
          </div>
        </div>

        {/* Announcement */}
        {announcement && (
          <div className="shrink-0 px-6 py-3 text-center font-black text-white text-2xl animate-pulse"
            style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
            📢 {announcement}
          </div>
        )}

        {/* Progress banner — shown only for tables view */}
        {view === 'tables' && latestGame > 0 && (
          <div className="shrink-0 mx-6 mt-4 rounded-2xl px-6 py-3 flex items-center gap-3 text-white font-black text-xl shadow"
            style={{ background: 'linear-gradient(90deg,#0f766e,#2dd4bf)' }}>
            <span>🪑 คู่แข่งเกมที่ {latestGame} — {totalPairs} คู่</span>
            <span className="mx-2 opacity-50">·</span>
            <span className="text-emerald-200">{scoredPairs} กรอกแล้ว</span>
            <span className="mx-2 opacity-50">·</span>
            <span className="text-yellow-200">{remainPairs} คงเหลือ</span>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ── TABLES (2-column grid) ── */}
          {view === 'tables' && (
            tables.length === 0
              ? <p className="text-center py-16 text-teal-600 text-2xl">ยังไม่มีการจัดโต๊ะ</p>
              : (
                <div className="grid grid-cols-2 gap-4">
                  {tableNums.map(tn => {
                    const rows = tablesByNum[tn]
                    const allScored = rows.every(r => r.is_bye || scoredSet.has(r.sub_table))
                    return (
                      <div key={tn} className="rounded-2xl overflow-hidden shadow border-2 bg-white" style={{ borderColor: '#e0e0e0' }}>
                        <div className="px-5 py-3 text-white font-black text-xl flex items-center justify-between"
                          style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
                          <span>โต๊ะ {tn}</span>
                          <span className={`w-4 h-4 rounded-full ${allScored ? 'bg-emerald-300' : 'bg-white/30'}`} />
                        </div>
                        <div className="px-5 py-4 space-y-3">
                          {rows.map(r => (
                            <div key={r.sub_table} className="text-lg leading-snug">
                              {r.is_bye
                                ? <span className="text-blue-500 font-semibold">🎁 {r.player1?.name} <span className="text-teal-500">(#{r.player1?.number})</span> ได้ bye</span>
                                : <span className="text-gray-900">
                                  {r.player1?.name} <span className="font-black text-teal-600">(#{r.player1?.number})</span>
                                  <strong className="text-teal-500 mx-2">VS</strong>
                                  {r.player2?.name} <span className="font-black text-teal-600">(#{r.player2?.number})</span>
                                </span>
                              }
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
          )}

          {/* ── STANDINGS ── */}
          {view === 'standings' && (
            <div className="rounded-3xl overflow-hidden shadow border-2 bg-white" style={{ borderColor: '#e0e0e0' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ background: '#0f766e' }} className="text-white">
                    <th className="p-4 text-center text-xl">อันดับ</th>
                    <th className="p-4 text-left text-xl">ชื่อ-สกุล</th>
                    <th className="p-4 text-center text-xl">ห้อง</th>
                    <th className="p-4 text-center text-xl">W-T-L</th>
                    <th className="p-4 text-center text-xl">แต้ม</th>
                    <th className="p-4 text-center text-xl">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-16 text-teal-600 text-xl">ยังไม่มีข้อมูล</td></tr>
                  )}
                  {standings.map((s, i) => (
                    <tr key={s.player.id} className={`border-b ${i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : i % 2 === 0 ? '' : 'bg-teal-50/30'}`}
                      style={{ borderColor: '#e0e0e0' }}>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center justify-center w-12 h-12 rounded-full font-black text-xl ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-amber-100 text-amber-700'}`}>
                          {i < 3 ? ['🥇', '🥈', '🥉'][i] : s.rank}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-2xl text-gray-900">
                        {s.player.name}
                        <span className="font-normal text-base ml-2 text-teal-600">(#{s.player.number})</span>
                      </td>
                      <td className="p-4 text-center text-lg text-teal-600">{s.player.room}</td>
                      <td className="p-4 text-center text-lg text-teal-500">{s.w}-{s.t}-{s.l}</td>
                      <td className="p-4 text-center font-black text-3xl text-gray-900">{s.points}</td>
                      <td className={`p-4 text-center font-bold text-lg ${s.diffSum > 0 ? 'text-emerald-600' : s.diffSum < 0 ? 'text-red-500' : 'text-teal-600'}`}>
                        {s.diffSum > 0 ? '+' : ''}{s.diffSum}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── PLAYOFF ── */}
          {view === 'playoff' && (
            <div className="grid grid-cols-2 gap-4">
              {playoffs.length === 0
                ? <p className="col-span-2 text-center py-16 text-teal-600 text-2xl">ยังไม่มีข้อมูลเพลย์ออฟ</p>
                : playoffs.map((p, i) => {
                  const r = (p.score1 !== null && p.score2 !== null) ? computeMatchResult(p.score1, p.score2) : null
                  const p1win = r?.resultA === 'W'; const p2win = r?.resultB === 'W'
                  const hasTie = p.score1 !== null && p.score2 !== null && p.score1 === p.score2
                  return (
                    <div key={i} className="rounded-2xl overflow-hidden shadow border-2 bg-white" style={{ borderColor: '#e0e0e0' }}>
                      <div className="px-5 py-3 text-white font-black text-xl"
                        style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
                        {p.round} · คู่ {p.pair_no}
                      </div>
                      <div className="px-5 py-5 flex items-center gap-4">
                        <div className={`flex-1 text-center p-4 rounded-2xl ${p1win ? 'bg-emerald-50' : p2win ? 'bg-red-50' : ''}`}>
                          <p className={`font-black text-2xl ${p1win ? 'text-emerald-700' : p2win ? 'text-red-400' : 'text-gray-900'}`}>{p.player1?.name}</p>
                          <p className="text-lg text-teal-600">(#{p.player1?.number})</p>
                          {p.score1 !== null && <p className="font-black text-5xl text-amber-700 mt-2">{p.score1}</p>}
                        </div>
                        <div className="font-black text-amber-400 text-3xl">VS</div>
                        <div className={`flex-1 text-center p-4 rounded-2xl ${p2win ? 'bg-emerald-50' : p1win ? 'bg-red-50' : ''}`}>
                          <p className={`font-black text-2xl ${p2win ? 'text-emerald-700' : p1win ? 'text-red-400' : 'text-gray-900'}`}>{p.player2?.name}</p>
                          <p className="text-lg text-teal-600">(#{p.player2?.number})</p>
                          {p.score2 !== null && <p className="font-black text-5xl text-amber-700 mt-2">{p.score2}</p>}
                        </div>
                      </div>
                      {r && !hasTie && (
                        <div className="px-5 pb-4 text-center">
                          <span className="text-xl font-black text-emerald-600 bg-emerald-100 px-5 py-1.5 rounded-full">
                            ✅ {p1win ? p.player1?.name : p.player2?.name} ชนะ
                          </span>
                        </div>
                      )}
                      {hasTie && (
                        <div className="px-5 pb-4 text-center">
                          <span className="text-xl font-black text-amber-600 bg-amber-100 px-5 py-1.5 rounded-full">⚠️ เสมอ — กรรมการต้องตัดสิน</span>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}

          {/* ── AWARDS ── */}
          {view === 'awards' && (
            <div className="space-y-4">
              {awards.champion && (
                <div className="rounded-3xl p-8 flex gap-6 items-center border-2 border-yellow-300 bg-yellow-50 shadow-lg">
                  <span className="text-8xl">🥇</span>
                  <div>
                    <p className="font-black text-amber-700 uppercase tracking-widest mb-2 text-xl">ชนะเลิศ อันดับ 1</p>
                    <p className="font-black text-4xl text-gray-900">{awards.champion.name}</p>
                    <p className="text-amber-600 text-2xl font-semibold mt-1">หมายเลข {awards.champion.number} · {awards.champion.room}</p>
                  </div>
                </div>
              )}
              {awards.runnerUp && (
                <div className="rounded-3xl p-8 flex gap-6 items-center border-2 border-slate-300 bg-slate-50 shadow-lg">
                  <span className="text-8xl">🥈</span>
                  <div>
                    <p className="font-black text-slate-600 uppercase tracking-widest mb-2 text-xl">รองชนะเลิศ อันดับ 2</p>
                    <p className="font-black text-4xl text-gray-900">{awards.runnerUp.name}</p>
                    <p className="text-slate-500 text-2xl font-semibold mt-1">หมายเลข {awards.runnerUp.number} · {awards.runnerUp.room}</p>
                  </div>
                </div>
              )}
              {awards.thirdPlace.map((p, i) => (
                <div key={i} className="rounded-3xl p-8 flex gap-6 items-center border-2 border-orange-300 bg-orange-50 shadow-lg">
                  <span className="text-8xl">🥉</span>
                  <div>
                    <p className="font-black text-orange-700 uppercase tracking-widest mb-2 text-xl">อันดับ 3 ร่วม</p>
                    <p className="font-black text-4xl text-gray-900">{p.name}</p>
                    <p className="text-orange-600 text-2xl font-semibold mt-1">หมายเลข {p.number} · {p.room}</p>
                  </div>
                </div>
              ))}
              {!awards.champion && !awards.runnerUp && awards.thirdPlace.length === 0 && (
                <p className="text-center py-16 text-teal-600 text-2xl">⏳ ยังไม่มีผลชิงชนะเลิศ</p>
              )}
            </div>
          )}
        </div>

        {/* Bottom status bar */}
        <div className="shrink-0 flex items-center justify-between px-6 py-2.5 text-white text-base font-semibold"
          style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
          <span>
            {realtimeOk
              ? <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-300 mr-2 animate-pulse"></span>Live · อัปเดต {lastUpdate}</span>
              : <span className="text-red-200"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-300 mr-2"></span>ออฟไลน์</span>
            }
          </span>
          <span className="text-white/60">{lastUpdate && `อัปเดต ${lastUpdate}`}</span>
        </div>
      </div>
    )
  }

  // ── NORMAL MODE ──
  return (
    <div className="min-h-screen pb-16 transition-colors duration-300" style={{ background: dk.bg }}>
      <div className="rounded-b-3xl p-5 text-center shadow-xl mb-4"
        style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)', color: 'white' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-black text-yellow-100 tabular-nums text-sm w-24 text-left">{clock}</span>
          <h1 className="font-black text-xl flex-1" style={{ fontFamily: "'Nunito',sans-serif" }}>🏅 Gold Finger</h1>
          <div className="flex gap-1.5 w-24 justify-end">
            <button onClick={() => setDark(v => !v)}
              className={`text-xs font-bold px-2 py-1.5 rounded-lg transition ${dark ? 'bg-white text-amber-800' : 'bg-white/20 text-yellow-100 hover:bg-white/30'}`}>
              {dark ? '☀️' : '🌙'}
            </button>
            <button onClick={() => setProjector(true)}
              className="text-xs font-bold px-2 py-1.5 rounded-lg bg-white/20 text-yellow-100 hover:bg-white/30 transition">
              📽️
            </button>
            <button onClick={() => setAutoRotate(v => !v)}
              className={`text-xs font-bold px-2 py-1.5 rounded-lg transition ${autoRotate ? 'bg-white text-amber-800' : 'bg-white/20 text-yellow-100 hover:bg-white/30'}`}>
              {autoRotate ? '⏸️' : '▶️'}
            </button>
            <button onClick={() => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen() }}
              className="text-xs font-bold px-2 py-1.5 rounded-lg bg-white/20 text-yellow-100 hover:bg-white/30 transition">
              ⛶
            </button>
          </div>
        </div>
        <p className="text-teal-100 text-xs font-semibold">{process.env.NEXT_PUBLIC_SCHOOL_NAME}</p>
      </div>

      {!realtimeOk && (
        <div className="mx-4 mb-3 rounded-2xl p-3 bg-red-100 border-2 border-red-300 text-red-700 font-bold text-sm text-center flex items-center justify-center gap-2 flex-wrap">
          ⚠️ การเชื่อมต่อหลุด — กำลัง reconnect อัตโนมัติ...
          <button onClick={() => setReconnectKey(k => k + 1)} className="px-3 py-1 bg-red-600 text-white rounded-xl text-xs font-bold">reconnect เดี๋ยวนี้</button>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-4 space-y-2">
          <div className="flex rounded-2xl p-1 border-2 gap-1" style={{ background: dk.card, borderColor: dk.border }}>
            {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
              <button key={lv} onClick={() => setLevel(lv)}
                className={`flex-1 py-2 rounded-xl font-bold text-sm transition-all ${level === lv ? 'text-white shadow' : `${dk.subtext} hover:opacity-80`}`}
                style={level === lv ? { background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' } : {}}>
                {lv === 'มต้น' ? '🌱 ม.ต้น' : '🌸 ม.ปลาย'}
              </button>
            ))}
          </div>
          <div className="flex rounded-2xl p-1 border-2 gap-0.5" style={{ background: dk.card, borderColor: dk.border }}>
            {VIEWS.map(v => (
              <button key={v} onClick={() => { setView(v); setAutoRotate(false) }}
                className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${view === v ? 'text-white shadow' : `${dk.subtext} hover:opacity-80`}`}
                style={view === v ? { background: '#F98B8B' } : {}}>
                {VIEW_ICONS[v]} {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>

        {announcement && (
          <div className="mb-4 rounded-2xl p-4 text-center font-black text-white text-lg shadow-xl animate-pulse"
            style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
            📢 {announcement}
            <button onClick={() => setAnnouncement(null)} className="ml-3 text-sm opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {latestGame > 0 && (
          <div className="rounded-2xl p-3 mb-4 text-center text-white font-black text-sm shadow"
            style={{ background: 'linear-gradient(90deg,#0f766e,#2dd4bf)' }}>
            ⚡ ขณะนี้อยู่ในเกมที่ {latestGame}{totalGames > 0 ? `/${totalGames}` : ''}
          </div>
        )}

        {/* STANDINGS */}
        {view === 'standings' && (
          <div className="rounded-3xl overflow-hidden shadow border" style={{ background: dk.card, borderColor: dk.border }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: dk.thead }} className="text-white">
                  <th className="p-3 text-center text-sm">อันดับ</th>
                  <th className="p-3 text-left text-sm">ชื่อ-สกุล</th>
                  <th className="p-3 text-center text-sm hidden sm:table-cell">ห้อง</th>
                  <th className="p-3 text-center text-sm">W-T-L</th>
                  <th className="p-3 text-center text-sm">แต้ม</th>
                  <th className="p-3 text-center text-sm">ผลต่าง</th>
                </tr>
              </thead>
              <tbody>
                {standings.length === 0 && (
                  <tr><td colSpan={6} className={`text-center py-12 ${dk.subtext}`}>ยังไม่มีข้อมูล</td></tr>
                )}
                {standings.map((s, i) => (
                  <tr key={s.player.id} className={`border-b ${i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : i % 2 === 0 ? '' : dk.rowEven}`}
                    style={{ borderColor: dk.border }}>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-black text-sm ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-amber-100 text-amber-700'}`}>
                        {i < 3 ? ['🥇', '🥈', '🥉'][i] : s.rank}
                      </span>
                    </td>
                    <td className={`p-3 font-semibold text-base ${dk.text}`}>
                      {s.player.name}
                      <span className={`font-normal text-xs ml-1 ${dk.subtext}`}>(#{s.player.number})</span>
                    </td>
                    <td className={`p-3 text-center text-sm ${dk.subtext} hidden sm:table-cell`}>{s.player.room}</td>
                    <td className="p-3 text-center text-sm text-teal-500">{s.w}-{s.t}-{s.l}</td>
                    <td className={`p-3 text-center font-black text-lg ${dk.text}`}>{s.points}</td>
                    <td className={`p-3 text-center font-bold text-sm ${s.diffSum > 0 ? 'text-emerald-600' : s.diffSum < 0 ? 'text-red-500' : dk.subtext}`}>
                      {s.diffSum > 0 ? '+' : ''}{s.diffSum}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TABLES */}
        {view === 'tables' && (
          tables.length === 0
            ? <p className={`text-center py-12 ${dk.subtext}`}>ยังไม่มีการจัดโต๊ะ</p>
            : (
              <>
                <div className="rounded-2xl px-4 py-2.5 mb-3 text-white font-semibold text-sm flex gap-3"
                  style={{ background: 'linear-gradient(90deg,#0f766e,#2dd4bf)' }}>
                  <span>เกมที่ {latestGame}</span>
                  <span className="opacity-50">·</span>
                  <span className="text-emerald-200">{scoredPairs} กรอกแล้ว</span>
                  <span className="opacity-50">·</span>
                  <span className="text-yellow-200">{remainPairs} คงเหลือ</span>
                </div>
                <div className="space-y-3">
                  {tableNums.map(tn => {
                    const rows = tablesByNum[tn]
                    const allScored = rows.every(r => r.is_bye || scoredSet.has(r.sub_table))
                    return (
                      <div key={tn} className="rounded-2xl overflow-hidden shadow-sm border" style={{ background: dk.card, borderColor: dk.border }}>
                        <div className="px-4 py-2.5 text-white font-black text-sm flex items-center justify-between"
                          style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
                          <span>โต๊ะ {tn}</span>
                          <span className={`w-2.5 h-2.5 rounded-full ${allScored ? 'bg-emerald-300' : 'bg-white/30'}`} />
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          {rows.map(r => (
                            <p key={r.sub_table} className="text-base">
                              {r.is_bye
                                ? <span className="text-blue-500">🎁 {r.player1?.name} <span className={`text-xs ${dk.subtext}`}>(#{r.player1?.number})</span> ได้ bye</span>
                                : <span className={dk.text}>
                                  {r.player1?.name} <span className={`font-black ${dk.subtext}`}>(#{r.player1?.number})</span>
                                  <strong className="text-teal-500 mx-2">VS</strong>
                                  {r.player2?.name} <span className={`font-black ${dk.subtext}`}>(#{r.player2?.number})</span>
                                </span>
                              }
                            </p>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )
        )}

        {/* PLAYOFF */}
        {view === 'playoff' && (
          <div className="space-y-3">
            {playoffs.length === 0
              ? <p className={`text-center py-12 ${dk.subtext}`}>ยังไม่มีข้อมูลเพลย์ออฟ</p>
              : playoffs.map((p, i) => {
                const r = (p.score1 !== null && p.score2 !== null) ? computeMatchResult(p.score1, p.score2) : null
                const p1win = r?.resultA === 'W'; const p2win = r?.resultB === 'W'
                const hasTie = p.score1 !== null && p.score2 !== null && p.score1 === p.score2
                return (
                  <div key={i} className="rounded-2xl overflow-hidden shadow-sm border" style={{ background: dk.card, borderColor: dk.border }}>
                    <div className="px-4 py-2.5 text-white font-black text-sm"
                      style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
                      {p.round} · คู่ {p.pair_no}
                    </div>
                    <div className="px-4 py-4 flex items-center gap-3 text-base">
                      <div className={`flex-1 text-center p-3 rounded-xl ${p1win ? 'bg-emerald-100' : p2win ? 'bg-red-50' : ''}`}>
                        <p className={`font-black ${p1win ? 'text-emerald-700' : p2win ? 'text-red-400' : dk.text}`}>{p.player1?.name}</p>
                        <p className={`text-xs ${dk.subtext}`}>(#{p.player1?.number})</p>
                        {p.score1 !== null && <p className="font-black text-2xl text-amber-700">{p.score1}</p>}
                      </div>
                      <div className="font-black text-amber-400 text-xl">VS</div>
                      <div className={`flex-1 text-center p-3 rounded-xl ${p2win ? 'bg-emerald-100' : p1win ? 'bg-red-50' : ''}`}>
                        <p className={`font-black ${p2win ? 'text-emerald-700' : p1win ? 'text-red-400' : dk.text}`}>{p.player2?.name}</p>
                        <p className={`text-xs ${dk.subtext}`}>(#{p.player2?.number})</p>
                        {p.score2 !== null && <p className="font-black text-2xl text-amber-700">{p.score2}</p>}
                      </div>
                    </div>
                    {r && !hasTie && (
                      <div className="px-4 pb-3 text-center">
                        <span className="text-xs font-black text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full">
                          ✅ {p1win ? p.player1?.name : p.player2?.name} ชนะ
                        </span>
                      </div>
                    )}
                    {hasTie && (
                      <div className="px-4 pb-3 text-center">
                        <span className="text-xs font-black text-amber-600 bg-amber-100 px-3 py-1 rounded-full">⚠️ เสมอ — กรรมการต้องตัดสิน</span>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* AWARDS */}
        {view === 'awards' && (
          <div>
            {awards.champion && (
              <div className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-yellow-300 bg-yellow-50 shadow-lg">
                <span className="text-5xl">🥇</span>
                <div>
                  <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-1">ชนะเลิศ อันดับ 1</p>
                  <p className="font-black text-xl text-gray-900">{awards.champion.name}</p>
                  <p className="text-amber-600 text-sm font-semibold">หมายเลข {awards.champion.number} · {awards.champion.room}</p>
                </div>
              </div>
            )}
            {awards.runnerUp && (
              <div className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-slate-300 bg-slate-50 shadow-lg">
                <span className="text-5xl">🥈</span>
                <div>
                  <p className="text-xs font-black text-slate-600 uppercase tracking-widest mb-1">รองชนะเลิศ อันดับ 2</p>
                  <p className="font-black text-xl text-gray-900">{awards.runnerUp.name}</p>
                  <p className="text-slate-500 text-sm font-semibold">หมายเลข {awards.runnerUp.number} · {awards.runnerUp.room}</p>
                </div>
              </div>
            )}
            {awards.thirdPlace.map((p, i) => (
              <div key={i} className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-orange-300 bg-orange-50 shadow-lg">
                <span className="text-5xl">🥉</span>
                <div>
                  <p className="text-xs font-black text-orange-700 uppercase tracking-widest mb-1">อันดับ 3 ร่วม</p>
                  <p className="font-black text-xl text-gray-900">{p.name}</p>
                  <p className="text-orange-600 text-sm font-semibold">หมายเลข {p.number} · {p.room}</p>
                </div>
              </div>
            ))}
            {!awards.champion && !awards.runnerUp && awards.thirdPlace.length === 0 && (
              <p className={`text-center py-12 ${dk.subtext}`}>⏳ ยังไม่มีผลชิงชนะเลิศ</p>
            )}
            <button onClick={() => window.print()}
              className="mt-2 w-full py-3 rounded-2xl font-bold text-sm border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition active:scale-95">
              🖨️ พิมพ์รายชื่อผู้ได้รับรางวัล
            </button>
          </div>
        )}

        <div className="text-center mt-6 text-xs font-semibold">
          {realtimeOk
            ? <span className={dk.subtext}><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1 animate-pulse"></span>Live · อัปเดตล่าสุด: {lastUpdate || '...'}</span>
            : <span className="text-red-400"><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1"></span>ออฟไลน์ · {lastUpdate}</span>
          }
        </div>
      </div>
    </div>
  )
}
