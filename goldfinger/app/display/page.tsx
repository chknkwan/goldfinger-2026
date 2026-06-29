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
  const [reconnectKey, setReconnectKey] = useState(0)
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const views: View[] = ['standings', 'tables', 'playoff', 'awards']
  const viewLabels: Record<View, string> = { standings: '📊 อันดับ', tables: '🪑 โต๊ะ', playoff: '🏆 เพลย์ออฟ', awards: '🎖️ รางวัล' }

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  // auto-rotate — 20s in projector, 15s normal
  useEffect(() => {
    if (!autoRotate) return
    const interval = projector ? 20000 : 15000
    const id = setInterval(() => setView(v => views[(views.indexOf(v) + 1) % views.length]), interval)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRotate, projector])

  // enter fullscreen + auto-rotate when projector mode toggled
  useEffect(() => {
    if (projector) {
      setAutoRotate(true)
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {})
    } else {
      setAutoRotate(false)
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
    setLatestGame(maxGame)
    setTables(taRows.filter(r => r.game === maxGame))
    setPlayoffs((pf || []) as PFRow[])

    const scored = (gs).filter(r => (r as unknown as { game: number }).game === maxGame && r.score1 !== null)
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

  const awards = getAwards()

  // projector size tokens — much larger for projection screen
  const sz = projector
    ? { name: 'text-3xl', stat: 'text-xl', pts: 'text-4xl', cell: 'p-5', header: 'text-2xl', tableText: 'text-3xl', scoreText: 'text-6xl', award: 'text-9xl', awardName: 'text-5xl', awardSub: 'text-2xl', rankBadge: 'w-14 h-14 text-2xl' }
    : { name: 'text-base', stat: 'text-sm', pts: 'text-lg', cell: 'p-3', header: 'text-sm', tableText: 'text-base', scoreText: 'text-2xl', award: 'text-5xl', awardName: 'text-xl', awardSub: 'text-sm', rankBadge: 'w-9 h-9 text-sm' }

  const dk = dark && !projector
    ? { bg: '#1c1410', card: '#292015', border: '#4a3820', text: 'text-amber-100', subtext: 'text-amber-400', thead: '#92400e', rowEven: 'bg-amber-950/20', tableBg: 'bg-amber-950/30' }
    : { bg: projector ? '#ffffff' : '#FEFAF2', card: 'white', border: '#e0e0e0', text: 'text-gray-900', subtext: 'text-teal-600', thead: '#0f766e', rowEven: 'bg-teal-50/40', tableBg: 'bg-teal-50' }

  // shared content for both modes
  const ContentStandings = () => (
    <div className="rounded-3xl overflow-hidden shadow border" style={{ background: dk.card, borderColor: dk.border }}>
      <table className="w-full">
        <thead>
          <tr style={{ background: dk.thead }} className="text-white">
            <th className={`${sz.cell} text-center ${sz.header}`}>อันดับ</th>
            <th className={`${sz.cell} text-left ${sz.header}`}>ชื่อ-สกุล</th>
            <th className={`${sz.cell} text-center ${sz.header} ${projector ? '' : 'hidden sm:table-cell'}`}>ห้อง</th>
            <th className={`${sz.cell} text-center ${sz.header}`}>W-T-L</th>
            <th className={`${sz.cell} text-center ${sz.header}`}>แต้ม</th>
            <th className={`${sz.cell} text-center ${sz.header}`}>ผลต่าง</th>
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 && (
            <tr><td colSpan={6} className={`text-center py-12 ${dk.subtext} ${sz.stat}`}>ยังไม่มีข้อมูล</td></tr>
          )}
          {standings.map((s, i) => (
            <tr key={s.player.id} className={`border-b ${i === 0 ? 'bg-yellow-50' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : i % 2 === 0 ? '' : dk.rowEven}`}
              style={{ borderColor: dk.border }}>
              <td className={`${sz.cell} text-center`}>
                <span className={`inline-flex items-center justify-center ${sz.rankBadge} rounded-full font-black ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-orange-400 text-white' : 'bg-amber-100 text-amber-700'}`}>
                  {i < 3 ? ['🥇', '🥈', '🥉'][i] : s.rank}
                </span>
              </td>
              <td className={`${sz.cell} font-semibold ${sz.name} ${dk.text}`}>
                {s.player.name}
                <span className={`font-normal ml-2 ${projector ? 'text-lg' : 'text-xs'} ${dk.subtext}`}>(#{s.player.number})</span>
              </td>
              <td className={`${sz.cell} text-center ${sz.stat} ${dk.subtext} ${projector ? '' : 'hidden sm:table-cell'}`}>{s.player.room}</td>
              <td className={`${sz.cell} text-center ${sz.stat} text-teal-500`}>{s.w}-{s.t}-{s.l}</td>
              <td className={`${sz.cell} text-center font-black ${sz.pts} ${dk.text}`}>{s.points}</td>
              <td className={`${sz.cell} text-center font-bold ${sz.stat} ${s.diffSum > 0 ? 'text-emerald-600' : s.diffSum < 0 ? 'text-red-500' : dk.subtext}`}>
                {s.diffSum > 0 ? '+' : ''}{s.diffSum}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const ContentTables = () => (
    <div>
      {tables.length === 0
        ? <p className={`text-center py-12 ${dk.subtext} ${sz.stat}`}>ยังไม่มีการจัดโต๊ะ</p>
        : (
          <>
            <p className={`font-black text-amber-700 mb-3 ${projector ? 'text-3xl' : 'text-sm'}`}>เกมที่ {latestGame}</p>
            <div className="space-y-3">
              {Object.entries(tablesByNum).sort(([a], [b]) => Number(a) - Number(b)).map(([tn, rows]) => (
                <div key={tn} className="rounded-2xl overflow-hidden shadow-sm border" style={{ background: dk.card, borderColor: dk.border }}>
                  <div className={`px-4 py-2.5 text-white font-black ${projector ? 'text-2xl' : 'text-sm'}`}
                    style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
                    โต๊ะ {tn}
                  </div>
                  <div className={`px-4 py-3 space-y-${projector ? '4' : '2'}`}>
                    {rows.map(r => (
                      <p key={r.sub_table} className={`${sz.tableText} flex items-center gap-2`}>
                        <strong className="text-teal-600">{r.sub_table.slice(-1)}:</strong>
                        {!r.is_bye && (
                          <span className={`inline-block ${projector ? 'w-3 h-3' : 'w-2 h-2'} rounded-full shrink-0 ${scoredSet.has(r.sub_table) ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                        )}
                        {r.is_bye
                          ? <span className="text-blue-500">🎁 {r.player1?.name} <span className={projector ? 'text-xl' : 'text-xs'}>(#{r.player1?.number})</span> ได้ bye</span>
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
              ))}
            </div>
          </>
        )}
    </div>
  )

  const ContentPlayoff = () => (
    <div className="space-y-3">
      {playoffs.length === 0
        ? <p className={`text-center py-12 ${dk.subtext} ${sz.stat}`}>ยังไม่มีข้อมูลเพลย์ออฟ</p>
        : playoffs.map((p, i) => {
          const r = (p.score1 !== null && p.score2 !== null) ? computeMatchResult(p.score1, p.score2) : null
          const p1win = r?.resultA === 'W'; const p2win = r?.resultB === 'W'
          const hasTie = p.score1 !== null && p.score2 !== null && p.score1 === p.score2
          return (
            <div key={i} className="rounded-2xl overflow-hidden shadow-sm border" style={{ background: dk.card, borderColor: dk.border }}>
              <div className={`px-4 py-2.5 text-white font-black ${projector ? 'text-2xl' : 'text-sm'}`}
                style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
                {p.round} · คู่ {p.pair_no}
              </div>
              <div className={`px-4 py-4 flex items-center gap-3 ${sz.tableText}`}>
                <div className={`flex-1 text-center p-3 rounded-xl ${p1win ? 'bg-emerald-100' : p2win ? 'bg-red-50' : ''}`}>
                  <p className={`font-black ${sz.name} ${p1win ? 'text-emerald-700' : p2win ? 'text-red-400' : dk.text}`}>{p.player1?.name}</p>
                  <p className={`${projector ? 'text-xl' : 'text-xs'} ${dk.subtext}`}>(#{p.player1?.number})</p>
                  {p.score1 !== null && <p className={`font-black ${sz.scoreText} text-amber-700`}>{p.score1}</p>}
                </div>
                <div className={`font-black text-amber-400 ${projector ? 'text-4xl' : 'text-xl'}`}>VS</div>
                <div className={`flex-1 text-center p-3 rounded-xl ${p2win ? 'bg-emerald-100' : p1win ? 'bg-red-50' : ''}`}>
                  <p className={`font-black ${sz.name} ${p2win ? 'text-emerald-700' : p1win ? 'text-red-400' : dk.text}`}>{p.player2?.name}</p>
                  <p className={`${projector ? 'text-xl' : 'text-xs'} ${dk.subtext}`}>(#{p.player2?.number})</p>
                  {p.score2 !== null && <p className={`font-black ${sz.scoreText} text-amber-700`}>{p.score2}</p>}
                </div>
              </div>
              {r && !hasTie && (
                <div className="px-4 pb-3 text-center">
                  <span className={`font-black text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full ${projector ? 'text-2xl' : 'text-xs'}`}>
                    ✅ {p1win ? p.player1?.name : p.player2?.name} ชนะ
                  </span>
                </div>
              )}
              {hasTie && (
                <div className="px-4 pb-3 text-center">
                  <span className={`font-black text-amber-600 bg-amber-100 px-3 py-1 rounded-full ${projector ? 'text-2xl' : 'text-xs'}`}>⚠️ เสมอ — กรรมการต้องตัดสิน</span>
                </div>
              )}
            </div>
          )
        })}
    </div>
  )

  const ContentAwards = () => (
    <div>
      {awards.champion && (
        <div className={`rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-yellow-300 bg-yellow-50 shadow-lg`}>
          <span className={sz.award}>🥇</span>
          <div>
            <p className={`font-black text-amber-700 uppercase tracking-widest mb-1 ${projector ? 'text-2xl' : 'text-xs'}`}>ชนะเลิศ อันดับ 1</p>
            <p className={`font-black ${sz.awardName} text-gray-900`}>{awards.champion.name}</p>
            <p className={`text-amber-600 ${sz.awardSub} font-semibold`}>หมายเลข {awards.champion.number} · {awards.champion.room}</p>
          </div>
        </div>
      )}
      {awards.runnerUp && (
        <div className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-slate-300 bg-slate-50 shadow-lg">
          <span className={sz.award}>🥈</span>
          <div>
            <p className={`font-black text-slate-600 uppercase tracking-widest mb-1 ${projector ? 'text-2xl' : 'text-xs'}`}>รองชนะเลิศ อันดับ 2</p>
            <p className={`font-black ${sz.awardName} text-gray-900`}>{awards.runnerUp.name}</p>
            <p className={`text-slate-500 ${sz.awardSub} font-semibold`}>หมายเลข {awards.runnerUp.number} · {awards.runnerUp.room}</p>
          </div>
        </div>
      )}
      {awards.thirdPlace.map((p, i) => (
        <div key={i} className="rounded-3xl p-5 mb-3 flex gap-4 items-center border-2 border-orange-300 bg-orange-50 shadow-lg">
          <span className={sz.award}>🥉</span>
          <div>
            <p className={`font-black text-orange-700 uppercase tracking-widest mb-1 ${projector ? 'text-2xl' : 'text-xs'}`}>อันดับ 3 ร่วม</p>
            <p className={`font-black ${sz.awardName} text-gray-900`}>{p.name}</p>
            <p className={`text-orange-600 ${sz.awardSub} font-semibold`}>หมายเลข {p.number} · {p.room}</p>
          </div>
        </div>
      ))}
      {!awards.champion && !awards.runnerUp && awards.thirdPlace.length === 0 && (
        <p className={`text-center py-12 ${dk.subtext} ${sz.stat}`}>⏳ ยังไม่มีผลชิงชนะเลิศ</p>
      )}
      {!projector && (
        <button onClick={() => window.print()}
          className="mt-2 w-full py-3 rounded-2xl font-bold text-sm border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition active:scale-95">
          🖨️ พิมพ์รายชื่อผู้ได้รับรางวัล
        </button>
      )}
    </div>
  )

  // ── PROJECTOR MODE ──
  if (projector) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: '#ffffff' }}>
        {/* Top bar */}
        <div className="shrink-0 flex items-center justify-between px-8 py-4 text-white"
          style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
          <span className="font-black tabular-nums text-3xl">{clock}</span>
          <div className="text-center">
            <span className="font-black text-3xl">🏅 Gold Finger</span>
            <span className="ml-6 text-2xl font-bold opacity-90">{level === 'มต้น' ? 'ม.ต้น' : 'ม.ปลาย'}</span>
            <span className="ml-4 text-2xl opacity-80">{viewLabels[view]}</span>
          </div>
          <button onClick={() => setProjector(false)}
            className="text-3xl font-black px-5 py-2 bg-white/20 hover:bg-white/40 rounded-2xl transition leading-none">
            ✕
          </button>
        </div>

        {/* Announcement */}
        {announcement && (
          <div className="shrink-0 px-8 py-3 text-center font-black text-white text-3xl animate-pulse"
            style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
            📢 {announcement}
          </div>
        )}

        {/* Game badge */}
        {latestGame > 0 && (
          <div className="shrink-0 mx-8 mt-4 rounded-2xl py-3 text-center text-white font-black text-2xl shadow"
            style={{ background: 'linear-gradient(90deg,#0f766e,#2dd4bf)' }}>
            ⚡ ขณะนี้อยู่ในเกมที่ {latestGame}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {view === 'standings' && <ContentStandings />}
          {view === 'tables' && <ContentTables />}
          {view === 'playoff' && <ContentPlayoff />}
          {view === 'awards' && <ContentAwards />}
        </div>

        {/* Bottom bar */}
        <div className="shrink-0 flex items-center justify-between px-8 py-3 text-white"
          style={{ background: 'linear-gradient(135deg,#0f766e,#2dd4bf)' }}>
          <span className="text-xl font-semibold">
            {realtimeOk
              ? <span><span className="inline-block w-3 h-3 rounded-full bg-emerald-300 mr-2 animate-pulse"></span>Live · {lastUpdate}</span>
              : <span className="text-red-200"><span className="inline-block w-3 h-3 rounded-full bg-red-300 mr-2"></span>ออฟไลน์</span>
            }
          </span>
          <span className="text-lg text-white/70">🔄 สลับ view อัตโนมัติทุก 20 วินาที</span>
          <div className="flex gap-2">
            {views.map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-xl font-bold text-base transition ${v === view ? 'bg-white text-teal-700' : 'bg-white/20 hover:bg-white/40'}`}>
                {viewLabels[v]}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── NORMAL MODE ──
  return (
    <div className="min-h-screen pb-16 transition-colors duration-300" style={{ background: dk.bg }}>
      {/* Header */}
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
        {/* Level + View controls */}
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
            {([['standings', '📊 อันดับ'], ['tables', '🪑 โต๊ะ'], ['playoff', '🏆 เพลย์ออฟ'], ['awards', '🎖️ รางวัล']] as [View, string][]).map(([v, label]) => (
              <button key={v} onClick={() => { setView(v); setAutoRotate(false) }}
                className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${view === v ? 'text-white shadow' : `${dk.subtext} hover:opacity-80`}`}
                style={view === v ? { background: '#F98B8B' } : {}}>
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
            style={{ background: 'linear-gradient(90deg,#0f766e,#2dd4bf)' }}>
            ⚡ ขณะนี้อยู่ในเกมที่ {latestGame}
          </div>
        )}

        {view === 'standings' && <ContentStandings />}
        {view === 'tables' && <ContentTables />}
        {view === 'playoff' && <ContentPlayoff />}
        {view === 'awards' && <ContentAwards />}

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
