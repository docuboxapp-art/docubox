# Operator-only policy. Do not attach this policy to the Docubox runtime AppRole.
path "sys/mounts/transit" {
  capabilities = ["read", "create", "update"]
}

path "transit/keys/docubox-development-*" {
  capabilities = ["create", "read", "update"]
}
