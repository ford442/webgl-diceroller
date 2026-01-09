
from playwright.sync_api import sync_playwright
import time

def verify_clutter():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        page.goto("http://localhost:5173")

        # Wait for canvas to be present
        page.wait_for_selector("canvas")

        # Give some time for 3D scene to load and physics to settle
        time.sleep(5)

        # Take a screenshot
        screenshot_path = "verification/clutter_verification.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_clutter()
