"""How a source gets to an explorer, and to which explorer.

Two things went wrong here, and neither announced itself.

The v2 API takes one host and one key and picks the explorer from `chainid` --
and it reads that parameter from the *query string*, for a POST as much as for
a GET.  boa's verifier sends it in the form body, so every submission that was
not to mainnet came back "Missing or unsupported chainid parameter".  Before
that, the chain id was not being set at all, so every submission went to
chain 1, where the first deployment had already verified the code: fourteen
chains were told "already verified" about mainnet's copy.

Then, having satisfied the API, gnosis still showed "Verify & publish" to
anyone who opened it -- Etherscan retired gnosisscan.io and the domain now
serves Blockscout, which keeps its own database and takes a different payload.
So a chain is verified when the place people open it is, and both submissions
are pinned below.
"""

from __future__ import annotations

import io
import json
import urllib.parse
import urllib.request

import pytest

from erouter.dev import deploy

ROUTER = deploy.REPO / "contracts" / "ElectricRouter.vy"


class Fake:
    """Every request the module would have made, and what to answer with."""

    def __init__(self):
        self.seen: list[dict] = []
        self.reply = {"status": "1", "message": "OK", "result": "theguid"}


@pytest.fixture
def fake(monkeypatch):
    caught = Fake()

    def urlopen(request, timeout=None):
        body = request.data.decode() if request.data else ""
        caught.seen.append({
            "url": request.full_url,
            "body": body,
            "query": dict(urllib.parse.parse_qsl(
                urllib.parse.urlparse(request.full_url).query,
                keep_blank_values=True)),
            "form": dict(urllib.parse.parse_qsl(body, keep_blank_values=True)),
        })
        return io.BytesIO(json.dumps(caught.reply).encode())

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return caught


def test_a_submission_carries_the_chain_in_its_query_string(fake):
    guid = deploy.submit_source(100, "0x" + "11" * 20, ROUTER, "key")
    assert guid == "theguid"
    sent = fake.seen[0]
    assert sent["query"]["chainid"] == "100", (
        "chainid in the body alone is what the v2 API rejects, and it rejects "
        "it with a message about a missing parameter rather than a wrong one")
    assert sent["form"]["action"] == "verifysourcecode"


def test_a_read_carries_it_too(fake):
    deploy.explorer_ask(100, "key", module="contract", action="getsourcecode")
    assert fake.seen[0]["query"]["chainid"] == "100"
    assert fake.seen[0]["form"] == {}, "a read is a GET"


def test_the_submission_names_the_contract_the_way_etherscan_matches_it(fake):
    deploy.submit_source(1, "0x" + "11" * 20, ROUTER, "key")
    form = fake.seen[0]["form"]
    assert form["contractname"] == "contracts/ElectricRouter.vy:ElectricRouter"
    assert form["compilerversion"].startswith("vyper:0."), form["compilerversion"]
    # Constructor-free is what makes the CREATE2 address the initcode's alone;
    # anything here would mean the deployed address was not what was computed.
    assert form["constructorArguments"] == ""
    bundle = json.loads(form["sourceCode"])
    assert "contracts/ElectricRouter.vy" in bundle["sources"]


def test_a_chain_the_api_does_not_serve_is_not_reported_as_unverified(fake):
    """xlayer and tac answer NOTOK.  Reading that as "no source" would send a
    submission the explorer was never going to look at."""
    fake.reply = {"status": "0", "message": "NOTOK",
                  "result": "Missing or unsupported chainid parameter"}
    with pytest.raises(RuntimeError, match="unsupported chainid"):
        deploy.explorer_source(196, "0x" + "11" * 20, "key")


def test_the_bundle_blockscout_gets_is_only_what_vyper_takes():
    """boa hangs `compiler_version` and `integrity` off the standard input.
    Etherscan ignores them; Blockscout hands the bundle to vyper, which does
    not, so the extras have to come off before it goes."""
    bundle, version = deploy.standard_json(ROUTER)
    assert set(bundle) == {"language", "sources", "settings"}
    assert version.startswith("v0.4."), version
    assert "contracts/ElectricRouter.vy" in bundle["sources"]


def test_a_blockscout_submission_is_multipart_at_the_vyper_endpoint(fake):
    fake.reply = {"message": "Smart-contract verification started"}
    deploy.blockscout_submit("https://gnosisscan.io", "0x" + "11" * 20, ROUTER)
    sent = fake.seen[0]
    assert sent["url"] == (
        "https://gnosisscan.io/api/v2/smart-contracts/0x" + "11" * 20
        + "/verification/via/vyper-standard-input")
    assert 'name="compiler_version"' in sent["body"]
    assert 'filename="standard.json"' in sent["body"]


def test_a_blockscout_that_starts_no_job_says_so_at_once(fake):
    """Rather than a minute of polling for a verification nobody is running."""
    fake.reply = {"message": "Smart-contract is already verified."}
    with pytest.raises(RuntimeError, match="already verified"):
        deploy.blockscout_submit("https://gnosisscan.io", "0x" + "11" * 20, ROUTER)


def test_an_indexed_but_unverified_address_reads_as_no_source(fake):
    """Blockscout answers 200 with nulls for a contract it has never had
    source for.  Reading that as source would report the job done."""
    fake.reply = {"is_verified": None, "source_code": None, "name": None}
    assert deploy.blockscout_source("https://gnosisscan.io", "0x" + "11" * 20) is None


def test_every_blockscout_host_is_absolute_and_bare():
    """The paths are appended, so a trailing slash or a missing scheme makes a
    URL that 404s rather than one that fails to build."""
    for name, host in deploy.BLOCKSCOUT.items():
        assert host.startswith("https://"), name
        assert not host.endswith("/"), name
