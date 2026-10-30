import type { Me } from '../api/client'

/** 头像 + 昵称，点一下回个人中心；没有登录态就不显示 */
export function UserChip({ me, plain = false }: { me: Me | null; plain?: boolean }) {
  if (!me) return null
  const display = me.name?.trim() || me.email.split('@')[0] || me.email
  const chrome = plain
    ? 'hover:opacity-80'
    : 'rounded-[10px] bg-white/88 py-5 pr-12 pl-5 shadow-[0_1px_2px_rgba(0,0,0,.08),0_8px_24px_rgba(0,0,0,.1)] backdrop-blur-[20px] backdrop-saturate-[160%] hover:bg-white'
  return (
    <a
      href="/"
      title={`${display} · ${me.email} · 个人中心`}
      className={`flex items-center gap-8 text-inherit no-underline ${chrome}`}
    >
      {me.picture ? (
        <img
          src={me.picture}
          alt=""
          referrerPolicy="no-referrer"
          className="h-24 w-24 rounded-full object-cover"
        />
      ) : (
        <span className="grid h-24 w-24 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">
          {display.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="max-w-[140px] truncate text-[12.5px]">{display}</span>
    </a>
  )
}
