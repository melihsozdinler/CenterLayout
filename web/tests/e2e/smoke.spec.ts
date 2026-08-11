import { expect, test } from '@playwright/test'

test('app shell loads without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto('/')

  await expect(page.getByRole('banner')).toContainText('ProLiVis')
  await expect(page.getByRole('complementary', { name: /datasets/i })).toBeVisible()
  await expect(page.getByRole('main', { name: /visualization/i })).toBeVisible()

  expect(errors).toEqual([])
})
