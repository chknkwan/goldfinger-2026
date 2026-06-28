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
  const { authed, checked, login, logout } = useAuth('admin')
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
  const [showStandings, setShowStandings] = useState(false)

  // Broadcast
  const [announcement, setAnnouncement] = useState('')
  const [announceLoading, setAnnounceLoading] = useState(false)

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

  async function sendAnnouncement(e: React.FormEvent) {
    e.preventDefault()
    if (!announcement.trim()) return
    setAnnounceLoading(true)
    await fetch('/api/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'announcement', level, payload: { message: announcement.trim() } })
    })
    setAnnounceLoading(false)
    setAnnouncement('')
    setStatus({ msg: '✅ ส่งข้อความไปยังหน้าจอแสดงผลแล้ว', ok: true })
  }

  function downloadSampleExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['ชื่อ', 'ระดับ', 'ห้อง'],
      ['เด็กชายตัวอย่าง ทดสอบ', 'มต้น', 'ม.1/1'],
      ['เด็กหญิงตัวอย่าง สอบทด', 'มต้น', 'ม.2/3'],
      ['นายตัวอย่าง ทดสอบ', 'มปลาย', 'ม.4/2'],
      ['นางสาวตัวอย่าง สอบทด', 'มปลาย', 'ม.5/1'],
    ])
    ws['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ผู้เล่น')
    XLSX.writeFile(wb, 'ตัวอย่าง_รายชื่อผู้เล่น.xlsx')
  }

  if (!checked) return null
  if (!authed) return <LoginScreen role="admin" onLogin={login} />

  const awards = getAwards()

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="max-w-2xl mx-auto mb-4 rounded-3xl p-6 text-center shadow-xl"
          style={{ background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' }}>
          <h1 style={{ fontFamily: "'Nunito',sans-serif" }} className="text-2xl font-black text-white">🥇 แผงแอดมิน Goldfinger</h1>
          <p className="text-yellow-200 text-sm font-bold mt-1">{process.env.NEXT_PUBLIC_EVENT_NAME} • {process.env.NEXT_PUBLIC_SCHOOL_NAME}</p>
          <div className="flex justify-center gap-3 mt-4 flex-wrap">
            <a href="/display" target="_blank" className="px-4 py-2 bg-white/20 rounded-xl text-white font-bold text-sm hover:bg-white/30 transition">🖥️ กระดานคะแนน</a>
            <a href="/scoring" target="_blank" className="px-4 py-2 bg-white/20 rounded-xl text-white font-bold text-sm hover:bg-white/30 transition">✍️ กรอกคะแนน</a>
            <button onClick={logout} className="px-4 py-2 bg-red-900/40 rounded-xl text-white font-bold text-sm hover:bg-red-900/60 transition">ออกจากระบบ</button>
          </div>
        </div>
      </div>

      {/* Sticky tab bar */}
      <div className="sticky top-0 z-50 bg-pink-50 border-b-2 border-pink-100 shadow-sm">
        <div className="max-w-2xl mx-auto flex">
          {[
            { label: '🎮 คัดเลือก', id: 'section-prelim' },
            { label: '🏆 เพลย์ออฟ', id: 'section-playoff' },
            { label: '📊 อันดับ', id: 'section-standings' },
            { label: '👥 จัดการ', id: 'section-manage' },
          ].map(tab => (
            <button key={tab.id} onClick={() => scrollTo(tab.id)}
              className="flex-1 py-3 text-xs font-black text-pink-700 hover:bg-pink-100 transition border-r last:border-r-0 border-pink-100">
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-5">
        {/* Level Toggle */}
        <div className="flex bg-white rounded-2xl p-1.5 border-2 border-pink-100 shadow">
          {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
            <button key={lv} onClick={() => setLevel(lv)} className={`flex-1 py-3 rounded-xl font-bold text-sm transition ${level === lv ? 'bg-pink-500 text-white shadow' : 'text-pink-600'}`}>
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
        <div id="section-prelim" className="bg-white rounded-2xl p-5 border border-pink-100 shadow scroll-mt-14">
          <p className="font-black text-pink-700 mb-3">🎮 รอบคัดเลือก</p>
          <div className="text-xs text-pink-600 bg-pink-50 rounded-lg p-3 mb-4">
            เกม 1: สุ่มจับโต๊ะ &nbsp;|&nbsp; เลขคู่: ไขว้โต๊ะเดิม &nbsp;|&nbsp; เลขคี่ (3+): Swiss จัดใหม่ตามแต้ม
          </div>
          {/* Game count control */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-pink-600">{totalGames} เกม</span>
            <div className="flex gap-2">
              {totalGames > 4 && (
                <button onClick={() => setTotalGames(n => Math.max(4, n - 1))}
                  className="w-9 h-9 rounded-full font-black text-lg border-2 border-pink-200 text-pink-500 hover:bg-pink-100 transition flex items-center justify-center">
                  −
                </button>
              )}
              <button onClick={() => setTotalGames(n => n + 1)}
                className="w-9 h-9 rounded-full font-black text-lg border-2 border-pink-300 bg-pink-500 text-white hover:bg-amber-600 transition flex items-center justify-center">
                +
              </button>
            </div>
          </div>

          {/* Game cards */}
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: totalGames }, (_, i) => i + 1).map(g => {
              const done = isGameDone(g)
              const hasTable = !!(tables[g] && tables[g].length > 0)
              const locked = g > 1 && !isGameDone(g - 1) && !hasTable
              const label = g === 1 ? 'Random' : g % 2 === 0 ? 'ไขว้' : 'Swiss'
              return (
                <button key={g} onClick={() => generateTables(g)} disabled={loading}
                  className={`relative py-4 px-3 rounded-2xl font-bold text-sm border-2 transition text-left shadow-sm
                    ${done ? 'bg-green-50 border-green-400 text-green-800'
                    : hasTable && !done ? 'bg-pink-50 border-pink-300 text-pink-700'
                    : locked ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-white border-pink-200 text-pink-700 hover:bg-pink-50'}`}>
                  {locked && <span className="absolute top-2 right-2 text-base">🔒</span>}
                  {done && <span className="absolute top-2 right-2 text-base">✅</span>}
                  {loadingGame === g
                    ? <span className="block animate-spin text-xl text-center">⏳</span>
                    : <>
                        <span className="block text-base font-black">เกม {g}</span>
                        <span className="text-xs font-normal opacity-70">{label}</span>
                      </>
                  }
                </button>
              )
            })}
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

            const { scored, total } = getGameProgress(latestGame)
            const pct = total > 0 ? Math.round(scored / total * 100) : 0

            // หา sub_tables ที่ยังไม่ได้กรอก
            const gs = gameRows.filter(g => g.game === latestGame)
            const missingTables = (tables[latestGame] || [])
              .filter(t => !t.is_bye)
              .filter(t => {
                const g = gs.find(g => g.sub_table === t.sub_table)
                return !(g && g.score1 !== null && g.score2 !== null)
              })
              .map(t => (t as unknown as TARow).sub_table)

            return (
              <div className="mt-4 space-y-3">
                {/* Progress bar */}
                {total > 0 && (
                  <div>
                    <div className="flex justify-between text-xs font-bold text-pink-600 mb-1">
                      <span>ความคืบหน้าเกม {latestGame}</span>
                      <span>{scored}/{total} โต๊ะ {scored === total ? '✅ ครบแล้ว' : ''}</span>
                    </div>
                    <div className="w-full bg-pink-100 rounded-full h-2.5">
                      <div className="h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: scored === total ? '#16a34a' : '#d97706' }} />
                    </div>
                  </div>
                )}

                {/* Missing tables warning card */}
                {missingTables.length > 0 && (
                  <div className="bg-pink-50 border border-pink-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-yellow-800 mb-2">
                      ⏳ เกม {latestGame} ยังกรอกไม่ครบ — เหลือ {missingTables.length} โต๊ะ
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {missingTables.map(sub => (
                        <span key={sub} className="px-2 py-0.5 bg-yellow-200 text-yellow-900 text-xs font-bold rounded-full">
                          โต๊ะ {sub}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Table list */}
                <div className="flex justify-between items-center">
                  <p className="text-xs font-bold text-pink-600">โต๊ะเกมที่ {latestGame}:</p>
                  <button onClick={() => window.print()} className="px-3 py-1 rounded-lg border border-pink-300 text-pink-600 text-xs font-bold hover:bg-pink-50">🖨️ พิมพ์ใบปะหน้า</button>
                </div>
                {Object.entries(byTable).sort(([a], [b]) => Number(a) - Number(b)).map(([tn, rows]) => (
                  <div key={tn} className="bg-pink-50 rounded-xl p-3 border border-pink-100 text-sm">
                    <span className="font-black text-pink-700 mr-2">โต๊ะ {tn}</span>
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
        <div id="section-playoff" className="bg-white rounded-2xl p-5 border border-pink-100 shadow scroll-mt-14">
          <p className="font-black text-pink-700 mb-3">🏆 รอบเพลย์ออฟ</p>
          <div className="text-xs text-pink-600 bg-pink-50 rounded-lg p-3 mb-4">กดหลังกรอกผลครบ 4 เกมแล้ว — ระบบดึง 4 อันดับแรกมาจับคู่รองชนะเลิศให้อัตโนมัติ (1 vs 4, 2 vs 3)</div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={generateSemi} disabled={loading} className="flex-1 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-[#F98B8B] to-[#FDBBBB] text-white shadow disabled:opacity-50">🎯 สร้างคู่รองชนะเลิศ</button>
            <button onClick={generateFinal} disabled={loading} className="flex-1 py-3 rounded-xl font-bold text-sm border-2 border-pink-400 text-pink-700 bg-white hover:bg-pink-50 disabled:opacity-50">🏁 สร้างคู่ชิงชนะเลิศ</button>
          </div>
          {playoffs.length > 0 && (
            <div className="mt-4 space-y-2">
              {playoffs.map((p, i) => (
                <div key={i} className="bg-pink-50 rounded-xl p-3 border border-pink-100 text-sm flex justify-between items-center">
                  <span className="font-black text-pink-700">{p.round} คู่ {p.pair_no}</span>
                  <span>{p.player1?.name} ({p.score1 ?? '-'}) vs {p.player2?.name} ({p.score2 ?? '-'})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Standings — collapsible */}
        <div id="section-standings" className="bg-white rounded-2xl border border-pink-100 shadow overflow-hidden scroll-mt-14">
          <button onClick={() => setShowStandings(v => !v)} className="w-full p-5 flex justify-between items-center font-black text-pink-700 hover:bg-pink-50 transition">
            <span>📊 ตารางอันดับปัจจุบัน ({level})</span>
            <span className="text-pink-300">{showStandings ? '▲' : '▼'}</span>
          </button>
          {showStandings && (
            <div className="border-t border-yellow-100 overflow-x-auto">
              {standings.length === 0
                ? <p className="text-center text-pink-200 py-4 px-5">ยังไม่มีข้อมูล</p>
                : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-white" style={{ background: '#F98B8B' }}>
                      <th className="p-2 rounded-l text-center">อันดับ</th>
                      <th className="p-2 text-left">ชื่อ</th>
                      <th className="p-2 text-center">ห้อง</th>
                      <th className="p-2 text-center">W-T-L</th>
                      <th className="p-2 text-center">แต้ม</th>
                      <th className="p-2 text-center rounded-r">ผลต่าง</th>
                    </tr></thead>
                    <tbody>
                      {standings.map((s, i) => (
                        <tr key={s.player.id} className={`border-b border-yellow-50 ${i === 0 ? 'bg-pink-50' : i === 1 ? 'bg-slate-50' : i === 2 ? 'bg-orange-50' : ''}`}>
                          <td className="p-2 text-center">{i < 3 ? ['🥇','🥈','🥉'][i] : <span className="text-pink-500">{s.rank}</span>}</td>
                          <td className="p-2">{s.player.name} <span className="text-pink-300">(#{s.player.number})</span></td>
                          <td className="p-2 text-center text-pink-300">{s.player.room}</td>
                          <td className="p-2 text-center text-pink-500">{s.w}-{s.t}-{s.l}</td>
                          <td className="p-2 text-center font-black text-pink-700">{s.points}</td>
                          <td className={`p-2 text-center font-bold ${s.diffSum > 0 ? 'text-emerald-600' : s.diffSum < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {s.diffSum > 0 ? '+' : ''}{s.diffSum}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          )}
        </div>

        {/* Awards */}
        <div className="bg-white rounded-2xl p-5 border border-pink-100 shadow" id="awards-section">
          <div className="flex justify-between items-center mb-4">
            <p className="font-black text-pink-700">🏅 สรุปผลรางวัล ({level})</p>
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg border border-pink-300 text-pink-700 text-xs font-bold hover:bg-pink-50">🖨️ พิมพ์</button>
          </div>
          {!awards.champion && !awards.runnerUp && awards.thirdPlace.length === 0 && (
            <p className="text-center text-pink-200 py-4">⏳ ยังไม่มีผลชิงชนะเลิศ</p>
          )}
          {awards.champion && <div className="rounded-xl p-4 mb-3 border-2 border-pink-300 bg-pink-50 flex gap-4 items-center"><span className="text-4xl">🥇</span><div><p className="text-xs font-bold text-pink-600">ชนะเลิศ (ที่ 1)</p><p className="font-black text-base">{awards.champion.name}</p><p className="text-xs text-pink-500">หมายเลข {awards.champion.number} • {awards.champion.room}</p></div></div>}
          {awards.runnerUp && <div className="rounded-xl p-4 mb-3 border-2 border-slate-300 bg-slate-50 flex gap-4 items-center"><span className="text-4xl">🥈</span><div><p className="text-xs font-bold text-slate-600">รองชนะเลิศ (ที่ 2)</p><p className="font-black text-base">{awards.runnerUp.name}</p><p className="text-xs text-slate-500">หมายเลข {awards.runnerUp.number} • {awards.runnerUp.room}</p></div></div>}
          {awards.thirdPlace.map((p, i) => (
            <div key={i} className="rounded-xl p-4 mb-3 border-2 border-orange-300 bg-orange-50 flex gap-4 items-center"><span className="text-4xl">🥉</span><div><p className="text-xs font-bold text-orange-700">อันดับ 3 ร่วม</p><p className="font-black text-base">{p.name}</p><p className="text-xs text-orange-600">หมายเลข {p.number} • {p.room}</p></div></div>
          ))}
        </div>

        {/* Broadcast */}
        <div className="bg-white rounded-2xl p-5 border border-pink-100 shadow">
          <p className="font-black text-pink-700 mb-3">📢 ส่งข้อความไปหน้าจอ</p>
          <form onSubmit={sendAnnouncement} className="flex gap-2">
            <input type="text" value={announcement} onChange={e => setAnnouncement(e.target.value)}
              placeholder="เช่น พักรับประทานอาหาร 30 นาที"
              className="flex-1 px-3 py-2.5 rounded-xl border-2 border-pink-100 bg-pink-50 text-sm font-semibold focus:outline-none focus:border-pink-300" />
            <button type="submit" disabled={!announcement.trim() || announceLoading}
              className="px-4 py-2.5 rounded-xl font-bold text-sm text-white shadow hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 shrink-0"
              style={{ background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' }}>
              {announceLoading ? '⏳' : '📤 ส่ง'}
            </button>
          </form>
          <p className="text-xs text-pink-300 mt-2">ข้อความจะแสดงบนหน้าจอ display 30 วินาที</p>
        </div>

        {/* Export */}
        <div className="bg-white rounded-2xl p-5 border border-pink-100 shadow">
          <p className="font-black text-pink-700 mb-3">📥 Export ผลคะแนน</p>
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
        <div id="section-manage" className="bg-white rounded-2xl border border-pink-100 shadow overflow-hidden scroll-mt-14">
          <button onClick={() => setShowPlayers(v => !v)} className="w-full p-5 flex justify-between items-center font-black text-pink-700 hover:bg-pink-50 transition">
            <span>👥 จัดการรายชื่อนักเรียน</span>
            <span>{showPlayers ? '▲' : '▼'}</span>
          </button>
          {showPlayers && (
            <div className="p-5 border-t border-yellow-100 space-y-5">
              {/* เพิ่มทีละคน */}
              <form onSubmit={addPlayer} className="space-y-3">
                <p className="font-bold text-pink-600 text-sm">เพิ่มนักเรียนทีละคน</p>
                <select value={newLevel} onChange={e => setNewLevel(e.target.value as Level)} className="w-full px-3 py-2 border-2 border-pink-100 rounded-xl text-sm font-semibold bg-pink-50">
                  <option value="มต้น">ม.ต้น</option>
                  <option value="มปลาย">ม.ปลาย</option>
                </select>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อ-นามสกุล" className="w-full px-3 py-2 border-2 border-pink-100 rounded-xl text-sm" required />
                <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="ห้อง (เช่น ม.3/5)" className="w-full px-3 py-2 border-2 border-pink-100 rounded-xl text-sm" />
                <button type="submit" className="w-full py-2 rounded-xl bg-pink-500 text-white font-bold text-sm">+ เพิ่มนักเรียน</button>
              </form>

              {/* Import Excel */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-pink-600 text-sm">นำเข้าจาก Excel (คอลัมน์: ชื่อ | ระดับ | ห้อง)</p>
                  <button onClick={downloadSampleExcel}
                    className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 transition">
                    📥 ดาวน์โหลดตัวอย่าง
                  </button>
                </div>
                <input type="file" accept=".xlsx,.csv" onChange={handleImportFile} className="w-full text-sm mb-2" />
                {importPreview.length > 0 && (
                  <div className="bg-pink-50 rounded-xl p-3 mb-2 text-xs">
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
                    <p className="font-bold text-pink-700 text-sm mb-2">
                      👤 รายชื่อผู้เล่น {lv === 'มต้น' ? 'ม.ต้น' : 'ม.ปลาย'} ({lvPlayers.length} คน)
                    </p>
                    <div className="overflow-y-auto rounded-xl border border-pink-100 space-y-1.5 p-2" style={{ maxHeight: 320 }}>
                      {lvPlayers.map(p => (
                        <div key={p.id} className="flex items-center gap-2 text-sm bg-pink-50 rounded-xl px-3 py-2.5 border border-yellow-100">
                          <span className="font-black text-pink-400 w-7 text-center text-xs">#{p.number}</span>
                          {editingPlayer?.id === p.id ? (
                            <>
                              <input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 px-2 py-1 border border-pink-200 rounded-lg text-sm" />
                              <input value={editRoom} onChange={e => setEditRoom(e.target.value)} className="w-20 px-2 py-1 border border-pink-200 rounded-lg text-sm" />
                              <button onClick={saveEdit} className="px-2 py-1 bg-green-600 text-white rounded-lg text-xs font-bold">บันทึก</button>
                              <button onClick={() => setEditingPlayer(null)} className="px-2 py-1 bg-gray-300 rounded-lg text-xs">ยกเลิก</button>
                            </>
                          ) : (
                            <>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-amber-900 text-sm truncate">{p.name}</p>
                                <p className="text-pink-400 text-xs">{p.room}</p>
                              </div>
                              <button onClick={() => { setEditingPlayer(p); setEditName(p.name); setEditRoom(p.room) }} className="px-2.5 py-1.5 text-xs border border-pink-200 rounded-lg text-pink-600 hover:bg-pink-100 font-bold flex items-center gap-1">✏️ แก้ไข</button>
                              <button onClick={() => deletePlayer(p)} className="px-2 py-1.5 text-xs border border-red-200 rounded-lg text-red-400 hover:bg-red-50">🗑️</button>
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
        #print-tables { display: none; }
        @media print {
          body * { visibility: hidden; }
          #print-tables { display: block !important; visibility: visible; position: fixed; top: 0; left: 0; width: 100%; padding: 24px; }
          #print-tables * { visibility: visible; }
        }
      `}</style>

      {/* ข้อ 3: ใบปะหน้าโต๊ะ (ซ่อนไว้ แสดงเฉพาะตอนพิมพ์) */}
      <div id="print-tables">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 900 }}>🎮 การจับคู่เกมที่ {latestGame} — {level}</h2>
          <p style={{ fontSize: 13 }}>{process.env.NEXT_PUBLIC_EVENT_NAME} • {process.env.NEXT_PUBLIC_SCHOOL_NAME}</p>
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
            <div key={tn} style={{ border: '2px solid #F98B8B', borderRadius: 12, padding: 16, marginBottom: 16, breakInside: 'avoid' }}>
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
