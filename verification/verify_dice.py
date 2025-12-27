from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Capture console messages
        page.on("console", lambda msg: print(f"Console: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PageError: {exc}"))

        # Navigate to the local server
        page.goto("http://localhost:5173")

        # Wait for the canvas to appear (give it time to load models and physics)
        try:
            print("Waiting for canvas...")
            page.wait_for_selector("canvas", timeout=30000)
            print("Canvas found.")
            # Wait a bit for render loop to run
            page.wait_for_timeout(5000)
        except Exception as e:
            print(f"Error waiting for canvas: {e}")

        # Take a screenshot
        page.screenshot(path="verification/dice_screenshot.png")
        print("Screenshot taken at verification/dice_screenshot.png")
        browser.close()

if __name__ == "__main__":
    run()
