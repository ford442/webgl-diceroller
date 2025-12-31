from playwright.sync_api import sync_playwright

def verify_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-swiftshader"]
        )
        page = browser.new_page()

        page.on("console", lambda msg: print(f"Console {msg.type}: {msg.text}"))

        print("Navigating...")
        page.goto("http://localhost:5173/")

        try:
            # Wait for UI input, giving enough time for dice timeout (5s) + buffer
            page.wait_for_selector("input[type='number']", timeout=20000)
            print("UI found!")
            page.screenshot(path="verification/ui_success.png")
        except Exception as e:
            print(f"Error waiting for UI: {e}")
            page.screenshot(path="verification/ui_fail.png")

        browser.close()

if __name__ == "__main__":
    verify_ui()
