# Aetheris Website v1.0.1

Public, account-free website for aetherisbot.club.

Pages:
- Home
- Download
- Setup
- Documentation
- Changelog
- Status
- Support
- Roadmap

This remains a static site. The status page deliberately does not fake live service health; a public health check can be wired in later.

Local preview:
`python3 -m http.server 8080`

Deployment target: Cloudflare Pages for `aetherisbot.club`, while the existing Cloudflare Tunnel continues serving `api.aetherisbot.club`.
