import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_CALENDARS = (
    "https://a.pool.opentimestamps.org",
    "https://b.pool.opentimestamps.org",
    "https://a.pool.eternitywall.com",
    "https://ots.btc.catallaxy.com",
)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
HEIGHT_RE = re.compile(r"BitcoinBlockHeaderAttestation\((\d+)\)", re.IGNORECASE)
FILE_HASH_RE = re.compile(r"File sha256 hash:\s*([a-f0-9]{64})", re.IGNORECASE)


class OtsRuntimeError(Exception):
    def __init__(self, code: str, message: str, status: int = 500):
        super().__init__(message)
        self.code = code
        self.status = status


def configured_calendars() -> list[str]:
    raw = os.environ.get("OPENTIMESTAMPS_CALENDARS", "")
    return list(dict.fromkeys(item.strip() for item in raw.split(",") if item.strip())) or list(
        DEFAULT_CALENDARS
    )


def _validated_calendars(requested: Any) -> list[str]:
    allowed = configured_calendars()
    if requested is None:
        return allowed
    if not isinstance(requested, list) or not requested:
        raise OtsRuntimeError("OTS_CALENDAR_UNAVAILABLE", "No calendars were configured.", 400)
    if any(not isinstance(item, str) or item not in allowed for item in requested):
        raise OtsRuntimeError("OTS_CALENDAR_UNAVAILABLE", "Calendar is not allowlisted.", 400)
    return list(dict.fromkeys(requested))


def _decode(value: Any, field: str, max_bytes: int = 8 * 1024 * 1024) -> bytes:
    if not isinstance(value, str) or not value:
        raise OtsRuntimeError("OTS_INVALID_PROOF", f"{field} is required.", 400)
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as error:
        raise OtsRuntimeError("OTS_INVALID_PROOF", f"{field} is not valid base64.", 400) from error
    if not decoded or len(decoded) > max_bytes:
        raise OtsRuntimeError("OTS_INVALID_PROOF", f"{field} has an invalid size.", 400)
    return decoded


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _global_args(calendars: list[str]) -> list[str]:
    args = ["--no-default-whitelist"]
    for calendar in calendars:
        args.extend(["--whitelist", calendar])
    return args


def _run(args: list[str], cwd: str, allow_pending: bool = False) -> tuple[str, int]:
    timeout = min(max(int(os.environ.get("OPENTIMESTAMPS_TIMEOUT_MS", "30000")), 5000), 120000)
    try:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from otsclient.ots import main; main()",
                *args,
            ],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout / 1000,
            check=False,
        )
    except FileNotFoundError as error:
        raise OtsRuntimeError("OTS_CLIENT_UNAVAILABLE", "OpenTimestamps client is unavailable.") from error
    except subprocess.TimeoutExpired as error:
        raise OtsRuntimeError("OTS_CALENDAR_UNAVAILABLE", "OpenTimestamps operation timed out.", 504) from error
    output = f"{result.stdout}\n{result.stderr}".strip()
    pending = "timestamp not complete" in output.lower() or "pending confirmation" in output.lower()
    if result.returncode != 0 and not (allow_pending and pending):
        lowered = output.lower()
        if "not a timestamp file" in lowered or "invalid timestamp" in lowered:
            code = "OTS_INVALID_PROOF"
        elif "calendar" in lowered or "timed out" in lowered:
            code = "OTS_CALENDAR_UNAVAILABLE"
        else:
            code = "OTS_STAMP_FAILED" if "stamp" in args else "OTS_UPGRADE_FAILED"
        raise OtsRuntimeError(code, "OpenTimestamps operation failed.")
    return output, result.returncode


def _inspection(output: str) -> dict[str, Any]:
    heights = [int(match) for match in HEIGHT_RE.findall(output)]
    height = min(heights) if heights else None
    pending = "PendingAttestation" in output or "pending confirmation" in output.lower()
    return {
        "proofIntegrity": True,
        "pending": bool(pending and height is None),
        "bitcoinAttestationFound": height is not None,
        "bitcoinBlockHeight": height,
        "bitcoinBlockHash": None,
        "bitcoinAttestedAt": None,
        "rawSummary": "Bitcoin attestation found." if height is not None else "Pending Bitcoin anchoring.",
    }


def _write_proof(directory: str, proof: bytes, expected_hash: Any) -> Path:
    if not isinstance(expected_hash, str) or not SHA256_RE.fullmatch(expected_hash):
        raise OtsRuntimeError("OTS_PROOF_HASH_MISMATCH", "Proof hash is invalid.", 400)
    if _digest(proof) != expected_hash:
        raise OtsRuntimeError("OTS_PROOF_HASH_MISMATCH", "Proof hash does not match.", 409)
    proof_path = Path(directory) / "document.ots"
    proof_path.write_bytes(proof)
    return proof_path


