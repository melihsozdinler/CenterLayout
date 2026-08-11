/**
 * Identity of the application, referenced by the UI, by exported files and by the
 * session manifest. Keeping it in one module means an exported figure can always be
 * traced back to the exact tool version that produced it.
 */
export const APP_NAME = 'ProLiVis'
export const APP_VERSION = '2.0.0'

/** Cited as the origin of the method this tool implements. */
export const PREDECESSOR_CITATION = {
  title: 'ProLiVis: Protein-Protein Interaction Literature Visualization System',
  author: 'Melih Sozdinler',
  arxiv: '2111.12794',
  url: 'https://arxiv.org/abs/2111.12794',
} as const

/** Human-readable identifier stamped into every export and manifest. */
export function appSignature(): string {
  return `${APP_NAME} ${APP_VERSION}`
}
