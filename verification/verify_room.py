from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:5173")

        # Wait for canvas
        page.wait_for_selector("canvas")

        # Wait a bit for textures to load and scene to render
        page.wait_for_timeout(3000)

        # Take screenshot
        page.screenshot(path="verification/room_screenshot.png")
        browser.close()

if __name__ == "__main__":
    run()
