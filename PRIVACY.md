# Privacy Policy - Changelink

[English](PRIVACY.md) · [한국어](PRIVACY.ko.md)

Last updated: 2026-09-30

Changelink is a developer tool that connects Gerrit and Jira.

## What it stores

- The Gerrit URL and Jira URL you enter
- Your Jira account email
- Your Jira API token
- (Optional) your Gerrit username and HTTP password
- Settings such as the comment template, language, and quick action button position

All of it lives in `chrome.storage.local`, inside your own browser. None of it is sent
anywhere, including to the author of this extension. `chrome.storage.sync` is not used, so
nothing is copied to your other devices either.

## What it is used for

The email and API token are used only to authenticate against the Jira site you configured.
The requests made are issue lookups, remote links, comments, and status transitions.

To find the Gerrit changes related to a Jira issue, the extension sends a search request to
the Gerrit URL you configured. If you saved a Gerrit HTTP password, it authenticates with
that; otherwise it uses the Gerrit session you are already signed in with in the browser.

## What leaves your browser

There is no analytics, no advertising, and no server belonging to the author. The only
hosts contacted are the Gerrit URL and the Jira URL you typed into the options page, and
the extension holds no permission for any other site.

## Deleting your data

Clear the credential fields on the options page (Jira email and token, Gerrit username and
HTTP password) and save, and the stored values are removed. Uninstalling the extension deletes everything it stored.

## Contact

osntak@gmail.com
