from playwright.sync_api import sync_playwright
import time

def verify_table():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Go to local vite server
            page.goto("http://localhost:5173")

            # Wait for any canvas, ignoring visible check for a moment if it's tricky, but usually visible is fine.
            # The previous error said "locator resolved to visible <canvas ...>" but also "Timeout 10000ms exceeded".
            # This is contradictory or means it flickered.

            # Let's try to just sleep a bit and grab it.
            time.sleep(5)

            # Take screenshot
            page.screenshot(path="verification/table_screenshot.png")
            print("Screenshot saved to verification/table_screenshot.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_table()
