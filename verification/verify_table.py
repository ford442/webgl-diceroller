from playwright.sync_api import sync_playwright

def verify_table():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto("http://localhost:5173")
            # Wait for canvas to be present
            page.wait_for_selector("canvas")
            # Wait a bit longer for textures to load
            page.wait_for_timeout(3000)
            page.screenshot(path="verification/final_state.png")
            print("Screenshot taken: verification/final_state.png")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_table()
