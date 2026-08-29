# Development-only OpenBao configuration. Docker binds this listener to loopback.
# Remote deployments must enable TLS and use a managed secret store for unseal keys.
ui = true
disable_mlock = true

api_addr = "http://127.0.0.1:8200"

storage "file" {
  path = "/openbao/data"
}

listener "tcp" {
  address = "0.0.0.0:8200"
  tls_disable = 1
}
