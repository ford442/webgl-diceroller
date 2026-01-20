
from playwright.sync_api import sync_playwright
import time

def verify_scene():
    with sync_playwright() as p:
        # Enable unsafe swiftshader to bypass the warning/error seen in logs
        browser = p.chromium.launch(headless=True, args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page()

        try:
            page.on('console', lambda msg: print(f'Console: {msg.text}'))
            page.goto('http://localhost:5173')

            # Use a more generous timeout and wait for load event
            page.wait_for_load_state('networkidle')

            # Wait for canvas
            page.wait_for_selector('canvas', state='attached', timeout=20000)
            print('Canvas attached.')

            time.sleep(5) # Let render loop run

            page.screenshot(path='verification/scene.png')
            print('Screenshot taken: verification/scene.png')

        except Exception as e:
            print(f'Error: {e}')
        finally:
            browser.close()

if __name__ == '__main__':
    verify_scene()
