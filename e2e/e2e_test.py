"""
E2E for AI Project Commander — requirement #56.

Drives a REAL Chromium browser against a REAL server with REAL demo projects that have
been built and tested by REAL subprocesses. Covers the main path:

  open system -> dashboard -> attention center -> open project detail -> overview ->
  tests -> risks -> next action -> generate agent prompt -> search -> settings

Run via `npm run test:e2e` (which starts/stops the server for you) or directly with
E2E_BASE_URL pointing at a running instance.
"""
import os
import re
import sys
import time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8791")
ART = os.environ.get("E2E_ARTIFACTS", os.path.join(os.getcwd(), ".e2e-artifacts"))
os.makedirs(ART, exist_ok=True)

results = []


def step(name):
    def deco(fn):
        def wrapper(*a, **kw):
            t0 = time.time()
            try:
                fn(*a, **kw)
                results.append((name, "PASS", time.time() - t0, ""))
                print(f"  PASS {name} ({time.time()-t0:.1f}s)")
            except Exception as exc:  # noqa: BLE001 - we want every step reported
                results.append((name, "FAIL", time.time() - t0, (str(exc).splitlines() or ["(no message)"])[0][:200]))
                print(f"  FAIL {name}: {exc}")
                try:
                    page.screenshot(path=os.path.join(ART, f"FAIL-{name.replace(' ', '_')}.png"), full_page=True)
                except Exception:
                    pass
                raise
        return wrapper
    return deco


@step("open the dashboard and see three demo projects")
def dashboard(page):
    page.goto(BASE + "/#/", wait_until="domcontentloaded")
    expect(page.locator("h1")).to_contain_text("Dashboard", timeout=20000)
    expect(page.locator(".metric").filter(has_text="Projects").locator(".value")).to_have_text("3", timeout=20000)
    expect(page.locator(".proj-card")).to_have_count(3)
    expect(page.locator(".proj-card").filter(has_text="ShopFlow Web")).to_be_visible()
    assert page.locator(".proj-card").filter(has_text="Legacy Billing").count() == 1
    # The dashboard must show REAL data: a build badge and a gate badge on each card.
    assert page.locator(".proj-card .badge").count() >= 3


@step("attention center lists the failing project first")
def attention(page):
    page.goto(BASE + "/#/attention", wait_until="domcontentloaded")
    expect(page.locator("h1")).to_contain_text("Attention Center", timeout=15000)
    page.wait_for_selector(".risk-item", timeout=15000)
    items = page.locator(".risk-item")
    assert items.count() >= 3
    body = page.inner_text("body")
    assert "Legacy Billing" in body
    assert "build" in body.lower()


@step("project detail overview shows gate, health and next action")
def overview(page):
    page.goto(BASE + "/#/", wait_until="domcontentloaded")
    page.locator(".proj-card").filter(has_text="FitPlan Tracker").click()
    page.wait_for_url(re.compile(r"#/projects/[^/]+$"), timeout=15000)
    expect(page.locator("h1")).to_contain_text("FitPlan Tracker", timeout=15000)
    page.wait_for_selector(".metric", timeout=15000)
    body = page.inner_text("body")
    assert "Acceptance Gate" in body
    assert "Next recommended action" in body
    assert "gate:" in body.lower()
    # The gate must explain itself, not just show FAIL.
    assert "cannot advance" in body or "may advance" in body


@step("tests tab shows 22/25 e2e with failing cases")
def tests_tab(page):
    page.locator(".tab", has_text="Tests").click()
    expect(page.locator("body")).to_contain_text("Failing cases", timeout=15000)
    expect(page.locator("body")).to_contain_text("22/25", timeout=15000)
    expect(page.locator("body")).to_contain_text("generates a 7 day plan", timeout=15000)
    assert page.locator("details summary", has_text="Raw output").count() >= 1


@step("risks tab lists deterministic risks with evidence")
def risks_tab(page):
    page.locator(".tab", has_text="Risks").click()
    page.wait_for_selector(".risk-item", timeout=15000)
    expect(page.locator("body")).to_contain_text("TESTS_FAILED_E2E", timeout=15000)
    expect(page.locator("body")).to_contain_text("Suggested action", timeout=15000)
    assert page.locator(".chip").count() >= 3, "risks must carry evidence chips"


@step("next action is rendered with priority and verification commands")
def next_action(page):
    page.goto(BASE + "/#/", wait_until="domcontentloaded")
    page.locator(".proj-card").filter(has_text="FitPlan Tracker").click()
    page.wait_for_url(re.compile(r"#/projects/[^/]+$"), timeout=15000)
    page.wait_for_selector("text=Next recommended action", timeout=15000)
    expect(page.locator("body")).to_contain_text("npm run test:e2e", timeout=15000)
    page.locator(".tab", has_text="Prompts").click()
    page.wait_for_selector("text=No prompts generated yet", timeout=15000)


