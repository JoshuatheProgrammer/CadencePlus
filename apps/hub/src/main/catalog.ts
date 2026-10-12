/** The apps Cadence Hub manages. */

export type AppId = 'plus' | 'video'

export interface CatalogApp {
  id: AppId
  name: string
  tagline: string
  description: string
  /** Release tag prefix in the suite repository. */
  prefix: string
  /** Name the installer registers with Windows (uninstall entry). */
  productName: string
  exe: string
}

export const CATALOG: CatalogApp[] = [
  {
    id: 'plus',
    name: 'Cadence+',
    tagline: 'Precision imaging for creators.',
    description: 'Photo editing, retouching and compositing — layers, masks, layer styles, 16-bit and wide-gamut colour, camera RAW and Photoshop files.',
    prefix: 'plus-v',
    productName: 'Cadence+',
    exe: 'CadencePlus.exe'
  },
  {
    id: 'video',
    name: 'Cadence Video',
    tagline: 'Professional video editing.',
    description: 'Non-linear video editing — multi-track timeline, keyframes and transitions, colour grading with scopes, and an audio mixer.',
    prefix: 'video-v',
    productName: 'Cadence Video',
    exe: 'CadenceVideo.exe'
  }
]

export const appById = (id: string): CatalogApp | undefined => CATALOG.find((a) => a.id === id)
