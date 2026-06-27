'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/useAuth'
import LoginScreen from '@/components/LoginScreen'
import { supabase } from '@/lib/supabase'
import { computeMatchResult, GF_MAX_DIFF, GF_MAX_DIFF_FINAL } from '@/lib/gf-logic'

type Level = 'มต้น' | 'มปลาย'
type Mode = 'qualify' | 'playoff'

interface Player { id: number; number: number; name: string; level: string; room: string }
interface TableRow { sub_table: string; player1: Player; player2: Player | null; is_bye: boolean; game: number }
interface GameResult { sub_table: string; score1: number | null; score2: number | null }

export default function ScoringPage() {
  const { authed, checked, login } = useAuth()
  const [level, setLevel] = useState<Level>('มต้น')
  const [mode, setMode] = useState<Mode>('qualify')
  const [latestGame, setLatestGame] = useState(0)
  const [game, setGame] = useState(1)
  const [userPickedGame, setUserPickedGame] = useState(false)

  const [subTable, setSubTable] = useState('')
  const [lookupResult, setLookupResult] = useState<TableRow | null>(null)
  const [lookupMsg, setLookupMsg] = useState('')
  const [existingResult, setExistingResult] = useState<GameResult | null>(null)

  const [idA, setIdA] = useState(''); const [nameA, setNameA] = useState('')
  const [idB, setIdB] = useState(''); const [nameB, setNameB] = useState('')
  const [scoreA, setScoreA] = useState(''); const [scoreB, setScoreB] = useState('')

  // Playoff
  const [pfRound, setPfRound] = useState('รองชนะเลิศ')
  const [pfPair, setPfPair] = useState('')

  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchLatestGame = useCallback(async () => {
    const { data } = await supabase.from('table_assignments').select('game').eq('level', level).order('game', { ascending: false }).limit(1)
    const g = data?.[0]?.game || 0
    setLatestGame(g)
    if (g > 0 && !userPickedGame) setGame(g)
  }, [level, userPickedGame])

  useEffect(() => { if (authed) fetchLatestGame() }, [authed, fetchLatestGame])

  // Realtime: broadcast
  useEffect(() => {
    if (!authed) return
    const ch = supabase.channel('broadcast-scoring')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast' }, payload => {
        const { type, level: bLevel, payload: p } = payload.new as { type: string; level: string; payload: { game?: number } }
        if (type === 'current_game' && bLevel === level) {
          setLatestGame(p.game || 0)
          if (!userPickedGame) setGame(p.game || 1)
        }
        if (type === 'reset') { clearForm() }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [authed, level, userPickedGame])

  async function lookupSubTable() {
    if (!subTable.trim()) return
    setLookupMsg('⏳ กำลังค้นหา...')
    setLookupResult(null); setExistingResult(null)
    setIdA(''); setNameA(''); setIdB(''); setNameB('')

    const suffix = subTable.trim().toUpperCase().slice(-1)
    const { data: ta } = await supabase.from('table_assignments')
      .select('*, player1:player1_id(*), player2:player2_id(*)')
      .eq('level', level).eq('game', game).eq('sub_table', subTable.trim().toUpperCase())
      .single()

    if (!ta) { setLookupMsg('⚠️ ไม่พบโต๊ะนี้ในเกม ' + game + ' ตรวจสอบว่าจัดโต๊ะแล้วหรือยัง'); return }
    if (ta.is_bye) { setLookupMsg('ℹ️ โต๊ะนี้เป็น bye — ระบบบันทึกคะแนนให้อัตโนมัติแล้ว ไม่ต้องกรอก'); return }

    setLookupResult(ta as TableRow)
    setIdA(String(ta.player1.number)); setNameA(ta.player1.name)
    setIdB(String(ta.player2?.number || '')); setNameB(ta.player2?.name || '')

    // เช็คว่ากรอกไปแล้วหรือยัง
    const { data: existing } = await supabase.from('games')
      .select('score1, score2, sub_table').eq('level', level).eq('game', game).eq('sub_table', subTable.trim().toUpperCase()).single()
    if (existing && existing.score1 !== null) {
      setExistingResult(existing as GameResult)
      setLookupMsg(`⚠️ โต๊ะนี้กรอกไปแล้ว: ${existing.score1} – ${existing.score2} กรอกใหม่เพื่อแก้ไข`)
    } else {
      setLookupMsg('✅ พบข้อมูลคู่แข่ง')
    }
  }

  async function submitResult(e: React.FormEvent) {
    e.preventDefault()
    if (!scoreA || !scoreB) { alert('กรุณากรอกคะแนนทั้งสองฝั่ง'); return }

    // ถ้ากรอกซ้ำ ให้ confirm ก่อน
    if (existingResult) {
      if (!confirm(`โต๊ะ ${subTable} กรอกไปแล้ว (${existingResult.score1}–${existingResult.score2})\nยืนยันแก้ไขเป็น ${scoreA}–${scoreB}?`)) return
    }

    setSubmitting(true); setStatus(null)
    const sa = Number(scoreA), sb = Number(scoreB)

    if (mode === 'qualify') {
      if (!lookupResult) { alert('กรุณาค้นหาโต๊ะก่อน'); setSubmitting(false); return }
      const res = await fetch('/api/games', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game, level,
          sub_table: subTable.trim().toUpperCase(),
          player1_id: lookupResult.player1.id, score1: sa,
          player2_id: lookupResult.player2?.id || null, score2: sb
        })
      })
      if (!res.ok) { const d = await res.json(); setStatus({ msg: d.error, ok: false }); setSubmitting(false); return }
      const r = computeMatchResult(sa, sb)
      const cap = GF_MAX_DIFF
      const diff = Math.max(-cap, Math.min(cap, sa - sb))
      setStatus({ msg: `✅ บันทึกเกม ${game} โต๊ะ ${subTable.toUpperCase()} — ${r.resultA === 'W' ? 'ผู้เล่น 1 ชนะ' : r.resultA === 'L' ? 'ผู้เล่น 2 ชนะ' : 'เสมอ'} (ผลต่าง ${diff > 0 ? '+' : ''}${diff})`, ok: true })
    } else {
      if (!pfPair) { alert('กรุณากรอกหมายเลขคู่'); setSubmitting(false); return }
      const { data: pf } = await supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)').eq('level', level).eq('round', pfRound).eq('pair_no', pfPair).single()
      if (!pf) { setStatus({ msg: 'ไม่พบคู่นี้ในเพลย์ออฟ', ok: false }); setSubmitting(false); return }
      const res = await fetch('/api/playoffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', level, round: pfRound, pair_no: pfPair, player1_id: pf.player1_id, score1: sa, player2_id: pf.player2_id, score2: sb })
      })
      if (!res.ok) { const d = await res.json(); setStatus({ msg: d.error, ok: false }); setSubmitting(false); return }
      const r = computeMatchResult(sa, sb)
      const cap = pfRound === 'ชิงชนะเลิศ' ? GF_MAX_DIFF_FINAL : GF_MAX_DIFF
      const diff = Math.max(-cap, Math.min(cap, sa - sb))
      setIdA(String(pf.player1?.number || '')); setNameA(pf.player1?.name || '')
      setIdB(String(pf.player2?.number || '')); setNameB(pf.player2?.name || '')
      setStatus({ msg: `✅ บันทึก${pfRound} คู่ ${pfPair} — ${r.resultA === 'W' ? (pf.player1?.name + ' ชนะ') : r.resultB === 'W' ? (pf.player2?.name + ' ชนะ') : 'เสมอ'} (ผลต่าง ${diff > 0 ? '+' : ''}${diff})`, ok: true })
    }
    clearForm()
    setSubmitting(false)
  }

  // Lookup รหัสนักเรียน → auto-fill ชื่อ (สำหรับ playoff ที่ต้องพิมพ์เอง)
  async function lookupPlayer(num: string, side: 'A' | 'B') {
    if (!num) return
    const { data } = await supabase.from('players').select('*').eq('level', level).eq('number', Number(num)).single()
    if (side === 'A') setNameA(data?.name || '')
    else setNameB(data?.name || '')
  }

  function clearForm() {
    setSubTable(''); setLookupResult(null); setLookupMsg(''); setExistingResult(null)
    setIdA(''); setNameA(''); setIdB(''); setNameB('')
    setScoreA(''); setScoreB('')
    setPfPair('')
  }

  // lookup สำหรับ playoff: เมื่อเลือก round+pair ให้ auto-fill
  async function lookupPlayoffPair(round: string, pair: string) {
    if (!pair) return
    const { data } = await supabase.from('playoffs').select('*, player1:player1_id(*), player2:player2_id(*)')
      .eq('level', level).eq('round', round).eq('pair_no', pair).single()
    if (data) {
      setIdA(String((data.player1 as Player)?.number || ''))
      setNameA((data.player1 as Player)?.name || '')
      setIdB(String((data.player2 as Player)?.number || ''))
      setNameB((data.player2 as Player)?.name || '')
      if (data.score1 !== null) setScoreA(String(data.score1))
      if (data.score2 !== null) setScoreB(String(data.score2))
    }
  }

  if (!checked) return null
  if (!authed) return <LoginScreen onLogin={login} />

  return (
    <div className="min-h-screen flex flex-col items-center p-4 pb-10">
      {/* Header */}
      <div className="w-full max-w-md rounded-2xl p-4 text-center text-white mb-3 shadow-lg"
        style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
        <h2 className="text-lg font-black">✍️ กรอกผลแมตช์</h2>
        <p className="text-xs text-yellow-200 mt-1">Math Week 2026 • โรงเรียนพูลเจริญวิทยาคม</p>
      </div>

      {/* Level */}
      <div className="w-full max-w-md flex bg-white rounded-2xl p-1 border-2 border-yellow-200 mb-3 shadow">
        {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
          <button key={lv} onClick={() => { setLevel(lv); clearForm(); setUserPickedGame(false) }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition ${level === lv ? 'bg-amber-500 text-white' : 'text-amber-700'}`}>
            {lv === 'มต้น' ? 'ม.ต้น' : 'ม.ปลาย'}
          </button>
        ))}
      </div>

      {/* Mode */}
      <div className="w-full max-w-md flex bg-white rounded-2xl p-1 border-2 border-yellow-200 mb-3 shadow">
        {[['qualify', 'รอบคัดเลือก'], ['playoff', 'รอบเพลย์ออฟ']].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m as Mode); clearForm() }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition ${mode === m ? 'bg-amber-500 text-white' : 'text-amber-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Current game banner */}
      {latestGame > 0 && mode === 'qualify' && (
        <div className="w-full max-w-md rounded-xl p-3 mb-3 text-center text-white font-black text-sm shadow"
          style={{ background: '#dc2626' }}>
          ⚠️ ขณะนี้อยู่ในเกมที่ {latestGame} ({level})
        </div>
      )}

      <form onSubmit={submitResult} className="w-full max-w-md bg-white rounded-2xl p-5 border border-yellow-200 shadow space-y-4">

        {mode === 'qualify' && (
          <>
            {/* เกมที่ */}
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">🎮 เกมที่:</label>
              <select value={game} onChange={e => { setGame(Number(e.target.value)); setUserPickedGame(true); clearForm() }}
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50">
                {[1, 2, 3, 4].map(g => (
                  <option key={g} value={g}>เกม {g}{latestGame === g ? ' 🟢 (ปัจจุบัน)' : ''}</option>
                ))}
              </select>
            </div>

            {/* โต๊ะย่อย */}
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">🪑 โต๊ะย่อย:</label>
              <input
                value={subTable}
                onChange={e => setSubTable(e.target.value)}
                onBlur={lookupSubTable}
                placeholder="เช่น 1A หรือ 1B"
                inputMode="text"
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50"
              />
              {lookupMsg && (
                <p className={`text-xs mt-1 font-semibold ${existingResult ? 'text-orange-600' : lookupMsg.startsWith('✅') ? 'text-green-700' : 'text-amber-700'}`}>
                  {lookupMsg}
                </p>
              )}
            </div>
          </>
        )}

        {mode === 'playoff' && (
          <>
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">🏆 รอบ:</label>
              <select value={pfRound} onChange={e => { setPfRound(e.target.value); clearForm() }}
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50">
                <option value="รองชนะเลิศ">รองชนะเลิศ (Semi-final)</option>
                <option value="ชิงชนะเลิศ">ชิงชนะเลิศ (Final)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">🔢 คู่ที่:</label>
              <input
                value={pfPair}
                onChange={e => setPfPair(e.target.value)}
                onBlur={() => lookupPlayoffPair(pfRound, pfPair)}
                placeholder="1"
                inputMode="numeric"
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50"
              />
            </div>
          </>
        )}

        <hr className="border-yellow-200" />

        {/* ผู้เล่น */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1">🆔 ผู้เล่น 1</label>
            <input value={idA} onChange={e => setIdA(e.target.value)} onBlur={() => mode === 'playoff' && lookupPlayer(idA, 'A')}
              placeholder="หมายเลข" inputMode="numeric"
              className="w-full px-3 py-2 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50" readOnly={mode === 'qualify'} />
            <p className="text-xs text-amber-700 font-bold mt-1 min-h-4">{nameA && `👤 ${nameA}`}</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1">🆔 ผู้เล่น 2</label>
            <input value={idB} onChange={e => setIdB(e.target.value)} onBlur={() => mode === 'playoff' && lookupPlayer(idB, 'B')}
              placeholder="หมายเลข" inputMode="numeric"
              className="w-full px-3 py-2 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50" readOnly={mode === 'qualify'} />
            <p className="text-xs text-amber-700 font-bold mt-1 min-h-4">{nameB && `👤 ${nameB}`}</p>
          </div>
        </div>

        {/* คะแนน */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1">🎯 คะแนน ผู้เล่น 1</label>
            <input value={scoreA} onChange={e => setScoreA(e.target.value)} placeholder="0"
              type="number" inputMode="numeric"
              className="w-full px-3 py-3 border-2 border-yellow-200 rounded-xl text-lg font-black text-center bg-amber-50" />
          </div>
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1">🎯 คะแนน ผู้เล่น 2</label>
            <input value={scoreB} onChange={e => setScoreB(e.target.value)} placeholder="0"
              type="number" inputMode="numeric"
              className="w-full px-3 py-3 border-2 border-yellow-200 rounded-xl text-lg font-black text-center bg-amber-50" />
          </div>
        </div>

        {/* Preview ผลต่าง */}
        {scoreA !== '' && scoreB !== '' && (
          <div className={`rounded-xl p-3 text-center text-sm font-bold ${Number(scoreA) > Number(scoreB) ? 'bg-green-100 text-green-800' : Number(scoreA) < Number(scoreB) ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>
            {(() => {
              const sa = Number(scoreA), sb = Number(scoreB)
              const cap = mode === 'playoff' && pfRound === 'ชิงชนะเลิศ' ? GF_MAX_DIFF_FINAL : GF_MAX_DIFF
              const diff = Math.max(-cap, Math.min(cap, sa - sb))
              if (sa > sb) return `ผู้เล่น 1 ชนะ (W) — ผลต่าง +${diff}`
              if (sa < sb) return `ผู้เล่น 2 ชนะ (W) — ผลต่าง ${diff}`
              return 'เสมอ (T) — ผลต่าง 0'
            })()}
          </div>
        )}

        <button type="submit" disabled={submitting}
          className="w-full py-4 rounded-xl font-black text-base text-white shadow-lg disabled:opacity-50 transition"
          style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
          🚀 บันทึกผลแมตช์
        </button>

        {status && (
          <div className={`rounded-xl p-3 text-center font-bold text-sm ${status.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {status.msg}
          </div>
        )}
      </form>
    </div>
  )
}
