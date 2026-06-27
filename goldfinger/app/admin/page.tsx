'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/useAuth'
import LoginScreen from '@/components/LoginScreen'
import { supabase } from '@/lib/supabase'
import { computeStandings, computeMatchResult, Player, GameRow } from '@/lib/gf-logic'
import * as XLSX from 'xlsx'

type Level = 'มต้น' | 'มปลาย'

interface Standing {
  rank: number
  player: Player
  points: number
  diffSum: number
  w: number; t: number; l: number
}

export default function AdminPage() {
  const { authed, checked, login, logout } = useAuth()
  const [level, setLevel] = useState<Level>('มต้น')
  const [players, setPlayers] = useState<Player[]>([])
  const [gameRows, setGameRows] = useState<GameRow[]>([])
  const [standings, setStandings] = useState<Standing[]>([])
  const [tables, setTables] = useState<Record<number, { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean }[]>>({})
  const [playoffs, setPlayoffs] = useState<{ round: string; pair_no: number; player1: Player; player2: Player | null; score1: number | null; score2: number | null }[]>([])
  const [latestGame, setLatestGame] = useState(0)
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingGame, setLoadingGame] = useState<number | null>(null)
  const [totalGames, setTotalGames] = useState(4)
  const prevProgressRef = useRef<number>(0)

  // Players management
  const [showPlayers, setShowPlayers] = useState(false)
  const [allPlayers, setAllPlayers] = useState<Player[]>([])
  const [newName, setNewName] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [newLevel, setNewLevel] = useState<Level>('มต้น')
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [editName, setEditName] = useState('')
  const [editRoom, setEditRoom] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<{ name: string; level: string; room: string }[]>([])
  const [importDuplicates, setImportDuplicates] = useState<{ name: string; level: string; room: string }[]>([])
  const [showImportConfirm, setShowImportConfirm] = useState(false)

  const loadData = useCallback(async () => {
    const [{ data: p }, { data: g }, { data: ta }, { data: pf }] = await Promise.all([
      supabase.from('players').select('*').eq('level', level).order('number'),
      supabase.from('games').select('*').eq('level', level).order('updated_at', { ascending: false }),
      supabase.from('table_assignments').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level).order('game').order('table_num').order('sub_table'),
      supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level),
    ])
    const ps = (p || []) as Player[]
    const gs = (g || []) as GameRow[]
    setPlayers(ps)
    setGameRows(gs)
    setStandings(computeStandings(ps, gs) as Standing[])

    // Group table_assignments by game
    const byGame: typeof tables = {}
    let maxGame = 0
    for (const row of (ta || [])) {
      if (!byGame[row.game]) byGame[row.game] = []
      byGame[row.game].push(row as { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean })
      if (row.game > maxGame) maxGame = row.game
    }
    setTables(byGame)
    setLatestGame(maxGame)
    setPlayoffs((pf || []) as typeof playoffs)

  }, [level])

  useEffect(() => { if (authed) loadData() }, [authed, loadData])

  // ข้อ 2: แจ้งเตือนเมื่อกรอกครบ
  useEffect(() => {
    if (!latestGame) return
    const { scored, total } = getGameProgress(latestGame)
    if (total > 0 && scored === total && prevProgressRef.current < total) {
      setStatus({ msg: `🎉 กรอกครบแล้วทุกโต๊ะ! (เกม ${latestGame}) พร้อมจัดโต๊ะเกมต่อไป`, ok: true })
      try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA==').play() } catch { /* ignore */ }
    }
    prevProgressRef.current = scored
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameRows, latestGame])

  const loadAllPlayers = async () => {
    const { data } = await supabase.from('players').select('*').order('level').order('number')
    setAllPlayers((data || []) as Player[])
  }

  useEffect(() => { if (showPlayers) loadAllPlayers() }, [showPlayers])

  async function generateTables(game: number) {
    setLoading(true); setLoadingGame(game); setStatus(null)
    const res = await fetch('/api/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, game }) })
    const data = await res.json()
    if (!res.ok) { setStatus({ msg: data.error, ok: false }) }
    else { setStatus({ msg: `✅ จัดโต๊ะเกม ${game} เรียบร้อย`, ok: true }); await loadData() }
    setLoading(false); setLoadingGame(null)
  }

  async function generateSemi() {
    setLoading(true); setStatus(null)
    const res = await fetch('/api/playoffs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'semi', level }) })
    const data = await res.json()
    if (!res.ok) setStatus({ msg: data.error, ok: false })
    else { setStatus({ msg: '✅ สร้างคู่รองชนะเลิศสำเร็จ', ok: true }); await loadData() }
    setLoading(false)
  }

  async function generateFinal() {
    setLoading(true); setStatus(null)
    const res = await fetch('/api/playoffs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'final', level }) })
    const data = await res.json()
    if (!res.ok) setStatus({ msg: data.error, ok: false })
    else { setStatus({ msg: '✅ สร้างคู่ชิงชนะเลิศสำเร็จ', ok: true }); await loadData() }
    setLoading(false)
  }

  async function resetSystem() {
    if (!confirm('⚠️ ยืนยันรีเซ็ตระบบทั้งหมด?\nข้อมูลผลการแข่งขัน โต๊ะ และเพลย์ออฟจะถูกลบหมด\n(รายชื่อนักเรียนยังอยู่)')) return
    // ข้อ 6: backup อัตโนมัติก่อนรีเซ็ต
    const a = document.createElement('a')
    a.href = '/api/export?level=all'
    a.download = `goldfinger-backup-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    await new Promise(r => setTimeout(r, 500))
    await Promise.all([
      supabase.from('games').delete().neq('id', 0),
      supabase.from('table_assignments').delete().neq('id', 0),
      supabase.from('playoffs').delete().neq('id', 0),
      supabase.from('broadcast').delete().neq('id', 0),
    ])
    await supabase.from('broadcast').insert({ type: 'reset', level: null, payload: {} })
    setStatus({ msg: '✅ รีเซ็ตระบบสำเร็จ', ok: true })
    await loadData()
  }

  // ---- Player management ----
  async function addPlayer(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    // เช็คชื่อซ้ำ
    const dup = allPlayers.find(p => p.name.trim() === newName.trim() && p.level === newLevel)
    if (dup) {
      if (!confirm(`⚠️ มีชื่อ "${newName}" ในระดับ ${newLevel} อยู่แล้ว (หมายเลข ${dup.number}) ยืนยันเพิ่มอีกคนหรือไม่?`)) return
    }
    const res = await fetch('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, level: newLevel, room: newRoom }) })
    if (res.ok) { setNewName(''); setNewRoom(''); await loadAllPlayers(); await loadData() }
  }

  async function deletePlayer(p: Player) {
    if (!confirm(`ยืนยันลบ "${p.name}" (หมายเลข ${p.number} ${p.level})?`)) return
    await fetch('/api/players', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
    await loadAllPlayers(); await loadData()
  }

  async function saveEdit() {
    if (!editingPlayer) return
    await fetch('/api/players', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingPlayer.id, name: editName, room: editRoom }) })
    setEditingPlayer(null); await loadAllPlayers(); await loadData()
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImportFile(file)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<{ ชื่อ?: string; ระดับ?: string; ห้อง?: string }>(ws)
    const parsed = rows.map(r => ({ name: String(r['ชื่อ'] || '').trim(), level: String(r['ระดับ'] || '').trim(), room: String(r['ห้อง'] || '').trim() })).filter(r => r.name && r.level)
    setImportPreview(parsed)
  }

  async function submitImport(force = false) {
    if (!importPreview.length) return
    const res = await fetch('/api/players/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: importPreview, force }) })
    const data = await res.json()
    if (!res.ok) { alert(data.error); return }
    if (!force && data.duplicates?.length > 0) {
      setImportDuplicates(data.duplicates); setShowImportConfirm(true); return
    }
    alert(`นำเข้าสำเร็จ ${data.inserted} คน (ข้ามซ้ำ ${data.duplicatesSkipped} คน)`)
    setImportPreview([]); setImportFile(null); setShowImportConfirm(false)
    await loadAllPlayers(); await loadData()
  }

  function isGameDone(game: number) {
    const ta = tables[game] || []
    const gs = gameRows.filter(g => g.game === game)
    if (!ta.length) return false
    return ta.filter(t => !t.is_bye).every(t => {
      const g = gs.find(g => g.sub_table === t.sub_table)
      return g && g.score1 !== null && g.score2 !== null
    })
  }

  function getGameProgress(game: number) {
    const ta = (tables[game] || []).filter(t => !t.is_bye)
    const gs = gameRows.filter(g => g.game === game)
    const scored = ta.filter(t => {
      const g = gs.find(g => g.sub_table === t.sub_table)
      return g && g.score1 !== null && g.score2 !== null
    }).length
    return { scored, total: ta.length }
  }

  // Awards
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

  if (!checked) return null
  if (!authed) return <LoginScreen onLogin={login} />

  const awards = getAwards()

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="max-w-2xl mx-auto mb-4 rounded-3xl p-6 text-center shadow-xl"
          style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
          <h1 style={{ fontFamily: "'Nunito',sans-serif" }} className="text-2xl font-black text-white">🥇 แผงแอดมิน Goldfinger</h1>
          <p className="text-yellow-200 text-sm font-bold mt-1">Math Week 2026 • โรงเรียนพูลเจริญวิทยาคม</p>
          <div className="flex justify-center gap-3 mt-4 flex-wrap">
            <a href="/display" target="_blank" className="px-4 py-2 bg-white/20 rounded-xl text-white font-bold text-sm hover:bg-white/30 transition">🖥️ กระดานคะแนน</a>
            <a href="/scoring" target="_blank" className="px-4 py-2 bg-white/20 rounded-xl text-white font-bold text-sm hover:bg-white/30 transition">✍️ กรอกคะแนน</a>
            <button onClick={logout} className="px-4 py-2 bg-red-900/40 rounded-xl text-white font-bold text-sm hover:bg-red-900/60 transition">ออกจากระบบ</button>
          </div>
        </div>
      </div>

      {/* Sticky tab bar */}
      <div className="sticky top-0 z-50 bg-amber-50 border-b-2 border-yellow-200 shadow-sm">
        <div className="max-w-2xl mx-auto flex">
          {[
            { label: '🎮 คัดเลือก', id: 'section-prelim' },
            { label: '🏆 เพลย์ออฟ', id: 'section-playoff' },
            { label: '📊 อันดับ', id: 'section-standings' },
            { label: '👥 จัดการ', id: 'section-manage' },
          ].map(tab => (
            <button key={tab.id} onClick={() => scrollTo(tab.id)}
              className="flex-1 py-3 text-xs font-black text-amber-800 hover:bg-amber-100 transition border-r last:border-r-0 border-yellow-200">
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-5">
        {/* Level Toggle */}
        <div className="flex bg-white rounded-2xl p-1.5 border-2 border-yellow-200 shadow">
          {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
            <button key={lv} onClick={() => setLevel(lv)} className={`flex-1 py-3 rounded-xl font-bold text-sm transition ${level === lv ? 'bg-amber-500 text-white shadow' : 'text-amber-700'}`}>
              {lv === 'มต้น' ? 'มัธยมศึกษาตอนต้น' : 'มัธยมศึกษาตอนปลาย'}
            </button>
          ))}
        </div>

        {/* Current game banner */}
        {latestGame > 0 && (
          <div className="rounded-2xl p-4 text-center font-black text-lg text-white shadow-lg animate-pulse-slow"
            style={{ background: '#dc2626' }}>
            ⚠️ ขณะนี้อยู่ในเกมที่ {latestGame} ({level})
          </div>
        )}

        {/* Status */}
        {status && (
          <div className={`rounded-xl p-3 text-center font-bold text-sm ${status.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {status.msg}
          </div>
        )}

        {/* Game rounds */}
        <div id="section-prelim" className="bg-white rounded-2xl p-5 border border-yellow-200 shadow scroll-mt-14">
          <p className="font-black text-amber-800 mb-3">🎮 รอบคัดเลือก</p>
          <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3 mb-4">
            เกม 1: สุ่มจับโต๊ะ &nbsp;|&nbsp; เลขคู่: ไขว้โต๊ะเดิม &nbsp;|&nbsp; เลขคี่ (3+): Swiss จัดใหม่ตามแต้ม
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: totalGames }, (_, i) => i + 1).map(g => {
              const done = isGameDone(g)
              const isLatest = latestGame === g
              const label = g === 1 ? 'Random' : g % 2 === 0 ? 'ไขว้' : 'Swiss'
              return (
                <button key={g} onClick={() => generateTables(g)} disabled={loading}
                  className={`flex-1 min-w-[70px] py-3 rounded-xl font-bold text-sm border-2 transition ${done ? 'bg-green-100 border-green-400 text-green-800' : isLatest ? 'bg-amber-500 border-amber-600 text-white' : 'bg-amber-50 border-yellow-300 text-amber-800 hover:bg-amber-100'}`}>
                  {loadingGame === g ? <span className="block animate-spin text-base">⏳</span> : <>เกม {g}<br /><span className="text-xs font-normal">{label}</span>{done && <span className="block text-xs">✅</span>}</>}
                </button>
              )
            })}
            <button onClick={() => setTotalGames(n => n + 1)}
              className="min-w-[44px] py-3 px-3 rounded-xl font-black text-xl border-2 border-dashed border-amber-300 text-amber-400 hover:border-amber-500 hover:text-amber-600 transition">
              +
            </button>
            {totalGames > 4 && (
              <button onClick={() => setTotalGames(n => Math.max(4, n - 1))}
                className="min-w-[44px] py-3 px-3 rounded-xl font-black text-xl border-2 border-dashed border-red-200 text-red-300 hover:border-red-400 hover:text-red-500 transition">
                −
              </button>
            )}
          </div>

          {/* แสดงโต๊ะของเกมล่าสุด */}
          {latestGame > 0 && tables[latestGame] && tables[latestGame].length > 0 && (() => {
            type TARow = { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean; table_num: number }
            const byTable: Record<number, TARow[]> = {}
            tables[latestGame].forEach(r => {
              const tn = (r as unknown as TARow).table_num || 0
              if (!byTable[tn]) byTable[tn] = []
              byTable[tn].push(r as unknown as TARow)
            })
            return (
              <div className="mt-4 space-y-2">
                {(() => {
                  const { scored, total } = getGameProgress(latestGame)
                  const pct = total > 0 ? Math.round(scored / total * 100) : 0
                  return total > 0 && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs font-bold text-amber-700 mb-1">
                        <span>ความคืบหน้าเกม {latestGame}</span>
                        <span>{scored}/{total} โต๊ะ {scored === total ? '✅ ครบแล้ว' : ''}</span>
                      </div>
                      <div className="w-full bg-amber-100 rounded-full h-2.5">
                        <div className="h-2.5 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: scored === total ? '#16a34a' : '#d97706' }} />
                      </div>
                    </div>
                  )
                })()}
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs font-bold text-amber-700">โต๊ะเกมที่ {latestGame}:</p>
                  <button onClick={() => window.print()} className="px-3 py-1 rounded-lg border border-amber-400 text-amber-700 text-xs font-bold hover:bg-amber-50">🖨️ พิมพ์ใบปะหน้า</button>
                </div>
                {Object.entries(byTable).sort(([a], [b]) => Number(a) - Number(b)).map(([tn, rows]) => (
                  <div key={tn} className="bg-amber-50 rounded-xl p-3 border border-yellow-200 text-sm">
                    <span className="font-black text-amber-800 mr-2">โต๊ะ {tn}</span>
                    {rows.map(r => (
                      <span key={r.sub_table} className="mr-3">
                        <strong>{r.sub_table.slice(-1)}:</strong>{' '}
                        {r.is_bye
                          ? `🎁 ${r.player1?.name} (bye)`
                          : `${r.player1?.name} vs ${r.player2?.name}`}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        {/* Playoff */}
        <div id="section-playoff" className="bg-white rounded-2xl p-5 border border-yellow-200 shadow scroll-mt-14">
          <p className="font-black text-amber-800 mb-3">🏆 รอบเพลย์ออฟ</p>
          <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3 mb-4">กดหลังกรอกผลครบ 4 เกมแล้ว — ระบบดึง 4 อันดับแรกมาจับคู่รองชนะเลิศให้อัตโนมัติ (1 vs 4, 2 vs 3)</div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={generateSemi} disabled={loading} className="flex-1 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-800 to-amber-500 text-white shadow disabled:opacity-50">🎯 สร้างคู่รองชนะเลิศ</button>
            <button onClick={generateFinal} disabled={loading} className="flex-1 py-3 rounded-xl font-bold text-sm border-2 border-amber-500 text-amber-800 bg-white hover:bg-amber-50 disabled:opacity-50">🏁 สร้างคู่ชิงชนะเลิศ</button>
          </div>
          {playoffs.length > 0 && (
            <div className="mt-4 space-y-2">
              {playoffs.map((p, i) => (
                <div key={i} className="bg-amber-50 rounded-xl p-3 border border-yellow-200 text-sm flex justify-between items-center">
                  <span className="font-black text-amber-800">{p.round} คู่ {p.pair_no}</span>
                  <span>{p.player1?.name} ({p.score1 ?? '-'}) vs {p.player2?.name} ({p.score2 ?? '-'})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Standings */}
        <div id="section-standings" className="bg-white rounded-2xl p-5 border border-yellow-200 shadow scroll-mt-14">
          <p className="font-black text-amber-800 mb-3">📊 ตารางอันดับปัจจุบัน ({level})</p>
          {standings.length === 0 ? (
            <p className="text-center text-amber-300 py-4">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-amber-800 text-white"><th className="p-2">อันดับ</th><th className="p-2 text-left">ชื่อ</th><th className="p-2">ห้อง</th><th className="p-2">W-T-L</th><th className="p-2">แต้ม</th><th className="p-2">ผลต่าง</th></tr></thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={s.player.id} className={i % 2 === 0 ? 'bg-amber-50' : 'bg-white'}>
                      <td className="p-2 text-center font-bold">{s.rank}</td>
                      <td className="p-2 font-semibold">{s.player.name} <span className="text-amber-500 font-normal text-xs">({s.player.number})</span></td>
                      <td className="p-2 text-center text-xs">{s.player.room}</td>
                      <td className="p-2 text-center">{s.w}-{s.t}-{s.l}</td>
                      <td className="p-2 text-center font-black">{s.points}</td>
                      <td className="p-2 text-center">{s.diffSum > 0 ? '+' : ''}{s.diffSum}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Awards */}
        <div className="bg-white rounded-2xl p-5 border border-yellow-200 shadow" id="awards-section">
          <div className="flex justify-between items-center mb-4">
            <p className="font-black text-amber-800">🏅 สรุปผลรางวัล ({level})</p>
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg border border-amber-400 text-amber-800 text-xs font-bold hover:bg-amber-50">🖨️ พิมพ์</button>
          </div>
          {!awards.champion && !awards.runnerUp && awards.thirdPlace.length === 0 && (
            <p className="text-center text-amber-300 py-4">⏳ ยังไม่มีผลชิงชนะเลิศ</p>
          )}
          {awards.champion && <div className="rounded-xl p-4 mb-3 border-2 border-yellow-400 bg-yellow-50 flex gap-4 items-center"><span className="text-4xl">🥇</span><div><p className="text-xs font-bold text-amber-700">ชนะเลิศ (ที่ 1)</p><p className="font-black text-base">{awards.champion.name}</p><p className="text-xs text-amber-600">หมายเลข {awards.champion.number} • {awards.champion.room}</p></div></div>}
          {awards.runnerUp && <div className="rounded-xl p-4 mb-3 border-2 border-slate-300 bg-slate-50 flex gap-4 items-center"><span className="text-4xl">🥈</span><div><p className="text-xs font-bold text-slate-600">รองชนะเลิศ (ที่ 2)</p><p className="font-black text-base">{awards.runnerUp.name}</p><p className="text-xs text-slate-500">หมายเลข {awards.runnerUp.number} • {awards.runnerUp.room}</p></div></div>}
          {awards.thirdPlace.map((p, i) => (
            <div key={i} className="rounded-xl p-4 mb-3 border-2 border-orange-300 bg-orange-50 flex gap-4 items-center"><span className="text-4xl">🥉</span><div><p className="text-xs font-bold text-orange-700">อันดับ 3 ร่วม</p><p className="font-black text-base">{p.name}</p><p className="text-xs text-orange-600">หมายเลข {p.number} • {p.room}</p></div></div>
          ))}
        </div>

        {/* Export */}
        <div className="bg-white rounded-2xl p-5 border border-yellow-200 shadow">
          <p className="font-black text-amber-800 mb-3">📥 Export ผลคะแนน</p>
          <div className="flex gap-3 flex-wrap">
            <a href={`/api/export?level=${encodeURIComponent(level)}`} className="flex-1 py-3 rounded-xl text-center font-bold text-sm bg-green-700 text-white hover:bg-green-800 transition">📊 Export {level} (.xlsx)</a>
            <a href="/api/export?level=all" className="flex-1 py-3 rounded-xl text-center font-bold text-sm border-2 border-green-600 text-green-800 hover:bg-green-50 transition">📊 Export ทุกระดับ</a>
          </div>
        </div>

        {/* Reset */}
        <div className="bg-red-50 rounded-2xl p-5 border-2 border-red-300 shadow">
          <p className="font-black text-red-700 mb-1">🚨 รีเซ็ตระบบ — ระวัง!</p>
          <p className="text-xs text-red-600 mb-3">จะลบ <strong>ผลการแข่งขัน โต๊ะ และเพลย์ออฟทั้งหมด</strong> ไม่สามารถกู้คืนได้ (รายชื่อนักเรียนยังอยู่)</p>
          <button onClick={resetSystem}
            className="w-full py-3 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 transition">
            🗑️ รีเซ็ตระบบทั้งหมด
          </button>
        </div>

        {/* Players Management */}
        <div id="section-manage" className="bg-white rounded-2xl border border-yellow-200 shadow overflow-hidden scroll-mt-14">
          <button onClick={() => setShowPlayers(v => !v)} className="w-full p-5 flex justify-between items-center font-black text-amber-800 hover:bg-amber-50 transition">
            <span>👥 จัดการรายชื่อนักเรียน</span>
            <span>{showPlayers ? '▲' : '▼'}</span>
          </button>
          {showPlayers && (
            <div className="p-5 border-t border-yellow-100 space-y-5">
              {/* เพิ่มทีละคน */}
              <form onSubmit={addPlayer} className="space-y-3">
                <p className="font-bold text-amber-700 text-sm">เพิ่มนักเรียนทีละคน</p>
                <select value={newLevel} onChange={e => setNewLevel(e.target.value as Level)} className="w-full px-3 py-2 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50">
                  <option value="มต้น">ม.ต้น</option>
                  <option value="มปลาย">ม.ปลาย</option>
                </select>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อ-นามสกุล" className="w-full px-3 py-2 border-2 border-yellow-200 rounded-xl text-sm" required />
                <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="ห้อง (เช่น ม.3/5)" className="w-full px-3 py-2 border-2 border-yellow-200 rounded-xl text-sm" />
                <button type="submit" className="w-full py-2 rounded-xl bg-amber-500 text-white font-bold text-sm">+ เพิ่มนักเรียน</button>
              </form>

              {/* Import Excel */}
              <div className="border-t pt-4">
                <p className="font-bold text-amber-700 text-sm mb-2">นำเข้าจาก Excel (คอลัมน์: ชื่อ | ระดับ | ห้อง)</p>
                <input type="file" accept=".xlsx,.csv" onChange={handleImportFile} className="w-full text-sm mb-2" />
                {importPreview.length > 0 && (
                  <div className="bg-amber-50 rounded-xl p-3 mb-2 text-xs">
                    <p className="font-bold mb-1">ตัวอย่าง {importPreview.length} แถวแรก:</p>
                    {importPreview.slice(0, 3).map((r, i) => <p key={i}>{r.name} / {r.level} / {r.room}</p>)}
                    {importPreview.length > 3 && <p>... อีก {importPreview.length - 3} คน</p>}
                    <button onClick={() => submitImport(false)} className="mt-2 px-4 py-1.5 bg-green-700 text-white rounded-lg font-bold">นำเข้า {importPreview.length} คน</button>
                  </div>
                )}
                {showImportConfirm && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs">
                    <p className="font-bold text-red-700 mb-1">⚠️ พบชื่อซ้ำ {importDuplicates.length} คน:</p>
                    {importDuplicates.map((d, i) => <p key={i}>{d.name} ({d.level})</p>)}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => submitImport(true)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold text-xs">ข้ามคนซ้ำ นำเข้าที่เหลือ</button>
                      <button onClick={() => setShowImportConfirm(false)} className="px-3 py-1.5 border border-red-300 text-red-700 rounded-lg font-bold text-xs">ยกเลิก</button>
                    </div>
                  </div>
                )}
              </div>

              {/* รายชื่อ */}
              {(['มต้น', 'มปลาย'] as Level[]).map(lv => {
                const lvPlayers = allPlayers.filter(p => p.level === lv)
                if (!lvPlayers.length) return null
                return (
                  <div key={lv} className="border-t pt-4">
                    <p className="font-bold text-amber-800 text-sm mb-2">{lv} ({lvPlayers.length} คน)</p>
                    <div className="space-y-1">
                      {lvPlayers.map(p => (
                        <div key={p.id} className="flex items-center gap-2 text-sm py-1.5 border-b border-yellow-50">
                          <span className="font-bold text-amber-700 w-6 text-center">{p.number}</span>
                          {editingPlayer?.id === p.id ? (
                            <>
                              <input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 px-2 py-1 border border-yellow-300 rounded-lg text-sm" />
                              <input value={editRoom} onChange={e => setEditRoom(e.target.value)} className="w-20 px-2 py-1 border border-yellow-300 rounded-lg text-sm" />
                              <button onClick={saveEdit} className="px-2 py-1 bg-green-600 text-white rounded-lg text-xs font-bold">บันทึก</button>
                              <button onClick={() => setEditingPlayer(null)} className="px-2 py-1 bg-gray-300 rounded-lg text-xs">ยกเลิก</button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1">{p.name}</span>
                              <span className="text-amber-500 text-xs">{p.room}</span>
                              <button onClick={() => { setEditingPlayer(p); setEditName(p.name); setEditRoom(p.room) }} className="px-2 py-1 text-xs border border-amber-300 rounded-lg text-amber-700 hover:bg-amber-50">✏️</button>
                              <button onClick={() => deletePlayer(p)} className="px-2 py-1 text-xs border border-red-300 rounded-lg text-red-600 hover:bg-red-50">🗑️</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          body > * { display: none !important; }
          #awards-section { display: block !important; }
          #print-tables { display: block !important; }
        }
        #print-tables { display: none; }
      `}</style>

      {/* ข้อ 3: ใบปะหน้าโต๊ะ (ซ่อนไว้ แสดงเฉพาะตอนพิมพ์) */}
      <div id="print-tables">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 900 }}>🎮 การจับคู่เกมที่ {latestGame} — {level}</h2>
          <p style={{ fontSize: 13 }}>Math Week 2026 • โรงเรียนพูลเจริญวิทยาคม</p>
        </div>
        {latestGame > 0 && tables[latestGame] && (() => {
          type TARow = { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean; table_num: number }
          const byTable: Record<number, TARow[]> = {}
          tables[latestGame].forEach(r => {
            const tn = (r as unknown as TARow).table_num || 0
            if (!byTable[tn]) byTable[tn] = []
            byTable[tn].push(r as unknown as TARow)
          })
          return Object.entries(byTable).sort(([a], [b]) => Number(a) - Number(b)).map(([tn, rows]) => (
            <div key={tn} style={{ border: '2px solid #d97706', borderRadius: 12, padding: 16, marginBottom: 16, breakInside: 'avoid' }}>
              <p style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>โต๊ะ {tn}</p>
              {rows.map(r => (
                <p key={r.sub_table} style={{ fontSize: 15, marginBottom: 4 }}>
                  <strong>{r.sub_table.slice(-1)}:</strong>{' '}
                  {r.is_bye ? `${r.player1?.name} (${r.player1?.number}) — bye` : `${r.player1?.name} (${r.player1?.number}) VS ${r.player2?.name} (${r.player2?.number})`}
                </p>
              ))}
            </div>
          ))
        })()}
      </div>
    </div>
  )
}
