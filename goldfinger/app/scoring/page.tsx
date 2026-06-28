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
  const { authed, checked, login } = useAuth('scoring')
  const [level, setLevel] = useState<Level>('มต้น')
  const [mode, setMode] = useState<Mode>('qualify')
  const [latestGame, setLatestGame] = useState(0)
  const [maxAvailGame, setMaxAvailGame] = useState(0)
  const [game, setGame] = useState(1)
  const [userPickedGame, setUserPickedGame] = useState(false)

  const [tableNum, setTableNum] = useState('')
  const [tableSide, setTableSide] = useState<'A' | 'B' | ''>('')
  const [lookupResult, setLookupResult] = useState<TableRow | null>(null)
  const [lookupMsg, setLookupMsg] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ok' | 'warn' | 'error'>('idle')
  const [existingResult, setExistingResult] = useState<GameResult | null>(null)
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ scoreA: string; scoreB: string } | null>(null)

  const [nameA, setNameA] = useState('')
  const [nameB, setNameB] = useState('')
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')

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

  useEffect(() => {
    if (!tableNum || !tableSide) return
    doLookup(`${tableNum}${tableSide}`)
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
      setLookupMsg('✅ พบคู่แข่งโต๊ะ ' + sub)
    }

    setTimeout(() => scoreARef.current?.focus(), 50)
  }

  async function doSubmit(force = false) {
    setSubmitting(true); setStatus(null)
    const sa = Number(scoreA), sb = Number(scoreB)

    if (mode === 'qualify') {
      if (!lookupResult) { setSubmitting(false); return }
      const sub = `${tableNum}${tableSide}`
      const res = await fetch('/api/games', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game, level, sub_table: sub,
          player1_id: lookupResult.player1.id, score1: sa,
          player2_id: lookupResult.player2?.id || null, score2: sb,
          ...(force ? { force: true } : {}),
        })
      })
      if (res.status === 409 && !force) {
        setConfirmOverwrite({ scoreA, scoreB })
        setSubmitting(false)
        return
      }
      if (!res.ok) { const d = await res.json(); setStatus({ msg: d.error, ok: false }); setSubmitting(false); return }
      const r = computeMatchResult(sa, sb)
      const diff = Math.max(-GF_MAX_DIFF, Math.min(GF_MAX_DIFF, sa - sb))
      const winner = r.resultA === 'W' ? nameA : r.resultA === 'L' ? nameB : null
      setStatus({ msg: `✅ บันทึกโต๊ะ ${sub} — ${winner ? winner + ' ชนะ' : 'เสมอ'} (ผลต่าง ${diff > 0 ? '+' : ''}${diff})`, ok: true })
    } else {
      if (!pfPair) { setSubmitting(false); return }
      const { data: pf } = await supabase.from('playoffs')
        .select('*, player1:player1_id(*), player2:player2_id(*)')
        .eq('level', level).eq('round', pfRound).eq('pair_no', pfPair).single()
      if (!pf) { setStatus({ msg: 'ไม่พบคู่นี้ในเพลย์ออฟ', ok: false }); setSubmitting(false); return }
      const res = await fetch('/api/playoffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', level, round: pfRound, pair_no: pfPair, player1_id: pf.player1_id, score1: sa, player2_id: pf.player2_id, score2: sb })
      })
      if (!res.ok) { const d = await res.json(); setStatus({ msg: d.error, ok: false }); setSubmitting(false); return }
      const cap = pfRound === 'ชิงชนะเลิศ' ? GF_MAX_DIFF_FINAL : GF_MAX_DIFF
      const diff = Math.max(-cap, Math.min(cap, sa - sb))
      const r = computeMatchResult(sa, sb)
      const p1 = pf.player1 as Player; const p2 = pf.player2 as Player
      const winner = r.resultA === 'W' ? p1?.name : r.resultB === 'W' ? p2?.name : null
      setStatus({ msg: `✅ บันทึก${pfRound} คู่ ${pfPair} — ${winner ? winner + ' ชนะ' : 'เสมอ'} (ผลต่าง ${diff > 0 ? '+' : ''}${diff})`, ok: true })
    }

    clearForm()
    setSubmitting(false)
    setTimeout(() => tableNumRef.current?.focus(), 100)
  }

  async function submitResult(e: React.FormEvent) {
    e.preventDefault()
    if (!scoreA || !scoreB) { alert('กรุณากรอกคะแนนทั้งสองฝั่ง'); return }
    await doSubmit(false)
  }

  function clearForm() {
    setTableNum(''); setTableSide('')
    setLookupResult(null); setLookupMsg(''); setLookupState('idle'); setExistingResult(null)
    setNameA(''); setNameB('')
    setScoreA(''); setScoreB('')
    setPfPair('')
    setConfirmOverwrite(null)
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
  if (!authed) return <LoginScreen role="scoring" onLogin={login} />

  const subTable = tableNum && tableSide ? `${tableNum}${tableSide}` : ''
  const submitLabel = subTable && lookupState === 'ok' ? `🚀 บันทึกผล โต๊ะ ${subTable}` : mode === 'playoff' ? '🚀 บันทึกรอบเพลย์ออฟ' : '🚀 บันทึกผลแมตช์'

  const sa = Number(scoreA), sb = Number(scoreB)
  const cap = mode === 'playoff' && pfRound === 'ชิงชนะเลิศ' ? GF_MAX_DIFF_FINAL : GF_MAX_DIFF
  const diff = scoreA !== '' && scoreB !== '' ? Math.max(-cap, Math.min(cap, sa - sb)) : 0
  const win = scoreA !== '' && scoreB !== '' ? (sa > sb ? (nameA || 'ผู้เล่น 1') + ' ชนะ' : sa < sb ? (nameB || 'ผู้เล่น 2') + ' ชนะ' : 'เสมอ') : ''
  const previewColor = sa > sb ? 'bg-green-100 text-green-800 border-green-300' : sa < sb ? 'bg-red-100 text-red-800 border-red-300' : 'bg-gray-100 text-gray-700 border-gray-200'

  return (
    <div className="min-h-screen flex flex-col items-center p-4 pb-10" style={{ background: '#FEFAF2' }}>
      {/* Header */}
      <div className="w-full max-w-md rounded-3xl p-5 text-center text-white mb-4 shadow-xl"
        style={{ background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' }}>
        <div className="text-3xl mb-1">✍️</div>
        <h1 className="text-xl font-black" style={{ fontFamily: "'Nunito',sans-serif" }}>กรอกผลแมตช์</h1>
        <p className="text-yellow-200 text-xs mt-1 font-semibold">{process.env.NEXT_PUBLIC_EVENT_NAME} • {process.env.NEXT_PUBLIC_SCHOOL_NAME}</p>
      </div>

      <div className="w-full max-w-md space-y-3">
        {/* Level toggle */}
        <div className="flex bg-white rounded-2xl p-1.5 border-2 border-pink-100 shadow-sm">
          {(['มต้น', 'มปลาย'] as Level[]).map(lv => (
            <button key={lv} onClick={() => { setLevel(lv); clearForm(); setUserPickedGame(false) }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${level === lv ? 'text-white shadow' : 'text-pink-600 hover:text-pink-800'}`}
              style={level === lv ? { background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' } : {}}>
              {lv === 'มต้น' ? 'ม.ต้น' : 'ม.ปลาย'}
            </button>
          ))}
        </div>

        {/* Mode toggle */}
        <div className="flex bg-white rounded-2xl p-1.5 border-2 border-pink-100 shadow-sm">
          {([['qualify', '🎮 รอบคัดเลือก'], ['playoff', '🏆 รอบเพลย์ออฟ']] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m as Mode); clearForm() }}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${mode === m ? 'text-white shadow' : 'text-pink-600'}`}
              style={mode === m ? { background: 'linear-gradient(135deg,#A8D5D0,#c9ecea)' } : {}}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submitResult} className="bg-white rounded-3xl p-5 shadow-sm border border-pink-100 space-y-4">
          {mode === 'qualify' && (
            <>
              {/* Game pills */}
              <div>
                <label className="block text-xs font-bold text-pink-700 mb-2">🎮 เกมที่</label>
                <div className="flex gap-2 flex-wrap">
                  {Array.from({ length: maxAvailGame || 1 }, (_, i) => i + 1).map(g => (
                    <button key={g} type="button"
                      onClick={() => { setGame(g); setUserPickedGame(true); clearForm() }}
                      className={`relative flex-1 min-w-[44px] py-2.5 rounded-xl font-black text-sm border-2 transition-all active:scale-95 ${game === g ? 'text-white shadow border-pink-400' : 'bg-pink-50 border-pink-200 text-pink-600 hover:border-amber-400'}`}
                      style={game === g ? { background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' } : {}}>
                      {g}
                      {latestGame === g && (
                        <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table input */}
              <div>
                <label className="block text-xs font-bold text-pink-700 mb-2">🪑 โต๊ะ</label>
                <div className="flex gap-2 items-stretch">
                  <input
                    ref={tableNumRef}
                    value={tableNum}
                    onChange={e => { setTableNum(e.target.value.replace(/\D/g, '')); setTableSide('') }}
                    placeholder="หมายเลขโต๊ะ"
                    inputMode="numeric"
                    className="flex-1 px-3 py-3 border-2 border-pink-100 rounded-xl text-lg font-black text-center bg-pink-50 focus:outline-none focus:border-pink-400"
                  />
                  {(['A', 'B'] as const).map(side => (
                    <button key={side} type="button"
                      onClick={() => setTableSide(prev => prev === side ? '' : side)}
                      className={`w-14 rounded-xl font-black text-xl border-2 transition-all active:scale-95 ${tableSide === side ? 'text-white shadow-md border-pink-400' : 'bg-pink-50 border-pink-200 text-pink-600 hover:border-amber-500'}`}
                      style={tableSide === side ? { background: 'linear-gradient(135deg,#A8D5D0,#c9ecea)' } : {}}>
                      {side}
                    </button>
                  ))}
                </div>

                <div className="mt-2 min-h-[1.25rem]">
                  {lookupState === 'loading' && <p className="text-xs font-bold text-pink-400">⏳ กำลังค้นหา...</p>}
                  {lookupState === 'ok' && <p className="text-xs font-bold text-green-700">{lookupMsg}</p>}
                  {lookupState === 'warn' && <p className="text-xs font-bold text-orange-600">⚠️ {lookupMsg}</p>}
                  {lookupState === 'error' && <p className="text-xs font-bold text-red-600">❌ {lookupMsg}</p>}
                </div>
              </div>
            </>
          )}

          {mode === 'playoff' && (
            <>
              <div>
                <label className="block text-xs font-bold text-pink-700 mb-1">🏆 รอบ</label>
                <select value={pfRound} onChange={e => { setPfRound(e.target.value); clearForm() }}
                  className="w-full px-3 py-2.5 border-2 border-pink-100 rounded-xl text-sm font-semibold bg-pink-50 focus:outline-none focus:border-pink-400">
                  <option value="รองชนะเลิศ">รองชนะเลิศ (Semi-final)</option>
                  <option value="ชิงชนะเลิศ">ชิงชนะเลิศ (Final)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-pink-700 mb-1">🔢 คู่ที่</label>
                <input value={pfPair} onChange={e => setPfPair(e.target.value)}
                  onBlur={() => lookupPlayoffPair(pfRound, pfPair)}
                  placeholder="1" inputMode="numeric"
                  className="w-full px-3 py-2.5 border-2 border-pink-100 rounded-xl text-sm font-semibold bg-pink-50 focus:outline-none focus:border-pink-400" />
              </div>
            </>
          )}

          {/* Player cards */}
          {(nameA || nameB) && (
            <div className="flex gap-2 items-center">
              <div className="flex-1 rounded-2xl p-3 border-2 border-pink-100 bg-pink-50 text-center">
                <p className="text-[10px] font-black text-pink-400 uppercase tracking-wider mb-0.5">ฝั่ง A</p>
                <p className="font-black text-pink-800 text-sm leading-tight">{nameA || '—'}</p>
              </div>
              <div className="font-black text-pink-300 text-xl">VS</div>
              <div className="flex-1 rounded-2xl p-3 border-2 border-pink-100 bg-pink-50 text-center">
                <p className="text-[10px] font-black text-pink-400 uppercase tracking-wider mb-0.5">ฝั่ง B</p>
                <p className="font-black text-pink-800 text-sm leading-tight">{nameB || '—'}</p>
              </div>
            </div>
          )}

          {/* Score inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-pink-700 mb-1 text-center truncate">{nameA || 'ผู้เล่น A'}</label>
              <input ref={scoreARef} value={scoreA} onChange={e => setScoreA(e.target.value)}
                placeholder="0" type="number" inputMode="numeric"
                className="w-full px-3 py-4 border-2 border-pink-100 rounded-xl text-2xl font-black text-center bg-pink-50 focus:outline-none focus:border-pink-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-pink-700 mb-1 text-center truncate">{nameB || 'ผู้เล่น B'}</label>
              <input value={scoreB} onChange={e => setScoreB(e.target.value)}
                placeholder="0" type="number" inputMode="numeric"
                className="w-full px-3 py-4 border-2 border-pink-100 rounded-xl text-2xl font-black text-center bg-pink-50 focus:outline-none focus:border-pink-400" />
            </div>
          </div>

          {/* Score preview */}
          {scoreA !== '' && scoreB !== '' && (
            <div className={`rounded-xl px-4 py-2.5 text-center text-sm font-black border-2 ${previewColor}`}>
              {win} {sa !== sb ? `(ผลต่าง ${diff > 0 ? '+' : ''}${diff})` : ''}
            </div>
          )}

          {/* Confirm overwrite dialog */}
          {confirmOverwrite && (
            <div className="rounded-2xl p-4 border-2 border-pink-200 bg-pink-50 space-y-3">
              <p className="text-sm font-black text-pink-700">⚠️ โต๊ะ {subTable} เกม {game} มีผลอยู่แล้ว</p>
              <p className="text-xs text-pink-600">ผลเดิม: <strong>{existingResult?.score1} – {existingResult?.score2}</strong></p>
              <p className="text-xs text-pink-500">ต้องการเขียนทับด้วย {confirmOverwrite.scoreA} – {confirmOverwrite.scoreB} หรือไม่?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => doSubmit(true)} disabled={submitting}
                  className="flex-1 py-2 rounded-xl bg-pink-500 text-white font-bold text-sm hover:bg-amber-600 active:scale-95 transition disabled:opacity-40">
                  ✅ ยืนยันเขียนทับ
                </button>
                <button type="button" onClick={() => setConfirmOverwrite(null)}
                  className="flex-1 py-2 rounded-xl bg-white border-2 border-pink-100 text-pink-600 font-bold text-sm hover:bg-pink-50 active:scale-95 transition">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          <button type="submit" disabled={submitting || (mode === 'qualify' && lookupState !== 'ok')}
            className="w-full py-3.5 rounded-2xl font-black text-base text-white shadow-lg transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' }}>
            {submitting ? '⏳ กำลังบันทึก...' : submitLabel}
          </button>

          {status && (
            <div className={`rounded-xl px-4 py-3 border-2 font-bold text-sm ${status.ok ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'}`}>
              {status.msg}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
