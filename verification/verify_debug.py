from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        page.goto("http://localhost:5173")

        try:
            page.wait_for_timeout(5000)
            content = page.content()
            if "<canvas" in content:
                print("Canvas detected in HTML.")
            else:
                print("No canvas found in HTML.")
                print("Body content:", page.inner_html("body"))
        except Exception as e:
            print(f"Error: {e}")

        page.screenshot(path="verification/dice_screenshot.png")
        print("Screenshot taken.")
        browser.close()

if __name__ == "__main__":
    run()
