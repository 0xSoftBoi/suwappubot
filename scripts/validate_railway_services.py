#!/usr/bin/env python3
"""Validate Suwappu's committed Railway deployment policy.

Railway's project-level IaC does not yet express every deployment-safety
control.  This validator keeps branch policy, watch paths, Dockerfiles,
healthchecks, restart behavior, and service lifecycle reviewable until those
fields can be moved into `.railway/railway.ts` after a safe live import.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ALLOWED_LIFECYCLES = {"persistent", "manual", "preview", "managed"}
ALLOWED_KINDS = {"http", "worker", "job", "data"}
ALLOWED_SOURCE_TYPES = {"github", "external", "managed"}


def _repo_path(root: Path, value: str) -> Path:
    return root / value.lstrip("/")


def _normalized_repo_path(root_directory: str, value: str) -> str:
    root = root_directory.strip("/")
    path = value.strip("/")
    return "/" + "/".join(part for part in (root, path) if part)


def _read_json(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        errors.append(f"missing file: {path}")
        return None
    except json.JSONDecodeError as exc:
        errors.append(f"invalid JSON in {path}: {exc}")
        return None
    if not isinstance(value, dict):
        errors.append(f"expected a JSON object in {path}")
        return None
    return value


def validate_manifest(data: dict[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    branches = data.get("environmentBranches")
    instances = data.get("instances")
    repository = data.get("repository")

    if not isinstance(branches, dict) or not branches:
        errors.append("environmentBranches must be a non-empty object")
        branches = {}
    if not isinstance(instances, list) or not instances:
        return errors + ["instances must be a non-empty array"]
    if not isinstance(repository, str) or "/" not in repository:
        errors.append("repository must be in owner/name form")

    seen: set[tuple[str, str]] = set()
    service_ids: dict[str, str] = {}

    for index, instance in enumerate(instances):
        label = f"instances[{index}]"
        if not isinstance(instance, dict):
            errors.append(f"{label} must be an object")
            continue

        name = instance.get("name")
        environment = instance.get("environment")
        service_id = instance.get("serviceId")
        lifecycle = instance.get("lifecycle")
        kind = instance.get("kind")
        source = instance.get("source")
        label = f"{name or '?'}[{environment or '?'}]"

        if not all(isinstance(value, str) and value for value in (name, environment, service_id)):
            errors.append(f"{label}: name, environment, and serviceId are required strings")
            continue
        if environment not in branches:
            errors.append(f"{label}: unknown environment")
        if (name, environment) in seen:
            errors.append(f"{label}: duplicate service/environment instance")
        seen.add((name, environment))
        if name in service_ids and service_ids[name] != service_id:
            errors.append(f"{label}: serviceId differs from another {name} instance")
        service_ids[name] = service_id

        if lifecycle not in ALLOWED_LIFECYCLES:
            errors.append(f"{label}: invalid lifecycle {lifecycle!r}")
        if kind not in ALLOWED_KINDS:
            errors.append(f"{label}: invalid kind {kind!r}")
        if not isinstance(source, dict) or source.get("type") not in ALLOWED_SOURCE_TYPES:
            errors.append(f"{label}: source.type must be github, external, or managed")
            continue

        source_type = source["type"]
        watch_patterns = instance.get("watchPatterns", [])
        if source_type != "github":
            if lifecycle == "persistent":
                errors.append(f"{label}: persistent services must have a GitHub source")
            if watch_patterns:
                errors.append(f"{label}: non-GitHub services cannot declare watchPatterns")
            continue

        branch = source.get("branch")
        if not isinstance(branch, str) or not branch:
            errors.append(f"{label}: GitHub source requires a branch")
        if not isinstance(watch_patterns, list) or not all(
            isinstance(pattern, str) and pattern.startswith("/") for pattern in watch_patterns
        ):
            errors.append(f"{label}: watchPatterns must be non-empty repo-root absolute strings")
            watch_patterns = []

        if lifecycle == "persistent":
            expected_branch = branches.get(environment)
            if branch != expected_branch:
                errors.append(
                    f"{label}: persistent branch must be {expected_branch!r}, got {branch!r}"
                )
            if instance.get("waitForCi") is not True:
                errors.append(f"{label}: persistent GitHub services must wait for CI")
            if any(pattern.startswith("/.manual-deploy-only/") for pattern in watch_patterns):
                errors.append(f"{label}: persistent service uses a manual-only watch path")
            for field in ("rootDirectory", "configFile", "dockerfilePath"):
                if not isinstance(instance.get(field), str) or not instance[field]:
                    errors.append(f"{label}: persistent service requires {field}")
            if kind in {"http", "worker"} and not instance.get("healthcheckPath"):
                errors.append(f"{label}: persistent {kind} requires a healthcheckPath")
            if instance.get("restartPolicyType") != "ON_FAILURE":
                errors.append(f"{label}: persistent service restartPolicyType must be ON_FAILURE")
        elif lifecycle in {"manual", "preview"}:
            expected = f"/.manual-deploy-only/{name}/**"
            if watch_patterns != [expected]:
                errors.append(f"{label}: frozen service watchPatterns must be [{expected!r}]")
            if instance.get("waitForCi") is not False:
                errors.append(f"{label}: frozen services must set waitForCi=false")

        dockerfile = instance.get("dockerfilePath")
        if isinstance(dockerfile, str) and not _repo_path(repo_root, dockerfile).is_file():
            errors.append(f"{label}: dockerfile does not exist: {dockerfile}")

        config_file = instance.get("configFile")
        if not isinstance(config_file, str):
            continue
        config = _read_json(_repo_path(repo_root, config_file), errors)
        if config is None:
            continue

        build = config.get("build", {})
        deploy = config.get("deploy", {})
        root_directory = instance.get("rootDirectory", "/")
        config_dockerfile = build.get("dockerfilePath")
        if isinstance(config_dockerfile, str) and isinstance(dockerfile, str):
            normalized = _normalized_repo_path(root_directory, config_dockerfile)
            if normalized != dockerfile:
                errors.append(
                    f"{label}: {config_file} resolves Dockerfile to {normalized}, expected {dockerfile}"
                )
        if build.get("watchPatterns") != watch_patterns:
            errors.append(f"{label}: {config_file} watchPatterns differ from the service policy")
        if deploy.get("healthcheckPath") != instance.get("healthcheckPath"):
            errors.append(f"{label}: {config_file} healthcheckPath differs from the service policy")
        if deploy.get("restartPolicyType") != instance.get("restartPolicyType"):
            errors.append(
                f"{label}: {config_file} restartPolicyType differs from the service policy"
            )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?", default="railway.services.json")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    manifest_path = _repo_path(repo_root, args.manifest)
    errors: list[str] = []
    data = _read_json(manifest_path, errors)
    if data is not None:
        errors.extend(validate_manifest(data, repo_root))

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"Railway service policy failed with {len(errors)} error(s).")
        return 1

    print(f"Railway service policy is valid: {len(data['instances'])} instances checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
