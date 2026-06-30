// ============================================================
//  Goldfinger — กติกาและการคำนวณ (port จาก Google Apps Script)
// ============================================================

export const GF_LEVELS = ['มต้น', 'มปลาย'] as const
export type Level = typeof GF_LEVELS[number]
export const GF_BYE_SCORE = 20
export const GF_MAX_DIFF = 50
export const GF_MAX_DIFF_FINAL = 40

export interface Player {
  id: number
  number: number
  name: string
  level: Level
  room: string
}

export interface GameRow {
  id: number
  game: number
  level: string
  table_num: number
  sub_table: string
  player1_id: number
  score1: number | null
  player2_id: number | null
  score2: number | null
}

export interface TablePair {
  player1: Player
  player2: Player | null  // null = bye
}

export interface TableEntry {
  table_num: number
  sub_table: string
  pairA: TablePair
  pairB: TablePair | null
}

export interface Standing {
  player: Player
  rank: number
  points: number
  diffSum: number
  rawDiffSum: number
  w: number
  t: number
  l: number
  gamesPlayed: number
}

// ============================================================
//  คำนวณผล W/T/L และผลต่าง
// ============================================================
export function computeMatchResult(
  scoreA: number | null,
  scoreB: number | null,
  maxDiff = GF_MAX_DIFF
) {
  const a = scoreA ?? 0
  const b = scoreB ?? 0
  const resultA = a > b ? 'W' : a < b ? 'L' : 'T'
  const resultB = a > b ? 'L' : a < b ? 'W' : 'T'
  const raw = a - b
  const clamped = Math.max(-maxDiff, Math.min(maxDiff, raw))
  return { resultA, resultB, diffA: clamped, diffB: -clamped, rawA: raw, rawB: -raw }
}

// ============================================================
//  คำนวณตารางอันดับ
// ============================================================
export function computeStandings(players: Player[], gameRows: GameRow[]): Standing[] {
  const stat: Record<number, Standing & { opponents: number[] }> = {}
  players.forEach(p => {
    stat[p.id] = {
      player: p, rank: 0, points: 0, diffSum: 0, rawDiffSum: 0,
      w: 0, t: 0, l: 0, gamesPlayed: 0, opponents: []
    }
  })

  for (const g of gameRows) {
    if (!g.player1_id) continue
    // bye
    if (!g.player2_id) {
      const s = stat[g.player1_id]
      if (!s) continue
      const byeDiff = g.score1 ?? 0
      s.diffSum += byeDiff; s.rawDiffSum += byeDiff
      s.gamesPlayed++; s.w++; s.points += 2
      s.opponents.push(-1)
      continue
    }
    const r = computeMatchResult(g.score1, g.score2)
    const raw1 = (g.score1 ?? 0) - (g.score2 ?? 0)
    const raw2 = -raw1
    const s1 = stat[g.player1_id], s2 = stat[g.player2_id]
    if (s1) {
      s1.diffSum += r.diffA; s1.rawDiffSum += raw1; s1.gamesPlayed++
      s1.opponents.push(g.player2_id)
      if (r.resultA === 'W') { s1.w++; s1.points += 2 }
      else if (r.resultA === 'T') { s1.t++; s1.points += 1 }
      else s1.l++
    }
    if (s2) {
      s2.diffSum += r.diffB; s2.rawDiffSum += raw2; s2.gamesPlayed++
      s2.opponents.push(g.player1_id)
      if (r.resultB === 'W') { s2.w++; s2.points += 2 }
      else if (r.resultB === 'T') { s2.t++; s2.points += 1 }
      else s2.l++
    }
  }

  const list = Object.values(stat)
  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.diffSum !== a.diffSum) return b.diffSum - a.diffSum
    return b.rawDiffSum - a.rawDiffSum
  })
  list.forEach((s, i) => { s.rank = i + 1 })
  return list
}

// ============================================================
//  สุ่ม array
// ============================================================
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ============================================================
//  แบ่งผู้เล่นเป็นโต๊ะ (โต๊ะละ 4 คน = 2 คู่ A/B)
// ============================================================
export interface TableDef {
  table_num: number
  pairA: { p1: Player; p2: Player } | null
  pairB: { p1: Player; p2: Player } | null
  byeA: Player | null   // ทั้งโต๊ะ bye
  byeB: Player | null   // ฝั่ง B bye
}

export function splitIntoTables(players: Player[]): TableDef[] {
  const tables: TableDef[] = []
  let t = 1
  for (let i = 0; i < players.length; i += 4) {
    const g = players.slice(i, i + 4)
    if (g.length === 4) {
      tables.push({ table_num: t, pairA: { p1: g[0], p2: g[1] }, pairB: { p1: g[2], p2: g[3] }, byeA: null, byeB: null })
    } else if (g.length === 3) {
      tables.push({ table_num: t, pairA: { p1: g[0], p2: g[1] }, pairB: null, byeA: null, byeB: g[2] })
    } else if (g.length === 2) {
      tables.push({ table_num: t, pairA: { p1: g[0], p2: g[1] }, pairB: null, byeA: null, byeB: null })
    } else {
      tables.push({ table_num: t, pairA: null, pairB: null, byeA: g[0], byeB: null })
    }
    t++
  }
  return tables
}

// ============================================================
//  เกม 1: สุ่ม
// ============================================================
export function generateGame1(players: Player[]): TableDef[] {
  return splitIntoTables(shuffle(players))
}

