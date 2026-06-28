import Link from 'next/link'

export default function Home() {
  const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || ''
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: '#fffbeb' }}>
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">🥇</div>
        <h1 className="text-4xl font-black text-transparent bg-clip-text"
          style={{ backgroundImage: 'linear-gradient(135deg,#92400e,#d97706)', fontFamily: "'Nunito',sans-serif" }}>
          Goldfinger
        </h1>
        <p className="text-amber-400 font-semibold text-xs mt-1">Gold Finger (เกมตึกถล่ม)</p>
        {schoolName && <p className="text-amber-300 font-medium text-xs mt-0.5">{schoolName}</p>}
      </div>

      <div className="w-full max-w-sm space-y-4">
        <Link href="/display"
          className="flex items-center gap-4 p-5 bg-white rounded-3xl border-2 border-yellow-200 shadow-lg hover:shadow-xl hover:border-amber-400 active:scale-95 transition-all group">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#92400e,#d97706)' }}>
            📺
          </div>
          <div className="flex-1">
            <p className="font-black text-amber-900 text-lg leading-tight">กระดานคะแนน</p>
            <p className="text-amber-400 text-xs font-semibold mt-0.5">แสดงผลสดแบบ real-time</p>
          </div>
          <span className="text-amber-300 group-hover:text-amber-600 font-black text-xl transition">›</span>
        </Link>

        <Link href="/scoring"
          className="flex items-center gap-4 p-5 bg-white rounded-3xl border-2 border-yellow-200 shadow-lg hover:shadow-xl hover:border-amber-400 active:scale-95 transition-all group">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)' }}>
            ✍️
          </div>
          <div className="flex-1">
            <p className="font-black text-amber-900 text-lg leading-tight">กรอกคะแนน</p>
            <p className="text-amber-400 text-xs font-semibold mt-0.5">สำหรับกรรมการประจำโต๊ะ</p>
          </div>
          <span className="text-amber-300 group-hover:text-amber-600 font-black text-xl transition">›</span>
        </Link>

        <Link href="/admin"
          className="flex items-center gap-4 p-5 bg-white rounded-3xl border-2 border-yellow-200 shadow-lg hover:shadow-xl hover:border-amber-400 active:scale-95 transition-all group">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#78350f,#92400e)' }}>
            🛡️
          </div>
          <div className="flex-1">
            <p className="font-black text-amber-900 text-lg leading-tight">แผงแอดมิน</p>
            <p className="text-amber-400 text-xs font-semibold mt-0.5">จัดโต๊ะ · นำเข้าผู้เล่น · รอบชิง</p>
          </div>
          <span className="text-amber-300 group-hover:text-amber-600 font-black text-xl transition">›</span>
        </Link>
      </div>

      <div className="mt-10 text-center space-y-1">
        <p className="text-xs text-amber-400 font-semibold">🥇 Goldfinger Scoring System</p>
        <p className="text-xs text-amber-300 font-medium">พัฒนาโดย นางสาวชัญญ์คนันท์ รชตะฤทธิ์เสือ</p>
      </div>
    </div>
  )
}
