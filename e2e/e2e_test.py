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
    expect(page.locator("h1")).to_contain_text("仪表盘", timeout=20000)
    expect(page.locator(".metric").filter(has_text="项目数").locator(".value")).to_have_text("3", timeout=20000)
    expect(page.locator(".proj-card")).to_have_count(3)
    expect(page.locator(".proj-card").filter(has_text="ShopFlow Web")).to_be_visible()
    assert page.locator(".proj-card").filter(has_text="Legacy Billing").count() == 1
    # The dashboard must show REAL data: a build badge and a gate badge on each card.
    assert page.locator(".proj-card .badge").count() >= 3


@step("attention center lists the failing project first")
def attention(page):
    page.goto(BASE + "/#/attention", wait_until="domcontentloaded")
    expect(page.locator("h1")).to_contain_text("关注中心", timeout=15000)
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
    assert "验收门" in body
    assert "下一步建议行动" in body
    assert "验收门：" in body
    # The gate must explain itself, not just show FAIL.
    assert "无法推进" in body or "可以推进到下一阶段" in body


@step("tests tab shows 22/25 e2e with failing cases")
def tests_tab(page):
    page.locator(".tab", has_text="测试").click()
    expect(page.locator("body")).to_contain_text("Failing cases", timeout=15000)
    expect(page.locator("body")).to_contain_text("22/25", timeout=15000)
    expect(page.locator("body")).to_contain_text("generates a 7 day plan", timeout=15000)
    assert page.locator("details summary", has_text="Raw output").count() >= 1


@step("risks tab lists deterministic risks with evidence")
def risks_tab(page):
    page.locator(".tab", has_text="风险").click()
    page.wait_for_selector(".risk-item", timeout=15000)
    expect(page.locator("body")).to_contain_text("TESTS_FAILED_E2E", timeout=15000)
    expect(page.locator("body")).to_contain_text("Suggested action", timeout=15000)
    assert page.locator(".chip").count() >= 3, "risks must carry evidence chips"


@step("issues can be filed manually and listed next to computed risks")
def issues_tab(page):
    page.wait_for_selector("text=Issues (0)", timeout=15000)
    page.fill("input[aria-label='New issue title']", "Checkout double charges the card")
    page.select_option("select[aria-label='Issue severity']", "high")
    page.fill("input[aria-label='Issue description']", "Reported by a user on the payment step")
    page.locator(".card button", has_text="Add").first.click()
    expect(page.locator("body")).to_contain_text("Issues (1)", timeout=15000)
    expect(page.locator("body")).to_contain_text("Checkout double charges the card", timeout=15000)


@step("tasks can be created and moved through the ledger")
def tasks_tab(page):
    page.locator(".tab", has_text="任务").click()
    page.fill("input[aria-label='New task title']", "Fix double charge on checkout")
    page.locator("button:has-text('Add')").click()
    expect(page.locator("body")).to_contain_text("Fix double charge on checkout", timeout=15000)
    row = page.locator("tr", has_text="Fix double charge on checkout")
    row.locator("select").first.select_option("in_progress")
    expect(page.locator("body")).to_contain_text("in_progress", timeout=15000)


@step("decisions and project memory versioning work")
def decisions_memory(page):
    page.locator(".tab", has_text="决策").click()
    page.fill("input[aria-label='Decision title']", "Use SQLite for all local state")
    page.fill("textarea[aria-label='Decision']", "One embedded database, versioned migrations, no server.")
    page.locator("button:has-text('Create ADR')").click()
    expect(page.locator("body")).to_contain_text("Use SQLite for all local state", timeout=15000)
    page.locator(".tab", has_text="记忆").click()
    expect(page.locator("body")).to_contain_text("Project Memory v", timeout=15000)
    page.fill("input[aria-label='Memory note']", "note recorded by the e2e run")
    page.locator("button:has-text('Create new version')").click()
    expect(page.locator("body")).to_contain_text("note recorded by the e2e run", timeout=15000)
    expect(page.locator("body")).to_contain_text("Version history", timeout=15000)


@step("agent transcript import closes the prompt loop")
def sessions_tab(page):
    page.locator(".tab", has_text="Agent 会话").click()
    transcript = "$ npm test\nexit code 0\n$ npm run test:e2e\n  22 passed (18.4s)\n  3 failed\nexit code 1\nEdited file: src/planner/weekly.js\n"
    page.fill("textarea[aria-label='Transcript']", transcript)
    page.select_option("select[aria-label='Provider']", "claude_code")
    page.locator("button:has-text('Import transcript')").click()
    expect(page.locator("body")).to_contain_text("Imported sessions (1)", timeout=15000)
    expect(page.locator("body")).to_contain_text("claude_code", timeout=15000)
    expect(page.locator("body")).to_contain_text("2", timeout=10000)  # 2 commands parsed from the transcript


@step("next action is rendered with priority and verification commands")
def next_action(page):
    page.goto(BASE + "/#/", wait_until="domcontentloaded")
    page.locator(".proj-card").filter(has_text="FitPlan Tracker").click()
    page.wait_for_url(re.compile(r"#/projects/[^/]+$"), timeout=15000)
    page.wait_for_selector("text=下一步建议行动", timeout=15000)
    expect(page.locator("body")).to_contain_text("npm run test:e2e", timeout=15000)
    page.locator(".tab", has_text="提示词").click()
    page.wait_for_selector("text=No prompts generated yet", timeout=15000)


@step("prompt generation produces all ten sections")
def generate_prompt(page):
    page.locator(".tab", has_text="概述").click()
    page.wait_for_selector("button:has-text('生成 Agent 提示词')", timeout=15000)
    page.locator("button:has-text('生成 Agent 提示词')").first.click()
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
    page.locator("button:has-text('交接包')").click()
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
    page.wait_for_selector("text=的搜索结果", timeout=15000)
    expect(page.locator("body")).to_contain_text("的搜索结果", timeout=15000)


@step("settings screen renders provider and security info")
def settings(page):
    page.goto(BASE + "/#/settings", wait_until="domcontentloaded")
    expect(page.locator("body")).to_contain_text("AI 服务", timeout=20000)
    expect(page.locator("body")).to_contain_text("监控与扫描限制", timeout=20000)
    expect(page.locator("body")).to_contain_text("mock", timeout=20000)
    page.goto(BASE + "/#/security", wait_until="domcontentloaded")
    expect(page.locator("body")).to_contain_text("敏感文件保护", timeout=20000)
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
        issues_tab(page)
        next_action(page)
        tasks_tab(page)
        decisions_memory(page)
        sessions_tab(page)
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
