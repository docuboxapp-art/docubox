"""Apply native PDF permissions and add incremental PAdES signatures via KMS."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import secrets
import sys
from datetime import datetime, timezone
from typing import Any

from asn1crypto import cms
from pyhanko.pdf_utils.crypt.permissions import StandardPermissions
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils.writer import copy_into_new_writer
from pyhanko.sign import fields, signers

from gcp_kms_adapter import build_docubox_kms_signer


SIGNATURE_RESERVATION_HEX_BYTES = 48_000
MAX_SIGNATURES = 32
BYTE_RANGE_PATTERN = re.compile(
    rb"/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]"
)


def _decode_pdf(value: Any) -> bytes:
    if not isinstance(value, str):
        raise ValueError("PDF_SECURITY_PDF_REQUIRED")
    decoded = base64.b64decode(value, validate=True)
    if not decoded.startswith(b"%PDF-"):
        raise ValueError("PDF_SECURITY_SOURCE_INVALID")
    return decoded


def _policy(value: Any) -> dict[str, bool]:
    if not isinstance(value, dict):
        raise ValueError("PDF_SECURITY_POLICY_REQUIRED")
    names = (
        "deny_print",
        "deny_copy_content",
        "deny_modify",
        "deny_page_extraction",
        "deny_document_assembly",
    )
    if any(name not in value or not isinstance(value[name], bool) for name in names):
        raise ValueError("PDF_SECURITY_POLICY_INVALID")
    return {name: value[name] for name in names}


def _permissions(policy: dict[str, bool]) -> StandardPermissions:
    permissions = StandardPermissions.allow_everything()

    if policy["deny_print"]:
        permissions &= ~(
            StandardPermissions.ALLOW_PRINTING
            | StandardPermissions.ALLOW_HIGH_QUALITY_PRINTING
        )
    if policy["deny_copy_content"]:
        permissions &= ~StandardPermissions.ALLOW_CONTENT_EXTRACTION
    if policy["deny_modify"]:
        permissions &= ~(
            StandardPermissions.ALLOW_MODIFICATION_GENERIC
            | StandardPermissions.ALLOW_ANNOTS_FORM_FILLING
            | StandardPermissions.ALLOW_FORM_FILLING
            | StandardPermissions.ALLOW_REASSEMBLY
        )
    if policy["deny_document_assembly"]:
        permissions &= ~StandardPermissions.ALLOW_REASSEMBLY
    if policy["deny_page_extraction"]:
        # ISO 32000 has no separate page-extraction bit. Disallowing content
        # extraction plus document assembly is the compatible standard mapping.
        permissions &= ~(
            StandardPermissions.ALLOW_CONTENT_EXTRACTION
            | StandardPermissions.ALLOW_REASSEMBLY
        )

    permissions |= StandardPermissions.ALLOW_ASSISTIVE_TECHNOLOGY
    return permissions


def _protect(pdf_bytes: bytes, policy: dict[str, bool], owner_password: str) -> bytes:
    reader = PdfFileReader(io.BytesIO(pdf_bytes))
    writer = copy_into_new_writer(reader)
    writer.encrypt(
        owner_pass=owner_password,
        user_pass="",
        perms=_permissions(policy),
    )
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _sign_incrementally(
    pdf_bytes: bytes,
    signer: signers.Signer,
    signature_index: int,
) -> bytes:
    writer = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
    writer.encrypt("")
    field_name = f"DocuboxCertificationSignature{signature_index}"
    output = io.BytesIO()
    signers.sign_pdf(
        writer,
        signature_meta=signers.PdfSignatureMetadata(
            field_name=field_name,
            md_algorithm="sha256",
            subfilter=fields.SigSeedSubFilter.PADES,
            reason="Certificacion criptografica Docubox",
            name="Docubox",
        ),
        signer=signer,
        new_field_spec=fields.SigFieldSpec(
            sig_field_name=field_name,
            on_page=0,
            box=(0, 0, 0, 0),
        ),
        bytes_reserved=SIGNATURE_RESERVATION_HEX_BYTES,
        output=output,
    )
    return output.getvalue()


def _last_signature(pdf_bytes: bytes) -> tuple[list[int], bytes]:
    matches = list(BYTE_RANGE_PATTERN.finditer(pdf_bytes))
    if not matches:
        raise ValueError("PDF_SECURITY_SIGNATURE_BYTERANGE_MISSING")
    values = [0, *(int(value) for value in matches[-1].groups())]
    first_end = values[1]
    second_start = values[2]
    gap = pdf_bytes[first_end:second_start]
    start = gap.find(b"<")
    end = gap.rfind(b">")
    if start < 0 or end <= start:
        raise ValueError("PDF_SECURITY_SIGNATURE_CONTENTS_MISSING")
    padded = bytes.fromhex(gap[start + 1 : end].decode("ascii"))
    cms_bytes = cms.ContentInfo.load(padded).dump()
    return values, cms_bytes


def protect_and_sign(request: dict[str, Any]) -> dict[str, Any]:
    pdf_bytes = _decode_pdf(request.get("pdf_base64"))
    policy = _policy(request.get("policy"))
    signature_count = request.get("signature_count", 1)
    if (
        not isinstance(signature_count, int)
        or isinstance(signature_count, bool)
        or signature_count < 1
        or signature_count > MAX_SIGNATURES
    ):
        raise ValueError("PDF_SECURITY_SIGNATURE_COUNT_INVALID")

    owner_password = secrets.token_urlsafe(48)
    try:
        signer = build_docubox_kms_signer(
            tenant_id=request.get("tenant_id"),
            idempotency_key=request.get("idempotency_key"),
        )
        result = _protect(pdf_bytes, policy, owner_password)
        for index in range(1, signature_count + 1):
            result = _sign_incrementally(result, signer, index)
        byte_range, cms_bytes = _last_signature(result)
        return {
            "ok": True,
            "pdf_base64": base64.b64encode(result).decode("ascii"),
            "pdf_sha256": hashlib.sha256(result).hexdigest(),
            "cms_base64": base64.b64encode(cms_bytes).decode("ascii"),
            "cms_sha256": hashlib.sha256(cms_bytes).hexdigest(),
            "byte_range": byte_range,
            "signature_algorithm": "RSA-PKCS1-SHA256",
            "digest_algorithm": "SHA-256",
            "signing_time": datetime.now(timezone.utc).isoformat(),
            "key_id": signer.key_id,
            "key_version": signer.key_version,
            "signature_count": signature_count,
            "encryption": "AES-256",
        }
    finally:
        owner_password = ""


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        if request.get("operation") == "health":
            response = {"ok": True, "runtime": "pyhanko"}
        elif request.get("operation") == "protect_and_sign":
            response = protect_and_sign(request)
        else:
            raise ValueError("PDF_SECURITY_OPERATION_INVALID")
        sys.stdout.write(json.dumps(response, separators=(",", ":")))
        return 0
    except Exception as error:
        code = str(error) if str(error).isupper() else "PDF_SECURITY_RUNTIME_FAILED"
        sys.stdout.write(json.dumps({"ok": False, "code": code}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
