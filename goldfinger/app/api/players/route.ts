import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get('level')
  let q = supabase.from('players').select('*').order('number')
  if (level) q = q.eq('level', level)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, level, room } = body

  // หาเลขที่ถัดไปของระดับนั้น
  const { data: existing } = await supabase
    .from('players').select('number').eq('level', level).order('number', { ascending: false }).limit(1)
  const nextNumber = existing && existing.length > 0 ? existing[0].number + 1 : 1

  const { data, error } = await supabase.from('players')
    .insert({ number: nextNumber, name, level, room: room || '' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, name, room } = body
  const { data, error } = await supabase.from('players')
    .update({ name, room: room || '' }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const { error } = await supabase.from('players').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
