from playwright.sync_api import Page, expect, sync_playwright
import time

def test_dice_app_load(page: Page):
    print("Navigating to app...")
    page.goto("http://localhost:5173")

    print("Waiting for UI to appear...")
    # The UI is added dynamically in src/main.js -> src/ui.js
    # We look for the "Roll All" button
    roll_btn = page.get_by_text("Roll All")
    expect(roll_btn).to_be_visible(timeout=10000)

    # Wait a bit for the 3D scene to initialize (though we can't easily assert on canvas content)
    time.sleep(2)

    print("Taking screenshot...")
    page.screenshot(path="verification/app_loaded.png")
    print("Verification complete.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_dice_app_load(page)
        except Exception as e:
            print(f"Test failed: {e}")
            page.screenshot(path="verification/error.png")
            raise
        finally:
            browser.close()
