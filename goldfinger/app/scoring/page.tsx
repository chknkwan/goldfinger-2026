'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [maxAvailGame, setMaxAvailGame] = useState(0)
  const [game, setGame] = useState(1)
  const [userPickedGame, setUserPickedGame] = useState(false)

  // Table lookup: แยก เลข + A/B
  const [tableNum, setTableNum] = useState('')
  const [tableSide, setTableSide] = useState<'A' | 'B' | ''>('')
  const [lookupResult, setLookupResult] = useState<TableRow | null>(null)
  const [lookupMsg, setLookupMsg] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ok' | 'warn' | 'error'>('idle')
  const [existingResult, setExistingResult] = useState<GameResult | null>(null)

  const [nameA, setNameA] = useState('')
  const [nameB, setNameB] = useState('')
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')

  // Playoff
  const [pfRound, setPfRound] = useState('รองชนะเลิศ')
  const [pfPair, setPfPair] = useState('')

  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const tableNumRef = useRef<HTMLInputElement>(null)
  const scoreARef = useRef<HTMLInputElement>(null)

  const fetchLatestGame = useCallback(async () => {
    const { data } = await supabase.from('table_assignments')
      .select('game').eq('level', level).order('game', { ascending: false }).limit(1)
    const g = data?.[0]?.game || 0
    setLatestGame(g)
    setMaxAvailGame(g)
    if (g > 0 && !userPickedGame) setGame(g)
  }, [level, userPickedGame])

  useEffect(() => { if (authed) fetchLatestGame() }, [authed, fetchLatestGame])

  // Realtime broadcast
  useEffect(() => {
    if (!authed) return
    const ch = supabase.channel('broadcast-scoring')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast' }, payload => {
        const { type, level: bLevel, payload: p } = payload.new as { type: string; level: string; payload: { game?: number } }
        if (type === 'current_game' && bLevel === level) {
          setLatestGame(p.game || 0)
          setMaxAvailGame(p.game || 0)
          if (!userPickedGame) setGame(p.game || 1)
        }
        if (type === 'reset') clearForm()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [authed, level, userPickedGame])

  // Auto-lookup เมื่อมีทั้ง tableNum และ tableSide
  useEffect(() => {
    if (!tableNum || !tableSide) return
    const sub = `${tableNum}${tableSide}`
    doLookup(sub)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableNum, tableSide, game, level])

  async function doLookup(sub: string) {
    setLookupState('loading')
    setLookupMsg('กำลังค้นหา...')
    setLookupResult(null); setExistingResult(null)
    setNameA(''); setNameB('')

    const { data: ta } = await supabase.from('table_assignments')
      .select('*, player1:player1_id(*), player2:player2_id(*)')
      .eq('level', level).eq('game', game).eq('sub_table', sub)
      .single()

    if (!ta) {
      setLookupState('error')
      setLookupMsg(`ไม่พบโต๊ะ ${sub} ในเกม ${game}`)
      return
    }
    if (ta.is_bye) {
      setLookupState('warn')
      setLookupMsg('โต๊ะนี้เป็น bye — ระบบบันทึกให้อัตโนมัติแล้ว ไม่ต้องกรอก')
      return
    }

    setLookupResult(ta as TableRow)
    setNameA(`${ta.player1.name} (${ta.player1.number})`)
    setNameB(ta.player2 ? `${ta.player2.name} (${ta.player2.number})` : '')

    const { data: existing } = await supabase.from('games')
      .select('score1, score2, sub_table')
      .eq('level', level).eq('game', game).eq('sub_table', sub)
      .single()

    if (existing && existing.score1 !== null) {
      setExistingResult(existing as GameResult)
      setLookupState('warn')
      setLookupMsg(`กรอกไปแล้ว: ${existing.score1} – ${existing.score2} (กรอกใหม่เพื่อแก้ไข)`)
    } else {
      setLookupState('ok')
      setLookupMsg('พบข้อมูลคู่แข่ง')
    }

    // focus ไปที่ช่องคะแนนทันที
    setTimeout(() => scoreARef.current?.focus(), 50)
  }

  async function submitResult(e: React.FormEvent) {
    e.preventDefault()
    if (!scoreA || !scoreB) { alert('กรุณากรอกคะแนนทั้งสองฝั่ง'); return }

    if (existingResult) {
      const sub = `${tableNum}${tableSide}`
      if (!confirm(`โต๊ะ ${sub} กรอกไปแล้ว (${existingResult.score1}–${existingResult.score2})\nยืนยันแก้ไขเป็น ${scoreA}–${scoreB}?`)) return
    }

    setSubmitting(true); setStatus(null)
    const sa = Number(scoreA), sb = Number(scoreB)

    if (mode === 'qualify') {
      if (!lookupResult) { alert('กรุณาค้นหาโต๊ะก่อน'); setSubmitting(false); return }
      const sub = `${tableNum}${tableSide}`
      const res = await fetch('/api/games', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game, level, sub_table: sub,
          player1_id: lookupResult.player1.id, score1: sa,
          player2_id: lookupResult.player2?.id || null, score2: sb
        })
      })
      if (!res.ok) { const d = await res.json(); setStatus({ msg: d.error, ok: false }); setSubmitting(false); return }
      const r = computeMatchResult(sa, sb)
      const diff = Math.max(-GF_MAX_DIFF, Math.min(GF_MAX_DIFF, sa - sb))
      const winner = r.resultA === 'W' ? nameA : r.resultA === 'L' ? nameB : null
      setStatus({ msg: `✅ บันทึกโต๊ะ ${sub} — ${winner ? winner + ' ชนะ' : 'เสมอ'} (ผลต่าง ${diff > 0 ? '+' : ''}${diff})`, ok: true })
    } else {
      if (!pfPair) { alert('กรุณากรอกหมายเลขคู่'); setSubmitting(false); return }
      const { data: pf } = await supabase.from('playoffs')
        .select('*, player1:player1_id(*), player2:player2_id(*)')
        .eq('level', level).eq('round', pfRound).eq('pair_no', pfPair).single()
      if (!pf) { setStatus({ msg: 'ไม่พบคู่นี้ในเพลย์ออฟ', ok: false }); setSubmitting(false); return }
      const res = await fetch('/api/playoffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', level, round: pfRound, pair_no: pfPair, player1_id: pf.player1_id, score1: sa, player2_id: pf.player2_id, score2: sb })
      })
      if (!res.ok) { const d = await res.json(); setStatus({ msg: d.error, ok: false }); setSubmitting(false); return }
      const r = computeMatchResult(sa, sb)
      const cap = pfRound === 'ชิงชนะเลิศ' ? GF_MAX_DIFF_FINAL : GF_MAX_DIFF
      const diff = Math.max(-cap, Math.min(cap, sa - sb))
      const p1 = pf.player1 as Player; const p2 = pf.player2 as Player
      const winner = r.resultA === 'W' ? p1?.name : r.resultB === 'W' ? p2?.name : null
      setStatus({ msg: `✅ บันทึก${pfRound} คู่ ${pfPair} — ${winner ? winner + ' ชนะ' : 'เสมอ'} (ผลต่าง ${diff > 0 ? '+' : ''}${diff})`, ok: true })
    }

    clearForm()
    setSubmitting(false)
    // focus กลับที่ช่องเลขโต๊ะ
    setTimeout(() => tableNumRef.current?.focus(), 100)
  }

  function clearForm() {
    setTableNum(''); setTableSide('')
    setLookupResult(null); setLookupMsg(''); setLookupState('idle'); setExistingResult(null)
    setNameA(''); setNameB('')
    setScoreA(''); setScoreB('')
    setPfPair('')
  }

  async function lookupPlayoffPair(round: string, pair: string) {
    if (!pair) return
    const { data } = await supabase.from('playoffs')
      .select('*, player1:player1_id(*), player2:player2_id(*)')
      .eq('level', level).eq('round', round).eq('pair_no', pair).single()
    if (data) {
      setNameA((data.player1 as Player)?.name || '')
      setNameB((data.player2 as Player)?.name || '')
      if (data.score1 !== null) setScoreA(String(data.score1))
      if (data.score2 !== null) setScoreB(String(data.score2))
      setTimeout(() => scoreARef.current?.focus(), 50)
    }
  }

  if (!checked) return null
  if (!authed) return <LoginScreen onLogin={login} />

  const subTable = tableNum && tableSide ? `${tableNum}${tableSide}` : ''
  const lookupColors = {
    idle: '',
    loading: 'text-amber-600',
    ok: 'text-green-700',
    warn: 'text-orange-600',
    error: 'text-red-600',
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-4 pb-10">
      {/* Header */}
      <div className="w-full max-w-md rounded-2xl p-4 text-center text-white mb-3 shadow-lg"
        style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
        <h2 className="text-lg font-black">✍️ กรอกผลแมตช์</h2>
        <p className="text-xs text-yellow-200 mt-1">{process.env.NEXT_PUBLIC_EVENT_NAME} • {process.env.NEXT_PUBLIC_SCHOOL_NAME}</p>
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
        {[['qualify', '🎮 รอบคัดเลือก'], ['playoff', '🏆 รอบเพลย์ออฟ']].map(([m, label]) => (
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
              <label className="block text-xs font-bold text-amber-800 mb-1">🎮 เกมที่</label>
              <select value={game} onChange={e => { setGame(Number(e.target.value)); setUserPickedGame(true); clearForm() }}
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50">
                {Array.from({ length: maxAvailGame || 4 }, (_, i) => i + 1).map(g => (
                  <option key={g} value={g}>เกม {g}{latestGame === g ? ' 🟢 (ปัจจุบัน)' : ''}</option>
                ))}
              </select>
            </div>

            {/* โต๊ะย่อย: เลข + A/B */}
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-2">🪑 โต๊ะที่</label>
              <div className="flex gap-2 items-center">
                <input
                  ref={tableNumRef}
                  value={tableNum}
                  onChange={e => { setTableNum(e.target.value.replace(/\D/g, '')); setTableSide('') }}
                  placeholder="เลขโต๊ะ"
                  inputMode="numeric"
                  className="flex-1 px-3 py-3 border-2 border-yellow-200 rounded-xl text-lg font-black text-center bg-amber-50"
                />
                {(['A', 'B'] as const).map(side => (
                  <button key={side} type="button"
                    onClick={() => setTableSide(side)}
                    className={`w-14 py-3 rounded-xl text-lg font-black border-2 transition ${tableSide === side ? 'bg-amber-500 border-amber-600 text-white' : 'bg-amber-50 border-yellow-300 text-amber-800 hover:bg-amber-100'}`}>
                    {side}
                  </button>
                ))}
              </div>

              {/* lookup status */}
              {lookupMsg && (
                <div className={`flex items-center gap-2 mt-2 text-xs font-semibold ${lookupColors[lookupState]}`}>
                  {lookupState === 'loading' && <span className="animate-spin">⏳</span>}
                  {lookupState === 'ok' && <span>✅</span>}
                  {lookupState === 'warn' && <span>⚠️</span>}
                  {lookupState === 'error' && <span>❌</span>}
                  <span>{lookupMsg}</span>
                </div>
              )}
            </div>
          </>
        )}

        {mode === 'playoff' && (
          <>
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">🏆 รอบ</label>
              <select value={pfRound} onChange={e => { setPfRound(e.target.value); clearForm() }}
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50">
                <option value="รองชนะเลิศ">รองชนะเลิศ (Semi-final)</option>
                <option value="ชิงชนะเลิศ">ชิงชนะเลิศ (Final)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">🔢 คู่ที่</label>
              <input value={pfPair} onChange={e => setPfPair(e.target.value)}
                onBlur={() => lookupPlayoffPair(pfRound, pfPair)}
                placeholder="1" inputMode="numeric"
                className="w-full px-3 py-2.5 border-2 border-yellow-200 rounded-xl text-sm font-semibold bg-amber-50" />
            </div>
          </>
        )}

        {/* ผู้เล่น — แสดงเมื่อ lookup สำเร็จ */}
        {(nameA || nameB) && (
          <div className="rounded-xl bg-amber-50 border border-yellow-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-700">ผู้เล่น 1</span>
              <span className="font-black text-sm text-amber-900">{nameA}</span>
            </div>
            <div className="border-t border-yellow-100" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-700">ผู้เล่น 2</span>
              <span className="font-black text-sm text-amber-900">{nameB}</span>
            </div>
          </div>
        )}

        {/* คะแนน */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1 text-center">{nameA || 'ผู้เล่น 1'}</label>
            <input ref={scoreARef} value={scoreA} onChange={e => setScoreA(e.target.value)}
              placeholder="0" type="number" inputMode="numeric"
              className="w-full px-3 py-4 border-2 border-yellow-200 rounded-xl text-2xl font-black text-center bg-amber-50" />
          </div>
          <div>
            <label className="block text-xs font-bold text-amber-800 mb-1 text-center">{nameB || 'ผู้เล่น 2'}</label>
            <input value={scoreB} onChange={e => setScoreB(e.target.value)}
              placeholder="0" type="number" inputMode="numeric"
              className="w-full px-3 py-4 border-2 border-yellow-200 rounded-xl text-2xl font-black text-center bg-amber-50" />
          </div>
        </div>

        {/* Preview ผลต่าง */}
        {scoreA !== '' && scoreB !== '' && (() => {
          const sa = Number(scoreA), sb = Number(scoreB)
          const cap = mode === 'playoff' && pfRound === 'ชิงชนะเลิศ' ? GF_MAX_DIFF_FINAL : GF_MAX_DIFF
          const diff = Math.max(-cap, Math.min(cap, sa - sb))
          const win = sa > sb ? (nameA || 'ผู้เล่น 1') + ' ชนะ' : sa < sb ? (nameB || 'ผู้เล่น 2') + ' ชนะ' : 'เสมอ'
          const color = sa > sb ? 'bg-green-100 text-green-800' : sa < sb ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'
          return (
            <div className={`rounded-xl p-3 text-center text-sm font-bold ${color}`}>
              {win} {sa !== sb ? `(ผลต่าง ${diff > 0 ? '+' : ''}${diff})` : ''}
            </div>
          )
        })()}

        <button type="submit" disabled={submitting || (mode === 'qualify' && !lookupResult)}
          className="w-full py-4 rounded-xl font-black text-base text-white shadow-lg disabled:opacity-40 transition"
          style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
          {submitting ? '⏳ กำลังบันทึก...' : `🚀 บันทึกผล${subTable ? ` โต๊ะ ${subTable}` : ''}`}
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
