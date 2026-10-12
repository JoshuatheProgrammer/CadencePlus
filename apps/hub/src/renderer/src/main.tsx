import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@cadence/ui/base.css'
import './hub.css'

createRoot(document.getElementById('root')!).render(<App />)
