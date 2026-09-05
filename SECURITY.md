# Security

Report vulnerabilities through this repository's private vulnerability reporting feature. Do not place tokens, environment files, receipts or accounting data in public issues.

Provide package/version and a synthetic reproduction. Revoke exposed credentials with the issuer; removing a Git commit does not revoke them.

Hosted bearer MCP is owner-only. Every request needs authentication, browser origins must be explicitly allowed, and remote local-file operations are disabled. A tool confirm flag relies on the client obtaining human approval; it is not tenant-aware authorization. See [hosting](docs/hosting.md).

Only the MCP packages are published from this repository. The Freddy application's source and private history are excluded.
