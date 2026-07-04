# Security policy

## Supported version

The latest deploy at https://makeitmarkdown.pages.dev — it's a static
site with no server, accounts, or stored user data; every push to
`main` is the current version.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability**
on this repository. Please don't open public issues for security
reports.

## What's in scope

Conversion runs entirely client-side, so the interesting surface is
parser behavior on hostile files: crafted documents that smuggle
script/markup through a parser into the preview or the original-file
viewers (XSS), service-worker cache poisoning, or anything that makes
a converted file's content leave the browser. Reports that include a
minimal sample file are the fastest to fix — the parsers are
test-driven.
