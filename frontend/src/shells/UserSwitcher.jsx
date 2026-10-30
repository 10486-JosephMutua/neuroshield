import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import { useUser } from '../state/UserContext'

/** Native select inside a chip: accessible, keyboard friendly and uses the phone's own picker. */
export function UserSwitcher({ className = '' }) {
  const { users, user, setUserId } = useUser()
  const navigate = useNavigate()
  const onChange = (e) => {
    if (e.target.value === '__new__') navigate('/welcome')
    else setUserId(e.target.value)
  }
  const mine = users.filter((u) => !u.is_synthetic)
  const demo = users.filter((u) => u.is_synthetic)
  return (
    <label className={`relative inline-flex min-h-[48px] max-w-[190px] shrink-0 items-center gap-2 rounded-full bg-surface-container-low pl-2 pr-8 ${className}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"><Icon name="person" size={18} /></span>
      <span className="sr-only">Switch person</span>
      <select value={user?.user_id ?? ''} onChange={onChange}
        className="w-full cursor-pointer appearance-none truncate bg-transparent py-2 text-label-md text-on-surface focus:outline-none">
        {mine.length > 0 && <optgroup label="You">{mine.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</optgroup>}
        {demo.length > 0 && <optgroup label="Demo people">{demo.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</optgroup>}
        <option value="__new__">＋ Add or demo a person…</option>
      </select>
      <Icon name="expand_more" size={18} className="pointer-events-none absolute right-2 text-outline" />
    </label>
  )
}