// ============================================================
//  เกม 2/4: ไขว้ในโต๊ะเดิม
// ============================================================
export function generateCrossover(
  prevTables: TableDef[],
  prevGames: GameRow[],
  playerMap: Record<number, Player>
): TableDef[] {
  return prevTables.map(t => {
    if (t.byeA) return { ...t }
    if (!t.pairB && t.byeB) return { ...t }
    if (!t.pairB) return { ...t } // คู่เดี่ยว รีแมตช์

    const gA = prevGames.find(g => g.table_num === t.table_num && g.sub_table.endsWith('A'))
    const gB = prevGames.find(g => g.table_num === t.table_num && g.sub_table.endsWith('B'))

    function getWinLose(g: GameRow | undefined, def1: Player, def2: Player) {
      if (!g) return { winner: def1, loser: def2 }
      const r = computeMatchResult(g.score1, g.score2)
      if (r.resultA === 'W') return { winner: playerMap[g.player1_id], loser: playerMap[g.player2_id!] }
      if (r.resultB === 'W') return { winner: playerMap[g.player2_id!], loser: playerMap[g.player1_id] }
      return { winner: def1, loser: def2 }
    }

    const { winner: wA, loser: lA } = getWinLose(gA, t.pairA!.p1, t.pairA!.p2)
    const { winner: wB, loser: lB } = getWinLose(gB, t.pairB!.p1, t.pairB!.p2)

    return {
      table_num: t.table_num,
      pairA: { p1: wA, p2: wB },
      pairB: { p1: lA, p2: lB },
      byeA: null, byeB: null
    }
  })
}

// ============================================================
//  เกม 3: Swiss
// ============================================================
export function generateSwiss(standings: Standing[]): TableDef[] {
  const ordered = [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.diffSum !== a.diffSum) return b.diffSum - a.diffSum
    return b.rawDiffSum - a.rawDiffSum
  })
  // สุ่มในกลุ่มที่เท่ากันทั้งหมด
  const groups: Standing[][] = []
  let i = 0
  while (i < ordered.length) {
    let j = i + 1
    while (j < ordered.length &&
      ordered[j].points === ordered[i].points &&
      ordered[j].diffSum === ordered[i].diffSum &&
      ordered[j].rawDiffSum === ordered[i].rawDiffSum) j++
    groups.push(ordered.slice(i, j))
    i = j
  }
  const players = groups.flatMap(g => shuffle(g).map(s => s.player))
  return splitIntoTables(players)
}

// ============================================================
//  Swiss + Gibsonize (เกมสุดท้าย)
//  gibsonIds = Set ของ player.id ที่ล็อคอันดับแน่แล้ว
//  → กระจาย Gibson players ไว้คนละโต๊ะ ไม่จับคู่กันเอง
// ============================================================
export function generateSwissWithGibson(standings: Standing[], gibsonIds: Set<number>): TableDef[] {
  if (gibsonIds.size === 0) return generateSwiss(standings)

  const ordered = [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.diffSum !== a.diffSum) return b.diffSum - a.diffSum
    return b.rawDiffSum - a.rawDiffSum
  })
  // shuffle within tied groups
  const groups: Standing[][] = []
  let i = 0
  while (i < ordered.length) {
    let j = i + 1
    while (j < ordered.length &&
      ordered[j].points === ordered[i].points &&
      ordered[j].diffSum === ordered[i].diffSum &&
      ordered[j].rawDiffSum === ordered[i].rawDiffSum) j++
    groups.push(ordered.slice(i, j))
    i = j
  }
  const swissOrder = groups.flatMap(g => shuffle(g).map(s => s.player))

  const gibson = swissOrder.filter(p => gibsonIds.has(p.id))
  const normal = swissOrder.filter(p => !gibsonIds.has(p.id))

  // splitIntoTables จับคู่ตามตำแหน่งติดกัน: (0,1)=คู่ A, (2,3)=คู่ B, (4,5)=โต๊ะถัดไป...
  // วาง Gibson ไว้ตำแหน่ง "หัวคู่" (i%4===0 หรือ i%4===2) เพื่อให้คู่ของเขาเป็น normal เสมอ
  // → Gibson สองคนจะไม่อยู่คู่เดียวกัน (จนกว่าจะ gibson เกินครึ่งสนามซึ่งเลี่ยงไม่ได้)
  const total = swissOrder.length
  const result: (Player | undefined)[] = new Array(total)
  const prefPos: number[] = []   // หัวคู่
  const fillPos: number[] = []   // ตำแหน่งคู่ของหัวคู่
  for (let i = 0; i < total; i++) {
    if (i % 4 === 0 || i % 4 === 2) prefPos.push(i)
    else fillPos.push(i)
  }

  let gi = 0, ni = 0
  for (const pos of prefPos) { if (gi < gibson.length) result[pos] = gibson[gi++] }
  for (const pos of fillPos) { if (ni < normal.length) result[pos] = normal[ni++] }
  // เติมช่องที่ยังว่างด้วยที่เหลือ (normal ก่อน แล้วค่อย gibson ที่ล้น)
  const leftovers = [...normal.slice(ni), ...gibson.slice(gi)]
  let li = 0
  for (let i = 0; i < total; i++) { if (result[i] === undefined) result[i] = leftovers[li++] }

  return splitIntoTables(result as Player[])
}

// ============================================================
//  แนะนำ Gibsonize อัตโนมัติ
//  ผู้เล่นที่ล็อคอันดับแน่ถ้า gap > 2 (max pts/game) กับคนถัดไป
// ============================================================
export function suggestGibsonize(standings: Standing[]): Standing[] {
  const maxGainPerGame = 2
  return standings.filter((s, idx) => {
    if (idx === standings.length - 1) return false
    const next = standings[idx + 1]
    return s.points - next.points > maxGainPerGame
  })
}
