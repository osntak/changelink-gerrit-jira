# Privacy Policy - Changelink

[English](PRIVACY.md) · [한국어](PRIVACY.ko.md)

Last updated: 2026-09-17

Changelink is a developer tool that connects Gerrit and Jira.

## What it stores

- The Gerrit URL and Jira URL you enter
- Your Jira account email
- Your Jira API token
- Settings such as the comment template, language, and quick action button position

All of it lives in `chrome.storage.local`, inside your own browser. None of it is sent
anywhere, including to the author of this extension. `chrome.storage.sync` is not used, so
nothing is copied to your other devices either.

## What it is used for

The email and API token are used only to authenticate against the Jira site you configured.
The requests made are issue lookups, remote links, comments, and status transitions.

## What leaves your browser

There is no analytics, no advertising, and no server belonging to the author. The only
hosts contacted are the Gerrit URL and the Jira URL you typed into the options page, and
the extension holds no permission for any other site.

## Deleting your data

Clear the email and token fields on the options page and save, and the stored credentials
are removed. Uninstalling the extension deletes everything it stored.

## Contact

osntak@gmail.com
