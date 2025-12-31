from playwright.sync_api import sync_playwright
import time

def verify_dice(page):
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"Page Error: {exc}"))

    # Go to local dev server
    page.goto("http://localhost:5173")

    # Wait a bit for things to initialize
    time.sleep(5)

    # Check for canvas
    if page.locator("canvas").count() > 0:
        print("Canvas found!")
    else:
        print("Canvas NOT found!")
        print(page.content())

    # Wait more for models
    time.sleep(5)

    # Take screenshot
    page.screenshot(path="verification/dice_check.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_dice(page)
        finally:
            browser.close()
