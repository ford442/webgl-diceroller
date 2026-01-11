
from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Navigate to the local server
        try:
            page.goto('http://localhost:5173')
            # Wait for canvas to load and rendering to start
            # Since WebGL init might take a moment
            time.sleep(5)

            # Check for canvas
            canvas = page.locator('canvas')
            if canvas.count() > 0:
                print('Canvas found')
                page.screenshot(path='verification/screenshot.png')
                print('Screenshot saved')
            else:
                print('Canvas not found')

            # Check console logs for errors
            page.on('console', lambda msg: print(f'Console log: {msg.text}'))

        except Exception as e:
            print(f'Error: {e}')

        browser.close()

if __name__ == '__main__':
    run()
