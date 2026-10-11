import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import '@cadence/ui/base.css'
import './ui/theme.css'

createRoot(document.getElementById('root')!).render(<App />)
