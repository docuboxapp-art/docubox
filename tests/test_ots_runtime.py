import base64
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ots_worker_runtime import core


class OpenTimestampsRuntimeTests(unittest.TestCase):
    def test_stamp_hashes_exact_manifest_bytes_and_returns_non_empty_proof(self):
        manifest = b'{"schema":"docubox.test"}'
        manifest_hash = hashlib.sha256(manifest).hexdigest()

        def fake_run(args, cwd, allow_pending=False):
            if "stamp" in args:
                manifest_path = Path(args[-1])
                Path(f"{manifest_path}.ots").write_bytes(b"realistic-ots-proof-fixture" * 2)
                return "Submitting to remote calendar", 0
            return (
                f"File sha256 hash: {manifest_hash}\n"
                "PendingAttestation('https://a.pool.opentimestamps.org')",
                0,
            )

        with patch.object(core, "_run", side_effect=fake_run):
            result = core.stamp(
                {
                    "manifestBase64": base64.b64encode(manifest).decode("ascii"),
                    "manifestHash": manifest_hash,
                    "calendars": ["https://a.pool.opentimestamps.org"],
                }
            )
        proof = base64.b64decode(result["proofBase64"])
        self.assertGreater(len(proof), 32)
        self.assertEqual(result["proofSha256"], hashlib.sha256(proof).hexdigest())

    def test_stamp_rejects_manifest_hash_mismatch(self):
        with self.assertRaisesRegex(core.OtsRuntimeError, "Manifest hash"):
            core.stamp(
                {
                    "manifestBase64": base64.b64encode(b"manifest").decode("ascii"),
                    "manifestHash": "0" * 64,
                    "calendars": ["https://a.pool.opentimestamps.org"],
                }
            )

    def test_non_allowlisted_calendar_is_rejected(self):
        with self.assertRaises(core.OtsRuntimeError) as raised:
            core._validated_calendars(["https://example.com"])
        self.assertEqual(raised.exception.code, "OTS_CALENDAR_UNAVAILABLE")

    def test_corrupt_proof_hash_is_rejected_before_cli_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(core.OtsRuntimeError) as raised:
                core._write_proof(directory, b"proof", "0" * 64)
        self.assertEqual(raised.exception.code, "OTS_PROOF_HASH_MISMATCH")

    def test_pending_upgrade_is_not_promoted_to_verified(self):
        proof = b"pending-ots-proof" * 4
        proof_hash = hashlib.sha256(proof).hexdigest()
        with patch.object(
            core,
            "_run",
            return_value=("PendingAttestation('https://a.pool.opentimestamps.org')", 1),
        ):
            result = core.upgrade(
                {
                    "proofBase64": base64.b64encode(proof).decode("ascii"),
                    "proofSha256": proof_hash,
                    "calendars": ["https://a.pool.opentimestamps.org"],
                }
            )
        self.assertFalse(result["changed"])
        self.assertFalse(result["inspection"]["bitcoinAttestationFound"])

    def test_verify_without_bitcoin_node_remains_unverified(self):
        proof = b"anchored-ots-proof" * 4
        proof_hash = hashlib.sha256(proof).hexdigest()
        with patch.dict("os.environ", {"BITCOIN_RPC_URL": ""}), patch.object(
            core,
            "_run",
            return_value=(
                f"File sha256 hash: {'a' * 64}\nBitcoinBlockHeaderAttestation(900000)",
                0,
            ),
        ):
            result = core.verify(
                {
                    "proofBase64": base64.b64encode(proof).decode("ascii"),
                    "proofSha256": proof_hash,
                    "manifestHash": "a" * 64,
                }
            )
        verification = result["verification"]
        self.assertTrue(verification["bitcoinAttestationFound"])
        self.assertFalse(verification["bitcoinVerified"])
        self.assertTrue(verification["verificationUnavailable"])


if __name__ == "__main__":
    unittest.main()
