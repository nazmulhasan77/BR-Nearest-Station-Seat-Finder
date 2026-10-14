# Privacy Policy for BR Nearest Station Seat Finder

**Last Updated:** October 2026

BR Nearest Station Seat Finder ("the Extension") is committed to protecting your privacy. This Privacy Policy explains our practices regarding user information.

## 1. Information Collection and Usage
The Extension does **not** collect, store, sell, or transmit any personally identifiable information (PII) to any external third-party server or developer-controlled database.

- **Local Preferences:** Any configuration options (such as search detour limits, max pairs, or auto-refresh intervals) are stored entirely locally on your device via Chrome's `storage.local` API.
- **Search Queries:** When you search on `eticket.railway.gov.bd`, the Extension reads the trip parameters (origin, destination, date, class) and temporary session headers directly from your browser's local session to query seat availability from Bangladesh Railway's public ticket API endpoint (`railspaapi.shohoz.com`). No personal details, credentials, or passenger data are gathered or saved.
- **No Analytics / No Tracking:** The Extension does not contain any third-party analytics, tracking scripts, or advertising trackers.

## 2. Permissions Justification
- **`storage`**: Used exclusively to save your customized preferences (e.g., maximum detour distance, notification toggles) locally in your browser.
- **`notifications`**: Used solely to display desktop notifications when seats become available after an automated background search.
- **Host Permissions (`https://eticket.railway.gov.bd/*`)**: Needed to detect active journey searches and inject the helper user interface panel into the search results page.
- **Host Permissions (`https://railspaapi.shohoz.com/*`)**: Needed to execute read-only API requests to check train seat availability for alternative nearby station pairs.

## 3. Data Sharing
We do not sell, rent, trade, or transfer any data to outside parties.

## 4. Changes to This Policy
Any future updates to this policy will be posted on this page.

## 5. Contact
If you have any questions or feedback regarding this Privacy Policy, please contact the developer via the official repository or support channel.
