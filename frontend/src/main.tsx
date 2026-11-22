import './styles/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, applyTheme } from './app/App'
import { getSettings } from './data/store'

// Aplica o tema antes do primeiro desenho (sem piscar branco no modo escuro).
applyTheme(getSettings().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
