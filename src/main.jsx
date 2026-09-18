import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './context/AppContext'
import { ToastProvider } from './context/ToastContext'
import { registerDeepLinks } from './services/deepLinks'
import './index.css'

// Registered before React mounts, deliberately: a callback intent can arrive
// before any screen exists, and a listener attached after the fact never sees
// it. In a browser build this is a no-op.
registerDeepLinks()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