@step("prompt generation produces all ten sections")
def generate_prompt(page):
    page.locator(".tab", has_text="Overview").click()
    page.wait_for_selector("button:has-text('Generate agent prompt')", timeout=15000)
    page.locator("button:has-text('Generate agent prompt')").first.click()
    page.wait_for_selector(".modal", timeout=30000)
    for section in ["PROJECT CONTEXT", "CURRENT STATE", "OBJECTIVE", "RELEVANT FILES",
                    "KNOWN FAILURES", "CONSTRAINTS", "DO NOT BREAK",
                    "ACCEPTANCE CRITERIA", "VERIFICATION COMMANDS", "COMPLETION REQUIREMENTS"]:
        expect(page.locator(".modal")).to_contain_text(section, timeout=15000), f"missing {section}"
    expect(page.locator(".modal")).to_contain_text("provider: mock", timeout=10000), "mock provider must be labelled"
    page.screenshot(path=os.path.join(ART, "prompt-modal.png"), full_page=False)
    page.locator(".modal button", has_text="Close").click()
    page.wait_for_selector(".modal", state="detached", timeout=10000)


@step("handoff package opens with all sections")
def handoff(page):
    page.locator("button:has-text('Handoff')").click()
    page.wait_for_selector(".modal", timeout=30000)
    for section in ["Project Summary", "Architecture", "Current Stage", "Known Issues", "Next Action", "Verification"]:
        expect(page.locator(".modal")).to_contain_text(section, timeout=15000)
    page.screenshot(path=os.path.join(ART, "handoff.png"), full_page=False)
    page.locator(".modal button", has_text="Close").click()


@step("search finds indexed content")
def search(page):
    page.goto(BASE + "/#/search", wait_until="domcontentloaded")
    page.fill("input[aria-label='Search query']", "checkout")
    page.keyboard.press("Enter")
    page.wait_for_selector("text=Results for", timeout=15000)
    expect(page.locator("body")).to_contain_text("Results for", timeout=15000)


@step("settings screen renders provider and security info")
def settings(page):
    page.goto(BASE + "/#/settings", wait_until="domcontentloaded")
    expect(page.locator("body")).to_contain_text("AI Provider", timeout=20000)
    expect(page.locator("body")).to_contain_text("Watcher & Scan Limits", timeout=20000)
    expect(page.locator("body")).to_contain_text("mock", timeout=20000)
    page.goto(BASE + "/#/security", wait_until="domcontentloaded")
    expect(page.locator("body")).to_contain_text("Sensitive file protection", timeout=20000)
    expect(page.locator("body")).to_contain_text("never read, stored, logged", timeout=20000)


@step("keyboard navigation works")
def a11y(page):
    page.goto(BASE + "/#/", wait_until="domcontentloaded")
    page.wait_for_selector(".proj-card", timeout=20000)
    for _ in range(4):
        page.keyboard.press("/")
        try:
            page.wait_for_url(re.compile(r"#/search"), timeout=2500)
            break
        except Exception:
            page.locator("body").focus()
    expect(page.locator("input[aria-label='Search query']")).to_be_focused(timeout=10000)
    # every project card is keyboard reachable
    page.goto(BASE + "/#/", wait_until="domcontentloaded")
    page.wait_for_selector(".proj-card", timeout=15000)
    page.locator(".proj-card").first.focus()
    page.keyboard.press("Enter")
    page.wait_for_url(re.compile(r"#/projects/.+"), timeout=10000)


def main():
    failures = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        page.set_default_timeout(20000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text else None)

        dashboard(page)
        attention(page)
        overview(page)
        tests_tab(page)
        risks_tab(page)
        next_action(page)
        generate_prompt(page)
        handoff(page)
        search(page)
        settings(page)
        a11y(page)

        page.screenshot(path=os.path.join(ART, "final-dashboard.png"), full_page=True)
        browser.close()

        real_errors = [e for e in errors if "favicon" not in e and "404" not in e]
        if real_errors:
            results.append(("no console/page errors", "FAIL", 0, "; ".join(real_errors[:3])))
        else:
            results.append(("no console/page errors", "PASS", 0, ""))

    print("\n  E2E RESULTS")
    print("  ───────────")
    for name, status, dur, err in results:
        print(f"  {status}  {name}" + (f"  ({dur:.1f}s)" if dur else "") + (f"\n        {err}" if err else ""))
    failures = sum(1 for r in results if r[1] == "FAIL")
    print(f"\n  {len(results) - failures}/{len(results)} steps passed")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
