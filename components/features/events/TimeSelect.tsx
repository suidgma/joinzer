'use client'

type Props = {
  value: string        // "HH:MM" 24-hour format
  onChange: (value: string) => void
  required?: boolean
}

const HOURS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
const MINUTES = ['00', '15', '30', '45']

function parse(val: string): { hour: string; minute: string; period: 'AM' | 'PM' } {
  if (!val) return { hour: '8', minute: '00', period: 'AM' }
  const [hStr, mStr] = val.split(':')
  const h24 = parseInt(hStr, 10)
  const period = h24 >= 12 ? 'PM' : 'AM'
  const hour12 = String(h24 % 12 || 12)
  const minute = MINUTES.includes(mStr) ? mStr : '00'
  return { hour: hour12, minute, period }
}

function compose(hour: string, minute: string, period: 'AM' | 'PM'): string {
  let h = parseInt(hour, 10)
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${minute}`
}

export default function TimeSelect({ value, onChange, required }: Props) {
  const { hour, minute, period } = parse(value)

  function update(newHour: string, newMinute: string, newPeriod: 'AM' | 'PM') {
    onChange(compose(newHour, newMinute, newPeriod))
  }

  const selectClass = 'input py-2 text-sm'

  return (
    <div className="flex gap-2">
      <select
        value={hour}
        onChange={(e) => update(e.target.value, minute, period)}
        className={`flex-1 ${selectClass}`}
        required={required}
      >
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>

      <select
        value={minute}
        onChange={(e) => update(hour, e.target.value, period)}
        className={`w-20 ${selectClass}`}
      >
        {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      <select
        value={period}
        onChange={(e) => update(hour, minute, e.target.value as 'AM' | 'PM')}
        className={`w-20 ${selectClass}`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
