from playwright.sync_api import sync_playwright, expect

def test_debug_overlay():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Go to the local dev server
            page.goto("http://localhost:5173")

            # Wait for the debug overlay to appear
            overlay = page.locator("#debug-log-overlay")
            expect(overlay).to_be_visible(timeout=5000)

            # Take a screenshot
            page.screenshot(path="verification/debug_overlay.png")

            # Get the text content of the overlay
            print(overlay.inner_text())

        finally:
            browser.close()

if __name__ == "__main__":
    test_debug_overlay()
