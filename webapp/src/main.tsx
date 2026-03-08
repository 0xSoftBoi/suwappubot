import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// QueryClient is created in App.tsx to keep provider hierarchy clean

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
