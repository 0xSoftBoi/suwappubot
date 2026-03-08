interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchInput({ value, onChange, placeholder = 'Filter...' }: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="px-3 py-2 text-sm bg-white dark:bg-dark-bg border border-suwappu-sakura-light/30 dark:border-dark-border rounded-suwappu-md focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30 placeholder:text-suwappu-text-secondary/50 dark:placeholder:text-gray-500 w-full max-w-xs"
    />
  )
}
