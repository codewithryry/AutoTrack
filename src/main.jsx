import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './context/AppContext'
import { ToastProvider } from './context/ToastContext'
import { registerDeepLinks } from './services/deepLinks'
import { onNotificationTap } from './services/nativeNotifications'
import './index.css'

// Registered before React mounts, deliberately: a callback intent can arrive
// before any screen exists, and a listener attached after the fact never sees
// it. In a browser build this is a no-op.
registerDeepLinks()

// Same reasoning for a tapped notification, which can launch the app from cold.
// The router is not mounted yet, so the path is handed to the history API and
// React Router picks it up when it starts. No-op in a browser build.
onNotificationTap((url) => {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
})

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
