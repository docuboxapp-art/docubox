"""pyHanko signer backed by Docubox's existing KMS provider set."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from asn1crypto import algos, x509
from pyhanko.sign import signers
from pyhanko_certvalidator.registry import SimpleCertificateStore


class KmsBridgeError(RuntimeError):
    """Normalized bridge failure with no provider response details."""


@dataclass(frozen=True)
class KmsPublicIdentity:
    signing_certificate: x509.Certificate
    certificate_chain: tuple[x509.Certificate, ...]
    algorithm: str
    key_size_bits: int
    key_id: str
    key_version: str


class DocuboxKmsBridge:
    def __init__(
        self,
        command: Sequence[str] | None = None,
        cwd: Path | None = None,
        tenant_id: str | None = None,
        idempotency_key: str | None = None,
    ):
        root = Path(__file__).resolve().parents[2]
        bridge = root / "scripts" / "docubox-pyhanko-kms-bridge.mjs"
        self.command = tuple(
            command or (os.environ.get("DOCUBOX_NODE_BIN", "node"), str(bridge))
        )
        self.cwd = cwd or root
        self.tenant_id = tenant_id
        self.idempotency_key = idempotency_key

    def _call(self, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        completed = subprocess.run(
            [*self.command, operation],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            cwd=self.cwd,
            check=False,
        )
        try:
            response = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise KmsBridgeError("PYHANKO_KMS_BRIDGE_RESPONSE_INVALID") from error
        if completed.returncode != 0 or response.get("ok") is not True:
            raise KmsBridgeError(
                str(response.get("code") or "PYHANKO_KMS_BRIDGE_FAILED")
            )
        return response

    def describe(self) -> KmsPublicIdentity:
        response = self._call("describe", {})
        if (
            response.get("algorithm") != "RSA-PKCS1-SHA256"
            or response.get("key_size_bits") != 3072
        ):
            raise KmsBridgeError("PYHANKO_KMS_BRIDGE_KEY_POLICY_INVALID")
        try:
            certificate = x509.Certificate.load(
                _pem_to_der(str(response["signing_certificate_pem"]))
            )
            chain = tuple(
                x509.Certificate.load(_pem_to_der(str(pem)))
                for pem in response.get("certificate_chain_pem", [])
            )
            return KmsPublicIdentity(
                signing_certificate=certificate,
                certificate_chain=chain,
                algorithm=str(response["algorithm"]),
                key_size_bits=int(response["key_size_bits"]),
                key_id=str(response["key_id"]),
                key_version=str(response["key_version"]),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise KmsBridgeError("PYHANKO_KMS_BRIDGE_CERTIFICATE_INVALID") from error

    def sign_raw(self, data: bytes, digest_algorithm: str) -> bytes:
        if digest_algorithm.lower() != "sha256":
            raise KmsBridgeError("PYHANKO_KMS_BRIDGE_DIGEST_UNSUPPORTED")
        response = self._call(
            "sign",
            {
                "digest_algorithm": "sha256",
                "data_base64": base64.b64encode(data).decode("ascii"),
                "tenant_id": self.tenant_id,
                "idempotency_key": self.idempotency_key,
            },
        )
        if (
            response.get("algorithm") != "RSA-PKCS1-SHA256"
            or response.get("key_size_bits") != 3072
        ):
            raise KmsBridgeError("PYHANKO_KMS_BRIDGE_SIGNATURE_POLICY_INVALID")
        try:
            return base64.b64decode(str(response["signature_base64"]), validate=True)
        except (KeyError, ValueError) as error:
            raise KmsBridgeError("PYHANKO_KMS_BRIDGE_SIGNATURE_INVALID") from error


class DocuboxKmsSigner(signers.Signer):
    def __init__(self, bridge: DocuboxKmsBridge, identity: KmsPublicIdentity):
        registry = SimpleCertificateStore()
        for certificate in identity.certificate_chain:
            registry.register(certificate)
        super().__init__(
            signing_cert=identity.signing_certificate,
            cert_registry=registry,
            signature_mechanism=algos.SignedDigestAlgorithm(
                {"algorithm": "sha256_rsa"}
            ),
            prefer_pss=False,
            embed_roots=True,
        )
        self._bridge = bridge
        self.key_id = identity.key_id
        self.key_version = identity.key_version

    async def async_sign_raw(
        self, data: bytes, digest_algorithm: str, dry_run: bool = False
    ) -> bytes:
        if dry_run:
            return bytes(384)
        return await asyncio.to_thread(
            self._bridge.sign_raw, data, digest_algorithm
        )


def build_docubox_kms_signer(
    tenant_id: str | None = None, idempotency_key: str | None = None
) -> DocuboxKmsSigner:
    bridge = DocuboxKmsBridge(
        tenant_id=tenant_id, idempotency_key=idempotency_key
    )
    return DocuboxKmsSigner(bridge, bridge.describe())


def _pem_to_der(pem: str) -> bytes:
    lines = [
        line.strip() for line in pem.splitlines() if not line.startswith("-----")
    ]
    if not lines:
        raise ValueError("empty certificate")
    return base64.b64decode("".join(lines), validate=True)
