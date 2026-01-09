from playwright.sync_api import sync_playwright
import time
import os

def verify_fixes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console logs
        logs = []
        def handle_console(msg):
            logs.append(msg.text)
            print(f"Console: {msg.text}")

        page.on("console", handle_console)

        # Capture errors
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        print("Navigating to app...")
        page.goto("http://localhost:5173/")

        # Wait for initialization
        # We look for "All dice models loaded" which is in dice.js
        print("Waiting for dice loading...")
        max_retries = 60 # 60 seconds (since we sleep 1s)
        loaded = False

        for i in range(max_retries):
            if any("All dice models loaded" in log for log in logs):
                print("Found 'All dice models loaded' log message.")
                loaded = True
                break
            if len(errors) > 0:
                print("Errors found:", errors)
                # Don't break immediately, might be minor, but good to know.
            time.sleep(1)

        if not loaded:
            print("Timed out waiting for models to load.")

        # Always try to take a screenshot and check canvas
        # Wait a bit more for rendering to settle
        time.sleep(5)

        # Verify canvas is present and visible
        canvas = page.locator("canvas")
        if canvas.is_visible():
            print("Canvas is visible.")
        else:
            print("Canvas is NOT visible.")

        # Take screenshot
        os.makedirs("verification", exist_ok=True)
        screenshot_path = "verification/final_verification.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        if not loaded and not canvas.is_visible():
             exit(1)

        browser.close()

if __name__ == "__main__":
    verify_fixes()
