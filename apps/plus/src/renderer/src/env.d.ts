/// <reference types="vite/client" />
import type { CadencePlusApi } from '@shared/ipc'

declare global {
  interface Window {
    cadencePlus: CadencePlusApi
  }
}

export {}
