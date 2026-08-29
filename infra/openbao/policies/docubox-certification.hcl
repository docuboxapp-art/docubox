# Runtime AppRole policy. It can sign and verify, but never export or create keys.
path "transit/keys/docubox-development-document" {
  capabilities = ["read"]
}

path "transit/sign/docubox-development-document" {
  capabilities = ["update"]
}

path "transit/verify/docubox-development-document" {
  capabilities = ["update"]
}

path "transit/keys/docubox-development-evidence" {
  capabilities = ["read"]
}

path "transit/sign/docubox-development-evidence" {
  capabilities = ["update"]
}

path "transit/verify/docubox-development-evidence" {
  capabilities = ["update"]
}
