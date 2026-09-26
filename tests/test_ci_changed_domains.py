from scripts.ci_changed_domains import DOMAINS, domains_for_paths


def test_docs_only_change_runs_only_docs_lane():
    domains = domains_for_paths(["docs/deployment/railway.md"])

    assert domains["docs"] is True
    assert [name for name, selected in domains.items() if selected] == ["docs"]


def test_api_change_selects_python_and_showcase_stats():
    domains = domains_for_paths(["bot/config/chains.py"])

    assert domains["python"] is True
    assert domains["showcase"] is True
    assert domains["mobile"] is False


def test_design_tokens_select_every_visual_consumer():
    domains = domains_for_paths(["packages/design-tokens/src/tokens.ts"])

    assert domains["terminal"] is True
    assert domains["mobile"] is True
    assert domains["showcase"] is True
    assert domains["webapp"] is True


def test_dependency_file_selects_package_and_dependency_lanes():
    domains = domains_for_paths(["api-ts/package.json"])

    assert domains["api_ts"] is True
    assert domains["dependencies"] is True


def test_workflow_change_runs_every_lane():
    domains = domains_for_paths([".github/workflows/test.yml"])

    assert all(domains.values())
    assert set(domains) == set(DOMAINS)


def test_force_all_runs_every_lane_without_paths():
    assert all(domains_for_paths([], force_all=True).values())
