from playwright.sync_api import sync_playwright

def verify_atmosphere():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console messages
        page.on("console", lambda msg: print(f"Console: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"Page Error: {exc}"))

        try:
            page.goto("http://localhost:5173")
            # Wait for canvas to be present
            page.wait_for_selector("canvas", timeout=10000)
            # Wait a bit for the scene to load and stabilize
            page.wait_for_timeout(3000)
            page.screenshot(path="verification/atmosphere.png")
            print("Screenshot taken: verification/atmosphere.png")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_atmosphere()
