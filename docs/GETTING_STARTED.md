# Your first trip through Converge

> **Quick start:** Install Node.js LTS, unzip the release, open Start.command (Mac) or Start.cmd (Windows), then follow the browser. The example people, trips and calendars are invented. Nothing is emailed.

GitHub is just where the download and source code live. You do not need a GitHub account or to understand the source code to try the app.

## A five-minute tour

1. Choose **Quinn Vale** in the top bar. Open **Example trips and outbox**, then **manage the Orchard sketching weekend**.
2. Compare the three date options. Reed is required; Avery has not responded. The organizer counts once. See why one date works better than another.
3. Choose **Reed North**, open the example's response link and try the four availability states and a favorite. Save, close the tab and return. Your answers remain saved.
4. Switch back to **Quinn Vale**, review a date and confirm it. Open the local outbox to read the generated message and download the actual calendar file.
5. As Quinn, reopen availability. Switch to Reed to change an answer, then return to Quinn and confirm again. The new confirmation is a separate version.
6. Open the main Converge page to make a plan of your own. Browse dates first, or check the fictional calendars. One deliberately unavailable calendar demonstrates how an incomplete check is labeled.

Choosing a persona changes the whole browser's demo session. Other open tabs must be reloaded before continuing under the new account. Separate browser profiles let you compare two people side by side.

## Where your work is saved

The folder `.local/demo` inside the app contains its local database and identity information. It may be hidden by your file browser. Keep the whole extracted app folder together. Closing the terminal does not erase your work; deleting the folder does. See [backup and upgrade](BACKUPS.md) before moving to another release.

“Anonymous visitor” uses a private return link for each response. Save that link if you want to return in another browser. Anyone who has it can edit that response. A normal invitation link and a private return link do different jobs.

The demo address starts with `127.0.0.1`, which means “this computer.” Sending that address to a friend will not give them access to your app. For a real shared installation, follow [hosting](HOSTING.md).

## If it does not open

- **Node is missing:** install Node.js LTS from its official website, then reopen Start.
- **Windows ZIP preview:** use Extract All, then open the Start.cmd inside the extracted folder.
- **Mac will not run the file:** open Terminal, type `bash `, drag Start.command into the terminal and press Return. Keep the space after bash.
- **Browser did not open:** copy the `http://127.0.0.1:5075` address from the terminal into your browser.
- **Address already in use or demo already open:** close the other Converge terminal with Control+C. After a forced crash, allow 30 seconds for the lock to become stale. Do not delete the saved data to fix a lock.
- **Download failed:** check your internet connection, then retry Start. Installation fetches packages; the running local demo requires no network services.
- **Saved database version mismatch:** stop and make a backup, then follow the owner migration steps in [BACKUPS.md](BACKUPS.md). Startup does not silently change an old database.

If asking for help, include your operating system, Node version (`node --version`) and the error message. Remove folder names, email addresses, links with private return tokens and credentials before posting anything publicly.