def stamp(payload: dict[str, Any]) -> dict[str, Any]:
    manifest = _decode(payload.get("manifestBase64"), "manifestBase64")
    manifest_hash = payload.get("manifestHash")
    if not isinstance(manifest_hash, str) or _digest(manifest) != manifest_hash:
        raise OtsRuntimeError("OTS_INVALID_PROOF", "Manifest hash does not match submitted bytes.", 409)
    calendars = _validated_calendars(payload.get("calendars"))
    with tempfile.TemporaryDirectory(prefix="docubox-ots-") as directory:
        manifest_path = Path(directory) / "blockchain-evidence-manifest.json"
        manifest_path.write_bytes(manifest)
        args = [*_global_args(calendars), "stamp"]
        for calendar in calendars:
            args.extend(["--calendar", calendar])
        args.extend(["-m", str(min(2, len(calendars))), str(manifest_path)])
        output, _ = _run(args, directory)
        proof_path = Path(f"{manifest_path}.ots")
        if not proof_path.exists():
            raise OtsRuntimeError("OTS_INVALID_PROOF", "OpenTimestamps did not create a proof.")
        proof = proof_path.read_bytes()
        if len(proof) < 32:
            raise OtsRuntimeError("OTS_INVALID_PROOF", "OpenTimestamps proof is empty or corrupt.")
        info, _ = _run(["info", str(proof_path)], directory)
        proof_file_hash = FILE_HASH_RE.search(info)
        if not proof_file_hash or proof_file_hash.group(1).lower() != manifest_hash:
            raise OtsRuntimeError("OTS_INVALID_PROOF", "Proof is not bound to the manifest hash.")
        failed = [calendar for calendar in calendars if calendar in output and "fail" in output.lower()]
        return {
            "proofBase64": base64.b64encode(proof).decode("ascii"),
            "proofSha256": _digest(proof),
            "proofSize": len(proof),
            "calendarsSucceeded": [item for item in calendars if item not in failed],
            "calendarsFailed": failed,
            "inspection": _inspection(info),
        }


def inspect_proof(payload: dict[str, Any]) -> dict[str, Any]:
    proof = _decode(payload.get("proofBase64"), "proofBase64")
    with tempfile.TemporaryDirectory(prefix="docubox-ots-") as directory:
        proof_path = _write_proof(directory, proof, payload.get("proofSha256"))
        output, _ = _run(["info", str(proof_path)], directory)
        return {"inspection": _inspection(output)}


def upgrade(payload: dict[str, Any]) -> dict[str, Any]:
    proof = _decode(payload.get("proofBase64"), "proofBase64")
    calendars = _validated_calendars(payload.get("calendars"))
    with tempfile.TemporaryDirectory(prefix="docubox-ots-") as directory:
        proof_path = _write_proof(directory, proof, payload.get("proofSha256"))
        args = [*_global_args(calendars), "upgrade"]
        for calendar in calendars:
            args.extend(["--calendar", calendar])
        args.append(str(proof_path))
        _run(args, directory, allow_pending=True)
        updated = proof_path.read_bytes()
        info, _ = _run(["info", str(proof_path)], directory)
        return {
            "proofBase64": base64.b64encode(updated).decode("ascii"),
            "proofSha256": _digest(updated),
            "proofSize": len(updated),
            "changed": updated != proof,
            "inspection": _inspection(info),
        }


def verify(payload: dict[str, Any]) -> dict[str, Any]:
    proof = _decode(payload.get("proofBase64"), "proofBase64")
    manifest_hash = payload.get("manifestHash")
    if not isinstance(manifest_hash, str) or not SHA256_RE.fullmatch(manifest_hash):
        raise OtsRuntimeError("OTS_VERIFY_FAILED", "Manifest hash is invalid.", 400)
    with tempfile.TemporaryDirectory(prefix="docubox-ots-") as directory:
        proof_path = _write_proof(directory, proof, payload.get("proofSha256"))
        info_output, _ = _run(["info", str(proof_path)], directory)
        inspection = _inspection(info_output)
        proof_file_hash = FILE_HASH_RE.search(info_output)
        manifest_matches = bool(
            proof_file_hash and proof_file_hash.group(1).lower() == manifest_hash.lower()
        )
        if not manifest_matches:
            return {
                "verification": {
                    **inspection,
                    "manifestHashMatches": False,
                    "bitcoinVerified": False,
                    "verificationUnavailable": False,
                }
            }
        rpc_url = os.environ.get("BITCOIN_RPC_URL", "").strip()
        if not inspection["bitcoinAttestationFound"] or not rpc_url:
            return {
                "verification": {
                    **inspection,
                    "manifestHashMatches": manifest_matches,
                    "bitcoinVerified": False,
                    "verificationUnavailable": bool(inspection["bitcoinAttestationFound"] and not rpc_url),
                }
            }
        output, _ = _run(
            ["--bitcoin-node", rpc_url, "verify", "-d", manifest_hash, str(proof_path)],
            directory,
        )
        verified = "success" in output.lower() and "attests" in output.lower()
        return {
            "verification": {
                **inspection,
                "manifestHashMatches": "digest provided does not match" not in output.lower(),
                "bitcoinVerified": verified,
                "verificationUnavailable": False,
            }
        }


def health() -> dict[str, Any]:
    calendars = configured_calendars()
    reachable = 0
    for calendar in calendars:
        try:
            request = urllib.request.Request(calendar, method="HEAD")
            urllib.request.urlopen(request, timeout=3).close()
            reachable += 1
        except urllib.error.HTTPError:
            reachable += 1
        except Exception:
            pass
    try:
        import otsclient
        import otsclient.ots  # noqa: F401

        version = f"opentimestamps-client {otsclient.__version__}"
        available = True
        error_code = None
        diagnostic = None
    except Exception as error:
        version = ""
        available = False
        error_code = "OTS_CLIENT_UNAVAILABLE"
        diagnostic = f"{type(error).__name__}: {str(error)[:160]}"
    return {
        "health": {
            "available": available,
            "clientVersion": version[:120] or None,
            "calendarsReachable": reachable,
            "calendarsConfigured": len(calendars),
            "errorCode": error_code,
            "diagnostic": diagnostic,
        }
    }


def execute(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action == "stamp":
        return stamp(payload)
    if action == "upgrade":
        return upgrade(payload)
    if action == "inspect":
        return inspect_proof(payload)
    if action == "verify":
        return verify(payload)
    if action == "health":
        return health()
    raise OtsRuntimeError("OTS_RUNTIME_UNSUPPORTED", "Unsupported operation.", 400)


def json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode("utf-8")
