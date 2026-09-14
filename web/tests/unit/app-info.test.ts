import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_VERSION, appSignature, PREDECESSOR_CITATION } from '@/app-info'

describe('app identity', () => {
  it('stamps exports with a parseable name and semantic version', () => {
    expect(appSignature()).toBe(`${APP_NAME} ${APP_VERSION}`)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('carries the arXiv identifier of the predecessor tool', () => {
    expect(PREDECESSOR_CITATION.arxiv).toBe('2111.12794')
  })
})
