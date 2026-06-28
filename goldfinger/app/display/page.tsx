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
  const [lastUpdate, setLastUpdate] = useState('')
  const [realtimeOk, setRealtimeOk] = useState(true)
  const [projector, setProjector] = useState(false)
  const [dark, setDark] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [clock, setClock] = useState('')
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [scoredSet, setScoredSet] = useState<Set<string>>(new Set())
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const views: View[] = ['standings', 'tables', 'playoff', 'awards']

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!autoRotate) return
    const id = setInterval(() => setView(v => views[(views.indexOf(v) + 1) % views.length]), 15000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate])

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
    setLatestGame(maxGame)
    setTables(taRows.filter(r => r.game === maxGame))
    setPlayoffs((pf || []) as PFRow[])

    // scored set สำหรับ dot indicator
    const scored = (gs).filter(r => (r as unknown as { game: number }).game === maxGame && r.score1 !== null)
    setScoredSet(new Set(scored.map(r => r.sub_table)))

    setLastUpdate(new Date().toLocaleTimeString('th-TH'))
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
        const { type, level: bLevel, payload: bp } = payload.new as { type: string; level: string; payload: { game?: number; message?: string } }
        if (type === 'reset') loadAll()
        if (type === 'current_game' && bLevel === level) loadAll()
        if (type === 'announcement' && bp?.message) {
          setAnnouncement(bp.message)
          setTimeout(() => setAnnouncement(null), 30000)
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setRealtimeOk(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeOk(false)
      })
    return () => { supabase.removeChannel(ch); if (realtimeTimer.current) clearTimeout(realtimeTimer.current) }
  }, [level, loadAll])

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
  tables.forEach(r => { if (!tablesByNum[r.table_num]) tablesByNum[r.table_num] = []; tablesByNum[r.table_num].push(r) })

  const awards = getAwards()

  const sz = projector
    ? { name: 'text-xl', stat: 'text-lg', pts: 'text-2xl', cell: 'p-4', header: 'text-lg', tableText: 'text-lg', award: 'text-7xl', awardName: 'text-3xl', awardSub: 'text-base' }
    : { name: 'text-sm', stat: 'text-sm', pts: 'text-base', cell: 'p-3', header: 'text-sm', tableText: 'text-sm', award: 'text-5xl', awardName: 'text-xl', awardSub: 'text-sm' }

  const dk = dark
    ? { bg: '#1c1410', card: '#292015', border: '#4a3820', text: 'text-amber-100', subtext: 'text-amber-400', thead: '#92400e', rowEven: 'bg-amber-950/20', tableBg: 'bg-amber-950/30' }
    : { bg: '#fffbeb', card: 'white', border: '#fde68a', text: 'text-gray-900', subtext: 'text-amber-500', thead: '#92400e', rowEven: 'bg-amber-50/30', tableBg: 'bg-amber-50' }

  return (
    <div className="min-h-screen pb-16 transition-colors duration-300" style={{ background: dk.bg }}>
      {/* Header */}
      <div className="rounded-b-3xl p-5 text-center text-white shadow-xl mb-4"
        style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-black text-yellow-200 tabular-nums text-sm w-24 text-left">{clock}</span>
          <h1 className="font-black text-xl flex-1" style={{ fontFamily: "'Nunito',sans-serif" }}>🥇 Goldfinger</h1>
          <div className="flex gap-1.5 w-24 justify-end">
            <button onClick={() => setDark(v => !v)}
              className={`text-xs font-bold px-2 py-1.5 rounded-lg transition ${dark ? 'bg-white text-amber-800' : 'bg-white/20 text-yellow-100 hover:bg-white/30'}`}>
              {dark ? '☀️' : '🌙'}
            </button>
            <button onClick={() => setProjector(v => !v)}
              className={`text-xs font-bold px-2 py-1.5 rounded-lg transition ${projector ? 'bg-white text-amber-800' : 'bg-white/20 text-yellow-100 hover:bg-white/30'}`}>
              {projector ? '🔍' : '📽️'}
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
        <p className="text-yellow-200 text-xs font-semibold">{process.env.NEXT_PUBLIC_EVENT_NAME} • {process.env.NEXT_PUBLIC_SCHOOL_NAME}</p>
      </div>

      {!realtimeOk && (
        <div className="mx-4 mb-3 rounded-2xl p-3 bg-red-100 border-2 border-red-300 text-red-700 font-bold text-sm text-center flex items-center justify-center gap-2">
          ⚠️ การเชื่อมต่อ Realtime หลุด
          <button onClick={loadAll} className="ml-2 px-3 py-1 bg-red-600 text-white rounded-xl text-xs font-bold">โหลดใหม่</button>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4">
        {/* Level + View controls */}
        <div className="mb-4 space-y-2">
          <div className="flex rounded-2xl p-1 border-2 gap-1" style={{ background: dk.card, borderColor: dk.border }}>
            {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
              <button key={lv} onClick={() => setLevel(lv)}
                className={`flex-1 py-2 rounded-xl font-bold text-sm transition-all ${level === lv ? 'text-white shadow' : `${dk.subtext} hover:opacity-80`}`}
                style={level === lv ? { background: 'linear-gradient(135deg,#92400e,#d97706)' } : {}}>
                {lv === 'มต้น' ? '🌱 ม.ต้น' : '🌸 ม.ปลาย'}
              </button>
            ))}
          </div>

          <div className="flex rounded-2xl p-1 border-2 gap-0.5" style={{ background: dk.card, borderColor: dk.border }}>
            {([['standings', '📊 อันดับ'], ['tables', '🪑 โต๊ะ'], ['playoff', '🏆 เพลย์ออฟ'], ['awards', '🎖️ รางวัล']] as [View, string][]).map(([v, label]) => (
              <button key={v} onClick={() => { setView(v); setAutoRotate(false) }}
                className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${view === v ? 'text-white shadow' : `${dk.subtext} hover:opacity-80`}`}
                style={view === v ? { background: 'linear-gradient(135deg,#b45309,#f59e0b)' } : {}}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Announcement banner */}
        {announcement && (
          <div className="mb-4 rounded-2xl p-4 text-center font-black text-white text-lg shadow-xl animate-pulse"
            style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
            📢 {announcement}
            <button onClick={() => setAnnouncement(null)} className="ml-3 text-sm opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Current game badge */}
        {latestGame > 0 && (
          <div className="rounded-2xl p-3 mb-4 text-center text-white font-black text-sm shadow"
            style={{ background: 'linear-gradient(90deg,#92400e,#d97706)' }}>
            ⚡ ขณะนี้อยู่ในเกมที่ {latestGame}
          </div>
        )}

        {/* ── STANDINGS ── */}
        {view === 'standings' && (
          <div className="rounded-3xl overflow-hidden shadow border" style={{ background: dk.card, borderColor: dk.border }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: dk.thead }} className="text-white">
                  <th className={`${sz.cell} text-center`}>อันดับ</th>
                  <th className={`${sz.cell} text-left`}>ชื่อ-สกุล</th>
                  <th className={`${sz.cell} text-center hidden sm:table-cell`}>ห้อง</th>
                  <th className={`${sz.cell} text-center`}>W-T-L</th>
                  <th className={`${sz.cell} text-center`}>แต้ม</th>
                  <th className={`${sz.cell} text-center`}>ผลต่าง</th>
                </tr>
              </thead>
              <tbody>
                {standings.length === 0 && (
                  <tr><td colSpan={6} className={`text-center py-12 ${dk.subtext}`}>ยังไม่มีข้อมูล</td></tr>
                )}
                {standings.map((s, i) => (
                  <tr key={s.player.id} className={`border-b ${i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : i % 2 === 0 ? '' : dk.rowEven}`}
                    style={{ borderColor: dk.border }}>
                    <td className={`${sz.cell} text-center`}>
                      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-black text-sm ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-amber-100 text-amber-700'}`}>
                        {i < 3 ? ['🥇', '🥈', '🥉'][i] : s.rank}
                      </span>
                    </td>
                    <td className={`${sz.cell} font-semibold ${sz.name} ${dk.text}`}>
                      {s.player.name}
                      <span className={`font-normal text-xs ml-1 ${dk.subtext}`}>(#{s.player.number})</span>
                    </td>
                    <td className={`${sz.cell} text-center ${sz.stat} ${dk.subtext} hidden sm:table-cell`}>{s.player.room}</td>
                    <td className={`${sz.cell} text-center ${sz.stat} text-amber-600`}>{s.w}-{s.t}-{s.l}</td>
                    <td className={`${sz.cell} text-center font-black ${sz.pts} ${dk.text}`}>{s.points}</td>
                    <td className={`${sz.cell} text-center font-bold ${sz.stat} ${s.diffSum > 0 ? 'text-emerald-600' : s.diffSum < 0 ? 'text-red-500' : dk.subtext}`}>
                      {s.diffSum > 0 ? '+' : ''}{s.diffSum}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── TABLES ── */}
        {view === 'tables' && (
          <div>
            {tables.length === 0
              ? <p className={`text-center py-12 ${dk.subtext}`}>ยังไม่มีการจัดโต๊ะ</p>
              : (
                <>
                  <p className={`font-black text-amber-700 mb-3 ${projector ? 'text-2xl' : 'text-sm'}`}>เกมที่ {latestGame}</p>
                  <div className="space-y-3">
                    {Object.entries(tablesByNum).sort(([a], [b]) => Number(a) - Number(b)).map(([tn, rows]) => (
                      <div key={tn} className="rounded-2xl overflow-hidden shadow-sm border" style={{ background: dk.card, borderColor: dk.border }}>
                        <div className="px-4 py-2.5 text-white font-black text-sm"
                          style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
                          โต๊ะ {tn}
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          {rows.map(r => (
                            <p key={r.sub_table} className={`${sz.tableText} flex items-center gap-2`}>
                              <strong className="text-amber-600">{r.sub_table.slice(-1)}:</strong>
                              {!r.is_bye && (
                                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${scoredSet.has(r.sub_table) ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                              )}
                              {r.is_bye
                                ? <span className="text-blue-500">🎁 {r.player1?.name} <span className="text-xs">(#{r.player1?.number})</span> ได้ bye</span>
                                : <span className={dk.text}>
                                  {r.player1?.name} <span className={`font-black ${dk.subtext}`}>(#{r.player1?.number})</span>
                                  <strong className="text-amber-500 mx-2">VS</strong>
                                  {r.player2?.name} <span className={`font-black ${dk.subtext}`}>(#{r.player2?.number})</span>
                                </span>
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

        {/* ── PLAYOFF ── */}
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
                      style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
                      {p.round} · คู่ {p.pair_no}
                    </div>
                    <div className={`px-4 py-4 flex items-center gap-3 ${sz.tableText}`}>
                      <div className={`flex-1 text-center p-3 rounded-xl ${p1win ? 'bg-emerald-100' : p2win ? 'bg-red-50' : ''}`}>
                        <p className={`font-black ${p1win ? 'text-emerald-700' : p2win ? 'text-red-400' : dk.text}`}>{p.player1?.name}</p>
                        <p className={`text-xs ${dk.subtext}`}>(#{p.player1?.number})</p>
                        {p.score1 !== null && <p className="font-black text-2xl text-amber-700">{p.score1}</p>}
                      </div>
                      <div className={`font-black text-amber-400 text-xl`}>VS</div>
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

        {/* ── AWARDS ── */}
        {view === 'awards' && (
          <div>
            {awards.champion && (
              <div className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-yellow-300 bg-yellow-50 shadow-lg">
                <span className={sz.award}>🥇</span>
                <div>
                  <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-1">ชนะเลิศ อันดับ 1</p>
                  <p className={`font-black ${sz.awardName} text-gray-900`}>{awards.champion.name}</p>
                  <p className={`text-amber-600 ${sz.awardSub} font-semibold`}>หมายเลข {awards.champion.number} · {awards.champion.room}</p>
                </div>
              </div>
            )}
            {awards.runnerUp && (
              <div className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-slate-300 bg-slate-50 shadow-lg">
                <span className={sz.award}>🥈</span>
                <div>
                  <p className="text-xs font-black text-slate-600 uppercase tracking-widest mb-1">รองชนะเลิศ อันดับ 2</p>
                  <p className={`font-black ${sz.awardName} text-gray-900`}>{awards.runnerUp.name}</p>
                  <p className={`text-slate-500 ${sz.awardSub} font-semibold`}>หมายเลข {awards.runnerUp.number} · {awards.runnerUp.room}</p>
                </div>
              </div>
            )}
            {awards.thirdPlace.map((p, i) => (
              <div key={i} className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-orange-300 bg-orange-50 shadow-lg">
                <span className={sz.award}>🥉</span>
                <div>
                  <p className="text-xs font-black text-orange-700 uppercase tracking-widest mb-1">อันดับ 3 ร่วม</p>
                  <p className={`font-black ${sz.awardName} text-gray-900`}>{p.name}</p>
                  <p className={`text-orange-600 ${sz.awardSub} font-semibold`}>หมายเลข {p.number} · {p.room}</p>
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

        {/* Footer */}
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
