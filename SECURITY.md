# Security policy

## Supported versions

Only the latest release of Maillo gets security fixes. Before reporting, check that the problem still happens on the [latest release](https://github.com/tim-jubinville/Maillo/releases/latest).

## Reporting a vulnerability

Please don't open a public issue for a security problem.

Report it privately through GitHub instead: go to the [Security tab](https://github.com/tim-jubinville/Maillo/security) and choose **Report a vulnerability**. Only the maintainer can see the report.

Please include:

- what an attacker could do, and what they would need (a signed-in user, access to the server, a crafted email, etc.)
- steps to reproduce, or a proof of concept
- the Maillo version (Settings → About) and your host type (PHP host or static host)
- which part is involved, if you know: the browser app, or one of the PHP files (`config.php`, `session.php`, `update.php`, `ai.php`, `push.php`)

You should get a first reply within a week. Once a fix is released, the report can be published as a security advisory, with credit to you if you want it.

## Scope

In scope: the code in this repository and the release zip.

Out of scope: Google's own services (Gmail, Google sign-in, Pub/Sub), which should be reported to [Google](https://bughunters.google.com/), and problems that come only from how a server is set up, such as a `maillo-config.php` that the web server serves as plain text.
