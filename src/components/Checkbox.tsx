import React from 'react'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  tone?: 'primary' | 'danger'
}

export function Checkbox({ checked, onChange, label, tone = 'primary', className, ...props }: CheckboxProps) {
  const toneClasses =
    tone === 'danger'
      ? 'border-red-300/80 checked:border-red-500 checked:bg-red-500 focus:ring-red-500/25 dark:border-red-500/35'
      : 'border-gray-300 checked:border-blue-600 checked:bg-blue-600 focus:ring-blue-500/25 dark:border-white/20 dark:checked:border-blue-500 dark:checked:bg-blue-500'

  return (
    <label className={`group flex cursor-pointer items-center gap-2 ${className || ''}`}>
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`peer h-4 w-4 cursor-pointer appearance-none rounded-[5px] border bg-[var(--surface-solid)] shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[var(--surface-solid)] ${toneClasses}`}
          {...props}
        />
        <svg
          className="pointer-events-none absolute h-2.5 w-2.5 scale-75 text-white opacity-0 transition-all duration-150 peer-checked:scale-100 peer-checked:opacity-100"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3.2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      {label && (
        <span className="text-[13px] font-medium text-[var(--text-2)] transition-colors group-hover:text-[var(--text-1)]">
          {label}
        </span>
      )}
    </label>
  )
}
