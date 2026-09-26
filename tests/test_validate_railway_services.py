import copy
import json
from pathlib import Path

from scripts.validate_railway_services import validate_manifest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _manifest():
    return json.loads((REPO_ROOT / "railway.services.json").read_text())


def test_committed_railway_service_policy_is_valid():
    assert validate_manifest(_manifest(), REPO_ROOT) == []


def test_persistent_service_cannot_track_feature_branch():
    manifest = _manifest()
    candidate = next(
        instance
        for instance in manifest["instances"]
        if instance["name"] == "python-api" and instance["environment"] == "production"
    )
    candidate["source"]["branch"] = "feat/unsafe"

    errors = validate_manifest(manifest, REPO_ROOT)

    assert any("persistent branch must be 'main'" in error for error in errors)


def test_frozen_preview_requires_manual_only_watch_path():
    manifest = _manifest()
    candidate = next(
        instance for instance in manifest["instances"] if instance["name"] == "webapp-marketdata"
    )
    candidate["watchPatterns"] = ["/webapp/**"]

    errors = validate_manifest(manifest, REPO_ROOT)

    assert any("frozen service watchPatterns" in error for error in errors)


def test_manifest_detects_config_watch_path_drift(tmp_path):
    manifest = _manifest()
    candidate = next(
        instance
        for instance in manifest["instances"]
        if instance["name"] == "python-api" and instance["environment"] == "production"
    )
    isolated = copy.deepcopy(manifest)
    isolated["instances"] = [copy.deepcopy(candidate)]
    isolated["instances"][0]["configFile"] = "/drifted.json"
    (tmp_path / "drifted.json").write_text(
        json.dumps(
            {
                "build": {
                    "dockerfilePath": "api/Dockerfile.railway",
                    "watchPatterns": ["/**"],
                },
                "deploy": {
                    "healthcheckPath": "/health",
                    "restartPolicyType": "ON_FAILURE",
                },
            }
        )
    )
    (tmp_path / "api").mkdir()
    (tmp_path / "api" / "Dockerfile.railway").write_text("FROM scratch\n")

    errors = validate_manifest(isolated, tmp_path)

    assert any("watchPatterns differ" in error for error in errors)
