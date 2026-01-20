from playwright.sync_api import sync_playwright
import time

def verify_candle():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173/")

            # Wait for canvas to be present
            page.wait_for_selector("canvas")

            # Wait a bit for models to load and render
            print("Waiting for scene to load...")
            time.sleep(5)

            # Take screenshot
            print("Taking screenshot...")
            page.screenshot(path="verification/candle_verify.png")
            print("Screenshot saved to verification/candle_verify.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_candle()
