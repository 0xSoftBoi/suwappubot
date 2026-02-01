import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  isVisible: boolean
  duration?: number
  onClose?: () => void
  type?: 'success' | 'error' | 'info'
}

const icons = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
}

const colors = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
}

export function Toast({ 
  message, 
  isVisible, 
  duration = 2000, 
  onClose,
  type = 'success' 
}: ToastProps) {
  useEffect(() => {
    if (isVisible && onClose) {
      const timer = setTimeout(onClose, duration)
      return () => clearTimeout(timer)
    }
  }, [isVisible, duration, onClose])

  return (
    <>
      {isVisible && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 animate-toast-enter">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg ${colors[type]} text-white`}>
            <span className="text-sm font-bold">{icons[type]}</span>
            <span className="text-sm font-medium whitespace-nowrap">{message}</span>
          </div>
        </div>
      )}
    </>
  )
}

// Hook for easy toast management
export function useToast() {
  const [toast, setToast] = useState<{
    message: string
    type: 'success' | 'error' | 'info'
    isVisible: boolean
  }>({
    message: '',
    type: 'success',
    isVisible: false,
  })

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type, isVisible: true })
  }

  const hideToast = () => {
    setToast(prev => ({ ...prev, isVisible: false }))
  }

  return { toast, showToast, hideToast }
}

export default Toast
