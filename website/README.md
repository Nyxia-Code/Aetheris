# Aetheris Website v1.0.5

Public, account-free website for aetherisbot.com. The aetherisbot.club domain remains supported during migration.

Pages:
- Home
- Download
- Setup
- Documentation
- Changelog
- Status
- Support
- Roadmap

This remains a static site. The status page checks https://api.aetherisbot.com/health; browser access requires the backend health CORS allowlist and website CSP to include the new domains.

Local preview:
`python3 -m http.server 8080`

Current hosting: Cloudflare Worker `aetheris` serves both `aetherisbot.com` and `aetherisbot.club`, including both `www` aliases. Tunnel `AetherisBot` serves `api.aetherisbot.com` and `api.aetherisbot.club` through the same backend. Preserve all existing routes. This TEST workspace migration does not deploy website or backend changes. See `DEPLOYMENT-GUIDE.txt` for migration prerequisites.
