import Link from 'next/link'

export default function Home() {
  const schoolName = process.env.NEXT_PUBLIC_SCHOOL_NAME || ''
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: '#FEFAF2' }}>
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">🏅</div>
        <h1 className="text-4xl font-black text-transparent bg-clip-text"
          style={{ backgroundImage: 'linear-gradient(135deg,#A8D5D0,#F98B8B)', fontFamily: "'Nunito',sans-serif" }}>
          Gold Finger <span className="text-2xl">(เกมตึกถล่ม)</span>
        </h1>
        {schoolName && <p className="text-teal-400 font-semibold text-sm mt-0.5">{schoolName}</p>}
      </div>

      <div className="w-full max-w-sm space-y-4">
        <Link href="/display"
          className="flex items-center gap-4 p-5 bg-white rounded-3xl border-2 border-teal-100 shadow-lg hover:shadow-xl hover:border-teal-300 active:scale-95 transition-all group">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#A8D5D0,#c9ecea)' }}>
            📺
          </div>
          <div className="flex-1">
            <p className="font-black text-teal-700 text-lg leading-tight">กระดานคะแนน</p>
            <p className="text-teal-300 text-xs font-semibold mt-0.5">แสดงผลสดแบบ real-time</p>
          </div>
          <span className="text-teal-200 group-hover:text-teal-400 font-black text-xl transition">›</span>
        </Link>

        <Link href="/scoring"
          className="flex items-center gap-4 p-5 bg-white rounded-3xl border-2 border-teal-100 shadow-lg hover:shadow-xl hover:border-pink-300 active:scale-95 transition-all group">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#F98B8B,#FDBBBB)' }}>
            ✍️
          </div>
          <div className="flex-1">
            <p className="font-black text-pink-700 text-lg leading-tight">กรอกคะแนน</p>
            <p className="text-pink-300 text-xs font-semibold mt-0.5">สำหรับกรรมการประจำโต๊ะ</p>
          </div>
          <span className="text-pink-200 group-hover:text-pink-400 font-black text-xl transition">›</span>
        </Link>

        <Link href="/admin"
          className="flex items-center gap-4 p-5 bg-white rounded-3xl border-2 border-teal-100 shadow-lg hover:shadow-xl hover:border-teal-300 active:scale-95 transition-all group">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#A8D5D0,#c9ecea)' }}>
            🛡️
          </div>
          <div className="flex-1">
            <p className="font-black text-teal-700 text-lg leading-tight">แผงแอดมิน</p>
            <p className="text-teal-300 text-xs font-semibold mt-0.5">จัดโต๊ะ · นำเข้าผู้เล่น · รอบชิง</p>
          </div>
          <span className="text-teal-200 group-hover:text-teal-400 font-black text-xl transition">›</span>
        </Link>
      </div>

      <div className="mt-10 text-center space-y-1">
        <p className="text-xs text-teal-300 font-semibold">🏅 Gold Finger Scoring System</p>
        <p className="text-xs text-teal-200 font-medium">พัฒนาโดย นางสาวชัญญ์คนันท์ รชตะฤทธิ์เสือ</p>
      </div>
    </div>
  )
}
