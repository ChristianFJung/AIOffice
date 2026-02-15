import { test, expect } from '@playwright/test';

test.describe('Number keys to jump to agents', () => {
  test('check console logs when pressing number keys', async ({ page }) => {
    const consoleLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    await page.goto('http://localhost:3000');
    await page.waitForTimeout(3000); // Wait for WebSocket to connect and get agents

    // Press 1
    await page.keyboard.press('1');
    await page.waitForTimeout(500);

    // Press 2
    await page.keyboard.press('2');
    await page.waitForTimeout(500);

    console.log('=== Console logs from page ===');
    consoleLogs.forEach(log => console.log(log));
    console.log('=== End console logs ===');

    // Check if our debug logs appeared
    const keyLogs = consoleLogs.filter(log => log.includes('Key pressed:'));
    console.log('Key press logs:', keyLogs);

    expect(keyLogs.length).toBeGreaterThan(0);
  });
});
