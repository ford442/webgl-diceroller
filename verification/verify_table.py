import time
from playwright.sync_api import sync_playwright

def verify_table():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 720})

        # Capture console logs
        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173")

            # Wait a bit
            time.sleep(2)

            # Check for canvas
            if page.locator("canvas").count() > 0:
                print("Canvas found!")
                time.sleep(3)
                page.screenshot(path="verification/table_verify.png")
                print("Screenshot saved.")
            else:
                print("Canvas NOT found.")
                print("Body content:", page.content())

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_table()
